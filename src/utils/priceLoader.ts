export type Row = { date: string; gold: number; silver: number };

async function loadCsvFromPublic(): Promise<Row[]> {
  try {
    const url = `${import.meta.env.BASE_URL}data/prices.csv`;
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return [];
    return parseCsv(await res.text());
  } catch {
    return [];
  }
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const head = lines[0].split(",").map(h => h.trim().toLowerCase());
  const iDate = head.findIndex(h => /date/.test(h));
  const iGold = head.findIndex(h => /gold/.test(h));
  const iSilver = head.findIndex(h => /silver/.test(h));
  if (iDate < 0 || iGold < 0 || iSilver < 0) return [];
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 3) continue;
    const date = toISO(c[iDate].trim());
    const gold = Number(c[iGold]);
    const silver = Number(c[iSilver]);
    if (!date || !Number.isFinite(gold) || !Number.isFinite(silver)) continue;
    out.push({ date, gold, silver });
  }
  const map = new Map(out.map(r => [r.date, r]));
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function toISO(s: string): string | null {
  const a = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const m = a.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const p1 = +m[1], p2 = +m[2], y = +m[3];
    const [mo,d] = (p1>12) ? [p2,p1] : (p2>12) ? [p1,p2] : [p1,p2];
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const dt = new Date(a);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0,10);
}

async function fetchMetalAPI(start: string, end: string, apiKey: string): Promise<Row[]> {
  if (!apiKey) return [];
  const url = `https://api.metalpriceapi.com/v1/timeframe?api_key=${apiKey}&start_date=${start}&end_date=${end}&base=USD&currencies=XAU,XAG`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json().catch(()=>null);
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

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = new Date(start+'T00:00:00Z').getTime(), e = new Date(end+'T00:00:00Z').getTime(); t <= e; t+=86400000) {
    out.push(new Date(t).toISOString().slice(0,10));
  }
  return out;
}
function prevDay(iso: string) { return new Date(new Date(iso+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10); }
function missingRanges(need: string[], have: Set<string>): Array<[string,string]> {
  const out: Array<[string,string]> = []; let start: string | null = null;
  for (const d of need) {
    if (!have.has(d) && start == null) start = d;
    if (have.has(d) && start != null) { out.push([start, prevDay(d)]); start = null; }
  }
  if (start != null) out.push([start, need.at(-1)!]);
  return out;
}

export async function loadMergedPrices(start: string, end: string, apiKey?: string): Promise<Row[]> {
  const csv = await loadCsvFromPublic().catch(()=>[]);
  const map = new Map<string, Row>(csv.map(r => [r.date, r]));

  const required = enumerateDates(start, end);
  const have = new Set(required.filter(d => map.has(d)));
  const gaps = missingRanges(required, have);

  if (apiKey && gaps.length) {
    for (const [gs, ge] of gaps) {
      let cur = new Date(gs+'T00:00:00Z').getTime();
      const endT = new Date(ge+'T00:00:00Z').getTime();
      while (cur <= endT) {
        const s = new Date(cur).toISOString().slice(0,10);
        const e = new Date(Math.min(cur+86400000*360, endT)).toISOString().slice(0,10);
        const rows = await fetchMetalAPI(s, e, apiKey!);
        for (const r of rows) if (!map.has(r.date)) map.set(r.date, r);
        cur += 86400000*361;
      }
    }
  }

  return [...map.values()]
    .filter(r => r.date >= start && r.date <= end)
    .sort((a,b)=>a.date.localeCompare(b.date));
}
