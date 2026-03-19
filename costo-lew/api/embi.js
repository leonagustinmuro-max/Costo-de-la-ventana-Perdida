// api/embi.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const r = await fetch("https://mercados.ambito.com/riesgo-pais/variacion", {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const d = await r.json();
    const v = parseFloat(String(d.value).replace(",", "."));
    if (!isNaN(v) && v > 100 && v < 5000) {
      return res.status(200).json({ value: v, source: "tiempo real", timestamp: new Date().toISOString() });
    }
  } catch (_) {}
  try {
    const year = new Date().getFullYear();
    const r = await fetch(`https://mercados.ambito.com/riesgo-pais/historico-cierre/${year}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length) {
      const last = arr[arr.length - 1];
      const v = parseFloat(String(last[1] ?? last.value ?? "").replace(",", "."));
      const date = last[0] ?? null;
      if (!isNaN(v) && v > 100) {
        return res.status(200).json({ value: v, source: "último cierre", date, timestamp: new Date().toISOString() });
      }
    }
  } catch (_) {}
  return res.status(503).json({ error: "No se pudo obtener el riesgo país" });
}
