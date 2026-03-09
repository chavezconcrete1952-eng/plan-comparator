import { useState, useCallback, useRef } from "react";

const TRADES = [
  { id: "civil", label: "Civil", priority: 1, color: "#E8A838" },
  { id: "arch", label: "Architectural", priority: 1, color: "#4A90D9" },
  { id: "grading", label: "Grading & Drainage", priority: 1, color: "#5BAD6F" },
  { id: "structural", label: "Structural", priority: 1, color: "#D95F5F" },
  { id: "electrical", label: "Electrical Site", priority: 2, color: "#9B6DD9" },
  { id: "mechanical", label: "Mechanical", priority: 2, color: "#6DBBD9" },
];

const SYSTEM_PROMPT = `You are an expert construction plan reviewer for a concrete contractor in Albuquerque, NM.
Compare two versions of construction plan sheets and find EVERY change.

For each change report:
1. Sheet/Page number and title (e.g. "S-101 Foundation Plan")
2. Trade: Civil, Architectural, Grading & Drainage, Structural, Electrical Site, or Mechanical
3. Exactly what changed — word for word for notes/specs, exact dimensions for measurements
4. Type: MODIFIED, ADDED, or DELETED
5. Element/detail it pertains to (footing, slab, wall, note, schedule, etc.)
6. Severity: CRITICAL (affects concrete/structural work), IMPORTANT (coordination), MINOR (admin/cosmetic)

Priority order: Structural, Civil, Grading & Drainage, Architectural, then Electrical Site, Mechanical.

Respond ONLY with valid JSON, no preamble, no markdown:
{
  "summary": "one paragraph overview",
  "changes": [
    {
      "id": "c1",
      "sheet": "sheet number and title",
      "trade": "trade name",
      "type": "MODIFIED|ADDED|DELETED",
      "severity": "CRITICAL|IMPORTANT|MINOR",
      "element": "element description",
      "description": "exact word-for-word change",
      "oldValue": "before (if applicable)",
      "newValue": "after (if applicable)",
      "fieldNote": "short foreman note"
    }
  ]
}`;

const loadJSZip = () => new Promise((resolve) => {
  if (window.JSZip) return resolve(window.JSZip);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  s.onload = () => resolve(window.JSZip);
  document.head.appendChild(s);
});

const loadPdfJs = () => new Promise((resolve) => {
  if (window.pdfjsLib) return resolve(window.pdfjsLib);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  s.onload = () => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    resolve(window.pdfjsLib);
  };
  document.head.appendChild(s);
});

async function extractPdfsFromZip(zipFile, onProgress) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter(
    f => !f.dir && f.name.toLowerCase().endsWith(".pdf") && !f.name.includes("__MACOSX")
  ).sort((a, b) => a.name.localeCompare(b.name));
  const pdfs = [];
  for (let i = 0; i < entries.length; i++) {
    onProgress(`Extracting ${i + 1}/${entries.length}: ${entries[i].name.split("/").pop()}`);
    const blob = await entries[i].async("blob");
    pdfs.push({ name: entries[i].name.split("/").pop(), blob });
  }
  return pdfs;
}

async function pdfBlobToImages(blob, name, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(i, pdf.numPages, name);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    images.push({ pageNum: i, fileName: name, base64: canvas.toDataURL("image/jpeg", 0.7).split(",")[1] });
  }
  return images;
}

function FileDropZone({ label, files, onFiles, color }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();
  const has = files && files.length > 0;

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith(".pdf") || f.name.toLowerCase().endsWith(".zip")
    );
    if (dropped.length) onFiles(prev => [...(prev || []), ...dropped]);
  }, [onFiles]);

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? color : has ? color : "#2e2e2e"}`,
        borderRadius: 10, padding: "22px 18px", cursor: "pointer",
        background: dragging ? `${color}18` : has ? `${color}06` : "#161616",
        transition: "all 0.2s", minHeight: 140,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
      }}
    >
      <input ref={inputRef} type="file" accept=".zip,.pdf" multiple style={{ display: "none" }}
        onChange={e => { const sel = Array.from(e.target.files); if (sel.length) onFiles(prev => [...(prev || []), ...sel]); }} />
      <div style={{ fontSize: 26 }}>{has ? "📋" : "📂"}</div>
      <div style={{ color: has ? color : "#666", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>{label}</div>
      {has ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
          {files.map((f, i) => (
            <div key={i} style={{ color: "#999", fontSize: 10, background: "#1e1e1e", borderRadius: 4, padding: "3px 8px", display: "flex", gap: 5, alignItems: "center" }}>
              <span>{f.name.endsWith(".zip") ? "🗜" : "📄"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            </div>
          ))}
          <div style={{ color: "#333", fontSize: 9, textAlign: "center", marginTop: 2 }}>Click to add more</div>
        </div>
      ) : (
        <div style={{ color: "#383838", fontSize: 10, textAlign: "center", lineHeight: 1.6 }}>
          Drop ZIP or PDFs here, or click to browse<br />Ctrl+click for multiple files
        </div>
      )}
    </div>
  );
}

function Badge({ type, severity }) {
  const tc = { MODIFIED: "#E8A838", ADDED: "#5BAD6F", DELETED: "#D95F5F" };
  const sc = { CRITICAL: "#D95F5F", IMPORTANT: "#E8A838", MINOR: "#555" };
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      <span style={{ background: (tc[type]||"#888") + "22", color: tc[type]||"#888", border: `1px solid ${tc[type]||"#888"}44`, borderRadius: 4, padding: "2px 6px", fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>{type}</span>
      <span style={{ background: (sc[severity]||"#555") + "22", color: sc[severity]||"#555", border: `1px solid ${sc[severity]||"#555"}44`, borderRadius: 4, padding: "2px 6px", fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>{severity}</span>
    </span>
  );
}

function TradePill({ trade }) {
  const t = TRADES.find(t => t.label.toLowerCase() === (trade||"").toLowerCase()) || TRADES.find(t => (trade||"").toLowerCase().includes(t.id));
  const color = t?.color || "#888";
  return <span style={{ background: color+"22", color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 6px", fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>{trade}</span>;
}

function ChangeCard({ change, idx }) {
  const [open, setOpen] = useState(false);
  const border = { CRITICAL: "#D95F5F33", IMPORTANT: "#E8A83822", MINOR: "#1e1e1e" };
  return (
    <div style={{ background: "#181818", border: `1px solid ${border[change.severity]||"#1e1e1e"}`, borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "12px 15px", cursor: "pointer", display: "flex", gap: 11, alignItems: "flex-start" }}>
        <div style={{ color: "#333", fontFamily: "monospace", fontSize: 10, minWidth: 24, paddingTop: 2 }}>#{idx+1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 5, alignItems: "center" }}>
            <span style={{ color: "#fff", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{change.sheet}</span>
            <TradePill trade={change.trade} />
            <Badge type={change.type} severity={change.severity} />
          </div>
          <div style={{ color: "#888", fontSize: 12, lineHeight: 1.5 }}>{change.description}</div>
        </div>
        <div style={{ color: "#333", fontSize: 13, flexShrink: 0 }}>{open ? "▲" : "▼"}</div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid #1e1e1e", padding: "11px 15px 11px 50px", display: "flex", flexDirection: "column", gap: 8 }}>
          {change.element && <div><span style={{ color: "#333", fontSize: 9, fontFamily: "monospace" }}>ELEMENT: </span><span style={{ color: "#aaa", fontSize: 12 }}>{change.element}</span></div>}
          {change.oldValue && <div style={{ background: "#1a0808", border: "1px solid #D95F5F22", borderRadius: 5, padding: "7px 11px" }}><div style={{ color: "#D95F5F", fontSize: 9, fontFamily: "monospace", marginBottom: 3 }}>BEFORE</div><div style={{ color: "#eee", fontSize: 12 }}>{change.oldValue}</div></div>}
          {change.newValue && <div style={{ background: "#081a0e", border: "1px solid #5BAD6F22", borderRadius: 5, padding: "7px 11px" }}><div style={{ color: "#5BAD6F", fontSize: 9, fontFamily: "monospace", marginBottom: 3 }}>AFTER</div><div style={{ color: "#eee", fontSize: 12 }}>{change.newValue}</div></div>}
          {change.fieldNote && <div style={{ background: "#1a1200", border: "1px solid #E8A83833", borderRadius: 5, padding: "7px 11px" }}><div style={{ color: "#E8A838", fontSize: 9, fontFamily: "monospace", marginBottom: 3 }}>⚑ FIELD NOTE</div><div style={{ color: "#eee", fontSize: 12 }}>{change.fieldNote}</div></div>}
        </div>
      )}
    </div>
  );
}

function FieldSheet({ changes, summary, projectName }) {
  const critical = changes.filter(c => c.severity === "CRITICAL");
  const important = changes.filter(c => c.severity === "IMPORTANT");
  const print = () => {
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Field Sheet</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#000}
      h1{font-size:16px;border-bottom:3px solid #000;padding-bottom:6px}
      .meta{font-size:10px;color:#666;margin-bottom:14px}
      h2{font-size:12px;background:#222;color:#fff;padding:4px 8px;margin:14px 0 5px}
      .row{border-bottom:1px solid #ddd;padding:5px 0;display:flex;gap:10px}
      .sheet{font-weight:700;min-width:110px}
      .badge{font-size:9px;background:#eee;padding:1px 5px;border-radius:3px}
      .crit{background:#fff0f0}.imp{background:#fffbe6}
      .note{color:#b06000;font-style:italic}
      @media print{body{margin:6px}}
    </style></head><body>
    <h1>FIELD SHEET — ${projectName || "Chavez Concrete"}</h1>
    <div class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Critical: ${critical.length} &nbsp;|&nbsp; Important: ${important.length}</div>
    <p style="font-size:10px">${summary||""}</p>
    <h2>🔴 CRITICAL — ${critical.length}</h2>
    ${critical.map(c=>`<div class="row crit"><div class="sheet">${c.sheet}</div><div><span class="badge">${c.trade}</span> ${c.description}${c.fieldNote?` <span class="note">→ ${c.fieldNote}</span>`:""}</div></div>`).join("")}
    <h2>🟡 IMPORTANT — ${important.length}</h2>
    ${important.map(c=>`<div class="row imp"><div class="sheet">${c.sheet}</div><div><span class="badge">${c.trade}</span> ${c.description}${c.fieldNote?` <span class="note">→ ${c.fieldNote}</span>`:""}</div></div>`).join("")}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ color: "#E8A838", fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>⚑ FIELD SHEET</div>
        <button onClick={print} style={{ background: "#E8A838", color: "#000", border: "none", borderRadius: 6, padding: "7px 16px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>🖨 PRINT / SAVE PDF</button>
      </div>
      {[{label:"🔴 CRITICAL",items:critical,color:"#D95F5F"},{label:"🟡 IMPORTANT",items:important,color:"#E8A838"}].map(({label,items,color})=>(
        <div key={label} style={{ marginBottom: 16 }}>
          <div style={{ color, fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8, paddingBottom: 5, borderBottom: `1px solid ${color}33` }}>{label} — {items.length}</div>
          {items.length===0 ? <div style={{color:"#333",fontSize:12,fontStyle:"italic"}}>None</div>
            : items.map((c,i)=>(
              <div key={i} style={{display:"flex",gap:9,marginBottom:6,fontSize:12,color:"#aaa",alignItems:"flex-start"}}>
                <span style={{color,fontFamily:"monospace",minWidth:12}}>▸</span>
                <div><span style={{color:"#fff",fontWeight:700}}>{c.sheet}</span>{" — "}<TradePill trade={c.trade}/>{" "}{c.description}{c.fieldNote&&<span style={{color:"#E8A838"}}> ✦ {c.fieldNote}</span>}</div>
              </div>
            ))
          }
        </div>
      ))}
    </div>
  );
}

export default function PlanComparator() {
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem("cc_api_key")||""; } catch { return ""; } });
  const [rememberKey, setRememberKey] = useState(() => { try { return !!localStorage.getItem("cc_api_key"); } catch { return false; } });
  const [projectName, setProjectName] = useState("");
  const [oldFiles, setOldFiles] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("estimator");
  const [filterTrade, setFilterTrade] = useState("all");
  const [filterSev, setFilterSev] = useState("all");
  const [error, setError] = useState("");

  const handleApiKey = v => { setApiKey(v); try { if (rememberKey) localStorage.setItem("cc_api_key", v); } catch {} };
  const handleRemember = c => { setRememberKey(c); try { if (c) localStorage.setItem("cc_api_key", apiKey); else localStorage.removeItem("cc_api_key"); } catch {} };
  const setP = (label, pct) => setProgress({ label, pct: pct||0 });

  async function filesToImages(fileList, side) {
    let all = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (f.name.toLowerCase().endsWith(".zip")) {
        setP(`[${side}] Extracting ZIP: ${f.name}…`, 5);
        const pdfs = await extractPdfsFromZip(f, msg => setP(`[${side}] ${msg}`, 10));
        for (const pdf of pdfs) {
          const imgs = await pdfBlobToImages(pdf.blob, pdf.name, (pg, tot, nm) =>
            setP(`[${side}] ${nm} — page ${pg}/${tot}`, Math.round((pg/tot)*40))
          );
          all = all.concat(imgs);
        }
      } else {
        const imgs = await pdfBlobToImages(f, f.name, (pg, tot, nm) =>
          setP(`[${side}] ${nm} — page ${pg}/${tot}`, Math.round((pg/tot)*40))
        );
        all = all.concat(imgs);
      }
    }
    return all;
  }

  async function callClaude(ob, nb, bIdx, total) {
    const build = (pages, lbl) => pages.flatMap(p => [
      { type: "text", text: `[${lbl} — ${p.fileName} p.${p.pageNum}]` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.base64 } }
    ]);
    const resp = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5", max_tokens: 4000, system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [
          { type: "text", text: "OLD PLAN PAGES:" }, ...build(ob, "OLD"),
          { type: "text", text: "NEW PLAN PAGES:" }, ...build(nb, "NEW"),
          { type: "text", text: "Find ALL changes. Return only JSON." }
        ]}]
      })
    });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || "API error"); }
    const data = await resp.json();
    const text = data.content.map(c => c.text||"").join("");
    try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
    catch { return { changes: [], summary: "" }; }
  }

  const run = async () => {
    if (!oldFiles.length || !newFiles.length || !apiKey) return;
    setStatus("extracting"); setError(""); setResults(null);
    try {
      setP("Reading OLD plan set…", 0);
      const oldImages = await filesToImages(oldFiles, "OLD");
      setP("Reading NEW plan set…", 0);
      const newImages = await filesToImages(newFiles, "NEW");
      setStatus("comparing");
      const BATCH = 3;
      const maxPages = Math.max(oldImages.length, newImages.length);
      const totalBatches = Math.ceil(maxPages / BATCH);
      const allChanges = [], summaries = [];
      for (let i = 0; i < maxPages; i += BATCH) {
        const ob = oldImages.slice(i, i+BATCH);
        const nb = newImages.slice(i, i+BATCH);
        const bIdx = Math.floor(i/BATCH);
        setP(`Comparing batch ${bIdx+1} of ${totalBatches}…`, Math.round((bIdx/totalBatches)*100));
        if (!ob.length && !nb.length) continue;
        const res = await callClaude(
          ob.length ? ob : [{pageNum:i+1,fileName:"n/a",base64:""}],
          nb.length ? nb : [{pageNum:i+1,fileName:"n/a",base64:""}],
          bIdx, totalBatches
        );
        if (res.changes?.length) allChanges.push(...res.changes);
        if (res.summary) summaries.push(res.summary);
      }
      setResults({ changes: allChanges, summary: summaries.join(" "), oldCount: oldImages.length, newCount: newImages.length });
      setStatus("done");
    } catch(e) { setError(e.message); setStatus("error"); }
  };

  const filtered = (results?.changes||[]).filter(c => {
    if (filterTrade !== "all" && !(c.trade||"").toLowerCase().includes(filterTrade)) return false;
    if (filterSev !== "all" && c.severity !== filterSev) return false;
    return true;
  });
  const critCount = (results?.changes||[]).filter(c => c.severity==="CRITICAL").length;
  const impCount = (results?.changes||[]).filter(c => c.severity==="IMPORTANT").length;
  const busy = status === "extracting" || status === "comparing";
  const canRun = oldFiles.length && newFiles.length && apiKey && !busy;

  return (
    <div style={{ background: "#0f0f0f", minHeight: "100vh", fontFamily: "'Courier New', monospace", color: "#ddd" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "2px solid #1a1a1a", padding: "16px 26px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ background: "#E8A838", width: 4, height: 34, borderRadius: 2 }} />
        <div>
          <div style={{ color: "#E8A838", fontSize: 9, letterSpacing: 3, marginBottom: 1 }}>CHAVEZ CONCRETE</div>
          <div style={{ color: "#fff", fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>PLAN SET COMPARATOR</div>
        </div>
        <div style={{ marginLeft: "auto", color: "#2a2a2a", fontSize: 9 }}>v2.0 · ZIP + Multi-PDF · API Key Saved</div>
      </div>

      <div style={{ padding: "22px 26px", maxWidth: 1080, margin: "0 auto" }}>

        {/* API Key */}
        <div style={{ background: "#141414", border: "1px solid #212121", borderRadius: 8, padding: "13px 17px", marginBottom: 16 }}>
          <div style={{ color: "#555", fontSize: 9, letterSpacing: 2, marginBottom: 7 }}>ANTHROPIC API KEY</div>
          <input type="password" value={apiKey} onChange={e => handleApiKey(e.target.value)} placeholder="sk-ant-..."
            style={{ background: "#0a0a0a", border: "1px solid #252525", borderRadius: 6, padding: "8px 12px", color: "#ccc", fontFamily: "monospace", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <input type="checkbox" id="rk" checked={rememberKey} onChange={e => handleRemember(e.target.checked)} style={{ accentColor: "#E8A838", cursor: "pointer" }} />
            <label htmlFor="rk" style={{ color: "#444", fontSize: 10, cursor: "pointer" }}>Remember key on this device</label>
            {rememberKey && apiKey && <span style={{ color: "#5BAD6F", fontSize: 9, fontFamily: "monospace" }}>✓ SAVED</span>}
            <span style={{ color: "#2a2a2a", fontSize: 9, marginLeft: "auto" }}>console.anthropic.com</span>
          </div>
        </div>

        {/* Project Name */}
        <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Project name (optional)"
          style={{ background: "#141414", border: "1px solid #212121", borderRadius: 8, padding: "9px 15px", color: "#888", fontFamily: "monospace", fontSize: 11, width: "100%", outline: "none", boxSizing: "border-box", marginBottom: 16 }} />

        {/* Drop Zones */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 6 }}>
          <FileDropZone label="OLD PLAN SET — Previous Revision" files={oldFiles} onFiles={setOldFiles} color="#D95F5F" />
          <FileDropZone label="NEW PLAN SET — Current Revision" files={newFiles} onFiles={setNewFiles} color="#5BAD6F" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ color: "#2a2a2a", fontSize: 9 }}>✓ Drop ZIP directly &nbsp;·&nbsp; Ctrl+click for multiple PDFs &nbsp;·&nbsp; Mix ZIPs and PDFs freely</div>
          {(oldFiles.length > 0 || newFiles.length > 0) &&
            <button onClick={() => { setOldFiles([]); setNewFiles([]); setResults(null); setStatus("idle"); }}
              style={{ background: "none", border: "none", color: "#333", fontSize: 9, cursor: "pointer", fontFamily: "monospace" }}>✕ clear all</button>}
        </div>

        {/* Run */}
        <button onClick={run} disabled={!canRun} style={{
          width: "100%", padding: "14px", borderRadius: 8, border: "none", cursor: canRun ? "pointer" : "not-allowed",
          background: canRun ? "linear-gradient(135deg, #E8A838, #C87820)" : "#141414",
          color: canRun ? "#000" : "#2a2a2a", fontFamily: "monospace", fontSize: 13, fontWeight: 700, letterSpacing: 2, marginBottom: 18
        }}>
          {status==="extracting" ? "⏳  READING FILES..." : status==="comparing" ? "🔍  COMPARING..." : "▶  RUN COMPARISON"}
        </button>

        {/* Progress */}
        {busy && (
          <div style={{ background: "#141414", border: "1px solid #212121", borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ color: "#E8A838", fontSize: 11, marginBottom: 9 }}>{progress.label}</div>
            <div style={{ background: "#1a1a1a", borderRadius: 3, height: 4 }}>
              <div style={{ background: "#E8A838", height: "100%", width: `${progress.pct}%`, transition: "width 0.4s", borderRadius: 3 }} />
            </div>
            <div style={{ color: "#2a2a2a", fontSize: 9, marginTop: 6 }}>250 pages ≈ 8-12 min · 1000 pages ≈ 30-45 min</div>
          </div>
        )}

        {/* Error */}
        {status==="error" && (
          <div style={{ background: "#1a0808", border: "1px solid #D95F5F33", borderRadius: 8, padding: 13, marginBottom: 16 }}>
            <div style={{ color: "#D95F5F", fontWeight: 700, marginBottom: 4, fontSize: 11 }}>ERROR</div>
            <div style={{ color: "#ccc", fontSize: 12 }}>{error}</div>
          </div>
        )}

        {/* Results */}
        {status==="done" && results && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 9, marginBottom: 16 }}>
              {[
                {label:"TOTAL CHANGES",value:results.changes.length,color:"#fff"},
                {label:"CRITICAL",value:critCount,color:"#D95F5F"},
                {label:"IMPORTANT",value:impCount,color:"#E8A838"},
                {label:"PAGES",value:`${results.oldCount}→${results.newCount}`,color:"#5BAD6F"},
              ].map(({label,value,color})=>(
                <div key={label} style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:8,padding:"13px 15px"}}>
                  <div style={{color:"#2e2e2e",fontSize:8,letterSpacing:2,marginBottom:4}}>{label}</div>
                  <div style={{color,fontSize:20,fontWeight:700}}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:8,padding:"13px 17px",marginBottom:16}}>
              <div style={{color:"#444",fontSize:9,letterSpacing:2,marginBottom:5}}>REVISION SUMMARY</div>
              <div style={{color:"#aaa",fontSize:12,lineHeight:1.7}}>{results.summary||"See changes below."}</div>
            </div>
            <div style={{display:"flex",marginBottom:16,borderBottom:"1px solid #1a1a1a"}}>
              {[["estimator","📊  ESTIMATOR REPORT"],["field","⚑  FIELD SHEET"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setActiveTab(id)} style={{
                  background:"none",border:"none",borderBottom:activeTab===id?"2px solid #E8A838":"2px solid transparent",
                  color:activeTab===id?"#E8A838":"#444",fontFamily:"monospace",fontSize:11,fontWeight:700,
                  letterSpacing:1,padding:"8px 16px",cursor:"pointer",marginBottom:-1
                }}>{lbl}</button>
              ))}
            </div>
            {activeTab==="estimator" && (
              <div>
                <div style={{display:"flex",gap:9,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
                  <select value={filterTrade} onChange={e=>setFilterTrade(e.target.value)}
                    style={{background:"#181818",border:"1px solid #252525",borderRadius:6,color:"#bbb",fontFamily:"monospace",fontSize:10,padding:"6px 10px",cursor:"pointer"}}>
                    <option value="all">All Trades</option>
                    {TRADES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <select value={filterSev} onChange={e=>setFilterSev(e.target.value)}
                    style={{background:"#181818",border:"1px solid #252525",borderRadius:6,color:"#bbb",fontFamily:"monospace",fontSize:10,padding:"6px 10px",cursor:"pointer"}}>
                    <option value="all">All Severity</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="IMPORTANT">Important</option>
                    <option value="MINOR">Minor</option>
                  </select>
                  <div style={{color:"#333",fontSize:10}}>{filtered.length} of {results.changes.length}</div>
                </div>
                {filtered.length===0
                  ? <div style={{color:"#333",textAlign:"center",padding:36,fontSize:12}}>No changes match filter.</div>
                  : filtered.map((c,i)=><ChangeCard key={c.id||i} change={c} idx={i}/>)
                }
              </div>
            )}
            {activeTab==="field" && <FieldSheet changes={results.changes} summary={results.summary} projectName={projectName}/>}
          </div>
        )}
      </div>
    </div>
  );
}
