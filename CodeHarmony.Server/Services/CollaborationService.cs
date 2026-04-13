using CodeHarmony.Server.Models;
using System.Collections.Concurrent;

namespace CodeHarmony.Server.Services;

public interface ICollaborationService
{
    Dictionary<string, string> Files     { get; }
    ConcurrentDictionary<string, ClientState>  Clients   { get; }
    ConcurrentDictionary<string, ConflictInfo> Conflicts { get; }
    List<LogEntry> ServerLog { get; }

    ClientState         GetOrCreate(string connectionId);
    List<PresenceInfo>  GetPresenceList();
    void                Log(string msg, string type = "info");
    void                InitClientFiles(string connectionId);
    void                SetClientCode(string connectionId, string filename, string code);
    void                SyncAllClientsToFile(string filename, string code);
    Dictionary<string,string> GetAllClientCodes(string filename);
    (bool detected, bool updated, ConflictInfo? conflict) DetectConflicts(string filename);
    void                RemoveClient(string connectionId);
}

public class CollaborationService : ICollaborationService
{
    private static readonly Dictionary<string, string> DefaultFiles = new()
    {
        ["Program.cs"] =
@"using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IAuthService, AuthService>();

var app = builder.Build();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
",
        ["AuthService.cs"] =
@"using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace CodeHarmony.Services
{
    public interface IAuthService
    {
        Task<string> LoginAsync(string username, string password);
        Task<bool>   LogoutAsync(string sessionId);
        Task<bool>   ValidateTokenAsync(string token);
    }

    public class AuthService : IAuthService
    {
        private readonly Dictionary<string, Session> _sessions = new();
        private readonly IUserService _userService;

        public AuthService(IUserService userService)
        {
            _userService = userService;
        }

        public async Task<string> LoginAsync(string username, string password)
        {
            var user = await _userService.FindByUsernameAsync(username);
            if (user == null)
                throw new UnauthorizedAccessException(""User not found"");

            if (!VerifyPassword(password, user.PasswordHash))
                throw new UnauthorizedAccessException(""Invalid password"");

            var token = GenerateToken();
            _sessions[token] = new Session
            {
                UserId    = user.Id,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddHours(1)
            };
            return token;
        }

        public async Task<bool> LogoutAsync(string sessionId)
            => await Task.FromResult(_sessions.Remove(sessionId));

        public async Task<bool> ValidateTokenAsync(string token)
        {
            if (!_sessions.TryGetValue(token, out var session))
                return false;
            return await Task.FromResult(session.ExpiresAt > DateTime.UtcNow);
        }

        private static bool VerifyPassword(string plain, string hash) => plain == hash;

        private static string GenerateToken()
            => Convert.ToBase64String(Guid.NewGuid().ToByteArray())
                      .Replace(""="", """").Replace(""+"", """").Replace(""/"", """");
    }

    public record Session
    {
        public int      UserId    { get; init; }
        public DateTime CreatedAt { get; init; }
        public DateTime ExpiresAt { get; init; }
    }
}
",
        ["UserService.cs"] =
@"using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace CodeHarmony.Services
{
    public interface IUserService
    {
        Task<User?>             FindByUsernameAsync(string username);
        Task<User?>             FindByIdAsync(int id);
        Task<User>              CreateUserAsync(string username, string email, string password);
        Task<bool>              DeleteUserAsync(int id);
        Task<IEnumerable<User>> GetAllUsersAsync();
    }

    public class UserService : IUserService
    {
        private readonly List<User> _users = new();
        private int _nextId = 1;

        public async Task<User?> FindByUsernameAsync(string username)
            => await Task.FromResult(_users.FirstOrDefault(u => u.Username == username));

        public async Task<User?> FindByIdAsync(int id)
            => await Task.FromResult(_users.FirstOrDefault(u => u.Id == id));

        public async Task<User> CreateUserAsync(string username, string email, string password)
        {
            var user = new User
            {
                Id           = _nextId++,
                Username     = username,
                Email        = email,
                PasswordHash = password,
                CreatedAt    = DateTime.UtcNow
            };
            _users.Add(user);
            return await Task.FromResult(user);
        }

        public async Task<bool> DeleteUserAsync(int id)
        {
            var user = _users.FirstOrDefault(u => u.Id == id);
            if (user == null) return false;
            _users.Remove(user);
            return await Task.FromResult(true);
        }

        public async Task<IEnumerable<User>> GetAllUsersAsync()
            => await Task.FromResult(_users.AsEnumerable());
    }

    public record User
    {
        public int      Id           { get; init; }
        public string   Username     { get; init; } = """";
        public string   Email        { get; init; } = """";
        public string   PasswordHash { get; init; } = """";
        public DateTime CreatedAt    { get; init; }
    }
}
",
        ["MathHelper.cs"] =
@"using System;

namespace CodeHarmony.Utils
{
    /// <summary>
    /// CONFLICT DEMO FILE — Try editing Validate() in two browser tabs!
    /// Tab 1 → type:  if(x &lt; 3) return 0;
    /// Tab 2 → type:  if(x &gt; 10) return 0;
    /// AI merges to:  if (x &lt; 3 || x &gt; 10) return 0;
    /// </summary>
    public static class MathHelper
    {
        public static int Validate(int x)
        {
            // Edit this condition in multiple browser tabs to trigger a conflict!
            return x;
        }

        public static double Average(int[] values)
        {
            if (values == null || values.Length == 0)
                throw new ArgumentException(""Values cannot be empty"");
            double sum = 0;
            foreach (var v in values) sum += v;
            return sum / values.Length;
        }

        public static int Clamp(int value, int min, int max)
            => Math.Max(min, Math.Min(max, value));

        public static bool IsPrime(int n)
        {
            if (n < 2) return false;
            for (int i = 2; i * i <= n; i++)
                if (n % i == 0) return false;
            return true;
        }
    }
}
",
        ["appsettings.json"] =
@"{
  ""Logging"": { ""LogLevel"": { ""Default"": ""Information"" } },
  ""AllowedHosts"": ""*"",
  ""Jwt"": {
    ""Key"": ""change-me-in-production"",
    ""Issuer"": ""CodeHarmony"",
    ""Audience"": ""CodeHarmonyUsers"",
    ""ExpiryHours"": 1
  }
}
"
    };

    // ── State ────────────────────────────────────────────────
    public Dictionary<string, string>                   Files     { get; } = new(DefaultFiles);
    public ConcurrentDictionary<string, ClientState>    Clients   { get; } = new();
    public ConcurrentDictionary<string, ConflictInfo>   Conflicts { get; } = new();
    public List<LogEntry>                               ServerLog { get; } = new();

    // filename → (connectionId → code)  — each client's live editor content
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, string>> _clientCodes = new();

    // FIX KEY: Frozen baseline per file. Only advances when a merge is applied.
    // Saving does NOT change this — so both clients always compare against the
    // same original, enabling conflict detection even after auto-save fires.
    private readonly ConcurrentDictionary<string, string> _baseSnapshots = new();

    private readonly object _logLock = new();

    public CollaborationService()
    {
        foreach (var kv in DefaultFiles)
            _baseSnapshots[kv.Key] = kv.Value;
    }

    // ── Client lifecycle ─────────────────────────────────────
    public ClientState GetOrCreate(string connectionId)
        => Clients.GetOrAdd(connectionId, id => new ClientState { ConnectionId = id });

    public void InitClientFiles(string connectionId)
    {
        foreach (var fn in Files.Keys)
            _clientCodes.GetOrAdd(fn, _ => new()).TryAdd(connectionId, Files[fn]);
    }

    public void RemoveClient(string connectionId)
    {
        Clients.TryRemove(connectionId, out _);
        foreach (var map in _clientCodes.Values)
            map.TryRemove(connectionId, out _);
    }

    // ── Presence ─────────────────────────────────────────────
    public List<PresenceInfo> GetPresenceList()
        => Clients.Values.Select(c => new PresenceInfo
        {
            Id         = c.ConnectionId,
            User       = c.User,
            Cursor     = c.Cursor,
            Typing     = c.Typing,
            ActiveFile = c.ActiveFile
        }).ToList();

    // ── Logging ──────────────────────────────────────────────
    public void Log(string msg, string type = "info")
    {
        var t = DateTime.Now.ToString("HH:mm:ss");
        var entry = new LogEntry { Msg = msg, Type = type, Time = t };
        lock (_logLock)
        {
            ServerLog.Insert(0, entry);
            if (ServerLog.Count > 300) ServerLog.RemoveAt(ServerLog.Count - 1);
        }
        Console.WriteLine($"[{t}][{type.ToUpper()}] {msg}");
    }

    // ── Per-client code tracking ─────────────────────────────
    public void SetClientCode(string connectionId, string filename, string code)
        => _clientCodes.GetOrAdd(filename, _ => new())[connectionId] = code;

    /// <summary>
    /// Called only when a merge is accepted.
    /// Updates Files, advances the base snapshot, and syncs all client trackers.
    /// </summary>
    public void SyncAllClientsToFile(string filename, string code)
    {
        Files[filename]          = code;
        _baseSnapshots[filename] = code; // advance baseline to post-merge state
        var map = _clientCodes.GetOrAdd(filename, _ => new());
        foreach (var connId in map.Keys)
            map[connId] = code;
    }

    public Dictionary<string, string> GetAllClientCodes(string filename)
        => _clientCodes.TryGetValue(filename, out var map)
            ? new Dictionary<string, string>(map)
            : new();

    // ── Conflict detection ───────────────────────────────────
    public (bool detected, bool updated, ConflictInfo? conflict) DetectConflicts(string filename)
    {
        var codemap = GetAllClientCodes(filename);
        if (codemap.Count < 2) return (false, false, null);

        // FIX: Use the frozen snapshot, not Files[filename].
        // Files[filename] changes on every SaveFile, which would make one
        // client's edits become the new "base", hiding real conflicts.
        var baseText  = _baseSnapshots.TryGetValue(filename, out var snap)
                        ? snap
                        : Files.GetValueOrDefault(filename, "");
        var baseLines = baseText.Split('\n');

        var editors = codemap
            .Select(kv =>
            {
                if (!Clients.TryGetValue(kv.Key, out var c) || c.User == null) return null;
                return new { ConnId = kv.Key, User = c.User, Lines = kv.Value.Split('\n'), Code = kv.Value };
            })
            .Where(e => e != null)
            .ToList();

        if (editors.Count < 2) return (false, false, null);

        bool anyDetected = false, anyUpdated = false;
        ConflictInfo? lastConflict = null;

        for (int i = 0; i < editors.Count; i++)
        for (int j = i + 1; j < editors.Count; j++)
        {
            var a  = editors[i]!;
            var b2 = editors[j]!;

            // Lines changed relative to the frozen base
            var aChg = new HashSet<int>();
            var bChg = new HashSet<int>();

            var maxLen = Math.Max(Math.Max(a.Lines.Length, b2.Lines.Length), baseLines.Length);
            for (int k = 0; k < maxLen; k++)
            {
                var baseLine = k < baseLines.Length ? baseLines[k] : null;
                var aLine    = k < a.Lines.Length   ? a.Lines[k]   : null;
                var bLine    = k < b2.Lines.Length  ? b2.Lines[k]  : null;

                if (aLine != baseLine) aChg.Add(k);
                if (bLine != baseLine) bChg.Add(k);
            }

            var overlap = aChg.Intersect(bChg).ToList();
            var ids     = new[] { a.User.Id, b2.User.Id }.OrderBy(x => x).ToArray();
            var cKey    = $"{filename}::{ids[0]}_{ids[1]}";

            if (overlap.Count == 0)
            {
                Conflicts.TryRemove(cKey, out _);
                continue;
            }

            var existing = Conflicts.TryGetValue(cKey, out var ex) ? ex : null;
            var conflict = new ConflictInfo
            {
                Id         = cKey,
                Filename   = filename,
                DevA       = new ConflictDev { Id = a.User.Id,  Name = a.User.Name,  Color = a.User.Color,  Initial = a.User.Initial,  Code = a.Code },
                DevB       = new ConflictDev { Id = b2.User.Id, Name = b2.User.Name, Color = b2.User.Color, Initial = b2.User.Initial, Code = b2.Code },
                Lines      = overlap,
                DetectedAt = existing?.DetectedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            Conflicts[cKey] = conflict;
            lastConflict    = conflict;

            if (existing == null) anyDetected = true;
            else                  anyUpdated  = true;
        }

        return (anyDetected, anyUpdated, lastConflict);
    }
}
