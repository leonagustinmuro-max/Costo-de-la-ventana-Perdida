// api/t10y.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const year = new Date().getFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const xml = await r.text();
    const matches = [...xml.matchAll(/<d:BC_10YEAR[^>]*>([\d.]+)<\/d:BC_10YEAR>/g)];
    if (matches.length) {
      const v = parseFloat(matches[matches.length - 1][1]);
      if (!isNaN(v) && v > 0) {
        return res.status(200).json({ value: v / 100, source: "US Treasury XML", timestamp: new Date().toISOString() });
      }
    }
  } catch (_) {}
  try {
    const url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?fields=record_date,security_desc,avg_interest_rate_amt&filter=security_desc:eq:Treasury%20Notes&sort=-record_date&page[size]=5";
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    if (d?.data?.length) {
      const v = parseFloat(d.data[0].avg_interest_rate_amt);
      if (!isNaN(v) && v > 0) {
        return res.status(200).json({ value: v / 100, source: "US Treasury fiscaldata", timestamp: new Date().toISOString() });
      }
    }
  } catch (_) {}
  return res.status(503).json({ error: "No se pudo obtener el T10y" });
}
