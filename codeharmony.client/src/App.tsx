import React, {
  useState, useEffect, useRef, useCallback, ChangeEvent, KeyboardEvent,
} from 'react'
import * as signalR from '@microsoft/signalr'
import './index.css'
import { smartDemoMerge } from './mergeEngine'
import {
  UserInfo, PresenceInfo, ConflictInfo, LogEntry,
  WelcomePayload, AiSuggestion, RTab, LPanel,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────
const LH   = 19   // line height px
const CW   = 7.81 // char width px (JetBrains Mono 13px)

const COLORS     = ['#0078d4','#4ec9b0','#dcdcaa','#c586c0','#ce9178','#9cdcfe']
const FILE_ICONS: Record<string,string> = { cs:'🔷', json:'📋', csproj:'⚙️', md:'📘', txt:'📄' }

function getExt(fn: string)  { return fn.split('.').pop()?.toLowerCase() ?? '' }
function langLabel(fn: string) {
  const m: Record<string,string> = { cs:'C#', json:'JSON', csproj:'XML', md:'Markdown', txt:'Plain Text' }
  return m[getExt(fn)] ?? getExt(fn).toUpperCase()
}

// ─── Splash ───────────────────────────────────────────────────────────────────
function Splash({ onJoin }: { onJoin: (u: UserInfo, key: string) => void }) {
  const [name, setName] = useState('')
  const [apiKey, setApiKey]   = useState('')
  let ci = 0

  function doJoin(id: string, nm: string, role: string, color: string, initial: string) {
    const finalName    = name.trim() || nm
    const finalInitial = name.trim() ? name.trim()[0].toUpperCase() : initial
    onJoin({ id, name: finalName, role, color, initial: finalInitial }, apiKey)
  }

  return (
    <div id="splash">
      <div className="sp-bg" />
      <div className="sp-inner">
        <div className="sp-logo">Resolver<span>Engine</span></div>
        <div className="sp-sub">
          AI-powered collaborative code editor · <b>React + .NET 8 + SignalR</b><br />
          C# .NET project · Live conflict detection · AI merge with animation
        </div>
        <div className="sp-tip">
          <b>⚡ Debug in VS:</b> Open <code>CodeHarmony.sln</code> → press <b>F5</b><br />
          <b>🧪 Conflict demo:</b> Open two tabs → both edit <code>MathHelper.cs</code> → type different <code>if(…)</code> conditions → watch AI merge them
        </div>
        <div className="sp-field">
          <div className="sp-label">Your Name</div>
          <input className="sp-input" value={name} onChange={e => setName(e.target.value)}
            placeholder="Enter your name…" maxLength={20}
            onKeyDown={e => e.key === 'Enter' && name.trim() && doJoin('u_'+Math.random().toString(36).slice(2,6), name, 'Developer', COLORS[ci++%COLORS.length], name[0].toUpperCase())} />
        </div>
        <div className="sp-field">
          <div className="sp-label">Anthropic API Key (optional — enables real AI merge)</div>
          <input className="sp-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-…" />
        </div>
        <div style={{ fontSize:10, color:'#3a4050', marginBottom:10, letterSpacing:1, textTransform:'uppercase' }}>Quick Join</div>
        <div className="sp-grid">
          {[
            { id:'alex',   name:'Adarsh',   role:'Frontend',   color:'#0078d4', initial:'A' },
            { id:'sarah',  name:'Akhil',  role:'Backend',    color:'#4ec9b0', initial:'S' },
            { id:'jordan', name:'Hima', role:'Full Stack', color:'#dcdcaa', initial:'J' },
          ].map(u => (
            <div key={u.id} className="sp-card" style={{ '--cc': u.color } as React.CSSProperties}
              onClick={() => doJoin(u.id, u.name, u.role, u.color, u.initial)}>
              <div className="sp-av" style={{ background:u.color+'22', border:`2px solid ${u.color}44`, color:u.color }}>{u.initial}</div>
              <div className="sp-nm">{u.name}</div>
              <div className="sp-rl">{u.role}</div>
            </div>
          ))}
          <div className="sp-card" style={{ '--cc':'#c586c0' } as React.CSSProperties}
            onClick={() => { if (!name.trim()) return; doJoin('u_'+Math.random().toString(36).slice(2,6), name, 'Developer', COLORS[ci++%COLORS.length], name[0].toUpperCase()) }}>
            <div className="sp-av" style={{ background:'#c586c022', border:'2px solid #c586c044', color:'#c586c0' }}>+</div>
            <div className="sp-nm">Custom</div>
            <div className="sp-rl">Enter name above</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── Auth / connection state ────────────────────────────────────────────────
  const [joined,    setJoined]    = useState(false)
  const [me,        setMe]        = useState<UserInfo | null>(null)
  const [myKey,     setMyKey]     = useState('')
  const [connected, setConnected] = useState(false)

  // ── Editor / file state ────────────────────────────────────────────────────
  const [files,       setFiles]       = useState<Record<string,string>>({})
  const [openTabs,    setOpenTabs]    = useState<string[]>([])
  const [activeFile,  setActiveFile]  = useState('MathHelper.cs')
  const [dirtyFiles,  setDirtyFiles]  = useState<Set<string>>(new Set())

  // ── Collaboration state ────────────────────────────────────────────────────
  const [presence,   setPresence]   = useState<Record<string,PresenceInfo>>({})
  const [conflicts,  setConflicts]  = useState<Record<string,ConflictInfo>>({})
  const [aiResults,  setAiResults]  = useState<Record<string,string>>({})
  const [aiSuggs,    setAiSuggs]    = useState<AiSuggestion[]>([])
  const [clog,       setClog]       = useState<LogEntry[]>([])

  // ── UI panel state ─────────────────────────────────────────────────────────
  const [rTab,        setRTab]        = useState<RTab>('conflicts')
  const [lPanel,      setLPanel]      = useState<LPanel>('explorer')
  const [lsbOpen,     setLsbOpen]     = useState(true)
  const [rpOpen,      setRpOpen]      = useState(true)
  const [mergeModal,  setMergeModal]  = useState<string | null>(null)
  const [nfModal,     setNfModal]     = useState(false)
  const [nfName,      setNfName]      = useState('')
  const [nfContent,   setNfContent]   = useState('')

  // ── Status bar ─────────────────────────────────────────────────────────────
  const [lnCol,    setLnCol]    = useState('Ln 1, Col 1')
  const [edStatus, setEdStatus] = useState('Ready')

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Array<{ id:number; cls:string; title:string; body:string }>>([])
  const notifId = useRef(0)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const connRef      = useRef<signalR.HubConnection | null>(null)
  const editorRef    = useRef<HTMLTextAreaElement>(null)
  const gutterRef    = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const suppressRef  = useRef(false)
  const lastSentRef  = useRef('')
  const typingRef    = useRef<ReturnType<typeof setTimeout>>()
  const suggestRef   = useRef<ReturnType<typeof setTimeout>>()
  const activeRef    = useRef(activeFile)    // always-fresh copy for closures
  const filesRef     = useRef(files)

  useEffect(() => { activeRef.current = activeFile }, [activeFile])
  useEffect(() => { filesRef.current  = files      }, [files])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const notify = useCallback((cls: string, title: string, body: string) => {
    const id = ++notifId.current
    setNotifs(p => [...p, { id, cls, title, body }])
    setTimeout(() => setNotifs(p => p.filter(n => n.id !== id)), 4500)
  }, [])

  const addLog = useCallback((msg: string, type = 'info') => {
    const t = new Date().toLocaleTimeString('en-US',{ hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })
    setClog(p => [...p.slice(-199), { msg, type, time:t }])
  }, [])

  const send = useCallback(<T extends unknown[]>(method: string, ...args: T) => {
    connRef.current?.invoke(method, ...args).catch(console.error)
  }, [])

  // ── Minimap ────────────────────────────────────────────────────────────────
  const drawMinimap = useCallback((code: string, cflicts: Record<string,ConflictInfo>, af: string) => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const lines = code.split('\n')
    canvas.height = Math.max(lines.length * 2 + 40, 400)
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0,0,64,canvas.height)
    const cLines = new Set<number>()
    Object.values(cflicts).filter(c => c.filename === af).forEach(c => c.lines?.forEach(l => cLines.add(l)))
    lines.forEach((line,i) => {
      const t = line.trim(); if (!t) return
      const len = Math.min(t.length * 0.44, 56)
      let color = '#3a3a3a'
      if (t.startsWith('//'))                          color = '#2a4a2a'
      else if (/class |interface |enum /.test(t))      color = '#3a2060'
      else if (/public |private |protected /.test(t)) color = '#1a3a5a'
      else if (t.startsWith('using '))                 color = '#2a3a4a'
      ctx.fillStyle = cLines.has(i) ? 'rgba(244,71,71,.6)' : color
      ctx.fillRect(4, i*2, len, 1.5)
    })
  }, [])

  // ── Gutter ─────────────────────────────────────────────────────────────────
  const updateGutter = useCallback((code: string, af: string, dirty: boolean, cflicts: Record<string,ConflictInfo>) => {
    if (!gutterRef.current) return
    const lines = code.split('\n')
    const cLines = new Set<number>()
    if (!dirty) Object.values(cflicts).filter(c => c.filename === af).forEach(c => c.lines?.forEach(l => cLines.add(l)))
    gutterRef.current.innerHTML = lines.map((_,i) =>
      `<div class="ln ${cLines.has(i)?'conflict-ln':''}">${i+1}</div>`
    ).join('')
  }, [])

  // ── SignalR wiring ─────────────────────────────────────────────────────────
  const wireEvents = useCallback((conn: signalR.HubConnection) => {
    conn.on('Welcome', (payload: WelcomePayload) => {
      const cf: Record<string,ConflictInfo> = {}
      payload.conflicts?.forEach(c => { cf[c.id] = c })
      const pr: Record<string,PresenceInfo> = {}
      payload.presence?.forEach(p => { if (p.id !== conn.connectionId && p.user) pr[p.id] = p })
      setFiles(payload.files)
      setConflicts(cf)
      setPresence(pr)
      setClog(payload.log ?? [])
      const af = payload.activeFile || Object.keys(payload.files)[0] || 'MathHelper.cs'
      setActiveFile(af)
      setOpenTabs([af])
      requestAnimationFrame(() => {
        if (editorRef.current) {
          suppressRef.current = true
          editorRef.current.value = payload.files[af] ?? ''
          suppressRef.current = false
          lastSentRef.current = payload.files[af] ?? ''
          updateGutter(payload.files[af] ?? '', af, false, cf)
          drawMinimap(payload.files[af] ?? '', cf, af)
        }
      })
    })

    conn.on('UserJoined', ({ wsId, user }: { wsId:string; user:UserInfo }) => {
      setPresence(p => ({ ...p, [wsId]: { id:wsId, user, typing:false } }))
      addLog(`${user.name} joined`, 'info')
      notify('ni', `${user.name} joined`, user.role)
    })

    conn.on('UserLeft', ({ wsId, userName }: { wsId:string; userName:string }) => {
      setPresence(p => { const n={...p}; addLog(`${n[wsId]?.user?.name??userName} left`,'warning'); delete n[wsId]; return n })
      setConflicts(p => { const n={...p}; Object.keys(n).filter(k=>k.includes(wsId)).forEach(k=>delete n[k]); return n })
    })

    conn.on('PresenceUpdate', ({ presence: arr }: { presence: PresenceInfo[] }) => {
      setPresence(p => {
        const n = {...p}
        arr?.forEach(q => { if (q.id !== conn.connectionId && q.user) n[q.id] = { ...n[q.id], ...q } })
        return n
      })
    })

    conn.on('RemoteCodeChange', ({ wsId, filename, userColor: _uc }: any) => {
      setPresence(p => { const n={...p}; if(n[wsId]) n[wsId]={...n[wsId], typing:true, activeFile:filename}; return n })
      setTimeout(() => setPresence(p => { const n={...p}; if(n[wsId]) n[wsId]={...n[wsId], typing:false}; return n }), 1500)
    })

    conn.on('RemoteCursor', ({ wsId, line, col, filename, userName, userColor }: any) => {
      setPresence(p => {
        const n={...p}
        if(n[wsId]) n[wsId]={...n[wsId], cursor:{line,col}, activeFile:filename,
          user: n[wsId].user ?? { id:wsId, name:userName, color:userColor, role:'', initial:userName?.[0]??'?' } }
        return n
      })
    })

    conn.on('ConflictDetected', ({ conflict }: { conflict: ConflictInfo }) => {
      // FIX: Compute the merge result immediately and unconditionally so the
      // "Resolve Conflict" button is never stuck in "Analyzing..." state.
      const mergedNow = smartDemoMerge(conflict, filesRef.current)
      setConflicts(p => ({ ...p, [conflict.id]: conflict }))
      setAiResults(p => ({ ...p, [conflict.id]: mergedNow }))
      addLog(`⚠ Conflict in ${conflict.filename}: ${conflict.devA.name} vs ${conflict.devB.name}`, 'conflict')
      notify('nc', '⚠ Conflict Detected', `${conflict.devA.name} & ${conflict.devB.name} — ${conflict.filename}`)
      setRpOpen(true); setRTab('conflicts')
    })

    conn.on('ConflictUpdated', ({ conflict }: { conflict: ConflictInfo }) => {
      // FIX: Recompute merge result whenever conflict data updates (new line ranges)
      const mergedNow = smartDemoMerge(conflict, filesRef.current)
      setConflicts(p => ({ ...p, [conflict.id]: conflict }))
      setAiResults(p => ({ ...p, [conflict.id]: mergedNow }))
    })

    conn.on('ConflictCleared', ({ conflictId }: { conflictId:string }) => {
      setConflicts(p => { const n={...p}; delete n[conflictId]; return n })
    })

    conn.on('MergeApplied', ({ code, conflictId, filename, appliedBy }: any) => {
      setFiles(p => ({ ...p, [filename]: code }))
      setConflicts(p => { const n={...p}; delete n[conflictId]; return n })
      setAiResults(p => { const n={...p}; delete n[conflictId]; return n })
      addLog(`✅ Merge applied by ${appliedBy} in ${filename}`, 'success')
      notify('ns', '✅ Merge Applied', `${appliedBy} applied merge to ${filename}`)
      if (editorRef.current && filename === activeRef.current) {
        suppressRef.current = true
        editorRef.current.value = code
        suppressRef.current = false
      }
    })

    conn.on('FileCreated', ({ filename, content, createdBy }: any) => {
      setFiles(p => ({ ...p, [filename]: content }))
      setOpenTabs(p => p.includes(filename) ? p : [...p, filename])
      setActiveFile(filename)
      addLog(`${createdBy} created ${filename}`, 'info')
    })

    conn.on('FileDeleted', ({ filename, deletedBy }: any) => {
      setFiles(p => { const n={...p}; delete n[filename]; return n })
      setOpenTabs(p => p.filter(t => t !== filename))
      addLog(`${deletedBy} deleted ${filename}`, 'warning')
    })

    conn.onreconnecting(() => setConnected(false))
    conn.onreconnected(() => setConnected(true))
    conn.onclose(() => setConnected(false))
  }, [addLog, notify, updateGutter, drawMinimap])

  // ── Join handler ───────────────────────────────────────────────────────────
  const handleJoin = useCallback(async (user: UserInfo, key: string) => {
    setMe(user); setMyKey(key); setJoined(true)
    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hub')
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build()
    connRef.current = conn
    wireEvents(conn)
    try {
      await conn.start()
      setConnected(true)
      await conn.invoke('Join', user, 'MathHelper.cs')
    } catch (e) { console.error('SignalR start failed:', e) }
  }, [wireEvents])

  // ── Open file ──────────────────────────────────────────────────────────────
  const openFile = useCallback((filename: string) => {
    const content = filesRef.current[filename]
    if (content === undefined) return
    setActiveFile(filename)
    setOpenTabs(p => p.includes(filename) ? p : [...p, filename])
    if (editorRef.current) {
      suppressRef.current = true
      editorRef.current.value = content
      suppressRef.current = false
      lastSentRef.current = content
    }
    send('SwitchFile', filename)
  }, [send])

  // Sync editor when activeFile changes (e.g. after tab click)
  useEffect(() => {
    if (!editorRef.current) return
    const content = files[activeFile] ?? ''
    suppressRef.current = true
    editorRef.current.value = content
    suppressRef.current = false
    lastSentRef.current = content
    updateGutter(content, activeFile, dirtyFiles.has(activeFile), conflicts)
    drawMinimap(content, conflicts, activeFile)
  }, [activeFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resolve new conflicts with local engine
  useEffect(() => {
    setAiResults(prev => {
      const next = {...prev}
      let changed = false
      Object.keys(conflicts).forEach(id => {
        if (!next[id]) { next[id] = smartDemoMerge(conflicts[id], filesRef.current); changed = true }
      })
      return changed ? next : prev
    })
  }, [conflicts])

  // ── Editor: input ──────────────────────────────────────────────────────────
  const handleInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    if (suppressRef.current) return
    const code = e.target.value
    const af   = activeRef.current
    setFiles(p => ({ ...p, [af]: code }))
    setDirtyFiles(p => new Set([...p, af]))
    setEdStatus('Editing…')

    clearTimeout(typingRef.current)
    typingRef.current = setTimeout(() => {
      if (code === lastSentRef.current || !af) return
      lastSentRef.current = code
      const ta = editorRef.current!
      const before = ta.value.slice(0, ta.selectionStart).split('\n')
      const ln = before.length - 1, col = before[before.length-1].length
      send('CodeChange', af, code, ln, col)
      send('SaveFile', af, code)
      setEdStatus('Saved ✓')
      setDirtyFiles(p => { const n = new Set(p); n.delete(af); return n })
      clearTimeout(suggestRef.current)
      suggestRef.current = setTimeout(() => requestSuggestions(code), 3500)
    }, 120)

    // live gutter + minimap
    updateGutter(code, af, true, conflicts)
    drawMinimap(code, conflicts, af)
    const before = e.target.value.slice(0, e.target.selectionStart).split('\n')
    setLnCol(`Ln ${before.length}, Col ${before[before.length-1].length+1}`)
  }, [send, conflicts, updateGutter, drawMinimap]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editor: keydown ────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    const ed = e.currentTarget, v = ed.value, s = ed.selectionStart, se = ed.selectionEnd

    // Ctrl/Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      const af = activeRef.current
      send('SaveFile', af, filesRef.current[af] ?? '')
      setDirtyFiles(p => { const n=new Set(p); n.delete(af); return n })
      setEdStatus('Saved ✓')
      return
    }
    // Tab
    if (e.key === 'Tab') {
      e.preventDefault()
      const sp = activeRef.current.endsWith('.json') ? '  ' : '    '
      ed.value = v.slice(0,s) + sp + v.slice(se)
      ed.selectionStart = ed.selectionEnd = s + sp.length
      ed.dispatchEvent(new Event('input',{bubbles:true}))
      return
    }
    // Enter with auto-indent
    if (e.key === 'Enter') {
      e.preventDefault()
      const ls = v.lastIndexOf('\n',s-1)+1
      const cur = v.slice(ls, s)
      const indent = cur.match(/^(\s*)/)?.[1] ?? ''
      const last = cur.trimEnd().at(-1)
      const isJson = activeRef.current.endsWith('.json')
      const extra = (last==='{' || last==='[') ? (isJson?'  ':'    ') : ''
      const after = v[s]
      if (extra && (after==='}' || after===']')) {
        const ins = '\n'+indent+extra+'\n'+indent
        ed.value = v.slice(0,s)+ins+v.slice(se)
        ed.selectionStart = ed.selectionEnd = s+1+indent.length+extra.length
      } else {
        const ins = '\n'+indent+extra
        ed.value = v.slice(0,s)+ins+v.slice(se)
        ed.selectionStart = ed.selectionEnd = s+ins.length
      }
      ed.dispatchEvent(new Event('input',{bubbles:true}))
      return
    }
    // Smart backspace
    if (e.key==='Backspace' && s===se) {
      const ls = v.lastIndexOf('\n',s-1)+1
      const before = v.slice(ls,s)
      if (/^ +$/.test(before) && before.length>0) {
        e.preventDefault()
        const chunk = before.length%4===0?4:before.length%2===0?2:1
        ed.value = v.slice(0,s-chunk)+v.slice(s)
        ed.selectionStart = ed.selectionEnd = s-chunk
        ed.dispatchEvent(new Event('input',{bubbles:true}))
      }
    }
  }, [send])

  // ── Cursor broadcast ───────────────────────────────────────────────────────
  const sendCursor = useCallback(() => {
    if (!editorRef.current) return
    const before = editorRef.current.value.slice(0, editorRef.current.selectionStart).split('\n')
    const ln = before.length-1, col = before[before.length-1].length
    setLnCol(`Ln ${ln+1}, Col ${col+1}`)
    send('Cursor', ln, col, activeRef.current)
  }, [send])

  const handleScroll = useCallback(() => {
    if (gutterRef.current && scrollRef.current)
      gutterRef.current.style.transform = `translateY(-${scrollRef.current.scrollTop}px)`
  }, [])

  // ── AI Suggestions ─────────────────────────────────────────────────────────
  const requestSuggestions = useCallback(async (code: string) => {
    if (!myKey) return
    try {
      const r = await fetch('/api/ai/suggest', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ code, filename: activeRef.current, apiKey: myKey }),
      })
      const d = await r.json()
      if (d.suggestions?.length) setAiSuggs(d.suggestions.slice(0,3))
    } catch {/* ignore */}
  }, [myKey])

  // ── AI Resolve ─────────────────────────────────────────────────────────────
  const aiResolve = useCallback(async (conflictId: string) => {
    const c = conflicts[conflictId]; if (!c) return
    addLog(`🤖 Analyzing conflict in ${c.filename}…`, 'info')

    if (!myKey) {
      setAiResults(p => ({ ...p, [conflictId]: smartDemoMerge(c, filesRef.current) }))
      notify('ns','✨ Resolved','Local engine merged the conflict')
      return
    }
    try {
      const r = await fetch('/api/ai/resolve', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ conflict: c, apiKey: myKey }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setAiResults(p => ({ ...p, [conflictId]: d.resolved }))
      addLog(`✅ AI resolved ${c.filename}`, 'success')
      notify('ns','✨ Conflict Resolved','Review and apply the merged output')
    } catch (err: any) {
      setAiResults(p => ({ ...p, [conflictId]: smartDemoMerge(c, filesRef.current) }))
      addLog(`Engine fallback: ${err.message}`, 'warning')
    }
  }, [conflicts, myKey, addLog, notify])

  // ── Merge modal open ───────────────────────────────────────────────────────
  const openMergeModal = useCallback((id: string) => {
    setMergeModal(id)
    if (!aiResults[id]) aiResolve(id)
  }, [aiResults, aiResolve])

  // ── Accept merge ───────────────────────────────────────────────────────────
  const acceptMerge = useCallback(() => {
    if (!mergeModal) return
    const c = conflicts[mergeModal], resolved = aiResults[mergeModal]
    if (!c || !resolved) return
    setFiles(p => ({ ...p, [c.filename]: resolved }))
    if (editorRef.current && c.filename === activeRef.current) {
      suppressRef.current = true
      editorRef.current.value = resolved
      suppressRef.current = false
    }
    send('ApplyMerge', mergeModal, resolved, c.filename)
    send('SaveFile', c.filename, resolved)
    setConflicts(p => { const n={...p}; delete n[mergeModal]; return n })
    setAiResults(p => { const n={...p}; delete n[mergeModal]; return n })
    addLog(`✅ Merge applied to ${c.filename}`, 'success')
    notify('ns','✅ Applied', `Resolved code applied to ${c.filename}`)
    setMergeModal(null)
  }, [mergeModal, conflicts, aiResults, send, addLog, notify])

  // ── New file ───────────────────────────────────────────────────────────────
  const confirmNewFile = useCallback(() => {
    let n = nfName.trim(); if (!n) return
    if (!n.includes('.')) n += '.cs'
    if (files[n]) { notify('nw','File exists',`${n} already exists`); return }
    send('CreateFile', n, nfContent || `// ${n}\n`)
    setNfModal(false); setNfName(''); setNfContent('')
  }, [nfName, nfContent, files, send, notify])

  const setTemplate = useCallback((type: string) => {
    const base = nfName.replace('.cs','') || 'MyClass'
    const tpl: Record<string,string> = {
      cs:`using System;\n\nnamespace CodeHarmony\n{\n    public class ${base}\n    {\n        public ${base}() { }\n    }\n}\n`,
      interface:`using System;\n\nnamespace CodeHarmony\n{\n    public interface I${base}\n    {\n    }\n}\n`,
      enum:`namespace CodeHarmony\n{\n    public enum ${base}\n    {\n        ValueA,\n        ValueB,\n        ValueC\n    }\n}\n`,
      json:`{\n  "name": "example",\n  "version": "1.0.0"\n}\n`,
      txt:'',
    }
    setNfContent(tpl[type] ?? '')
    if (!nfName) setNfName('NewFile'+({ cs:'.cs', interface:'.cs', enum:'.cs', json:'.json', txt:'.txt' }[type] ?? '.cs'))
  }, [nfName])

  // ─── Computed values ───────────────────────────────────────────────────────
  const conflictList  = Object.values(conflicts)
  const userCount     = Object.keys(presence).length + 1
  const allUsers      = [me, ...Object.values(presence).map(p=>p.user).filter(Boolean)].slice(0,6) as UserInfo[]
  const activeConfs   = conflictList.filter(c => c.filename === activeFile)
  const confLineSet   = new Set(activeConfs.flatMap(c => c.lines ?? []))

  // ── Activity bar toggle helper ─────────────────────────────────────────────
  function toggleLPanel(panel: LPanel) {
    if (lPanel === panel) { setLsbOpen(o => !o) } else { setLPanel(panel); setLsbOpen(true) }
  }

  // ─── Conflict card (used in both sidebar and right panel) ─────────────────
  function ConflictCard({ c }: { c: ConflictInfo }) {
    const ready = !!aiResults[c.id]
    return (
      <div className="csc">
        <div className="csc-hdr">
          <div className="csc-pulse" />
          <span className="csc-title">⚡ Conflict Detected</span>
          <span className="csc-file">{c.filename}</span>
        </div>
        <div className="csc-devs">
          <div className="csc-dev"><div className="csc-dot" style={{background:c.devA.color}}/><span style={{color:c.devA.color}}>{c.devA.name}</span></div>
          <span className="csc-vs">VS</span>
          <div className="csc-dev"><div className="csc-dot" style={{background:c.devB.color}}/><span style={{color:c.devB.color}}>{c.devB.name}</span></div>
        </div>
        <div className="csc-lines">Lines: <span>{(c.lines??[]).map(l=>l+1).join(', ')}</span></div>
        <button className="csc-btn" onClick={() => openMergeModal(c.id)} disabled={!ready}>
          {ready ? <><span>⚡</span><span>Resolve Conflict</span></> : <><span className="csc-spin"/><span>Analyzing…</span></>}
        </button>
      </div>
    )
  }

  if (!joined) return <Splash onJoin={handleJoin} />

  // ─── Full VS Code-like UI ──────────────────────────────────────────────────
  return (
    <div id="app" className="show">

      {/* Notifications */}
      <div className="notifs">
        {notifs.map(n => (
          <div key={n.id} className={`notif ${n.cls}`}>
            <div className="notif-title">{n.title}</div>
            <div className="notif-body">{n.body}</div>
          </div>
        ))}
      </div>

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div className="titlebar">
        <div className="tb-dots">
          <div className="tb-dot" style={{background:'#ff5f57'}}/>
          <div className="tb-dot" style={{background:'#febc2e'}}/>
          <div className="tb-dot" style={{background:'#28c840'}}/>
        </div>
        <div className="tb-title">Resolver Engine — {me?.name}</div>
        <div className="tb-users">
          {allUsers.map((u,i) => u
            ? <div key={i} className="tb-uav" data-tip={u.name}
                style={{background:u.color+'22', color:u.color, border:`1.5px solid ${u.color}44`}}>{u.initial}</div>
            : null
          )}
        </div>
      </div>

      <div className="body">

        {/* ── Activity bar ──────────────────────────────────────────────── */}
        <div className="actbar">
          <button className={`ab ${lPanel==='explorer' && lsbOpen ? 'on':''}`}
            onClick={() => toggleLPanel('explorer')} title="Explorer">📁</button>

          <button className={`ab ${lPanel==='users' && lsbOpen ? 'on':''}`}
            onClick={() => toggleLPanel('users')} title="Live Users">
            👥{Object.keys(presence).length>0 && <div className="ab-badge">{Object.keys(presence).length}</div>}
          </button>

          <button className="ab" onClick={() => { setRpOpen(true); setRTab('conflicts') }} title="Conflicts">
            ⚠️{conflictList.length>0 && <div className="ab-badge">{conflictList.length}</div>}
          </button>

          <button className={`ab ${lPanel==='ai' && lsbOpen ? 'on':''}`}
            onClick={() => toggleLPanel('ai')} title="AI Hints">
            🤖{aiSuggs.length>0 && <div className="ab-badge">{aiSuggs.length}</div>}
          </button>

          <div className="ab-spacer"/>
          <button className="ab" title="Disconnect" style={{color:'#6e6e6e'}}
            onClick={() => { connRef.current?.stop(); window.location.reload() }}>⏏</button>
        </div>

        {/* ── Left sidebar ──────────────────────────────────────────────── */}
        <div className={`lsb ${!lsbOpen?'closed':''}`}>
          <div className="lsb-hdr">
            <span>{lPanel==='explorer'?'EXPLORER': lPanel==='users'?'LIVE USERS':'CODE HINTS'}</span>
            {lPanel==='explorer' && <button className="lsb-hdr-btn" onClick={() => setNfModal(true)} title="New File">＋</button>}
          </div>
          <div className="lsb-body">

            {/* Explorer */}
            {lPanel==='explorer' && (
              <div className="ft-section">
                <div className="ft-section-hdr"><span className="ft-section-arrow open">▶</span> RESOLVER-ENGINE</div>
                {Object.keys(files).map(fn => {
                  const ext = getExt(fn)
                  const hasConf = conflictList.some(c => c.filename===fn)
                  return (
                    <div key={fn} className={`ft-row ${fn===activeFile?'active':''} ${hasConf?'has-conflict':''}`}
                      onClick={() => openFile(fn)}>
                      <div className="ft-indent"/><div className="ft-arr"/>
                      <div className="ft-icon">{FILE_ICONS[ext]??'📄'}</div>
                      <div className="ft-name">{fn}</div>
                      <div className="ft-actions">
                        <button className="ft-action-btn" title="Delete"
                          onClick={e => { e.stopPropagation(); if(window.confirm(`Delete ${fn}?`)) send('DeleteFile', fn) }}>🗑</button>
                      </div>
                    </div>
                  )
                })}
                <div className="ft-new" onClick={() => setNfModal(true)}>＋ New File</div>
                {/* Conflict cards below file list */}
                {conflictList.map(c => <ConflictCard key={c.id} c={c}/>)}
              </div>
            )}

            {/* Users */}
            {lPanel==='users' && (
              [{ user:me!, isMe:true, typing:false, activeFile }, ...Object.values(presence).map(p => ({user:p.user!, isMe:false, typing:p.typing, activeFile:p.activeFile}))].map((p,i) => {
                const u = p.user; if (!u) return null
                return (
                  <div key={i} className="pr-item">
                    <div className="pr-av" style={{background:u.color+'22',color:u.color,border:`2px solid ${u.color}44`}}>{u.initial}</div>
                    <div className="pr-info">
                      <div className="pr-name" style={{color:u.color}}>{u.name} {p.isMe&&<span style={{color:'#555',fontSize:10}}>(you)</span>}</div>
                      <div className={`pr-status ${p.typing?'pr-typing':''}`}>
                        {p.typing ? <span style={{color:u.color}}>✎ typing in {p.activeFile??'?'}</span> : (p.activeFile??u.role)}
                      </div>
                    </div>
                    <div className="pr-dot"/>
                  </div>
                )
              })
            )}

            {/* AI hints in sidebar */}
            {lPanel==='ai' && (
              aiSuggs.length===0
                ? <div className="empty"><div className="empty-i">🤖</div><div className="empty-t">Code hints appear as you type.<br/><span style={{color:'#4a5568',fontSize:10}}>Requires API key</span></div></div>
                : aiSuggs.map((s,i) => (
                  <div key={i} className="ai-card">
                    <div className="ai-card-hdr"><span>💡</span><span className="ai-card-title">{s.title}</span></div>
                    <div className="ai-card-body">
                      <div style={{color:'#888',fontSize:11,lineHeight:1.6}}>{s.description}</div>
                      {s.code && <div className="ai-card-code">{s.code}</div>}
                    </div>
                    {s.code && (
                      <button className="ai-card-apply" onClick={() => {
                        const ed = editorRef.current!
                        const p = ed.selectionStart, v = ed.value
                        ed.value = v.slice(0,p)+'\n'+s.code+'\n'+v.slice(p)
                        ed.dispatchEvent(new Event('input',{bubbles:true}))
                        notify('ni','✨ Applied', s.title)
                      }}>Apply Suggestion</button>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>

        {/* ── Editor column ─────────────────────────────────────────────── */}
        <div className="editor-col">

          {/* Tabs */}
          <div className="tabs">
            {openTabs.map(fn => {
              const ext = getExt(fn)
              const hasConf = conflictList.some(c=>c.filename===fn)
              const dirty   = dirtyFiles.has(fn)
              return (
                <div key={fn} className={`tab ${fn===activeFile?'active':''}`} onClick={() => openFile(fn)}>
                  <span>{FILE_ICONS[ext]??'📄'}</span>
                  <span>{fn}</span>
                  {hasConf && <span className="tab-conflict-dot"/>}
                  {dirty && !hasConf && <span className="tab-dirty"/>}
                  <span className="tab-x" onClick={e => {
                    e.stopPropagation()
                    setOpenTabs(p => {
                      const next = p.filter(t=>t!==fn)
                      if (activeFile===fn && next.length) openFile(next[next.length-1])
                      return next
                    })
                  }}>✕</span>
                </div>
              )
            })}
          </div>

          {/* Breadcrumb */}
          <div className="breadcrumb">
            <span>codeharmony</span><span className="bc-sep">›</span>
            <span>src</span><span className="bc-sep">›</span>
            <span className="bc-cur">{activeFile}</span>
          </div>

          {/* Code area */}
          <div className="code-wrap">
            <div className="gutter" ref={gutterRef}/>

            <div className="code-scroll" ref={scrollRef} onScroll={handleScroll}>
              <div className="code-inner">

                {/* Remote cursors */}
                <div className="cursor-layer">
                  {Object.values(presence).map(p => {
                    if (!p.cursor || !p.user || p.activeFile!==activeFile) return null
                    return (
                      <React.Fragment key={p.id}>
                        <div className="rcursor" style={{top:14+p.cursor.line*LH, left:10+p.cursor.col*CW, background:p.user.color}}/>
                        <div className="rcursor-lbl" style={{top:14+p.cursor.line*LH-17, left:10+p.cursor.col*CW+3, background:p.user.color}}>{p.user.name}</div>
                      </React.Fragment>
                    )
                  })}
                </div>

                {/* Conflict highlights */}
                <div className="conflict-layer">
                  {[...confLineSet].map(l => <div key={l} className="conflict-hl" style={{top:14+l*LH}}/>)}
                </div>

                <textarea id="codeEditor" ref={editorRef}
                  autoCorrect="off" autoComplete="off" spellCheck={false}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  onKeyUp={sendCursor}
                  onClick={sendCursor}
                />
              </div>
            </div>

            <div className="minimap"><canvas ref={canvasRef} width="64" height="800"/></div>
          </div>

          {/* Status bar */}
          <div className="statusbar">
            <div className="sb-item">
              <div className="sb-dot" style={{background:connected?'#4ec9b0':'#f44747'}}/>
              <span>{connected?'Connected':'Reconnecting…'}</span>
            </div>
            <div className="sb-sep"/>
            <div className="sb-item">🔀 main</div>
            <div className="sb-sep"/>
            <div className="sb-item">{lnCol}</div>
            <div className="sb-item">{edStatus}</div>
            <div className="sb-right">
              {confLineSet.size>0 && <div className="sb-conflict-badge">⚠ {confLineSet.size} conflict line{confLineSet.size>1?'s':''}</div>}
              <div className="sb-sep"/>
              <div className="sb-item">{langLabel(activeFile)}</div>
              <div className="sb-item">UTF-8</div>
              <div className="sb-item">{userCount} user{userCount>1?'s':''}</div>
            </div>
          </div>
        </div>

        {/* ── Right panel ───────────────────────────────────────────────── */}
        <div className={`rpanel ${!rpOpen?'closed':''}`}>
          <div className="rp-tabs">
            {(['conflicts','ai','log'] as RTab[]).map(tab => (
              <div key={tab} className={`rp-tab ${rTab===tab?'on':''}`} onClick={() => setRTab(tab)}>
                {tab==='conflicts'?'⚠ Conflicts': tab==='ai'?'💡 Hints':'📋 Log'}
              </div>
            ))}
          </div>
          <div className="rp-body">
            {rTab==='conflicts' && (
              conflictList.length===0
                ? <div className="empty"><div className="empty-i">🟢</div><div className="empty-t">No conflicts detected.<br/>All clear!</div></div>
                : conflictList.map(c => <ConflictCard key={c.id} c={c}/>)
            )}
            {rTab==='ai' && (
              aiSuggs.length===0
                ? <div className="empty"><div className="empty-i">💡</div><div className="empty-t">Code hints appear as you type.<br/>Requires API key.</div></div>
                : aiSuggs.map((s,i) => (
                  <div key={i} className="ai-card">
                    <div className="ai-card-hdr"><span>💡</span><span className="ai-card-title">{s.title}</span></div>
                    <div className="ai-card-body">
                      <div style={{color:'#888',fontSize:11,lineHeight:1.6}}>{s.description}</div>
                      {s.code && <div className="ai-card-code">{s.code}</div>}
                    </div>
                  </div>
                ))
            )}
            {rTab==='log' && (
              clog.length===0
                ? <div className="empty"><div className="empty-i">📋</div><div className="empty-t">Log is empty.</div></div>
                : [...clog].reverse().slice(0,80).map((l,i) => (
                  <div key={i} className="log-row">
                    <span className="log-t">{l.time}</span>
                    <span className={`log-m ${l.type}`}>{l.msg}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* ── Merge Modal ───────────────────────────────────────────────────── */}
      {mergeModal && (() => {
        const c        = conflicts[mergeModal]; if (!c) return null
        const resolved = aiResults[mergeModal]
        const aLines   = c.devA.code.split('\n')
        const bLines   = c.devB.code.split('\n')
        const cSet     = new Set(c.lines??[])
        const baseArr  = (files[c.filename]??'').split('\n')

        return (
          <div id="mergeModal" className="open" onClick={e => { if(e.target===e.currentTarget) setMergeModal(null) }}>
            <div className="mm-box">
              {/* Header */}
              <div className="mm-hdr">
                <div style={{width:10,height:10,borderRadius:'50%',background:'#f44747',boxShadow:'0 0 8px #f44747',flexShrink:0}}/>
                <div className="mm-title">Conflict in {c.filename}</div>
                <div className="mm-devs">
                  {[c.devA, c.devB].map((dev,i) => (
                    <React.Fragment key={dev.id}>
                      {i>0 && <span style={{color:'#444',fontSize:12}}>vs</span>}
                      <div className="mm-dev-chip">
                        <div className="mm-dev-av" style={{background:dev.color+'22',color:dev.color}}>{dev.initial||dev.name[0]}</div>
                        <span style={{color:dev.color}}>{dev.name}</span>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                <button className="mm-close" onClick={() => setMergeModal(null)}>✕</button>
              </div>

              {/* Two-pane diff */}
              <div className="mm-conflict-panes">
                {([{dev:c.devA, lines:aLines},{dev:c.devB, lines:bLines}]).map((pane,pi) => (
                  <div key={pi} className="mm-pane">
                    <div className="mm-pane-hdr">
                      <div className="mm-pane-dot" style={{background:pane.dev.color}}/>
                      <span className="mm-pane-label" style={{color:pane.dev.color}}>{pane.dev.name}'s version</span>
                      <span className="mm-pane-lines">{pane.lines.length} lines</span>
                    </div>
                    <div className="mm-pane-code">
                      {pane.lines.map((l,i) => {
                        const changed = l.trim() !== (baseArr[i]??'').trim()
                        return <span key={i} className={cSet.has(i)&&changed?'diff-ln-changed':'diff-ln-normal'}>{l||' '}{'\n'}</span>
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Resolved output */}
              <div className="mm-resolved-section">
                {!resolved ? (
                  <div className="mm-loading">
                    <div className="mm-loading-orb">
                      <div className="mm-orb-ring r1"/><div className="mm-orb-ring r2"/><div className="mm-orb-ring r3"/>
                      <div className="mm-orb-core">⚡</div>
                    </div>
                    <div style={{fontSize:12,color:'#4ec9b0'}}>Resolver Engine analyzing…</div>
                  </div>
                ) : (
                  <>
                    <div className="mm-resolved-hdr">
                      <span className="mm-resolved-title">⚡ Resolver Engine Output</span>
                      <div className="mm-legend">
                        <div className="mm-legend-item"><div className="mm-legend-dot" style={{background:'#0078d4'}}/> From {c.devA.name}</div>
                        <div className="mm-legend-item"><div className="mm-legend-dot" style={{background:'#4ec9b0'}}/> From {c.devB.name}</div>
                        <div className="mm-legend-item"><div className="mm-legend-dot" style={{background:'#dcdcaa'}}/> Merged</div>
                      </div>
                    </div>
                    <div className="mm-resolved-code">
                      {resolved.split('\n').map((line,i) => {
                        const tr   = line.trim()
                        const base = (baseArr[i] ?? '').trim()
                        const aL   = (aLines[i]  ?? '').trim()
                        const bL   = (bLines[i]  ?? '').trim()
                        let cls = 'ml ml-normal'
                        // FIX: Compare against base regardless of cSet index.
                        // The merged output can have more/fewer lines than either input,
                        // so using cSet line indices would miss most colored lines.
                        if (tr && tr !== base) {
                          if (tr === aL && tr !== bL)       cls = 'ml ml-a'
                          else if (tr === bL && tr !== aL)  cls = 'ml ml-b'
                          else                              cls = 'ml ml-merged'
                        }
                        return <span key={i} className={cls} style={{animationDelay:`${i*18}ms`}}>{line||' '}{'\n'}</span>
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="mm-actions">
                <div style={{fontSize:11,color:'#5a5a5a',flex:1}}>
                  {resolved ? 'Resolution ready — review and apply.' : 'Resolver Engine is analyzing the conflict…'}
                </div>
                <button className="btn-reject" onClick={() => setMergeModal(null)}>✕ Reject</button>
                <button className="btn-accept" onClick={acceptMerge} disabled={!resolved}>
                  {resolved ? '✓ Apply Resolution' : '⚙ Resolving…'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── New File Modal ────────────────────────────────────────────────── */}
      {nfModal && (
        <div id="newFileModal" className="open" onClick={e => { if(e.target===e.currentTarget) setNfModal(false) }}>
          <div className="nf-box">
            <div className="nf-title">New File</div>
            <input className="nf-input" value={nfName} onChange={e => setNfName(e.target.value)}
              placeholder="Filename (e.g. MyClass.cs)" maxLength={60}
              onKeyDown={e => e.key==='Enter' && confirmNewFile()} autoFocus />
            <div style={{fontSize:11,color:'#5a5a5a',marginBottom:8}}>Quick templates:</div>
            <div className="nf-types">
              {[['cs','C# Class'],['interface','Interface'],['enum','Enum'],['json','JSON'],['txt','Plain Text']].map(([t,label]) => (
                <div key={t} className="nf-type" onClick={() => setTemplate(t)}>{label}</div>
              ))}
            </div>
            <div className="nf-actions">
              <button className="nf-btn-cancel" onClick={() => setNfModal(false)}>Cancel</button>
              <button className="nf-btn-ok" onClick={confirmNewFile}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
