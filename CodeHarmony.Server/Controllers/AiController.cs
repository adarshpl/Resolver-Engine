using CodeHarmony.Server.Models;
using Microsoft.AspNetCore.Mvc;
using System.Text;
using System.Text.Json;
using System.Linq;

namespace CodeHarmony.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AiController : ControllerBase
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<AiController> _logger;

    public AiController(IHttpClientFactory httpFactory, IConfiguration config, ILogger<AiController> logger)
    {
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
    }

    [HttpPost("resolve")]
    public async Task<ActionResult<ResolveResponse>> Resolve([FromBody] ResolveRequest req)
    {
        if (req.Conflict == null)
            return Ok(new ResolveResponse { Error = "Missing conflict object" });

        var c = req.Conflict;
        var ext = Path.GetExtension(c.Filename).TrimStart('.').ToLower();

        var lang = ext switch
        {
            "cs" => "C#",
            "json" => "JSON",
            "csproj" => "XML/MSBuild",
            _ => "code"
        };

        var conflictLines = string.Join(", ", (c.Lines ?? new()).Select(l => l + 1));

        var prompt = @$"
            You are an expert {lang} merge assistant. Two developers edited ""{c.Filename}"" simultaneously.

            Developer {c.DevA.Name}'s version:
            {c.DevA.Code}

            Developer {c.DevB.Name}'s version:
            {c.DevB.Code}

            Conflicting lines: {conflictLines}

            Rules:
            - Merge intelligently
            - Do NOT duplicate logic
            - Keep formatting clean
            ";

        try
        {
            var key = req.ApiKey
                ?? _config["AnthropicApiKey"]
                ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

            if (string.IsNullOrWhiteSpace(key))
                return Ok(new ResolveResponse { Error = "Missing API key" });

            var http = _httpFactory.CreateClient();
            http.DefaultRequestHeaders.Add("x-api-key", key);
            http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");

            var body = JsonSerializer.Serialize(new
            {
                model = "claude-sonnet-4-20250514",
                max_tokens = 3000,
                messages = new[] { new { role = "user", content = prompt } }
            });

            var response = await http.PostAsync(
                "https://api.anthropic.com/v1/messages",
                new StringContent(body, Encoding.UTF8, "application/json"));

            var json = await response.Content.ReadAsStringAsync();

            using var doc = JsonDocument.Parse(json);

            var text = doc.RootElement.GetProperty("content")
                .EnumerateArray()
                .Where(x => x.GetProperty("type").GetString() == "text")
                .Select(x => x.GetProperty("text").GetString())
                .Aggregate(string.Concat);

            return Ok(new ResolveResponse { Resolved = text });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AI error");
            return Ok(new ResolveResponse { Error = ex.Message });
        }
    }

    [HttpPost("suggest")]
    public async Task<ActionResult<SuggestResponse>> Suggest([FromBody] SuggestRequest req)
    {
        if (string.IsNullOrEmpty(req.Code))
            return Ok(new SuggestResponse());

        try
        {
            var key = req.ApiKey
                ?? _config["AnthropicApiKey"]
                ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

            if (string.IsNullOrWhiteSpace(key))
                return Ok(new SuggestResponse());

            var http = _httpFactory.CreateClient();
            http.DefaultRequestHeaders.Add("x-api-key", key);
            http.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");

            var prompt = $"Improve this code:\n{req.Code}";

            var body = JsonSerializer.Serialize(new
            {
                model = "claude-sonnet-4-20250514",
                max_tokens = 800,
                messages = new[] { new { role = "user", content = prompt } }
            });

            var response = await http.PostAsync(
                "https://api.anthropic.com/v1/messages",
                new StringContent(body, Encoding.UTF8, "application/json"));

            var json = await response.Content.ReadAsStringAsync();

            using var doc = JsonDocument.Parse(json);

            var text = doc.RootElement.GetProperty("content")
                .EnumerateArray()
                .Where(x => x.GetProperty("type").GetString() == "text")
                .Select(x => x.GetProperty("text").GetString())
                .Aggregate(string.Concat);

            return Ok(new SuggestResponse
            {
                Suggestions = new List<AiSuggestion>
                {
                    new AiSuggestion { Title = "AI Suggestion", Description = text }
                }
            });
        }
        catch
        {
            return Ok(new SuggestResponse());
        }
    }
}