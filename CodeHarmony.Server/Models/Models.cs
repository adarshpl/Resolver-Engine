namespace CodeHarmony.Server.Models;

// ── User / Presence ────────────────────────────────────────
public record UserInfo
{
    public string Id      { get; init; } = "";
    public string Name    { get; init; } = "";
    public string Role    { get; init; } = "";
    public string Color   { get; init; } = "";
    public string Initial { get; init; } = "";
}

public record CursorPosition
{
    public int Line { get; init; }
    public int Col  { get; init; }
}

public record ClientState
{
    public string          ConnectionId { get; set; } = "";
    public UserInfo?       User         { get; set; }
    public CursorPosition? Cursor       { get; set; }
    public string          ActiveFile   { get; set; } = "MathHelper.cs";
    public bool            Typing       { get; set; }
    public DateTime        LastSeen     { get; set; } = DateTime.UtcNow;
}

public record PresenceInfo
{
    public string          Id         { get; init; } = "";
    public UserInfo?       User       { get; init; }
    public CursorPosition? Cursor     { get; init; }
    public bool            Typing     { get; init; }
    public string?         ActiveFile { get; init; }
}

// ── Conflicts ──────────────────────────────────────────────
public record ConflictDev
{
    public string Id      { get; init; } = "";
    public string Name    { get; init; } = "";
    public string Color   { get; init; } = "";
    public string Initial { get; init; } = "";
    public string Code    { get; init; } = "";
}

public record ConflictInfo
{
    public string      Id         { get; init; } = "";
    public string      Filename   { get; init; } = "";
    public ConflictDev DevA       { get; init; } = new();
    public ConflictDev DevB       { get; init; } = new();
    public List<int>   Lines      { get; init; } = new();
    public long        DetectedAt { get; init; }
}

// ── Hub payloads ───────────────────────────────────────────
public record WelcomePayload
{
    public string                    ConnectionId { get; init; } = "";
    public Dictionary<string,string> Files        { get; init; } = new();
    public string                    ActiveFile   { get; init; } = "";
    public List<PresenceInfo>        Presence     { get; init; } = new();
    public List<ConflictInfo>        Conflicts    { get; init; } = new();
    public List<LogEntry>            Log          { get; init; } = new();
}

// ── Log ───────────────────────────────────────────────────
public record LogEntry
{
    public string Msg  { get; init; } = "";
    public string Type { get; init; } = "info";
    public string Time { get; init; } = "";
}

// ── AI API ────────────────────────────────────────────────
public record ResolveRequest
{
    public ConflictInfo? Conflict { get; init; }
    public string?       ApiKey   { get; init; }
    /// <summary>The original file content before either developer made edits (the merge base).</summary>
    public string?       BaseCode { get; init; }
}

public record ResolveResponse
{
    public string? Resolved { get; init; }
    public string? Error    { get; init; }
}

public record SuggestRequest
{
    public string  Code     { get; init; } = "";
    public string  Filename { get; init; } = "";
    public string? ApiKey   { get; init; }
}

public record AiSuggestion
{
    public string  Title       { get; init; } = "";
    public string  Description { get; init; } = "";
    public string? Code        { get; init; }
}

public record SuggestResponse
{
    public List<AiSuggestion> Suggestions { get; init; } = new();
}
