import { useState, useEffect, useCallback } from "react";

// ─── Fallbacks (último cierre conocido) ───────────────────────────────────────
const FALLBACK_EMBI   = 583;
const FALLBACK_EMBI_D = "09/03/2026";

const FALLBACK_T10Y   = 0.0424;
const FALLBACK_T10Y_D = "17/03/2026";

// ─── Otros parámetros ─────────────────────────────────────────────────────────
const LEW_RATE     = 0.0975;
const DEAL_AMOUNT  = 9500;
const AVG_DURATION = 2.5;
const DEAL_DATE    = new Date("2026-02-01");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rateFromEMBI = (embi, t10y) => t10y + embi / 10000;

function calcMetrics(embi, t10y) {
  const currentRate = rateFromEMBI(embi, t10y);
  const spreadDiff  = currentRate - LEW_RATE;
  const extraCostM  = DEAL_AMOUNT * spreadDiff * AVG_DURATION;
  const daysLost    = Math.round((new Date() - DEAL_DATE) / 86400000);
  return { currentRate, spreadDiff, extraCostM, daysLost };
}

const fmtM    = (n) => { const s=n<0?"−":"+", a=Math.abs(n); return a>=1000?`${s}USD ${(a/1000).toFixed(2)}B`:`${s}USD ${a.toFixed(0)}M`; };
const fmtPct  = (n) => `${n>=0?"+":""}${n.toFixed(3)}%`;
const fmtRate = (n) => `${(n*100).toFixed(2)}%`;

// ─── EMBI fetch — 3 endpoints ─────────────────────────────────────────────────
async function tryFetchEMBI() {
  const proxy = (url) => "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
  const opts  = { signal: AbortSignal.timeout(5000) };

  try {
    const r = await fetch(proxy("https://mercados.ambito.com/riesgo-pais/variacion"), opts);
    const j = await r.json();
    const d = JSON.parse(j.contents);
    const v = parseFloat(String(d.value).replace(",","."));
    if (!isNaN(v) && v > 100 && v < 5000) return { value: v, source: "Ambito Financiero" };
  } catch(_) {}

  try {
    const r = await fetch(proxy("https://mercados.ambito.com/riesgo-pais/historico-cierre/2026"), opts);
    const j = await r.json();
    const arr = JSON.parse(j.contents);
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length-1];
      const v = parseFloat(String(last[1]??last.value??"").replace(",","."));
      if (!isNaN(v) && v > 100) return { value: v, source: "Ambito (cierre)" };
    }
  } catch(_) {}

  try {
    const r = await fetch(proxy("https://api.dolarito.ar/indices/riesgo-pais"), opts);
    const j = await r.json();
    const d = JSON.parse(j.contents);
    const v = parseFloat(d?.valor ?? d?.value ?? "");
    if (!isNaN(v) && v > 100) return { value: v, source: "Dolarito.ar" };
  } catch(_) {}

  return null;
}

// ─── T10y fetch — US Treasury fiscaldata (sin API key) + 2 fallbacks ──────────
async function tryFetchT10Y() {
  const proxy = (url) => "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
  const opts  = { signal: AbortSignal.timeout(6000) };

  // Endpoint 1: US Treasury FiscalData — Daily Par Yield Curve Rates, último registro 10Y
  try {
    const url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates" +
      "?fields=record_date,security_desc,avg_interest_rate_amt" +
      "&filter=security_desc:eq:Treasury%20Notes&sort=-record_date&page[size]=5";
    const r = await fetch(proxy(url), opts);
    const j = await r.json();
    const d = JSON.parse(j.contents);
    if (d?.data?.length) {
      const v = parseFloat(d.data[0].avg_interest_rate_amt);
      if (!isNaN(v) && v > 0) return { value: v / 100, source: "US Treasury (fiscaldata.gov)" };
    }
  } catch(_) {}

  // Endpoint 2: Treasury par yield curve rates — daily nominal
  try {
    const today = new Date();
    const y = today.getFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${y}`;
    const r = await fetch(proxy(url), opts);
    const j = await r.json();
    const xml = j.contents;
    // Parsear el último entry y buscar BC_10YEAR
    const matches = [...xml.matchAll(/<d:BC_10YEAR[^>]*>([\d.]+)<\/d:BC_10YEAR>/g)];
    if (matches.length) {
      const v = parseFloat(matches[matches.length - 1][1]);
      if (!isNaN(v) && v > 0) return { value: v / 100, source: "US Treasury (XML feed)" };
    }
  } catch(_) {}

  // Endpoint 3: stooq.com vía proxy (datos de mercado)
  try {
    const url = "https://stooq.com/q/l/?s=10USY.B&f=sd2t2ohlcv&h&e=json";
    const r = await fetch(proxy(url), opts);
    const j = await r.json();
    const d = JSON.parse(j.contents);
    const close = d?.symbols?.[0]?.close ?? d?.["10USY.B"]?.close;
    if (close) {
      const v = parseFloat(close);
      if (!isNaN(v) && v > 0) return { value: v / 100, source: "Stooq" };
    }
  } catch(_) {}

  return null;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [embi,      setEmbi]      = useState(null);
  const [embiSrc,   setEmbiSrc]   = useState(null);
  const [embiState, setEmbiState] = useState("idle");   // idle|loading|live|fallback

  const [t10y,      setT10y]      = useState(null);
  const [t10ySrc,   setT10ySrc]   = useState(null);
  const [t10yState, setT10yState] = useState("idle");

  const [lastUpdate, setLastUpdate] = useState(null);
  const [showMethod, setShowMethod] = useState(false);
  const [pulse,      setPulse]      = useState(false);

  const loadAll = useCallback(async () => {
    setEmbiState("loading");
    setT10yState("loading");

    const [embiResult, t10yResult] = await Promise.all([tryFetchEMBI(), tryFetchT10Y()]);

    if (embiResult) {
      setEmbi(embiResult.value);
      setEmbiSrc(embiResult.source);
      setEmbiState("live");
    } else {
      setEmbi(FALLBACK_EMBI);
      setEmbiSrc(`cierre ${FALLBACK_EMBI_D}`);
      setEmbiState("fallback");
    }

    if (t10yResult) {
      setT10y(t10yResult.value);
      setT10ySrc(t10yResult.source);
      setT10yState("live");
    } else {
      setT10y(FALLBACK_T10Y);
      setT10ySrc(`cierre ${FALLBACK_T10Y_D}`);
      setT10yState("fallback");
    }

    setLastUpdate(new Date());
    setPulse(true);
    setTimeout(() => setPulse(false), 700);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loading  = embiState === "loading" || t10yState === "loading";
  const bothLive = embiState === "live" && t10yState === "live";
  const anyFall  = embiState === "fallback" || t10yState === "fallback";

  const globalState = loading ? "loading" : bothLive ? "live" : anyFall ? "fallback" : "idle";
  const statusInfo  = {
    idle:     { label: "",                            color: "#555" },
    loading:  { label: "Actualizando...",             color: "#666" },
    live:     { label: "En vivo",                     color: "#22b06a" },
    fallback: { label: "Parcialmente en vivo",        color: "#f0a020" },
  }[globalState] || { label: "", color: "#555" };

  const metrics   = embi != null && t10y != null ? calcMetrics(embi, t10y) : null;
  const isPos     = metrics?.extraCostM > 0;
  const costColor = isPos ? "#e8392a" : "#22b06a";

  return (
    <div style={S.root}>
      <div style={S.grain}/>

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.headerTop}>
          <span style={S.eyebrow}>ANÁLISIS FINANCIERO · ARG 2026</span>
          <div style={S.statusPill}>
            <span style={{
              ...S.dot,
              background: loading ? "#444" : statusInfo.color,
              boxShadow: globalState === "live" ? `0 0 7px ${statusInfo.color}` : "none"
            }}/>
            <span style={{...S.statusTxt, color: statusInfo.color}}>{statusInfo.label}</span>
          </div>
        </div>
        <h1 style={S.title}>El Costo de la Ventana Perdida</h1>
        <p style={S.subtitle}>
          ¿Cuánto le cuesta a Argentina no haber emitido deuda en febrero 2026?
        </p>
      </header>

      {/* ── Params strip ── */}
      <div style={S.strip}>
        {[
          ["Monto a rollear",       `USD ${DEAL_AMOUNT.toLocaleString("es-AR")}M`],
          ["Tasa acordada (TIR)",   fmtRate(LEW_RATE)],
          ["Duration",              `${AVG_DURATION} años`],
          ["Vencimientos a rollear","Jul-26 + Ene-27"],
        ].map(([l,v]) => (
          <div key={l} style={S.param}>
            <span style={S.pLabel}>{l}</span>
            <span style={S.pVal}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Loader ── */}
      {loading && !metrics && (
        <div style={S.loaderRow}>
          <div style={S.spinner}/>
          <span>Obteniendo datos de mercado...</span>
        </div>
      )}

      {/* ── Main metrics ── */}
      {metrics && (
        <div style={S.metricsWrap}>

          {/* Hero */}
          <div style={{...S.card, borderColor: costColor}}>
            <div style={S.cardLabel}>COSTO INCREMENTAL TOTAL</div>
            <div style={{
              ...S.heroNum, color: costColor,
              ...(pulse ? {animation:"pulse .7s ease"} : {})
            }}>
              {fmtM(metrics.extraCostM)}
            </div>
            <div style={S.heroSub}>
              vs. tasa acordada {fmtRate(LEW_RATE)} · {metrics.daysLost} días desde la operación cancelada
            </div>
            <div style={S.rateRow}>
              <span style={S.chip}>Tasa acordada <strong>{fmtRate(LEW_RATE)}</strong></span>
              <span style={S.arrow}>→</span>
              <span style={{...S.chip, borderColor: costColor, color: costColor}}>
                Tasa hoy <strong>{fmtRate(metrics.currentRate)}</strong>
              </span>
              <span style={{...S.badge, background: costColor}}>
                Δ {fmtPct(metrics.spreadDiff * 100)}
              </span>
            </div>
          </div>

          {/* 2x2 grid */}
          <div style={S.grid2}>
            {/* EMBI */}
            <div style={S.card}>
              <div style={S.cardLabel}>RIESGO PAÍS (EMBI)</div>
              <div style={{...S.bigNum, color: "#f0c040"}}>
                {Math.round(embi)}
                <span style={{fontSize:14, color:"#555", marginLeft:5}}>bps</span>
              </div>
              <div style={S.cardSub}>{embiSrc}</div>
              {embiState === "fallback" &&
                <div style={S.fallNote}>⚠ último cierre conocido</div>}
            </div>

            {/* T10y */}
            <div style={S.card}>
              <div style={S.cardLabel}>US TREASURY 10Y</div>
              <div style={{...S.bigNum, color: "#8ab4f8"}}>
                {fmtRate(t10y)}
              </div>
              <div style={S.cardSub}>{t10ySrc}</div>
              {t10yState === "fallback" &&
                <div style={S.fallNote}>⚠ último cierre conocido</div>}
            </div>

            {/* Tasa implícita */}
            <div style={{...S.card, gridColumn: "span 2"}}>
              <div style={S.cardLabel}>TASA IMPLÍCITA HOY · T10Y + EMBI</div>
              <div style={{...S.bigNum, color: "#bbb", fontSize:24}}>
                {fmtRate(t10y)} + {(embi/100).toFixed(2)}% = <strong style={{color: costColor}}>{fmtRate(metrics.currentRate)}</strong>
              </div>
              <div style={S.cardSub}>convención mercado internacional de deuda soberana emergente</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Controls ── */}
      <div style={S.controls}>
        <button style={S.btn} onClick={loadAll} disabled={loading}>
          {loading ? "↻ Actualizando..." : "↻ Refrescar datos"}
        </button>
        {lastUpdate && (
          <span style={S.ts}>última actualización {lastUpdate.toLocaleTimeString("es-AR")}</span>
        )}
      </div>

      {/* ── Scenarios table ── */}
      {metrics && (
        <div style={S.tableWrap}>
          <div style={S.secTitle}>ESCENARIOS · EMBI vs. COSTO INCREMENTAL</div>
          <table style={{width:"100%", borderCollapse:"collapse"}}>
            <thead>
              <tr>
                {["EMBI (bps)", "Tasa implícita", "Δ vs. acordada", "Costo extra USD"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[400,450,500,550,600,650,700,750,800].map(e => {
                const m   = calcMetrics(e, t10y);
                const act = Math.abs(e - (embi||0)) < 26;
                const pos = m.extraCostM > 0;
                const c   = pos ? "#e8392a" : "#22b06a";
                return (
                  <tr key={e} style={{
                    background: act ? "rgba(255,255,255,0.04)" : "transparent",
                    borderLeft: act ? `3px solid ${c}` : "3px solid transparent"
                  }}>
                    <td style={{...S.td, color:"#f0c040", fontWeight: act?700:400}}>
                      {e}{act?" ◀":""}
                    </td>
                    <td style={S.td}>{fmtRate(rateFromEMBI(e, t10y))}</td>
                    <td style={{...S.td, color:c}}>{fmtPct(m.spreadDiff*100)}</td>
                    <td style={{...S.td, color:c, fontWeight:600}}>{fmtM(m.extraCostM)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={S.tableNote}>
            Todos los escenarios calculados con T10y en vivo: {fmtRate(t10y)}
            {t10yState==="fallback" ? " (fallback)" : ""}
          </div>
        </div>
      )}

      {/* ── Methodology ── */}
      <div style={{padding:"0 40px 20px", position:"relative", zIndex:1}}>
        <button style={S.methBtn} onClick={() => setShowMethod(v=>!v)}>
          {showMethod ? "▲" : "▼"} METODOLOGÍA Y SUPUESTOS
        </button>
        {showMethod && (
          <div style={S.methBox}>
            <p><strong>Fórmula:</strong> Costo extra = Monto × (Tasa hoy − Tasa acordada) × Duration</p>
            <p><strong>Tasa hoy</strong> = US T10y + EMBI Argentina. Ambos se obtienen en tiempo real con fallback al último cierre conocido si los endpoints no responden.</p>
            <p><strong>US T10y:</strong> API del Tesoro americano (fiscaldata.treasury.gov) — fuente oficial, sin autenticación. Fallback: {fmtRate(FALLBACK_T10Y)} ({FALLBACK_T10Y_D}).</p>
            <p><strong>EMBI Argentina:</strong> Ambito Financiero. Fallback: {FALLBACK_EMBI} bps ({FALLBACK_EMBI_D}).</p>
            <p><strong>Monto:</strong> USD 9.500M — vencimientos de capital de jul-26 y ene-27 que la operación buscaba rollear.</p>
            <p><strong>Tasa acordada:</strong> 9,75% TIR en dólares.</p>
            <p><strong>Duration:</strong> {AVG_DURATION} años — similar a la duration modificada del tramo AL29/AL30.</p>
            <p><strong>Limitaciones:</strong> No captura efectos de segunda vuelta. Es cota inferior del costo real de oportunidad.</p>
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const mono  = "'IBM Plex Mono', monospace";
const serif = "'Source Serif 4', Georgia, serif";
const S = {
  root:       { fontFamily:serif, background:"#0d0d0d", color:"#e8e4dc", minHeight:"100vh",
                padding:"0 0 60px", position:"relative", maxWidth:920, margin:"0 auto",
                animation:"fadeIn .4s ease" },
  grain:      { position:"fixed", inset:0, pointerEvents:"none", zIndex:0, opacity:.3,
                backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E\")" },
  header:     { padding:"44px 40px 28px", borderBottom:"1px solid #1e1e1e", position:"relative", zIndex:1 },
  headerTop:  { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 },
  eyebrow:    { fontFamily:mono, fontSize:10, letterSpacing:"0.18em", color:"#4a4a4a" },
  statusPill: { display:"flex", alignItems:"center", gap:7 },
  dot:        { width:7, height:7, borderRadius:"50%", flexShrink:0, transition:"all .5s" },
  statusTxt:  { fontFamily:mono, fontSize:10, letterSpacing:"0.1em", transition:"color .5s" },
  title:      { fontFamily:"'Playfair Display',serif", fontSize:40, fontWeight:900,
                lineHeight:1.1, color:"#f0ece4", marginBottom:12, letterSpacing:"-0.01em" },
  subtitle:   { fontFamily:serif, fontStyle:"italic", fontWeight:300, fontSize:15, color:"#6a6a6a", lineHeight:1.65 },
  strip:      { display:"flex", borderBottom:"1px solid #1a1a1a", position:"relative", zIndex:1 },
  param:      { flex:1, padding:"13px 40px", borderRight:"1px solid #161616", display:"flex", flexDirection:"column", gap:4 },
  pLabel:     { fontFamily:mono, fontSize:9, letterSpacing:"0.13em", color:"#404040" },
  pVal:       { fontFamily:mono, fontSize:13, color:"#999", fontWeight:600 },
  loaderRow:  { display:"flex", alignItems:"center", gap:12, padding:"44px 40px",
                fontFamily:mono, fontSize:12, color:"#4a4a4a" },
  spinner:    { width:14, height:14, border:"2px solid #1e1e1e", borderTop:"2px solid #555",
                borderRadius:"50%", animation:"spin .8s linear infinite", flexShrink:0 },
  metricsWrap:{ padding:"26px 40px", display:"flex", flexDirection:"column", gap:14, position:"relative", zIndex:1 },
  card:       { background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:2,
                padding:"22px 26px", transition:"border-color .4s" },
  cardLabel:  { fontFamily:mono, fontSize:9, letterSpacing:"0.18em", color:"#404040", marginBottom:10 },
  heroNum:    { fontFamily:"'Playfair Display',serif", fontSize:60, fontWeight:900,
                lineHeight:1, marginBottom:8, transition:"color .4s" },
  heroSub:    { fontFamily:mono, fontSize:10, color:"#404040", marginBottom:14 },
  rateRow:    { display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" },
  chip:       { fontFamily:mono, fontSize:11, padding:"4px 10px", border:"1px solid #252525",
                borderRadius:2, color:"#666", transition:"all .4s" },
  arrow:      { color:"#2e2e2e", fontSize:14 },
  badge:      { fontFamily:mono, fontSize:11, padding:"4px 10px", borderRadius:2, color:"#fff", fontWeight:600 },
  grid2:      { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 },
  bigNum:     { fontFamily:"'Playfair Display',serif", fontSize:30, fontWeight:700, lineHeight:1, marginBottom:5 },
  cardSub:    { fontFamily:mono, fontSize:9, color:"#333" },
  fallNote:   { fontFamily:mono, fontSize:9, color:"#8a5f0a", marginTop:7, padding:"3px 7px",
                background:"#120f00", borderRadius:2, display:"inline-block" },
  controls:   { padding:"0 40px 22px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
                position:"relative", zIndex:1, borderBottom:"1px solid #141414" },
  btn:        { fontFamily:mono, fontSize:10, letterSpacing:"0.09em", background:"transparent",
                border:"1px solid #252525", color:"#5a5a5a", padding:"7px 14px",
                cursor:"pointer", borderRadius:2, transition:"all .2s" },
  ts:         { fontFamily:mono, fontSize:9, color:"#333", marginLeft:"auto" },
  tableWrap:  { padding:"26px 40px", position:"relative", zIndex:1 },
  secTitle:   { fontFamily:mono, fontSize:9, letterSpacing:"0.18em", color:"#333",
                marginBottom:12, paddingBottom:10, borderBottom:"1px solid #181818" },
  th:         { fontFamily:mono, fontSize:9, letterSpacing:"0.09em", color:"#333",
                padding:"7px 12px", textAlign:"right", borderBottom:"1px solid #181818" },
  td:         { fontFamily:mono, fontSize:11, padding:"8px 12px", textAlign:"right",
                borderBottom:"1px solid #121212", color:"#555", transition:"color .3s" },
  tableNote:  { fontFamily:mono, fontSize:9, color:"#2e2e2e", marginTop:10, textAlign:"right" },
  methBtn:    { fontFamily:mono, fontSize:9, letterSpacing:"0.17em", color:"#333",
                background:"transparent", border:"none", cursor:"pointer",
                padding:"12px 0", textTransform:"uppercase" },
  methBox:    { padding:"16px 20px", background:"#080808", border:"1px solid #181818",
                borderRadius:2, fontFamily:serif, fontSize:13, color:"#505050",
                lineHeight:1.85, display:"flex", flexDirection:"column", gap:10 },
};
