import { useState, useRef } from "react";

const TRADES = [
  { id: "civil", label: "Civil", color: "#E8A838" },
  { id: "arch", label: "Architectural", color: "#4A90D9" },
  { id: "grading", label: "Grading & Drainage", color: "#5BAD6F" },
  { id: "structural", label: "Structural", color: "#D95F5F" },
  { id: "electrical", label: "Electrical Site", color: "#9B6DD9" },
  { id: "mechanical", label: "Mechanical", color: "#6DBBD9" },
];

const SYSTEM_PROMPT = `You are an expert construction plan reviewer for a concrete contractor in Albuquerque, NM.
You are comparing extracted text from two versions of construction plan sets (old vs new revision).
Find EVERY change between them. Focus on: dimensions, notes, specs, details, schedules, callouts.
Priority: Structural, Civil, Grading & Drainage, Architectural, Electrical Site, Mechanical.

For each change report:
1. Sheet/Page number and title if identifiable
2. Trade: Civil, Architectural, Grading & Drainage, Structural, Electrical Site, or Mechanical
3. Exactly what changed (word for word for notes/specs, exact values for dimensions)
4. Type: MODIFIED, ADDED, or DELETED
5. Element: footing, slab, wall, note, schedule, callout, etc.
6. Severity: CRITICAL (affects concrete/structural work), IMPORTANT (coordination needed), MINOR (admin/cosmetic)

Respond ONLY with valid JSON, no preamble, no markdown fences:
{"summary":"one paragraph overview","changes":[{"id":"c1","sheet":"sheet ref","trade":"trade","type":"MODIFIED|ADDED|DELETED","severity":"CRITICAL|IMPORTANT|MINOR","element":"element","description":"exact change","oldValue":"before","newValue":"after","fieldNote":"foreman note"}]}`;

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

const loadJSZip = () => new Promise((resolve) => {
  if (window.JSZip) return resolve(window.JSZip);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  s.onload = () => resolve(window.JSZip);
  document.head.appendChild(s);
});

async function extractTextFromPdf(blob, name, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const arr = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arr }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i, pdf.numPages, name);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ").trim();
    if (pageText) fullText += `\n[PAGE ${i}]\n${pageText}`;
  }
  return fullText;
}

async function extractPdfsFromZip(zipFile, onStatus) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter(
    f => !f.dir && f.name.toLowerCase().endsWith(".pdf") && !f.name.includes("__MACOSX")
  ).sort((a, b) => a.name.localeCompare(b.name));
  const pdfs = [];
  for (let i = 0; i < entries.length; i++) {
    if (onStatus) onStatus(`Extracting ${i + 1}/${entries.length}: ${entries[i].name.split("/").pop()}`);
    const blob = await entries[i].async("blob");
    pdfs.push({ name: entries[i].name.split("/").pop(), blob });
  }
  return pdfs;
}

async function filesToText(fileList, side, setP) {
  let allText = "";
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    if (f.name.toLowerCase().endsWith(".zip")) {
      setP(`[${side}] Extracting ZIP: ${f.name}…`, 5);
      const pdfs = await extractPdfsFromZip(f, msg => setP(`[${side}] ${msg}`, 10));
      for (const pdf of pdfs) {
        const text = await extractTextFromPdf(pdf.blob, pdf.name, (pg, tot) =>
          setP(`[${side}] Reading ${pdf.name} — page ${pg}/${tot}`, Math.round((pg / tot) * 40))
        );
        allText += `\n\n=== FILE: ${pdf.name} ===\n${text}`;
      }
    } else {
      const text = await extractTextFromPdf(f, f.name, (pg, tot) =>
        setP(`[${side}] Reading ${f.name} — page ${pg}/${tot}`, Math.round((pg / tot) * 40))
      );
      allText += `\n\n=== FILE: ${f.name} ===\n${text}`;
    }
  }
  return allText;
}

function chunkText(text, size = 12000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : ["(empty)"];
}

async function callClaude(oldChunk, newChunk, apiKey, idx, total) {
  const resp = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Compare chunk ${idx + 1} of ${total}.\n\nOLD PLAN TEXT:\n${oldChunk}\n\nNEW PLAN TEXT:\n${newChunk}\n\nFind ALL changes. Return only JSON.`
      }]
    })
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const text = (data.content || []).map(c => c.text || "").join("");
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return { changes: [], summary: "" }; }
}

// ── Drop Zone ──
function DropZone({ label, files, onFiles, color }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  const has = files && files.length > 0;
  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        const f = Array.from(e.dataTransfer.files).filter(f => /\.(pdf|zip)$/i.test(f.name));
        if (f.length) onFiles(p => [...(p || []), ...f]);
      }}
      style={{ border: `2px dashed ${drag ? color : has ? color : "#252525"}`, borderRadius: 10, padding: "20px 16px", cursor: "pointer", background: drag ? color + "18" : has ? color + "06" : "#141414", minHeight: 130, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, transition: "all .2s" }}
    >
      <input ref={ref} type="file" accept=".pdf,.zip" multiple style={{ display: "none" }}
        onChange={e => { const f = Array.from(e.target.files); if (f.length) onFiles(p => [...(p || []), ...f]); }} />
      <div style={{ fontSize: 24 }}>{has ? "📋" : "📂"}</div>
      <div style={{ color: has ? color : "#444", fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>{label}</div>
      {has ? (
        <div style={{ width: "100%" }}>
          {files.map((f, i) => (
            <div key={i} style={{ color: "#777", fontSize: 9, background: "#1a1a1a", borderRadius: 3, padding: "2px 7px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f.name.endsWith(".zip") ? "🗜 " : "📄 "}{f.name}
            </div>
          ))}
          <div style={{ color: "#2a2a2a", fontSize: 8, textAlign: "center", marginTop: 3 }}>Click to add more</div>
        </div>
      ) : (
        <div style={{ color: "#2a2a2a", fontSize: 9, textAlign: "center", lineHeight: 1.7 }}>
          Drop ZIP or PDFs · Click to browse<br />Ctrl+click for multiple files
        </div>
      )}
    </div>
  );
}

function Badge({ type, sev }) {
  const tc = { MODIFIED: "#E8A838", ADDED: "#5BAD6F", DELETED: "#D95F5F" };
  const sc = { CRITICAL: "#D95F5F", IMPORTANT: "#E8A838", MINOR: "#555" };
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <span style={{ background: (tc[type] || "#888") + "22", color: tc[type] || "#888", border: `1px solid ${tc[type] || "#888"}44`, borderRadius: 3, padding: "1px 5px", fontSize: 8, fontFamily: "monospace", fontWeight: 700 }}>{type}</span>
      <span style={{ background: (sc[sev] || "#555") + "22", color: sc[sev] || "#555", border: `1px solid ${sc[sev] || "#555"}44`, borderRadius: 3, padding: "1px 5px", fontSize: 8, fontFamily: "monospace", fontWeight: 700 }}>{sev}</span>
    </span>
  );
}

function TradePill({ trade }) {
  const t = TRADES.find(t => (trade || "").toLowerCase().includes(t.id)) || { color: "#888" };
  return <span style={{ background: t.color + "22", color: t.color, border: `1px solid ${t.color}44`, borderRadius: 3, padding: "1px 5px", fontSize: 8, fontFamily: "monospace", fontWeight: 700 }}>{trade}</span>;
}

function Card({ c, idx }) {
  const [open, setOpen] = useState(false);
  const bord = { CRITICAL: "#D95F5F33", IMPORTANT: "#E8A83822", MINOR: "#1e1e1e" };
  return (
    <div style={{ background: "#181818", border: `1px solid ${bord[c.severity] || "#1e1e1e"}`, borderRadius: 7, marginBottom: 5, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "11px 14px", cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ color: "#2a2a2a", fontFamily: "monospace", fontSize: 9, minWidth: 22, paddingTop: 2 }}>#{idx + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4, alignItems: "center" }}>
            <span style={{ color: "#fff", fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>{c.sheet}</span>
            <TradePill trade={c.trade} />
            <Badge type={c.type} sev={c.severity} />
          </div>
          <div style={{ color: "#888", fontSize: 11, lineHeight: 1.5 }}>{c.description}</div>
        </div>
        <div style={{ color: "#2a2a2a", fontSize: 11, flexShrink: 0 }}>{open ? "▲" : "▼"}</div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid #1e1e1e", padding: "10px 14px 10px 46px", display: "flex", flexDirection: "column", gap: 7 }}>
          {c.element && <div><span style={{ color: "#333", fontSize: 8, fontFamily: "monospace" }}>ELEMENT: </span><span style={{ color: "#999", fontSize: 11 }}>{c.element}</span></div>}
          {c.oldValue && <div style={{ background: "#1a0808", border: "1px solid #D95F5F22", borderRadius: 4, padding: "6px 10px" }}><div style={{ color: "#D95F5F", fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>BEFORE</div><div style={{ color: "#eee", fontSize: 11 }}>{c.oldValue}</div></div>}
          {c.newValue && <div style={{ background: "#081a0e", border: "1px solid #5BAD6F22", borderRadius: 4, padding: "6px 10px" }}><div style={{ color: "#5BAD6F", fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>AFTER</div><div style={{ color: "#eee", fontSize: 11 }}>{c.newValue}</div></div>}
          {c.fieldNote && <div style={{ background: "#1a1200", border: "1px solid #E8A83833", borderRadius: 4, padding: "6px 10px" }}><div style={{ color: "#E8A838", fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>⚑ FIELD NOTE</div><div style={{ color: "#eee", fontSize: 11 }}>{c.fieldNote}</div></div>}
        </div>
      )}
    </div>
  );
}

function FieldSheet({ changes, summary, project }) {
  const crit = changes.filter(c => c.severity === "CRITICAL");
  const imp = changes.filter(c => c.severity === "IMPORTANT");
  const print = () => {
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Field Sheet</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#000}
      h1{font-size:15px;border-bottom:3px solid #000;padding-bottom:5px}
      .meta{font-size:9px;color:#666;margin-bottom:12px}
      h2{font-size:11px;background:#222;color:#fff;padding:3px 7px;margin:12px 0 4px}
      .row{border-bottom:1px solid #ddd;padding:4px 0;display:flex;gap:9px}
      .sheet{font-weight:700;min-width:100px;font-size:10px}
      .badge{font-size:8px;background:#eee;padding:1px 4px;border-radius:2px}
      .note{color:#b06000;font-style:italic}
      .crit{background:#fff5f5}.imp{background:#fffceb}
    </style></head><body>
    <h1>FIELD SHEET — ${project || "Chavez Concrete"}</h1>
    <div class="meta">Generated: ${new Date().toLocaleString()} | Critical: ${crit.length} | Important: ${imp.length}</div>
    <p style="font-size:9px;margin-bottom:9px">${summary || ""}</p>
    <h2>🔴 CRITICAL — ${crit.length}</h2>
    ${crit.map(c => `<div class="row crit"><div class="sheet">${c.sheet}</div><div><span class="badge">${c.trade}</span> ${c.description}${c.fieldNote ? ` <span class="note">→ ${c.fieldNote}</span>` : ""}</div></div>`).join("")}
    <h2>🟡 IMPORTANT — ${imp.length}</h2>
    ${imp.map(c => `<div class="row imp"><div class="sheet">${c.sheet}</div><div><span class="badge">${c.trade}</span> ${c.description}${c.fieldNote ? ` <span class="note">→ ${c.fieldNote}</span>` : ""}</div></div>`).join("")}
    </body></html>`);
    w.document.close(); setTimeout(() => w.print(), 300);
  };
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ color: "#E8A838", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>⚑ FIELD SHEET</div>
        <button onClick={print} style={{ background: "#E8A838", color: "#000", border: "none", borderRadius: 5, padding: "6px 14px", fontFamily: "monospace", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🖨 PRINT / SAVE PDF</button>
      </div>
      {[{ label: "🔴 CRITICAL", items: crit, color: "#D95F5F" }, { label: "🟡 IMPORTANT", items: imp, color: "#E8A838" }].map(({ label, items, color }) => (
        <div key={label} style={{ marginBottom: 14 }}>
          <div style={{ color, fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 7, paddingBottom: 4, borderBottom: `1px solid ${color}33` }}>{label} — {items.length}</div>
          {items.length === 0
            ? <div style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>None</div>
            : items.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11, color: "#999", alignItems: "flex-start" }}>
                <span style={{ color, minWidth: 10 }}>▸</span>
                <div><span style={{ color: "#fff", fontWeight: 700 }}>{c.sheet}</span>{" — "}<TradePill trade={c.trade} />{" "}{c.description}{c.fieldNote && <span style={{ color: "#E8A838" }}> ✦ {c.fieldNote}</span>}</div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

// ── Main ──
export default function App() {
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem("cc_api_key") || ""; } catch { return ""; } });
  const [remember, setRemember] = useState(() => { try { return !!localStorage.getItem("cc_api_key"); } catch { return false; } });
  const [project, setProject] = useState("");
  const [oldFiles, setOldFiles] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [results, setResults] = useState(null);
  const [tab, setTab] = useState("estimator");
  const [fTrade, setFTrade] = useState("all");
  const [fSev, setFSev] = useState("all");
  const [error, setError] = useState("");

  const handleKey = v => { setApiKey(v); try { if (remember) localStorage.setItem("cc_api_key", v); } catch {} };
  const handleRemember = c => { setRemember(c); try { if (c) localStorage.setItem("cc_api_key", apiKey); else localStorage.removeItem("cc_api_key"); } catch {} };
  const setP = (label, pct) => setProgress({ label, pct: pct || 0 });
  const busy = status === "extracting" || status === "comparing";
  const canRun = oldFiles.length && newFiles.length && apiKey && !busy;

  const run = async () => {
    if (!canRun) return;
    setStatus("extracting"); setError(""); setResults(null);
    try {
      setP("Reading OLD plan set…", 0);
      const oldText = await filesToText(oldFiles, "OLD", setP);
      setP("Reading NEW plan set…", 0);
      const newText = await filesToText(newFiles, "NEW", setP);

      setStatus("comparing");
      const oldChunks = chunkText(oldText);
      const newChunks = chunkText(newText);
      const total = Math.max(oldChunks.length, newChunks.length);
      const allChanges = [], summaries = [];

      for (let i = 0; i < total; i++) {
        setP(`Comparing section ${i + 1} of ${total}…`, Math.round((i / total) * 100));
        const oc = oldChunks[i] || "(section not in old revision)";
        const nc = newChunks[i] || "(section deleted in new revision)";
        const res = await callClaude(oc, nc, apiKey, i, total);
        if (res.changes?.length) allChanges.push(...res.changes);
        if (res.summary) summaries.push(res.summary);
      }

      setResults({ changes: allChanges, summary: summaries.join(" "), oldCount: oldChunks.length, newCount: newChunks.length });
      setStatus("done");
    } catch (e) { setError(e.message); setStatus("error"); }
  };

  const filtered = (results?.changes || []).filter(c => {
    if (fTrade !== "all" && !(c.trade || "").toLowerCase().includes(fTrade)) return false;
    if (fSev !== "all" && c.severity !== fSev) return false;
    return true;
  });
  const crit = (results?.changes || []).filter(c => c.severity === "CRITICAL").length;
  const imp = (results?.changes || []).filter(c => c.severity === "IMPORTANT").length;

  return (
    <div style={{ background: "#0f0f0f", minHeight: "100vh", fontFamily: "'Courier New', monospace", color: "#ddd" }}>
      <div style={{ background: "#0a0a0a", borderBottom: "2px solid #1a1a1a", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ background: "#E8A838", width: 4, height: 32, borderRadius: 2 }} />
        <div>
          <div style={{ color: "#E8A838", fontSize: 8, letterSpacing: 3, marginBottom: 1 }}>CHAVEZ CONCRETE</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>PLAN SET COMPARATOR</div>
        </div>
        <div style={{ marginLeft: "auto", color: "#2a2a2a", fontSize: 8 }}>v4.0 · ZIP + Multi-PDF · API Key Saved</div>
      </div>

      <div style={{ padding: "20px 24px", maxWidth: 1060, margin: "0 auto" }}>
        {/* API Key */}
        <div style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ color: "#444", fontSize: 8, letterSpacing: 2, marginBottom: 6 }}>ANTHROPIC API KEY</div>
          <input type="password" value={apiKey} onChange={e => handleKey(e.target.value)} placeholder="sk-ant-..."
            style={{ background: "#0a0a0a", border: "1px solid #252525", borderRadius: 5, padding: "7px 11px", color: "#ccc", fontFamily: "monospace", fontSize: 12, width: "100%", outline: "none", boxSizing: "border-box" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 7 }}>
            <input type="checkbox" id="rk" checked={remember} onChange={e => handleRemember(e.target.checked)} style={{ accentColor: "#E8A838", cursor: "pointer" }} />
            <label htmlFor="rk" style={{ color: "#444", fontSize: 9, cursor: "pointer" }}>Remember key on this device</label>
            {remember && apiKey && <span style={{ color: "#5BAD6F", fontSize: 8, fontFamily: "monospace" }}>✓ SAVED</span>}
            <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: "#2a2a2a", fontSize: 8, marginLeft: "auto", textDecoration: "none" }}>console.anthropic.com</a>
          </div>
        </div>

        {/* Project Name */}
        <input value={project} onChange={e => setProject(e.target.value)} placeholder="Project name (optional)"
          style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 7, padding: "8px 13px", color: "#777", fontFamily: "monospace", fontSize: 10, width: "100%", outline: "none", boxSizing: "border-box", marginBottom: 14 }} />

        {/* Drop Zones */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 5 }}>
          <DropZone label="OLD PLAN SET — Previous Revision" files={oldFiles} onFiles={setOldFiles} color="#D95F5F" />
          <DropZone label="NEW PLAN SET — Current Revision" files={newFiles} onFiles={setNewFiles} color="#5BAD6F" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ color: "#222", fontSize: 8 }}>✓ Drop ZIP directly · Ctrl+click for multiple PDFs · Mix ZIPs and PDFs freely</div>
          {(oldFiles.length > 0 || newFiles.length > 0) &&
            <button onClick={() => { setOldFiles([]); setNewFiles([]); setResults(null); setStatus("idle"); }}
              style={{ background: "none", border: "none", color: "#2a2a2a", fontSize: 8, cursor: "pointer", fontFamily: "monospace" }}>✕ clear all</button>}
        </div>

        {/* Run Button */}
        <button onClick={run} disabled={!canRun} style={{
          width: "100%", padding: "13px", borderRadius: 7, border: "none", cursor: canRun ? "pointer" : "not-allowed",
          background: canRun ? "linear-gradient(135deg,#E8A838,#C87820)" : "#141414",
          color: canRun ? "#000" : "#2a2a2a", fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 2, marginBottom: 16
        }}>
          {status === "extracting" ? "⏳  READING FILES..." : status === "comparing" ? "🔍  COMPARING..." : "▶  RUN COMPARISON"}
        </button>

        {/* Progress */}
        {busy && (
          <div style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 7, padding: 14, marginBottom: 14 }}>
            <div style={{ color: "#E8A838", fontSize: 10, marginBottom: 8 }}>{progress.label}</div>
            <div style={{ background: "#1a1a1a", borderRadius: 3, height: 3 }}>
              <div style={{ background: "#E8A838", height: "100%", width: `${progress.pct}%`, transition: "width .4s", borderRadius: 3 }} />
            </div>
            <div style={{ color: "#222", fontSize: 8, marginTop: 5 }}>Text extraction — most jobs under 2 minutes</div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div style={{ background: "#1a0808", border: "1px solid #D95F5F33", borderRadius: 7, padding: 12, marginBottom: 14 }}>
            <div style={{ color: "#D95F5F", fontWeight: 700, marginBottom: 3, fontSize: 10 }}>ERROR</div>
            <div style={{ color: "#ccc", fontSize: 11 }}>{error}</div>
          </div>
        )}

        {/* Results */}
        {status === "done" && results && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
              {[
                { label: "TOTAL CHANGES", value: results.changes.length, color: "#fff" },
                { label: "CRITICAL", value: crit, color: "#D95F5F" },
                { label: "IMPORTANT", value: imp, color: "#E8A838" },
                { label: "SECTIONS", value: `${results.oldCount}→${results.newCount}`, color: "#5BAD6F" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 7, padding: "11px 14px" }}>
                  <div style={{ color: "#2a2a2a", fontSize: 7, letterSpacing: 2, marginBottom: 3 }}>{label}</div>
                  <div style={{ color, fontSize: 18, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 7, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ color: "#333", fontSize: 8, letterSpacing: 2, marginBottom: 4 }}>REVISION SUMMARY</div>
              <div style={{ color: "#999", fontSize: 11, lineHeight: 1.7 }}>{results.summary || "See changes below."}</div>
            </div>
            <div style={{ display: "flex", marginBottom: 14, borderBottom: "1px solid #1a1a1a" }}>
              {[["estimator", "📊  ESTIMATOR REPORT"], ["field", "⚑  FIELD SHEET"]].map(([id, lbl]) => (
                <button key={id} onClick={() => setTab(id)} style={{
                  background: "none", border: "none", borderBottom: tab === id ? "2px solid #E8A838" : "2px solid transparent",
                  color: tab === id ? "#E8A838" : "#444", fontFamily: "monospace", fontSize: 10, fontWeight: 700,
                  letterSpacing: 1, padding: "7px 14px", cursor: "pointer", marginBottom: -1
                }}>{lbl}</button>
              ))}
            </div>
            {tab === "estimator" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={fTrade} onChange={e => setFTrade(e.target.value)}
                    style={{ background: "#181818", border: "1px solid #252525", borderRadius: 5, color: "#aaa", fontFamily: "monospace", fontSize: 9, padding: "5px 9px", cursor: "pointer" }}>
                    <option value="all">All Trades</option>
                    {TRADES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <select value={fSev} onChange={e => setFSev(e.target.value)}
                    style={{ background: "#181818", border: "1px solid #252525", borderRadius: 5, color: "#aaa", fontFamily: "monospace", fontSize: 9, padding: "5px 9px", cursor: "pointer" }}>
                    <option value="all">All Severity</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="IMPORTANT">Important</option>
                    <option value="MINOR">Minor</option>
                  </select>
                  <div style={{ color: "#2a2a2a", fontSize: 9 }}>{filtered.length} of {results.changes.length}</div>
                </div>
                {filtered.length === 0
                  ? <div style={{ color: "#333", textAlign: "center", padding: 30, fontSize: 11 }}>No changes match filter.</div>
                  : filtered.map((c, i) => <Card key={c.id || i} c={c} idx={i} />)}
              </div>
            )}
            {tab === "field" && <FieldSheet changes={results.changes} summary={results.summary} project={project} />}
          </div>
        )}
      </div>
    </div>
  );
}
