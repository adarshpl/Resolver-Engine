using CodeHarmony.Server.Models;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace CodeHarmony.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AiController : ControllerBase
{
    private readonly IHttpClientFactory  _httpFactory;
    private readonly IConfiguration      _config;
    private readonly ILogger<AiController> _logger;

    // ── System prompt ────────────────────────────────────────────────────────
    // This is the master instruction sent as the "system" role for every
    // resolve call. It mirrors the architect prompt from the UI but is
    // concise enough to leave room for the full code payloads.
    private const string MergeSystemPrompt = @"
        You are a senior software architect, debugging expert, and intelligent code merge resolver.
        You are working as an AI engine inside a real-time collaborative coding application.
        Your task is NOT just merging code — but also FIXING bugs, PRESERVING UI behavior,
        and IMPROVING the overall implementation.

        PRIMARY OBJECTIVE:
        Produce a SINGLE, fully working, bug-free, production-ready merged version of the code.

        CRITICAL RESPONSIBILITIES:

        1. COMPLETE FEATURE PRESERVATION
           - Do NOT remove any valid functionality.
           - If both versions add features → INCLUDE BOTH.
           - Preserve UI behavior: animations, transitions, scrolling, event handlers, state updates.

        2. INTELLIGENT 3-WAY MERGE
           - Compare BASE → VERSION A; identify every change developer A made.
           - Compare BASE → VERSION B; identify every change developer B made.
           - Merge non-conflicting changes directly.
           - For conflicts: combine logic intelligently — NEVER overwrite blindly.
           - Preserve BOTH developer intents whenever possible.

        3. STRUCTURAL & CLASS MERGING
           - Merge constructors properly (combine parameters + initialization logic).
           - Include all methods from both versions; avoid duplicates.
           - Maintain correct class structure and access modifiers.

        4. BUG FIXING (VERY IMPORTANT)
           Automatically detect and FIX issues such as:
           - UI not updating (stale state, missing setState/re-render)
           - Scroll not working / stuck UI
           - Broken event handlers
           - Incorrect async/await usage
           - Missing returns
           - Duplicated logic
           - Invalid initialization

        5. FRONTEND AWARENESS (React / UI)
           - Ensure state updates trigger re-renders.
           - Preserve animations and CSS transitions.
           - Fix any static UI issues.
           - Maintain component lifecycle correctly (useEffect dependencies, cleanup).

        6. MULTI-FILE / SYSTEM AWARENESS
           - Maintain imports/usings correctly.
           - Ensure all referenced dependencies are valid.
           - Keep architecture clean and consistent.

        7. CODE QUALITY
           - Clean, consistent formatting.
           - No duplicate logic or unused variables.
           - No syntax errors.
           - Production-ready quality.

        STRICT OUTPUT RULES:
        - Return ONLY the final merged and fixed code.
        - NO explanations, NO markdown, NO comments about the merging process.
        - NO extra text before or after the code.
        - Output must be complete and immediately runnable.
        ";

    public AiController(IHttpClientFactory httpFactory, IConfiguration config, ILogger<AiController> logger)
    {
        _httpFactory = httpFactory;
        _config      = config;
        _logger      = logger;
    }

    // ── /api/ai/resolve ──────────────────────────────────────────────────────
    [HttpPost("resolve")]
    public async Task<ActionResult<ResolveResponse>> Resolve([FromBody] ResolveRequest req)
    {
        if (req.Conflict == null)
            return Ok(new ResolveResponse { Error = "Missing conflict object" });

        var c    = req.Conflict;
        var lang = DetectLanguage(c.Filename);
        var conflictLines = c.Lines is { Count: > 0 }
            ? string.Join(", ", c.Lines.Select(l => $"line {l + 1}"))
            : "multiple lines";

        // Build the user message that contains all three versions
        var userMessage = $@"
            LANGUAGE: {lang}
            FILE: {c.Filename}
            CONFLICT AT: {conflictLines}

            BASE CODE (original before both developers started editing):
            ```{lang.ToLower()}
            {req.BaseCode ?? "(base not provided — treat VERSION A as the closest reference)"}
            ```

            VERSION A — Developer: {c.DevA.Name}
            ```{lang.ToLower()}
            {c.DevA.Code}
            ```

            VERSION B — Developer: {c.DevB.Name}
            ```{lang.ToLower()}
            {c.DevB.Code}
            ```

            Perform a complete intelligent 3-way merge and return ONLY the final merged code.
            The output must be the complete file content — not a diff or a partial snippet.
            Do not wrap the output in markdown code fences.
            ";

        try
        {
            var key = ResolveApiKey();
            if (string.IsNullOrWhiteSpace(key))
                return Ok(new ResolveResponse { Error = "No API key provided" });


            var merged = await CallGroqWithRetryAsync(
                key,
                MergeSystemPrompt,
                userMessage,
                2000
            );
            return Ok(new ResolveResponse { Resolved = merged });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI resolve failed for {filename}", c.Filename);
            return Ok(new ResolveResponse { Error = ex.Message });
        }
    }

    // ── /api/ai/suggest ──────────────────────────────────────────────────────
    [HttpPost("suggest")]
    public async Task<ActionResult<SuggestResponse>> Suggest([FromBody] SuggestRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Code))
            return Ok(new SuggestResponse());

        try
        {
            var key = ResolveApiKey(req.ApiKey);
            if (string.IsNullOrWhiteSpace(key))
                return Ok(new SuggestResponse());

            var lang   = DetectLanguage(req.Filename);
            var system = $"You are a senior {lang} developer. Analyse the given code and return ONLY a JSON array of up to 3 suggestion objects. Each object must have exactly these fields: \"title\" (short string), \"description\" (1-2 sentence explanation), \"code\" (optional improved snippet string or null). Return raw JSON only — no markdown, no extra text.";
            var user   = $"Code to review ({lang}):\n{req.Code}";

            var raw  = await CallAnthropicAsync(key, system, user, maxTokens: 1024);
            var suggs = ParseSuggestions(raw);
            return Ok(new SuggestResponse { Suggestions = suggs });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI suggest failed");
            return Ok(new SuggestResponse());
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private string? ResolveApiKey() =>
        _config["GroqApiKey"]
        ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

    private static string DetectLanguage(string? filename) =>
        Path.GetExtension(filename ?? "").TrimStart('.').ToLowerInvariant() switch
        {
            "cs"     => "C#",
            "ts"     => "TypeScript",
            "tsx"    => "TypeScript React",
            "js"     => "JavaScript",
            "jsx"    => "JavaScript React",
            "json"   => "JSON",
            "csproj" => "XML",
            "md"     => "Markdown",
            "py"     => "Python",
            _        => "code"
        };

    private async Task<string> CallAnthropicAsync(
        string apiKey, string systemPrompt, string userMessage, int maxTokens)
    {
        using var http = _httpFactory.CreateClient();
        http.DefaultRequestHeaders.Add("x-api-key",          apiKey);
        http.DefaultRequestHeaders.Add("anthropic-version",  "2023-06-01");

        var payload = new
        {
            model      = "claude-sonnet-4-20250514",
            max_tokens = maxTokens,
            system     = systemPrompt.Trim(),
            messages   = new[] { new { role = "user", content = userMessage.Trim() } }
        };

        var body     = JsonSerializer.Serialize(payload);
        var response = await http.PostAsync(
            "https://api.anthropic.com/v1/messages",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var json = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Anthropic API error {status}: {body}", response.StatusCode, json);
            throw new InvalidOperationException($"Anthropic API returned {(int)response.StatusCode}: {json}");
        }

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("content")
            .EnumerateArray()
            .Where(x => x.GetProperty("type").GetString() == "text")
            .Select(x => x.GetProperty("text").GetString() ?? "")
            .Aggregate(string.Concat)
            .Trim();
    }

    public async Task<string> CallGroqAsync(
    string apiKey,
    string systemPrompt,
    string userMessage,
    int maxTokens)
    {
        using var http = _httpFactory.CreateClient();

        http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", apiKey);

        if (string.IsNullOrWhiteSpace(systemPrompt))
            throw new Exception("System prompt empty");

        if (string.IsNullOrWhiteSpace(userMessage))
            throw new Exception("User message empty");

        // Limit size
        if (userMessage.Length > 12000)
            userMessage = userMessage.Substring(0, 12000);

        var payload = new
        {
            model = "llama-3.1-8b-instant", // 🔥 FIXED
            messages = new[]
            {
            new { role = "system", content = systemPrompt.Trim() },
            new { role = "user", content = userMessage.Trim() }
        },
            temperature = 0.1,
            max_tokens = Math.Min(maxTokens, 2000)
        };

        var body = JsonSerializer.Serialize(payload);

        var response = await http.PostAsync(
            "https://api.groq.com/openai/v1/chat/completions",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var json = await response.Content.ReadAsStringAsync();

        _logger.LogInformation("Groq Response: {json}", json);

        if (!response.IsSuccessStatusCode)
            throw new Exception($"Groq error: {json}");

        using var doc = JsonDocument.Parse(json);

        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private async Task<string> CallGroqWithRetryAsync(
    string apiKey,
    string systemPrompt,
    string userMessage,
    int maxTokens)
    {
        int retries = 3;

        for (int i = 0; i < retries; i++)
        {
            try
            {
                return await CallGroqAsync("", systemPrompt, userMessage, maxTokens);
            }
            catch (Exception ex) when (ex.Message.Contains("Rate limit"))
            {
                await Task.Delay(2000 * (i + 1)); // wait 2s, 4s, 6s
            }
        }

        throw new Exception("Groq API failed after retries");
    }

    private static List<AiSuggestion> ParseSuggestions(string raw)
    {
        // Strip optional markdown code fences the model might add
        var json = raw.Trim();
        if (json.StartsWith("```")) json = string.Join('\n', json.Split('\n').Skip(1));
        if (json.EndsWith("```"))  json = json[..json.LastIndexOf("```")].Trim();

        try
        {
            var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var list = JsonSerializer.Deserialize<List<SuggestionDto>>(json, opts) ?? new();
            return list.Select(s => new AiSuggestion
            {
                Title       = s.Title       ?? "Suggestion",
                Description = s.Description ?? "",
                Code        = s.Code
            }).ToList();
        }
        catch
        {
            // Fall back to a single suggestion containing the raw text
            return new List<AiSuggestion>
            {
                new() { Title = "AI Suggestion", Description = raw }
            };
        }
    }

    // DTO only used for JSON parsing inside ParseSuggestions
    private sealed class SuggestionDto
    {
        public string? Title       { get; set; }
        public string? Description { get; set; }
        public string? Code        { get; set; }
    }
}
