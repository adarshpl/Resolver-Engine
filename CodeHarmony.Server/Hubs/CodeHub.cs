using CodeHarmony.Server.Models;
using CodeHarmony.Server.Services;
using Microsoft.AspNetCore.SignalR;

namespace CodeHarmony.Server.Hubs;

/// <summary>
/// SignalR Hub — replaces the original Node.js WebSocket server.
/// Each public method here can be called from the React client via:
///   connection.invoke("MethodName", arg1, arg2, ...)
///
/// The hub broadcasts back using:
///   Clients.All.SendAsync("EventName", payload)
///   Clients.Others.SendAsync("EventName", payload)
///   Clients.Caller.SendAsync("EventName", payload)
/// </summary>
public class CodeHub : Hub
{
    private readonly ICollaborationService _svc;
    private readonly ILogger<CodeHub>      _logger;

    public CodeHub(ICollaborationService svc, ILogger<CodeHub> logger)
    {
        _svc    = svc;
        _logger = logger;
    }

    // ── Connection lifecycle ────────────────────────────────

    public override async Task OnConnectedAsync()
    {
        _svc.GetOrCreate(Context.ConnectionId);
        _logger.LogInformation("Client connected: {id}", Context.ConnectionId);

        // Send initial state to the new client
        await Clients.Caller.SendAsync("Welcome", new WelcomePayload
        {
            ConnectionId = Context.ConnectionId,
            Files        = _svc.Files,
            ActiveFile   = "MathHelper.cs",
            Presence     = _svc.GetPresenceList(),
            Conflicts    = _svc.Conflicts.Values.ToList(),
            Log          = _svc.ServerLog.Take(40).ToList()
        });

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var client = _svc.Clients.TryGetValue(Context.ConnectionId, out var c) ? c : null;

        if (client?.User != null)
        {
            _svc.Log($"{client.User.Name} disconnected", "warning");
            _logger.LogInformation("User {name} disconnected", client.User.Name);

            await Clients.Others.SendAsync("UserLeft", new
            {
                wsId     = Context.ConnectionId,
                userId   = client.User.Id,
                userName = client.User.Name
            });

            // Remove conflicts that involved this user
            var toRemove = _svc.Conflicts.Keys
                .Where(k => k.Contains(client.User.Id))
                .ToList();
            foreach (var k in toRemove)
                _svc.Conflicts.TryRemove(k, out _);
        }

        _svc.RemoveClient(Context.ConnectionId);
        await Clients.All.SendAsync("PresenceUpdate", new { presence = _svc.GetPresenceList() });
        await base.OnDisconnectedAsync(exception);
    }

    // ── Hub methods (called from React client) ──────────────

    /// <summary>User joins the session with their chosen identity.</summary>
    public async Task Join(UserInfo user, string activeFile)
    {
        var client       = _svc.GetOrCreate(Context.ConnectionId);
        client.User      = user;
        client.ActiveFile = activeFile ?? "MathHelper.cs";

        _svc.InitClientFiles(Context.ConnectionId);
        _svc.Log($"{user.Name} joined", "info");
        _logger.LogInformation("User {name} joined", user.Name);

        await Clients.Others.SendAsync("UserJoined", new { wsId = Context.ConnectionId, user });
        await Clients.All.SendAsync("PresenceUpdate", new { presence = _svc.GetPresenceList() });
    }

    /// <summary>
    /// User typed in the editor. Broadcast the change to others
    /// and run conflict detection.
    /// </summary>
    public async Task CodeChange(string filename, string code, int cursorLine, int cursorCol)
    {
        if (!_svc.Clients.TryGetValue(Context.ConnectionId, out var client) || client.User == null)
            return;

        client.ActiveFile = filename;
        client.Typing     = true;
        _svc.SetClientCode(Context.ConnectionId, filename, code);

        // Tell other clients about the remote edit
        await Clients.Others.SendAsync("RemoteCodeChange", new
        {
            wsId       = Context.ConnectionId,
            userId     = client.User.Id,
            userName   = client.User.Name,
            userColor  = client.User.Color,
            filename,
            code,
            cursorLine,
            cursorCol
        });

        // Run conflict detection
        var (detected, updated, conflict) = _svc.DetectConflicts(filename);

        if (detected && conflict != null)
        {
            _svc.Log($"Conflict in {filename}: {conflict.DevA.Name} vs {conflict.DevB.Name}", "conflict");
            await Clients.All.SendAsync("ConflictDetected", new { conflict });
        }
        else if (updated && conflict != null)
        {
            await Clients.All.SendAsync("ConflictUpdated", new { conflict });
        }

        // Clear typing indicator after 1.5 s
        _ = Task.Delay(1500).ContinueWith(async _ =>
        {
            if (_svc.Clients.TryGetValue(Context.ConnectionId, out var cl))
            {
                cl.Typing = false;
                await Clients.All.SendAsync("PresenceUpdate", new { presence = _svc.GetPresenceList() });
            }
        });

        await Clients.All.SendAsync("PresenceUpdate", new { presence = _svc.GetPresenceList() });
    }

    /// <summary>Cursor moved — broadcast to others for the ghost cursor UI.</summary>
    public async Task Cursor(int line, int col, string filename)
    {
        if (!_svc.Clients.TryGetValue(Context.ConnectionId, out var client) || client.User == null)
            return;

        client.Cursor     = new CursorPosition { Line = line, Col = col };
        client.ActiveFile = filename ?? client.ActiveFile;

        await Clients.Others.SendAsync("RemoteCursor", new
        {
            wsId      = Context.ConnectionId,
            userId    = client.User.Id,
            userName  = client.User.Name,
            userColor = client.User.Color,
            line,
            col,
            filename  = client.ActiveFile
        });
    }

    /// <summary>AI-resolved merge accepted — apply to all clients.</summary>
    public async Task ApplyMerge(string conflictId, string code, string filename)
    {
        var client = _svc.Clients.TryGetValue(Context.ConnectionId, out var c) ? c : null;

        // FIX: Use SyncAllClientsToFile which also advances the base snapshot.
        // This is the ONLY place the baseline should change — after a merge.
        _svc.SyncAllClientsToFile(filename, code);

        _svc.Conflicts.TryRemove(conflictId, out _);
        _svc.Log($"Merge applied by {client?.User?.Name} in {filename}", "success");

        await Clients.All.SendAsync("MergeApplied", new
        {
            code,
            conflictId,
            filename,
            appliedBy = client?.User?.Name,
            presence  = _svc.GetPresenceList()
        });
    }

    /// <summary>Save current file state (auto-save after typing stops).</summary>
    public Task SaveFile(string filename, string code)
    {
        if (!string.IsNullOrEmpty(filename))
        {
            // FIX: Only update Files dict and this client's tracker.
            // Do NOT call SyncAllClientsToFile here — that would advance
            // the conflict baseline, making other clients' edits invisible.
            _svc.Files[filename] = code;
            _svc.SetClientCode(Context.ConnectionId, filename, code);
        }
        return Task.CompletedTask;
    }

    /// <summary>Create a new file in the shared project.</summary>
    public async Task CreateFile(string filename, string content)
    {
        var client = _svc.Clients.TryGetValue(Context.ConnectionId, out var c) ? c : null;
        if (string.IsNullOrEmpty(filename) || _svc.Files.ContainsKey(filename)) return;

        _svc.Files[filename] = content ?? $"// {filename}\n";
        foreach (var connId in _svc.Clients.Keys)
            _svc.SetClientCode(connId, filename, _svc.Files[filename]);

        _svc.Log($"Created: {filename} by {client?.User?.Name}", "info");

        await Clients.All.SendAsync("FileCreated", new
        {
            filename,
            content   = _svc.Files[filename],
            createdBy = client?.User?.Name
        });
    }

    /// <summary>Delete a file (must keep at least one file).</summary>
    public async Task DeleteFile(string filename)
    {
        var client = _svc.Clients.TryGetValue(Context.ConnectionId, out var c) ? c : null;
        if (string.IsNullOrEmpty(filename) || !_svc.Files.ContainsKey(filename) || _svc.Files.Count <= 1)
            return;

        _svc.Files.Remove(filename);
        _svc.Log($"Deleted: {filename} by {client?.User?.Name}", "warning");

        await Clients.All.SendAsync("FileDeleted", new
        {
            filename,
            deletedBy = client?.User?.Name
        });
    }

    /// <summary>User switched to a different file — update presence.</summary>
    public async Task SwitchFile(string filename)
    {
        var client        = _svc.GetOrCreate(Context.ConnectionId);
        client.ActiveFile = filename;
        await Clients.All.SendAsync("PresenceUpdate", new { presence = _svc.GetPresenceList() });
    }
}
