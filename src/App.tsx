import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

/**
 * App â€“ Value Chart + Simple Toggles + Stats Boxes (FULL UPDATED)
 * - VALUE lines only (USD): Gold (buy & hold), Silver (buy & hold), My Portfolio.
 * - Optional translucent Goldâ€“Silver Ratio overlay (purely visual; does NOT change value scale).
 * - Four toggles only: Gold Value, Silver Value, My Portfolio, Gold-Silver Ratio.
 * - Auto-loads /public/data/prices.csv (or .xlsx). Falls back to MetalpriceAPI for gaps.
 * - Caches history in localStorage to reduce API calls and rate limits.
 * - Yâ€‘axis never drops below 0.
 */

// ===== Types =====

type Row = { date: string; gold: number; silver: number };
type SimPoint = Row & {
  ratio: number; // Gold-Silver (price ratio)
  portfolio: number; // strategy value (USD)
  goldValue: number; // buy & hold value if stayed in Gold-SilverValue: number; // buy & hold value if stayed in silver
  portfolioPct: number; // % gain of portfolio vs startAmount
  goldPct: number; // % gain of gold buy & hold
  silverPct: number; // % gain of silver buy & hold
  diffVsGold: number; // (pp) portfolioPct - goldPct
  diffVsSilver: number; // (pp) portfolioPct - silverPct
  heldMetal: 'Gold-Silver';
  heldOunces: number;
  switched?: 'Gâ†’S' | 'Sâ†’G';
};

// ===== Consts =====

const DEFAULT_API_KEY = '98ce31de34ecaadcd00d49d12137a56a'; // MetalpriceAPI (USD)
const LS_KEY = 'metalHistoryUSD_XAUXAG_v1';

// ===== Utils =====

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
let mpThrottleMs = 500;
const bumpThrottle = (ms: number) => {
  mpThrottleMs = Math.min(5000, Math.max(mpThrottleMs, Math.floor(ms)));
};

function fmtCurrency(n: number | undefined | null, dp = 2) {
  if (n == null || !Number.isFinite(Number(n))) return 'â€”';
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });
}
function fmtPct(n: number | undefined | null, dp = 2) {
  if (n == null || !Number.isFinite(Number(n))) return 'â€”';
  const v = Number(n);
  const sign = v > 0 ? '+' : v < 0 ? '' : '';
  return `${sign}${v.toFixed(dp)}%`;
}
function parseNumOrUndefined(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toISODate(input: any): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // ISO
  if (/^\d+$/.test(s)) {
    // Excel serial
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + Number(s) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let d = +m[1],
      mo = +m[2],
      y = +m[3];
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (mo > 12 && d <= 12) {
      const t = d;
      d = mo;
      mo = t;
    }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.toISOString().slice(0, 10);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function coerceNumber(x: any): number | null {
  const n = Number(String(x).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeRows(rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows || []) {
    const iso = toISODate((r as any).date ?? '');
    const g = coerceNumber((r as any).gold);
    const s = coerceNumber((r as any).silver);
    if (!iso || g == null || s == null) continue;
    map.set(iso, { date: iso, gold: g, silver: s });
  }
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}
function readHistoryCache(): Row[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const val = JSON.parse(raw);
    if (Array.isArray(val)) return normalizeRows(val);
    if (val && Array.isArray(val.rows)) return normalizeRows(val.rows);
  } catch {}
  return [];
}
function writeHistoryCache(rows: Row[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(normalizeRows(rows)));
  } catch {}
}
function mergeRows(a: Row[], b: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const r of a) map.set(r.date, r);
  for (const r of b) map.set(r.date, r);
  return Array.from(map.values()).sort((x, y) => (x.date < y.date ? -1 : 1));
}

// ===== Fetchers =====

async function fetchJsonWithRetry(url: string, attempts = 5, baseDelayMs = 700): Promise<any> {
  for (let i = 1; i <= attempts; i++) {
    const resp = await fetch(url);

    let retryAfterMs = 0;
    const ra = resp.headers.get('Retry-After');
    if (ra) {
      const sec = Number(ra);
      if (Number.isFinite(sec)) retryAfterMs = sec * 1000;
    }

    if (resp.ok) {
      let j: any;
      try {
        j = await resp.json();
      } catch {
        throw new Error('Invalid JSON from MetalpriceAPI');
      }
      if (j && j.success === false) {
        const info = j.error?.info || j.error?.message || j.message || '';
        const low = String(info).toLowerCase();
        if ((low.includes('too many') || low.includes('rate')) && i < attempts) {
          const delay = Math.max(retryAfterMs, baseDelayMs * Math.pow(2, i - 1));
          bumpThrottle(delay);
          await sleep(delay);
          continue;
        }
        throw new Error(`MetalpriceAPI error: ${info || 'Unknown API error'}`);
      }
      return j;
    }

    if ((resp.status === 429 || resp.status >= 500) && i < attempts) {
      const delay = Math.max(retryAfterMs, baseDelayMs * Math.pow(2, i - 1));
      bumpThrottle(delay);
      await sleep(delay);
      continue;
    }

    let text = '';
    try {
      text = await resp.text();
    } catch {}
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text : ''}`);
  }
  throw new Error('Failed to fetch after retries');
}

async function loadMetalPriceAPI(start: string, end: string, apiKey: string): Promise<Row[]> {
  const url = `https://api.metalpriceapi.com/v1/timeframe?api_key=${apiKey}&start_date=${start}&end_date=${end}&base=USD&currencies=XAU,XAG`;
  const j = await fetchJsonWithRetry(url, 5, 700);
  if (!j || !j.rates) throw new Error("Unexpected response: missing 'rates'");

  const rows: Row[] = [];
  const keys = Object.keys(j.rates).sort();

  if (keys.length && typeof j.rates[keys[0]] === 'object') {
    for (const d of keys) {
      const r = (j.rates as any)[d];
      const gold = r.USDXAU ?? (r.XAU ? 1 / r.XAU : undefined);
      const silver = r.USDXAG ?? (r.XAG ? 1 / r.XAG : undefined);
      if (Number.isFinite(gold) && Number.isFinite(silver)) {
        rows.push({ date: d, gold: Number(Gold-Silver: Number(silver) });
      }
    }
    return rows;
  }

  const r = j.rates as any;
  const gold = r.USDXAU ?? (r.XAU ? 1 / r.XAU : undefined);
  const silver = r.USDXAG ?? (r.XAG ? 1 / r.XAG : undefined);
  const date = j.date || end || dayjs().format('YYYY-MM-DD');
  if (Number.isFinite(gold) && Number.isFinite(silver)) {
    return [{ date, gold: Number(Gold-Silver: Number(silver) }];
  }
  throw new Error('MetalpriceAPI response lacked usable XAU/XAG fields');
}

async function loadMetalHistoryChunked(start: string, end: string, apiKey: string): Promise<Row[]> {
  const out: Row[] = [];
  let s = dayjs(start);
  const endD = dayjs(end);
  while (s.isBefore(endD) || s.isSame(endD, 'day')) {
    let e = s.add(365, 'day');
    if (e.isAfter(endD)) e = endD;

    let chunk: Row[] = [];
    for (let tries = 0; ; tries++) {
      try {
        chunk = await loadMetalPriceAPI(s.format('YYYY-MM-DD'), e.format('YYYY-MM-DD'), DEFAULT_API_KEY);
        break;
      } catch (err: any) {
        const m = String(err?.message || '').toLowerCase();
        if ((m.includes('too many') || m.includes('429') || m.includes('rate')) && tries < 6) {
          const wait = Math.max(mpThrottleMs * 2, 3000);
          bumpThrottle(wait);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }

    out.push(...chunk);
    s = e.add(1, 'day');
    await sleep(mpThrottleMs);
  }

  const map = new Map<string, Row>();
  for (const r of out) map.set(r.date, r);
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function loadMetalHistorySmart(start: string, end: string): Promise<Row[]> {
  let cached = readHistoryCache();
  if (!cached.length) {
    const fresh = await loadMetalHistoryChunked(start, end, DEFAULT_API_KEY);
    writeHistoryCache(fresh);
    return fresh;
  }
  const haveFirst = cached[0].date;
  const haveLast = cached[cached.length - 1].date;
  if (start < haveFirst) {
    const extraBefore = await loadMetalHistoryChunked(
      start,
      dayjs(haveFirst).subtract(1, 'day').format('YYYY-MM-DD'),
      DEFAULT_API_KEY,
    );
    cached = mergeRows(extraBefore, cached);
  }
  if (end > haveLast) {
    const extraAfter = await loadMetalHistoryChunked(
      dayjs(haveLast).add(1, 'day').format('YYYY-MM-DD'),
      end,
      DEFAULT_API_KEY,
    );
    cached = mergeRows(cached, extraAfter);
  }
  writeHistoryCache(cached);
  return cached.filter((r) => r.date >= start && r.date <= end);
}

// Auto-load CSV/XLSX from public/data
async function tryAutoLoadFromPublic(): Promise<Row[] | null> {
  try {
    const csvResp = await fetch('/data/prices.csv', { cache: 'no-store' });
    if (csvResp.ok) {
      const txt = await csvResp.text();
      const lines = txt.trim().split(/\r?\n/);
      if (!lines.length) return null;

      const header = lines[0].split(/[\t,;]+/).map((s) => s.trim());
      const findIdx = (patterns: RegExp[]) => {
        for (let i = 0; i < header.length; i++) {
          const h = header[i];
          if (patterns.some((p) => p.test(h))) return i;
        }
        return -1;
      };
      const di = findIdx([/date/i]);
      const gi = findIdx([/\bgold\b/i, /gold.*usd/i, /\bXAU\b/i]);
      const si = findIdx([/\bsilver\b/i, /silver.*usd/i, /\bXAG\b/i]);

      if (di >= 0 && gi >= 0 && si >= 0) {
        const out: Row[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(/[\t,;]+/).map((s) => s.trim());
          const iso = toISODate(cols[di]);
          const g = coerceNumber(cols[gi]);
          const s = coerceNumber(cols[si]);
          if (!iso || g == null || s == null) continue;
          out.push({ date: iso, gold: g, silver: s });
        }
        return normalizeRows(out);
      }
    }
  } catch {}

  try {
    const xResp = await fetch('/data/prices.xlsx', { cache: 'no-store' });
    if (xResp.ok) {
      const buf = await xResp.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '' });

      const out: Row[] = [];
      for (const row of json) {
        const keys = Object.keys(row);
        const findKey = (patterns: RegExp[]) =>
          keys.find((k) => patterns.some((p) => p.test(String(k)))) ?? '';
        const dateKey = findKey([/date/i]);
        const goldKey = findKey([/\bgold\b/i, /gold.*usd/i, /\bXAU\b/i]);
        const silverKey = findKey([/\bsilver\b/i, /silver.*usd/i, /\bXAG\b/i]);
        if (!dateKey || !goldKey || !silverKey) continue;

        const iso = toISODate(row[dateKey]);
        const g = coerceNumber(row[goldKey]);
        const s = coerceNumber(row[silverKey]);
        if (!iso || g == null || s == null) continue;
        out.push({ date: iso, gold: g, silver: s });
      }
      return normalizeRows(out);
    }
  } catch {}
  return null;
}

// ===== Simulation =====

function simulate(
  rows: Row[],
  startDate: string,
  endDate: string,
  startMetal: 'Gold-Silver',
  startAmount: number,
  g2s?: number,
  s2g?: number,
): SimPoint[] {
  const filtered = rows.filter((r) => r.date >= startDate && r.date <= endDate);
  if (!filtered.length) return [];
  const first = filtered[0];

  const noTriggers =
    (g2s == null || Number.isNaN(g2s)) && (s2g == null || Number.isNaN(s2g));

  let heldMetal: 'Gold-Silver' = startMetal;
  let ounces =
    heldMetal === 'Gold' ? startAmount / first.gold : startAmount / first.silver;

  // Buy-and-hold baselines (value series)
  const goldBHoz = startAmount / first.gold;
  const silverBHoz = startAmount / first.silver;

  const out: SimPoint[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const ratio = r.gold / r.silver;
    const prevRatio = i > 0 ? filtered[i - 1].gold / filtered[i - 1].silver : ratio;

    let switched: SimPoint['switched'] | undefined;

    if (!noTriggers) {
      if (heldMetal === 'Gold') {
        // Switch Gold â†’ Silver the FIRST day the ratio meets/exceeds g2s.
        // If it's the very first day and already >= g2s, we switch using day 1 prices (your example: 84.9 then 86 â†’ use 86 day).
        const crossedUp = g2s != null && Number.isFinite(g2s) && ratio >= g2s && (i === 0 || prevRatio < g2s);
        if (crossedUp) {
          const value = ounces * r.gold; // use today's close
          ounces = value / r.silver;
          heldMetal = 'Silver';
          switched = 'Gâ†’S';
        }
      } else {
        // Switch Silver â†’ Gold the FIRST day the ratio meets/falls to s2g.
        const crossedDown = s2g != null && Number.isFinite(s2g) && ratio <= s2g && (i === 0 || prevRatio > s2g);
        if (crossedDown) {
          const value = ounces * r.silver; // use today's close
          ounces = value / r.gold;
          heldMetal = 'Gold';
          switched = 'Sâ†’G';
        }
      }
    }

    // Portfolio and buy/hold values (USD)
    const portfolio = heldMetal === 'Gold' ? ounces * r.gold : ounces * r.silver;
    const goldValue = goldBHoz * r.gold;
    const silverValue = silverBHoz * r.silver;

    const portfolioPct = (portfolio / startAmount - 1) * 100;
    const goldPct = (goldValue / startAmount - 1) * 100;
    const silverPct = (silverValue / startAmount - 1) * 100;
    const diffVsGold = portfolioPct - goldPct;
    const diffVsSilver = portfolioPct - silverPct;

    out.push({
      ...r,
      ratio,
      portfolio,
      goldValue,
      silverValue,
      portfolioPct,
      goldPct,
      silverPct,
      diffVsGold,
      diffVsSilver,
      heldMetal,
      heldOunces: ounces,
      switched,
    });
  }
  return out;
}

// ===== Component =====

export default function App() {
  const [rows, setRows] = useState<Row[]>([]);
  const [startDate, setStartDate] = useState<string>(() =>
    dayjs('1990-01-01').format('YYYY-MM-DD'),
  );
  const [endDate, setEndDate] = useState<string>(() =>
    dayjs().format('YYYY-MM-DD'),
  );
  const [startMetal, setStartMetal] = useState<'Gold-Silver'>('Gold');
  const [startAmount, setStartAmount] = useState<number>(10000);
  const [g2s, setG2S] = useState<string>('85');
  const [s2g, setS2G] = useState<string>('75');

  // Toggles (defaults: Gold-Silver/portfolio ON, ratio OFF)
  const [showGold, setShowGold] = useState(true);
  const [showSilver, setShowSilver] = useState(true);
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [showRatio, setShowRatio] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string>('');
  // Load prices: CSV first, then fill gaps from MetalpriceAPI (only missing dates)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const from = startDate;
        const to = (typeof dayjs !== 'undefined' ? dayjs().format('YYYY-MM-DD') : new Date().toISOString().slice(0,10));
        // Try reading API key from env or window; ok if empty (then we skip API)
        const key =
          (typeof window !== 'undefined' && (window as any).METAL_API_KEY) ||
          (import.meta as any).env?.VITE_METALPRICEAPI_KEY ||
          (import.meta as any).env?.NEXT_PUBLIC_METALPRICEAPI_KEY ||
          '';
        const merged = await loadMergedPrices(from, to, key);
        if (!ignore && merged.length) setRows(merged);
      } catch (e) {
        console.error('merged loader failed', e);
      }
    })();
      // Load prices from CSV first; fill gaps from API (only missing dates)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const from = startDate;
        const to = (typeof dayjs !== "undefined" ? dayjs().format("YYYY-MM-DD") : new Date().toISOString().slice(0,10));
        const key =
          (typeof window !== "undefined" && (window as any).METAL_API_KEY) ||
          (import.meta as any).env?.VITE_METALPRICEAPI_KEY ||
          (import.meta as any).env?.NEXT_PUBLIC_METALPRICEAPI_KEY || "";
        const merged = await loadMergedPrices(from, to, key);
        if (!ignore && merged.length) setRows(merged);
      } catch (e) {
        console.error("merged loader failed", e);
      }
    })();
    return () => { ignore = true; };
  }, [startDate]);
  return () => { ignore = true; };
  }, [startDate]);
  const autoTriedRef = useRef(false);

  // Data bootstrapping: cache â†’ /public/data â†’ API (for gaps)
  useEffect(() => {
    (async () => {
      try {
        setErrorMsg('');
        if (dayjs(endDate).isBefore(dayjs(startDate))) {
          setRows([]);
          setErrorMsg('End date must be on or after start date');
          return;
        }

        let cached = readHistoryCache();
        if (cached.length)
          setRows(cached.filter((r) => r.date >= startDate && r.date <= endDate));

        if (!cached.length && !autoTriedRef.current) {
          autoTriedRef.current = true;
          const auto = await tryAutoLoadFromPublic();
          if (auto && auto.length) {
            writeHistoryCache(auto);
            setRows(auto.filter((r) => r.date >= startDate && r.date <= endDate));
            return;
          }
        }

        if (!cached.length) {
          const data = await loadMetalHistorySmart(startDate, endDate);
          setRows(data);
        } else {
          const haveFirst = cached[0].date;
          const haveLast = cached[cached.length - 1].date;
          if (startDate < haveFirst || endDate > haveLast) {
            const data = await loadMetalHistorySmart(startDate, endDate);
            setRows(data);
          }
        }
      } catch (e: any) {
        setErrorMsg(e?.message || 'Failed to load data');
        setRows([]);
      }
    })();
  }, [startDate, endDate]);

  const sim = useMemo(
    () =>
      simulate(
        rows,
        startDate,
        endDate,
        startMetal,
        startAmount,
        parseNumOrUndefined(g2s || ''),
        parseNumOrUndefined(s2g || ''),
      ),
    [rows, startDate, endDate, startMetal, startAmount, g2s, s2g],
  );

  const latest = sim.length ? sim[sim.length - 1] : undefined;
  const finalPortfolio = latest?.portfolio ?? 0;
  const finalGoldValue = latest?.goldValue ?? 0;
  const finalSilverValue = latest?.silverValue ?? 0;
  const finalPortfolioPct = latest?.portfolioPct ?? 0;
  const finalGoldPct = latest?.goldPct ?? 0;
  const finalSilverPct = latest?.silverPct ?? 0;
  const diffGoldValue = finalPortfolio - finalGoldValue;
  const diffSilverValue = finalPortfolio - finalSilverValue;
  const diffGoldPct = finalPortfolioPct - finalGoldPct;
  const diffSilverPct = finalPortfolioPct - finalSilverPct;

  const totalSwitches = useMemo(() => sim.filter((p) => p.switched).length, [sim]);

  // Single value axis domain for goldValue/silverValue/portfolio (clamp >= 0)
  const [valMin, valMax] = useMemo(() => {
    if (!sim.length) return [0, 1] as const;
    let vmin = Infinity,
      vmax = -Infinity;
    for (const p of sim) {
      for (const v of [p.goldValue, p.silverValue, p.portfolio]) {
        if (Number.isFinite(v)) {
          vmin = Math.min(vmin, Number(v));
          vmax = Math.max(vmax, Number(v));
        }
      }
    }
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmin === vmax) {
      const base = Number.isFinite(vmin) ? Number(vmin) : 0;
      return [Math.max(0, base - 1), base + 1] as const;
    }
    const pad = (vmax - vmin) * 0.05 || 1;
    return [Math.max(0, vmin - pad), vmax + pad] as const;
  }, [sim]);

  const xTickFormatter = (value: string) => dayjs(value).format('YYYY');
  const tooltipFormatter = (value: any, name: string) => {
    if (name === 'Gold-Silver Ratio') return [Number(value).toFixed(2), name];
    return [fmtCurrency(Number(value), 2), name];
  };

    // Load prices from CSV first; fill gaps from API (only missing dates)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const from = startDate;
        const to = (typeof dayjs !== "undefined" ? dayjs().format("YYYY-MM-DD") : new Date().toISOString().slice(0,10));
        const key =
          (typeof window !== "undefined" && (window as any).METAL_API_KEY) ||
          (import.meta as any).env?.VITE_METALPRICEAPI_KEY ||
          (import.meta as any).env?.NEXT_PUBLIC_METALPRICEAPI_KEY || "";
        const merged = await loadMergedPrices(from, to, key);
        if (!ignore && merged.length) setRows(merged);
      } catch (e) {
        console.error("merged loader failed", e);
      }
    })();
    return () => { ignore = true; };
  }, [startDate]);
  return (
    <div className="container">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Gold-Silver Strategy Visualizer</div>
        </div>

        <div className="card-content">
          {errorMsg && (
            <div
              style={{
                background: '#3b1f22',
                border: '1px solid #6b1f2a',
                color: '#ffd8df',
                padding: '8px 12px',
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Controls */}
          <div className="grid grid-3">
            {/* Start settings */}
            <div className="border">
              <div className="row">
                <label>Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="row">
                <label>End date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="row">
                <label>Start metal</label>
                <select
                  value={startMetal}
                  onChange={(e) => setStartMetal(e.target.value as any)}
                >
                  <option>Gold</option>
                  <option>Silver</option>
                </select>
              </div>
              <div className="row">
                <label>Start amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={startAmount}
                  onChange={(e) => setStartAmount(Math.max(0, Number(e.target.value)))}
                />
              </div>
            </div>

            {/* Ratio inputs */}
            <div className="border">
              <div className="row">
                <label>Gold-Silver Ratio</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 85"
                  value={g2s}
                  onChange={(e) => setG2S(e.target.value)}
                />
              </div>
              <div className="row">
                <label>Silverâ†’Gold ratio</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 75"
                  value={s2g}
                  onChange={(e) => setS2G(e.target.value)}
                />
              </div>
              {/* New: read-only total switches */}
              <div className="row">
                <label>Switches</label>
                <input type="number" value={totalSwitches} readOnly />
              </div>
            </div>

            {/* Four toggles only */}
            <div className="border">
              <div className="checkbox">
                <input
                  type="checkbox"
                  checked={showGold}
                  onChange={(e) => setShowGold(e.target.checked)}
                />
                <label>Gold Value</label>
              </div>
              <div className="checkbox">
                <input
                  type="checkbox"
                  checked={showSilver}
                  onChange={(e) => setShowSilver(e.target.checked)}
                />
                <label>Silver Value</label>
              </div>
              <div className="checkbox">
                <input
                  type="checkbox"
                  checked={showPortfolio}
                  onChange={(e) => setShowPortfolio(e.target.checked)}
                />
                <label>My Portfolio</label>
              </div>
              <div className="checkbox">
                <input
                  type="checkbox"
                  checked={showRatio}
                  onChange={(e) => setShowRatio(e.target.checked)}
                />
                <label>Gold-Silver Ratio</label>
              </div>
            </div>
          </div>

          {/* Stats â€” values with small % */}
          <div className="stats" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className="label">Gold (buy & hold)</div>
              <div className="value">{fmtCurrency(finalGoldValue, 2)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtPct(finalGoldPct, 2)}
              </div>
            </div>
            <div className="stat">
              <div className="label">Silver (buy & hold)</div>
              <div className="value">{fmtCurrency(finalSilverValue, 2)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtPct(finalSilverPct, 2)}
              </div>
            </div>
            <div className="stat">
              <div className="label">My Portfolio</div>
              <div className="value">{fmtCurrency(finalPortfolio, 2)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtPct(finalPortfolioPct, 2)}
              </div>
            </div>
            <div className="stat">
              <div className="label">My Portfolio vs Gold</div>
              <div className="value">{fmtCurrency(diffGoldValue, 2)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtPct(diffGoldPct, 2)}
              </div>
            </div>
            <div className="stat">
              <div className="label">My Portfolio vs Silver</div>
              <div className="value">{fmtCurrency(diffSilverValue, 2)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {fmtPct(diffSilverPct, 2)}
              </div>
            </div>
          </div>

          {/* Chart â€” VALUE lines + optional ratio overlay */}
          <div className="chart" style={{ marginTop: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sim} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={xTickFormatter}
                  minTickGap={32}
                  stroke="#94a3b8"
                />

                {/* One shared value axis for all value series (USD) */}
                <YAxis
                  yAxisId="value"
                  orientation="right"
                  domain={[valMin, valMax]}
                  tickFormatter={(v) => '$' + Number(v).toLocaleString()}
                  width={90}
                  stroke="#94a3b8"
                />

                {/* Hidden axis for the ratio overlay */}
                <YAxis yAxisId="ratio" orientation="right" hide />

                <Tooltip
                  formatter={tooltipFormatter as any}
                  labelFormatter={(l) => dayjs(l as string).format('DD MMM YYYY')}
                  contentStyle={{ background: '#0e1117', border: '1px solid #1e293b' }}
                />
                <Legend />

                {showRatio && (
                  <Line
                    type="monotone"
                    dataKey="ratio"
                    name="Gold-Silver Ratio"
                    yAxisId="ratio"
                    dot={false}
                    stroke="rgba(107,114,128,0.25)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                )}
                {showGold && (
                  <Line
                    yAxisId="value"
                    type="monotone"
                    dataKey="goldValue"
                    name="Gold Value"
                    dot={false}
                    strokeWidth={2}
                    stroke="#D4AF37"
                    isAnimationActive={false}
                  />
                )}
                {showSilver && (
                  <Line
                    yAxisId="value"
                    type="monotone"
                    dataKey="silverValue"
                    name="Silver Value"
                    dot={false}
                    strokeWidth={2}
                    stroke="#9CA3AF"
                    isAnimationActive={false}
                  />
                )}
                {showPortfolio && (
                  <Line
                    yAxisId="value"
                    type="monotone"
                    dataKey="portfolio"
                    name="My Portfolio"
                    dot={false}
                    strokeWidth={3}
                    stroke="#EF4444"
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Chart shows values (USD) for Gold (buy & hold), Silver (buy & hold), and My Portfolio.
            Optional Goldâ€‘Silver Ratio overlays in the background. Switches execute at endâ€‘ofâ€‘day
            when ratio triggers are met.
          </div>
        </div>
      </div>

      {/* Minimal styles so it looks decent even without Tailwind/shadcn */}
      <style>{`
        .container{padding:16px;max-width:1200px;margin:0 auto;color:#e5e7eb;background:#0b1220;min-height:100vh}
        .card{background:#0e1628;border:1px solid #1e293b;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.2)}
        .card-header{padding:16px 16px 0 16px}
        .card-title{font-size:20px;font-weight:700}
        .card-content{padding:16px}
        .grid{display:grid;gap:12px}
        .grid-3{grid-template-columns:repeat(1,minmax(0,1fr))}
        @media(min-width:900px){.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}}
        .border{border:1px solid #1e293b;border-radius:12px;padding:12px}
        .row{display:grid;grid-template-columns:140px 1fr;gap:8px;align-items:center;margin-bottom:8px}
        .row:last-child{margin-bottom:0}
        .row label{font-size:14px;color:#cbd5e1}
        .row input,.row select{height:36px;border:1px solid #334155;background:#0b1220;color:#e5e7eb;border-radius:8px;padding:0 10px}
        .checkbox{display:flex;align-items:center;gap:8px;margin-bottom:8px}
        .checkbox:last-child{margin-bottom:0}
        .stats{display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:12px}
        @media(min-width:900px){.stats{grid-template-columns:repeat(5,minmax(0,1fr))}}
        .stat{border:1px solid #1e293b;border-radius:12px;padding:12px}
        .label{font-size:12px;color:#94a3b8;margin-bottom:6px}
        .value{font-size:18px;font-weight:700}
        .muted{color:#94a3b8}
        .chart{height:440px}
      `}</style>
    </div>
  );
}









