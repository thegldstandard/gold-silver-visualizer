export type Row = { date: string; gold: number; silver: number };

// --- CSV loader (works on GitHub Pages subpaths) ---
async function loadCsvFromPublic(): Promise<Row[]> {
  // Use Vite base so /USERNAME.github.io/REPO/ works
  const url = `${import.meta.env.BASE_URL}data/prices.csv`;
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) return [];
  const text = await r.text();
  return parseCsv(text);
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxDate = header.findIndex((h) => /date/.test(h));
  const idxGold = header.findIndex((h) => /gold/.test(h));
  const idxSilver = header.findIndex((h) => /silver/.test(h));
  if (idxDate < 0 || idxGold < 0 || idxSilver < 0) return [];

  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const iso = toISO(parts[idxDate].trim());
    const gold = Number(parts[idxGold]);
    const silver = Number(parts[idxSilver]);
    if (!iso || !Number.isFinite(gold) || !Number.isFinite(silver)) continue;
    out.push({ date: iso, gold, silver });
  }
  // de-dup and sort
  const map = new Map<string, Row>();
  for (const r of out) map.set(r.date, r);
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function toISO(s: string): string | null {
  // Accept YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
  const a = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const m = a.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const p1 = Number(m[1]), p2 = Number(m[2]), y = Number(m[3]);
    // disambiguate: if p1 > 12 it must be DD/MM
    let d: number, mo: number;
    if (p1 > 12) { d = p1; mo = p2; }
    else if (p2 > 12) { d = p2; mo = p1; }
    else { mo = p1; d = p2; }
    const mm = String(mo).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const dt = new Date(a);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

// --- MetalpriceAPI (USD base) ---
async function fetchMetalAPI(start: string, end: string, apiKey: string): Promise<Row[]> {
  if (!apiKey) return [];
  const url = `https://api.metalpriceapi.com/v1/timeframe?api_key=${apiKey}&start_date=${start}&end_date=${end}&base=USD&currencies=XAU,XAG`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const j = await resp.json();
  if (!j || !j.rates) return [];
  const rows: Row[] = [];
  const days = Object.keys(j.rates).sort();
  for (const d of days) {
    const r = j.rates[d] as any;
    const gold = (r.USDXAU ?? (r.XAU ? 1 / r.XAU : undefined)) as number | undefined;
    const silver = (r.USDXAG ?? (r.XAG ? 1 / r.XAG : undefined)) as number | undefined;
    if (Number.isFinite(gold) && Number.isFinite(silver)) rows.push({ date: d, gold: gold!, silver: silver! });
  }
  return rows;
}

// --- Helpers to find missing ranges ---
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d0 = new Date(start + "T00:00:00Z");
  const d1 = new Date(end + "T00:00:00Z");
  for (let t = d0.getTime(); t <= d1.getTime(); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(d);
  }
  return out;
}

function missingRanges(required: string[], have: Set<string>): Array<[string, string]> {
  const ranges: Array<[string, string]> = [];
  let runStart: string | null = null;
  for (const d of required) {
    const present = have.has(d);
    if (!present && runStart == null) runStart = d;
    if (present && runStart != null) { ranges.push([runStart, prevDay(d)]); runStart = null; }
  }
  if (runStart != null) ranges.push([runStart, required[required.length - 1]]);
  return ranges;
}
function prevDay(iso: string): string {
  const t = new Date(iso + "T00:00:00Z").getTime() - 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// --- Public API: CSV first, API only for gaps ---
export async function loadMergedPrices(start: string, end: string, apiKey?: string): Promise<Row[]> {
  const csv = await loadCsvFromPublic().catch(() => []);
  const map = new Map<string, Row>();
  for (const r of csv) map.set(r.date, r);

  // Only require dates within requested range
  const required = enumerateDates(start, end);
  const have = new Set(required.filter((d) => map.has(d)));
  const ranges = missingRanges(required, have);

  if (apiKey && ranges.length) {
    // fetch in <=365-day chunks to be safe
    for (const [rs, re] of ranges) {
      let cur = new Date(rs + "T00:00:00Z").getTime();
      const endT = new Date(re + "T00:00:00Z").getTime();
      while (cur <= endT) {
        const chunkStart = new Date(cur).toISOString().slice(0, 10);
        const chunkEnd = new Date(Math.min(cur + 86400000 * 360, endT)).toISOString().slice(0, 10);
        const rows = await fetchMetalAPI(chunkStart, chunkEnd, apiKey!);
        for (const r of rows) if (!map.has(r.date)) map.set(r.date, r);
        cur += 86400000 * 361;
      }
    }
  }

  const out = Array.from(map.values()).filter(r => r.date >= start && r.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
