using CodeHarmony.Server.Hubs;
using CodeHarmony.Server.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Services ───────────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "CodeHarmony API", Version = "v1" });
});

// SignalR — handles real-time collaboration (replaces WebSocket)
builder.Services.AddSignalR(options =>
{
    options.MaximumReceiveMessageSize = 4 * 1024 * 1024; // 4 MB
    options.EnableDetailedErrors = true; // helpful during debugging
});

// Singleton keeps all collaboration state in memory
builder.Services.AddSingleton<ICollaborationService, CollaborationService>();

// HttpClient for calling Anthropic API
builder.Services.AddHttpClient();

// CORS — required for React dev server (localhost:5173) to talk to the backend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy
            .SetIsOriginAllowed(_ => true) // allow any origin in dev
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials(); // required for SignalR
    });
});

var app = builder.Build();

// ── Middleware pipeline ────────────────────────────────────
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "CodeHarmony API v1");
    });
}
else
{
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseCors("AllowAll");

// Serve built React app from wwwroot (Production)
app.UseDefaultFiles();
app.UseStaticFiles();

// ── Endpoints ──────────────────────────────────────────────
app.MapControllers();
app.MapHub<CodeHub>("/hub");

// SPA fallback: in Production serve index.html for all unknown routes
app.MapFallbackToFile("index.html");

app.Run();
