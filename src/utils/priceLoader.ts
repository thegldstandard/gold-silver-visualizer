export type Row = { date: string; gold: number; silver: number };

// Load CSV from public/ using Vite base path so it works on GitHub Pages subfolder.
async function loadCsvFromPublic(): Promise<Row[]> {
  const url = `${import.meta.env.BASE_URL}data/prices.csv`;
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) return [];
  const text = await r.text();
  return parseCsv(text);
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const iDate = header.findIndex(h => /date/.test(h));
  const iGold = header.findIndex(h => /gold/.test(h));
  const iSilver = header.findIndex(h => /silver/.test(h));
  if (iDate < 0 || iGold < 0 || iSilver < 0) return [];
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const date = toISO(parts[iDate].trim());
    const gold = Number(parts[iGold]);
    const silver = Number(parts[iSilver]);
    if (!date || !Number.isFinite(gold) || !Number.isFinite(silver)) continue;
    out.push({ date, gold, silver });
  }
  // de-dup + sort
  const map = new Map<string, Row>();
  for (const r of out) map.set(r.date, r);
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function toISO(s: string): string | null {
  const a = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;              // YYYY-MM-DD
  const m = a.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // DD/MM/YYYY or MM/DD/YYYY
  if (m) {
    const p1 = Number(m[1]), p2 = Number(m[2]), y = Number(m[3]);
    let d: number, mo: number;
    if (p1 > 12) { d = p1; mo = p2; } else if (p2 > 12) { d = p2; mo = p1; } else { mo = p1; d = p2; }
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const dt = new Date(a);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0,10);
}

// MetalpriceAPI timeframe (USD base). Uses USDXAU / USDXAG when available.
async function fetchMetalAPI(start: string, end: string, apiKey: string): Promise<Row[]> {
  if (!apiKey) return [];
  const url = `https://api.metalpriceapi.com/v1/timeframe?api_key=${apiKey}&start_date=${start}&end_date=${end}&base=USD&currencies=XAU,XAG`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j || !j.rates) return [];
  const out: Row[] = [];
  for (const d of Object.keys(j.rates).sort()) {
    const rr = (j.rates as any)[d];
    const gold = (rr.USDXAU ?? (rr.XAU ? 1/rr.XAU : undefined)) as number | undefined;
    const silver = (rr.USDXAG ?? (rr.XAG ? 1/rr.XAG : undefined)) as number | undefined;
    if (Number.isFinite(gold) && Number.isFinite(silver)) out.push({ date: d, gold: gold!, silver: silver! });
  }
  return out;
}

// Utilities to compute date coverage and gaps
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = new Date(start + 'T00:00:00Z').getTime(), endT = new Date(end + 'T00:00:00Z').getTime(); t <= endT; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0,10));
  }
  return out;
}
function prevDay(iso: string): string {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0,10);
}
function missingRanges(required: string[], have: Set<string>): Array<[string,string]> {
  const ranges: Array<[string,string]> = [];
  let runStart: string | null = null;
  for (const d of required) {
    const present = have.has(d);
    if (!present && runStart == null) runStart = d;
    if (present && runStart != null) { ranges.push([runStart, prevDay(d)]); runStart = null; }
  }
  if (runStart != null) ranges.push([runStart, required[required.length-1]]);
  return ranges;
}

// Public: load CSV first, then fetch API only for missing days within [start,end]
export async function loadMergedPrices(start: string, end: string, apiKey?: string): Promise<Row[]> {
  const csv = await loadCsvFromPublic().catch(() => []);
  const map = new Map<string, Row>();
  for (const r of csv) map.set(r.date, r);

  const required = enumerateDates(start, end);
  const have = new Set(required.filter(d => map.has(d)));
  const gaps = missingRanges(required, have);

  if (apiKey && gaps.length) {
    for (const [gs, ge] of gaps) {
      // fetch in <= 360-day chunks
      let cur = new Date(gs + 'T00:00:00Z').getTime();
      const endT = new Date(ge + 'T00:00:00Z').getTime();
      while (cur <= endT) {
        const s = new Date(cur).toISOString().slice(0,10);
        const e = new Date(Math.min(cur + 86400000*360, endT)).toISOString().slice(0,10);
        const rows = await fetchMetalAPI(s, e, apiKey!);
        for (const r of rows) if (!map.has(r.date)) map.set(r.date, r);
        cur += 86400000*361;
      }
    }
  }

  return Array.from(map.values())
    .filter(r => r.date >= start && r.date <= end)
    .sort((a,b) => a.date.localeCompare(b.date));
}
