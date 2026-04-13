# CodeHarmony — React + .NET 8 + SignalR

AI-powered collaborative code editor. Open the `.sln` in Visual Studio 2022, press **F5** — done.

---

## 🚀 Run & Debug in Visual Studio 2022

### Prerequisites
| Tool | Version | Download |
|---|---|---|
| Visual Studio 2022 | 17.8+ | https://visualstudio.microsoft.com |
| .NET 8 SDK | 8.0+ | https://dotnet.microsoft.com/download |
| Node.js | 18+ | https://nodejs.org |

VS 2022 must have the **ASP.NET and web development** workload installed.

### Steps
1. **Open solution** — double-click `CodeHarmony.sln`
2. **Set startup project** — right-click `CodeHarmony.Server` → Set as Startup Project  
   *(it should already be set)*
3. **Press F5** (or click the green ▶ button)

Visual Studio will automatically:
- Restore NuGet packages
- Run `npm install` in `codeharmony.client/`
- Start the .NET backend on `https://localhost:7130`
- Start the Vite dev server on `https://localhost:5173`
- Open your browser at `https://localhost:5173`

> **Breakpoints work normally.** Set a breakpoint in any `.cs` file (e.g. `CodeHub.cs`) — it will hit when the browser triggers that code path.

---

## 🐛 Debugging Tips

### Backend breakpoints (C#)
- `Hubs/CodeHub.cs` → breakpoint in `CodeChange()` hits every keypress from any connected browser
- `Services/CollaborationService.cs` → breakpoint in `DetectConflicts()` hits on every edit
- `Controllers/AiController.cs` → breakpoint in `Resolve()` hits when "Resolve Conflict" is clicked
- Use **Debug → Windows → Output** to see SignalR traffic logs

### Frontend (React/TypeScript)
- Open browser DevTools → **Sources** tab → find `src/App.tsx` under `localhost:5173`
- Set breakpoints directly in the TypeScript source (Vite serves source maps)
- Or use VS Code: **Run → Start Debugging** with the Chrome launch config

### SignalR inspection
- Browser DevTools → **Network** tab → filter `WS` → click the `/hub` websocket
- You can see every SignalR message in real time (JSON frames)

### Swagger UI (REST API)
- While running in Development mode: `https://localhost:7130/swagger`
- Test `/api/ai/resolve` and `/api/ai/suggest` directly

---

## 📁 Solution Structure

```
CodeHarmony.sln
│
├── CodeHarmony.Server/              ← ASP.NET Core 8 backend
│   ├── Properties/
│   │   └── launchSettings.json      ← F5 debug profiles (http / https / IIS Express)
│   ├── Controllers/
│   │   └── AiController.cs          ← POST /api/ai/resolve   POST /api/ai/suggest
│   ├── Hubs/
│   │   └── CodeHub.cs               ← SignalR hub (replaces original WebSocket server)
│   ├── Models/
│   │   └── Models.cs                ← C# records / DTOs
│   ├── Services/
│   │   └── CollaborationService.cs  ← Singleton: files, clients, conflicts, logs
│   ├── Program.cs                   ← DI, middleware, SignalR, SPA proxy
│   ├── appsettings.json
│   └── appsettings.Development.json
│
└── codeharmony.client/              ← React 18 + TypeScript + Vite frontend
    ├── index.html
    ├── vite.config.ts               ← Proxies /api and /hub → backend
    ├── tsconfig.json
    └── src/
        ├── main.tsx                 ← Entry point
        ├── App.tsx                  ← Entire UI (Splash + VS Code-like editor)
        ├── index.css                ← All styles (identical to original)
        ├── mergeEngine.ts           ← Local merge logic (runs without API key)
        └── types/
            └── index.ts             ← TypeScript interfaces
```

---

## 🌐 Architecture

```
Browser (React + Vite :5173)
        │
        │  /api/*   → HTTP REST (fetch)
        │  /hub     → WebSocket (SignalR)
        │
        ▼
ASP.NET Core :7130
        │
        ├── CodeHub (SignalR)         real-time collaboration
        ├── AiController (REST)       Anthropic API proxy
        └── CollaborationService      in-memory shared state
```

### Node.js WebSocket → SignalR mapping

| Original (Node.js ws) | This version (SignalR) |
|---|---|
| `ws.send(JSON.stringify(…))` | `Clients.Caller.SendAsync("Event", payload)` |
| `wss.on('connection', …)` | `OnConnectedAsync()` override |
| `ws.on('message', …)` | Public hub method e.g. `Task CodeChange(…)` |
| `broadcast(data)` | `Clients.All.SendAsync("Event", payload)` |
| `new WebSocket(url)` | `new HubConnectionBuilder().withUrl('/hub').build()` |
| `ws.send(…)` | `connection.invoke('MethodName', …)` |

---

## 🧪 Conflict Demo

1. Press **F5** in Visual Studio
2. Browser opens → join as **Alex**
3. Open a **second browser tab** at the same URL → join as **Sarah**
4. Both open **MathHelper.cs**
5. In Alex's tab, type `if(x < 3) return 0;` inside `Validate()`
6. In Sarah's tab, type `if(x > 10) return 0;` in the same line
7. A red conflict card appears → click **⚡ Resolve Conflict**
8. The AI merges them into `if (x < 3 || x > 10) return 0;`

---

## ⚙️ Configuration

**API Key** — enter it in the splash screen, or add to `appsettings.json`:
```json
{
  "AnthropicApiKey": "sk-ant-api03-..."
}
```

**Ports** — change in `Properties/launchSettings.json`:
```json
"applicationUrl": "https://localhost:7130;http://localhost:5130"
```
Then update `vite.config.ts` → `target` to match.

**LAN multiplayer** — run the backend, share `http://[YOUR-IP]:5130` with teammates.
