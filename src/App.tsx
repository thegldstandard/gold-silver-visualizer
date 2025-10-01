import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
} from "recharts";
import { loadMergedPrices, Row as PriceRow } from "./utils/priceLoader";
import "./styles.css";

type Metal = "gold" | "silver";

type ChartRow = {
  date: string;         // YYYY-MM-DD
  gold: number;         // USD/oz
  silver: number;       // USD/oz
  ratio: number;        // gold/silver
  portfolio: number;    // simulated portfolio value (USD)
  goldValue: number;    // buy & hold gold (USD)
  silverValue: number;  // buy & hold silver (USD)
};

function fmtUSD(n: number) {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function clampNonNegativeDomain() {
  // Helper for Recharts domain that never goes below 0
  return [0, "auto"] as [number, any];
}

export default function App() {
  // ------- Controls -------
  const [startDate, setStartDate] = useState<string>("1990-01-01");
  const [initialAmount, setInitialAmount] = useState<number>(10000);
  const [startMetal, setStartMetal] = useState<Metal>("gold");

  // Thresholds: if ratio goes from < to >= gsThreshold, switch gold->silver.
  //             if ratio goes from > to <= sgThreshold, switch silver->gold.
  const [gsThreshold, setGsThreshold] = useState<number>(85);
  const [sgThreshold, setSgThreshold] = useState<number>(60);

  const [showPortfolio, setShowPortfolio] = useState<boolean>(true);
  const [showGold, setShowGold] = useState<boolean>(true);     // buy & hold gold value
  const [showSilver, setShowSilver] = useState<boolean>(true); // buy & hold silver value
  const [showRatio, setShowRatio] = useState<boolean>(true);

  // ------- Data -------
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load CSV first; fill API only for missing dates within [startDate, today]
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoadError(null);
        const to = dayjs().format("YYYY-MM-DD");
        const key =
          (typeof window !== "undefined" && (window as any).METAL_API_KEY) ||
          (import.meta as any).env?.VITE_METALPRICEAPI_KEY ||
          (import.meta as any).env?.NEXT_PUBLIC_METALPRICEAPI_KEY ||
          "";
        const merged = await loadMergedPrices(startDate, to, key);
        if (!ignore) setRows(Array.isArray(merged) ? merged : []);
      } catch (e: any) {
        console.error(e);
        if (!ignore) setLoadError(String(e?.message ?? e));
      }
    })();
    return () => {
      ignore = true;
    };
  }, [startDate]);

  // ------- Simulation -------
  const sim = useMemo(() => {
    if (!rows.length) return { data: [] as ChartRow[], switches: 0 };

    const series = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const first = series[0];

    // Initial units for portfolio and baselines
    const goldUnitsBH = initialAmount / first.gold;
    const silverUnitsBH = initialAmount / first.silver;

    let holding: Metal = startMetal;
    let units =
      startMetal === "gold"
        ? initialAmount / first.gold
        : initialAmount / first.silver;

    let prevRatio: number | undefined = undefined;
    let switches = 0;

    const out: ChartRow[] = [];

    for (const r of series) {
      const ratio = r.gold / r.silver;

      // CROSSING logic (use today's value for the switch when threshold is crossed)
      if (prevRatio !== undefined) {
        if (holding === "gold" && prevRatio < gsThreshold && ratio >= gsThreshold) {
          // Switch gold -> silver at today's prices
          units = units * (r.gold / r.silver);
          holding = "silver";
          switches++;
        } else if (holding === "silver" && prevRatio > sgThreshold && ratio <= sgThreshold) {
          // Switch silver -> gold at today's prices
          units = units * (r.silver / r.gold);
          holding = "gold";
          switches++;
        }
      }
      prevRatio = ratio;

      const portfolio =
        holding === "gold" ? units * r.gold : units * r.silver;
      const goldValue = goldUnitsBH * r.gold;
      const silverValue = silverUnitsBH * r.silver;

      out.push({
        date: r.date,
        gold: r.gold,
        silver: r.silver,
        ratio,
        portfolio,
        goldValue,
        silverValue,
      });
    }

    return { data: out, switches };
  }, [rows, initialAmount, startMetal, gsThreshold, sgThreshold]);

  const data = sim.data;
  const last = data.length ? data[data.length - 1] : undefined;

  const portfolioVsGold = last ? last.portfolio - last.goldValue : 0;
  const portfolioVsSilver = last ? last.portfolio - last.silverValue : 0;
  const pctVsGold =
    last && last.goldValue > 0 ? (portfolioVsGold / last.goldValue) * 100 : 0;
  const pctVsSilver =
    last && last.silverValue > 0
      ? (portfolioVsSilver / last.silverValue) * 100
      : 0;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, Segoe UI, Roboto, Helvetica, Arial" }}>
      <h2 style={{ marginTop: 0 }}>Gold & Silver Visualizer</h2>

      {/* Controls */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, minmax(140px, 1fr))",
        gap: 12,
        alignItems: "end",
        marginBottom: 12
      }}>
        <label style={{ display: "grid" }}>
          <span>Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>

        <label style={{ display: "grid" }}>
          <span>Initial amount (USD)</span>
          <input
            type="number"
            min={0}
            step="100"
            value={initialAmount}
            onChange={(e) => setInitialAmount(Math.max(0, Number(e.target.value || 0)))}
          />
        </label>

        <div style={{ display: "grid" }}>
          <span>Start metal</span>
          <div>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                name="startMetal"
                checked={startMetal === "gold"}
                onChange={() => setStartMetal("gold")}
              />
              <span style={{ marginLeft: 6 }}>Gold</span>
            </label>
            <label>
              <input
                type="radio"
                name="startMetal"
                checked={startMetal === "silver"}
                onChange={() => setStartMetal("silver")}
              />
              <span style={{ marginLeft: 6 }}>Silver</span>
            </label>
          </div>
        </div>

        <label style={{ display: "grid" }}>
          <span>Gold to Silver ratio</span>
          <input
            type="number"
            step="0.1"
            value={gsThreshold}
            onChange={(e) => setGsThreshold(Number(e.target.value || 0))}
          />
        </label>

        <label style={{ display: "grid" }}>
          <span>Silver to Gold ratio</span>
          <input
            type="number"
            step="0.1"
            value={sgThreshold}
            onChange={(e) => setSgThreshold(Number(e.target.value || 0))}
          />
        </label>

        <div style={{ display: "grid" }}>
          <span>Switches</span>
          <div style={{
            padding: "8px 10px",
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#fafafa",
            fontWeight: 600
          }}>
            {sim.switches}
          </div>
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label>
            <input
              type="checkbox"
              checked={showPortfolio}
              onChange={(e) => setShowPortfolio(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>My Portfolio</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showGold}
              onChange={(e) => setShowGold(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>Buy & Hold Gold</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showSilver}
              onChange={(e) => setShowSilver(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>Buy & Hold Silver</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showRatio}
              onChange={(e) => setShowRatio(e.target.checked)}
            />
            <span style={{ marginLeft: 6 }}>Gold/Silver ratio</span>
          </label>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
        gap: 12,
        marginBottom: 12
      }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>My Portfolio vs Gold</div>
          <div style={{ fontWeight: 700 }}>
            {fmtUSD(portfolioVsGold)}{" "}
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              ({Number.isFinite(pctVsGold) ? pctVsGold.toFixed(1) : "0.0"}%)
            </span>
          </div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>My Portfolio vs Silver</div>
          <div style={{ fontWeight: 700 }}>
            {fmtUSD(portfolioVsSilver)}{" "}
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              ({Number.isFinite(pctVsSilver) ? pctVsSilver.toFixed(1) : "0.0"}%)
            </span>
          </div>
        </div>
      </div>

      {/* Chart (single screen height, no scroll) */}
      <div style={{ height: 520, border: "1px solid #eee", borderRadius: 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              minTickGap={20}
              tickFormatter={(d) => String(d).slice(0, 4)}
            />
            <YAxis
              yAxisId="value"
              domain={clampNonNegativeDomain()}
              tickFormatter={(v) =>
                (typeof v === "number" && v >= 1000) ? `${Math.round(v / 1000)}k` : String(v)
              }
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              domain={clampNonNegativeDomain()}
            />
            <Tooltip
              formatter={(val: any, name: any, _p: any) => {
                if (typeof val === "number") {
                  if (name === "Gold/Silver ratio") return [val.toFixed(2), name];
                  return [fmtUSD(val), name];
                }
                return [val, name];
              }}
            />
            <Legend />

            {showPortfolio && (
              <Line
                yAxisId="value"
                type="monotone"
                dataKey="portfolio"
                name="My Portfolio"
                dot={false}
                strokeWidth={2}
                stroke="#4E79A7"
              />
            )}
            {showGold && (
              <Line
                yAxisId="value"
                type="monotone"
                dataKey="goldValue"
                name="Buy & Hold Gold"
                dot={false}
                strokeWidth={2}
                stroke="#D4AF37"
              />
            )}
            {showSilver && (
              <Line
                yAxisId="value"
                type="monotone"
                dataKey="silverValue"
                name="Buy & Hold Silver"
                dot={false}
                strokeWidth={2}
                stroke="#C0C0C0"
              />
            )}
            {showRatio && (
              <Line
                yAxisId="ratio"
                type="monotone"
                dataKey="ratio"
                name="Gold/Silver ratio"
                dot={false}
                strokeWidth={1}
                stroke="#7E57C2"
              />
            )}

            {/* Threshold guides on the ratio axis */}
            <ReferenceLine yAxisId="ratio" y={gsThreshold} stroke="#7E57C2" strokeDasharray="4 4" />
            <ReferenceLine yAxisId="ratio" y={sgThreshold} stroke="#7E57C2" strokeDasharray="4 4" />

            <Brush dataKey="date" height={24} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Data source hint / error */}
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
        {loadError
          ? <>Data load error: {loadError}</>
          : <>CSV history is loaded from <code>public/data/prices.csv</code>; missing dates are filled from the API.</>}
      </div>
    </div>
  );
}


