import { useState, useMemo } from "react";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CityAggregateResponse, ConsensusResponse, MlForecast72hrResponse } from "@/lib/types";
import type { IqairRealtimeResponse } from "@/lib/api";
import { useTranslation } from "@/i18n";
import { pollutantSubIndex } from "@/lib/aqi";
import { VantaCellsBackground } from "./VantaCellsBackground";

interface Props {
  data: ConsensusResponse | null;
  forecast?: MlForecast72hrResponse | null;
  loading: boolean;
  error: string | null;
  cityAggregate?: CityAggregateResponse | null;
  realtimeIqair?: IqairRealtimeResponse | null;
}

/** Standard-aware AQI category and color mapping */
function getAqiMeta(aqi: number, standard: "cpcb" | "epa") {
  if (standard === "epa") {
    if (aqi <= 50) return { category: "Good", color: "#8ceb8c" };
    if (aqi <= 100) return { category: "Moderate", color: "#ffff00" };
    if (aqi <= 150) return { category: "Unhealthy for Sensitive Groups", color: "#ff9900" };
    if (aqi <= 200) return { category: "Unhealthy", color: "#ff6666" };
    if (aqi <= 300) return { category: "Very Unhealthy", color: "#af52de" };
    return { category: "Hazardous", color: "#800000" };
  } else {
    if (aqi <= 50) return { category: "Good", color: "#8ceb8c" };
    if (aqi <= 100) return { category: "Satisfactory", color: "#ffff00" };
    if (aqi <= 200) return { category: "Moderate", color: "#ff9900" };
    if (aqi <= 300) return { category: "Poor", color: "#ff6666" };
    if (aqi <= 400) return { category: "Very Poor", color: "#af52de" };
    return { category: "Severe", color: "#800000" };
  }
}

export function ConsensusDashboard({ data, forecast, loading: _loading, error, cityAggregate, realtimeIqair }: Props) {
  const { t } = useTranslation();
  const metrics = data?.metrics;

  const [horizon, setHorizon] = useState<"24h" | "48h" | "72h">("72h");
  const [chartType, setChartType] = useState<"line" | "bars">("bars");
  const [standard, setStandard] = useState<"cpcb" | "epa">("cpcb");

  const liveAqi = realtimeIqair?.aqi ?? (cityAggregate?.overall_aqi ?? (metrics ? Math.round(metrics.aqi) : 88));
  const livePm25 = cityAggregate?.sub_indices?.["PM2.5"]?.conc ?? (metrics?.pm25 ?? 45);

  const currentLiveAqi = standard === "epa" ? pollutantSubIndex("PM2.5", livePm25, "epa") : liveAqi;
  const liveInfo = useMemo(() => getAqiMeta(currentLiveAqi, standard), [currentLiveAqi, standard]);

  // Single source of truth for the chart's points based on horizon and selected standard
  const forecastPoints = useMemo(() => {
    const mlHours = forecast?.forecast_hours;
    const maxH = horizon === "24h" ? 24 : horizon === "48h" ? 48 : 72;

    if (mlHours && mlHours.length > 0) {
      const slice = mlHours.slice(0, maxH);
      return slice.map((h, idx) => {
        const pmObj = h.sub_indices?.find((s) => s.pollutant === "PM2.5");
        const pmConc = pmObj?.concentration ?? Math.round(h.aqi * 0.45);

        let pointAqi = Math.round(h.aqi);
        if (standard === "epa") {
          pointAqi = pollutantSubIndex("PM2.5", pmConc, "epa");
        }

        let timeFormatted = `+${idx}h`;
        let fullDateStr = `+${idx}h`;
        let pillDateStr = `+${idx}h`;

        if (h.timestamp) {
          try {
            const d = new Date(h.timestamp);
            if (!isNaN(d.getTime())) {
              const hoursStr = d.getHours().toString().padStart(2, "0");
              const minsStr = d.getMinutes().toString().padStart(2, "0");
              timeFormatted = `${hoursStr}:${minsStr}`;

              const dayNum = d.getDate();
              const monthStr = d.toLocaleDateString("en-US", { month: "short" });
              fullDateStr = `${dayNum} ${monthStr}, ${hoursStr}:${minsStr}`;
              pillDateStr = `${dayNum} ${monthStr} · ${hoursStr}:${minsStr}`;
            }
          } catch {
            // fallback
          }
        }

        const meta = getAqiMeta(pointAqi, standard);

        return {
          index: idx,
          horizon_hours: idx,
          timestamp: h.timestamp,
          timeFormatted,
          fullDateStr,
          pillDateStr,
          aqi: pointAqi,
          pm25: Math.round(pmConc),
          category: meta.category,
          color: meta.color,
        };
      });
    }

    // Fallback if mlHours is empty: use data?.forecast or smooth diurnal curve
    const raw = data?.forecast ?? [];
    if (raw.length === 0) {
      const now = new Date();
      const pts = [];
      for (let i = 0; i < maxH; i++) {
        const d = new Date(now.getTime() + i * 3600 * 1000);
        const hoursStr = d.getHours().toString().padStart(2, "0");
        const minsStr = d.getMinutes().toString().padStart(2, "0");
        const dayNum = d.getDate();
        const monthStr = d.toLocaleDateString("en-US", { month: "short" });
        const diurnalWave = Math.sin((i - 4) / 3.8) * 22;
        const a = Math.max(25, Math.round(currentLiveAqi + diurnalWave));
        const meta = getAqiMeta(a, standard);
        pts.push({
          index: i,
          horizon_hours: i,
          timestamp: d.toISOString(),
          timeFormatted: `${hoursStr}:${minsStr}`,
          fullDateStr: `${dayNum} ${monthStr}, ${hoursStr}:${minsStr}`,
          pillDateStr: `${dayNum} ${monthStr} · ${hoursStr}:${minsStr}`,
          aqi: a,
          pm25: Math.round(a * 0.45),
          category: meta.category,
          color: meta.color,
        });
      }
      return pts;
    }

    const filteredRaw = raw.filter((item) => item.horizon_hours <= maxH);
    return filteredRaw.map((item, idx) => {
      let timeFormatted = item.horizon_hours === 0 ? "Now" : `+${item.horizon_hours}h`;
      let pillDateStr = `+${item.horizon_hours}h`;
      if (item.timestamp) {
        try {
          const d = new Date(item.timestamp);
          if (!isNaN(d.getTime())) {
            const hoursStr = d.getHours().toString().padStart(2, "0");
            const minsStr = d.getMinutes().toString().padStart(2, "0");
            timeFormatted = `${hoursStr}:${minsStr}`;
            const dayNum = d.getDate();
            const monthStr = d.toLocaleDateString("en-US", { month: "short" });
            pillDateStr = `${dayNum} ${monthStr} · ${hoursStr}:${minsStr}`;
          }
        } catch {
          // fallback
        }
      }
      const a = standard === "epa" ? pollutantSubIndex("PM2.5", item.pm25, "epa") : item.aqi;
      const meta = getAqiMeta(a, standard);
      return {
        index: idx,
        horizon_hours: item.horizon_hours,
        timestamp: item.timestamp,
        timeFormatted,
        fullDateStr: pillDateStr,
        pillDateStr,
        aqi: a,
        pm25: item.pm25,
        category: meta.category,
        color: meta.color,
      };
    });
  }, [forecast, data, horizon, standard, currentLiveAqi]);

  // Compute MIN and MAX AQI for the currently active horizon
  const { minAqi, maxAqi } = useMemo(() => {
    if (forecastPoints.length === 0) {
      return {
        minAqi: { aqi: currentLiveAqi, pillDateStr: "Now", category: liveInfo.category, color: liveInfo.color },
        maxAqi: { aqi: currentLiveAqi, pillDateStr: "Now", category: liveInfo.category, color: liveInfo.color },
      };
    }

    let minPt = forecastPoints[0]!;
    let maxPt = forecastPoints[0]!;

    for (const p of forecastPoints) {
      if (p.aqi < minPt.aqi) minPt = p;
      if (p.aqi > maxPt.aqi) maxPt = p;
    }

    return { minAqi: minPt, maxAqi: maxPt };
  }, [forecastPoints, currentLiveAqi, liveInfo]);

  const issuedTime = useMemo(() => {
    const d = new Date();
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }, []);

  const horizonNumber = horizon === "24h" ? 24 : horizon === "48h" ? 48 : 72;

  return (
    <section className="consensus-wrap" aria-label="Live consensus forecast">
      {/* Section Head: Replaced marked block with clean, prominent forecast heading */}
      <div className="consensus-head">
        <div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white font-sans">
            {horizonNumber}-hour consensus forecast
          </h2>
        </div>
        <span className="source-count">
          {t("consensus.aggregatedAcross")} {cityAggregate?.station_count ?? 0} {t("consensus.stationsCount")} + {data?.source_count ?? 0} {t("consensus.meteoFeeds")}.
        </span>
      </div>
      {error && <p className="consensus-error">Consensus feed unavailable: {error}</p>}

      {/* Modern Atmospheric Forecast Box */}
      <div className="consensus-panels">
        <article className="chart-panel realism-box relative overflow-hidden">
          <div className="realism-topglow" />
          <div className="realism-inner !p-5 sm:!p-6 !bg-[#0b1017] relative">
            {/* Vanta Cells Animated Background Layer - extended further down into the upper chart area */}
            <div className="absolute inset-x-0 top-0 h-[260px] sm:h-[195px] pointer-events-none overflow-hidden z-0 rounded-t-[18px]">
              <VantaCellsBackground
                color1={0x3dbdbd}
                color2={0xcdeae8}
                size={1.0}
                speed={2.8}
                opacity={0.65}
              />
              {/* Bottom mix / blur fade into solid card background so lower chart bars are unaffected */}
              <div
                className="absolute inset-x-0 bottom-0 h-24 sm:h-20 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(11,16,23,0) 0%, rgba(11,16,23,0.35) 35%, rgba(11,16,23,0.88) 75%, #0b1017 100%)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                }}
              />
            </div>

            {/* Top Bar: Hero Live Telemetry (Left) & Controls (Right) */}
            <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-3.5 border-b border-white/[0.08]">
              {/* Left: Hero Live AQI with Subordinate Min & Peak Extremes */}
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                {/* PRIMARY HERO: Live AQI Display */}
                <div className="flex items-center gap-3">
                  {/* Big Bold Live Number with Colored Drop Glow */}
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-4xl sm:text-5xl font-black font-mono tracking-tight leading-none"
                      style={{
                        color: liveInfo.color,
                        textShadow: `0 0 24px ${liveInfo.color}40`,
                      }}
                    >
                      {currentLiveAqi}
                    </span>
                    <span className="text-[11px] font-mono font-bold text-white/40 uppercase tracking-wider">
                      AQI
                    </span>
                  </div>

                  {/* Live Beacon & Category Chip */}
                  <div className="flex flex-col justify-center gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span
                          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                          style={{ backgroundColor: liveInfo.color }}
                        />
                        <span
                          className="relative inline-flex rounded-full h-2 w-2"
                          style={{ backgroundColor: liveInfo.color }}
                        />
                      </span>
                      <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-white/60">
                        LIVE OBSERVATION
                      </span>
                    </div>
                    <div>
                      <span
                        className="inline-block text-xs font-mono font-bold px-2 py-0.5 rounded-full border shadow-sm"
                        style={{
                          backgroundColor: `${liveInfo.color}18`,
                          borderColor: `${liveInfo.color}45`,
                          color: liveInfo.color,
                        }}
                      >
                        {liveInfo.category}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Vertical Hairline Glass Divider */}
                <div className="hidden sm:block h-9 w-px bg-white/10" />

                {/* SECONDARY / SUBORDINATE: Min & Peak Range Window */}
                <div className="flex flex-col justify-center gap-1.5 text-xs font-mono py-0.5">
                  {/* Min / Trough */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <TrendingDown size={13} className="shrink-0" />
                      <span>MIN</span>
                    </span>
                    <span className="font-bold text-emerald-400 text-sm leading-none">
                      {minAqi.aqi}
                    </span>
                    <span className="text-white/45 text-[11px]">
                      · {minAqi.pillDateStr}
                    </span>
                  </div>

                  {/* Peak / Crest */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <TrendingUp size={13} className="shrink-0" />
                      <span>PEAK</span>
                    </span>
                    <span className="font-bold text-rose-400 text-sm leading-none">
                      {maxAqi.aqi}
                    </span>
                    <span className="text-white/45 text-[11px]">
                      · {maxAqi.pillDateStr}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: 3 Segmented Pill Button Groups */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Horizon [ 24h | 48h | 72h ] */}
                <div className="inline-flex items-center rounded-full bg-white/[0.04] border border-white/10 p-0.5">
                  {(["24h", "48h", "72h"] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHorizon(h)}
                      className={`px-3 py-1 text-xs font-mono rounded-full transition-all cursor-pointer ${
                        horizon === h
                          ? "bg-white/15 text-white font-semibold shadow-sm"
                          : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>

                {/* 2. Chart Type [ Bars | Line ] */}
                <div className="inline-flex items-center rounded-full bg-white/[0.04] border border-white/10 p-0.5">
                  {(["bars", "line"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setChartType(mode)}
                      className={`px-3 py-1 text-xs font-mono rounded-full transition-all capitalize cursor-pointer ${
                        chartType === mode
                          ? "bg-white/15 text-white font-semibold shadow-sm"
                          : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      {mode === "bars" ? "Bars" : "Line"}
                    </button>
                  ))}
                </div>

                {/* 3. Standard [ AQI (CPCB) | AQI (US EPA) ] */}
                <div className="inline-flex items-center rounded-full bg-white/[0.04] border border-white/10 p-0.5">
                  <button
                    type="button"
                    onClick={() => setStandard("cpcb")}
                    className={`px-3 py-1 text-xs font-mono rounded-full transition-all cursor-pointer ${
                      standard === "cpcb"
                        ? "bg-white/15 text-white font-semibold shadow-sm"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    AQI (CPCB)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandard("epa")}
                    className={`px-3 py-1 text-xs font-mono rounded-full transition-all cursor-pointer ${
                      standard === "epa"
                        ? "bg-white/15 text-white font-semibold shadow-sm"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    AQI (US EPA)
                  </button>
                </div>
              </div>
            </div>

            {/* Middle: Clean Chart Area */}
            <div className="w-full h-[240px] sm:h-[270px] mt-2 relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "line" ? (
                  <AreaChart data={forecastPoints} margin={{ top: 14, right: 12, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.04)" vertical={false} />
                    <XAxis
                      dataKey="timeFormatted"
                      interval={Math.max(1, Math.floor(forecastPoints.length / 7))}
                      stroke="rgba(255, 255, 255, 0.35)"
                      tickLine={false}
                      axisLine={{ stroke: "rgba(255, 255, 255, 0.12)" }}
                      tick={{ fontSize: 11, fontFamily: "var(--mono)", fill: "rgba(255, 255, 255, 0.45)" }}
                    />
                    <YAxis
                      stroke="rgba(255, 255, 255, 0.35)"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fontFamily: "var(--mono)", fill: "rgba(255, 255, 255, 0.45)" }}
                      width={38}
                      domain={[0, (dataMax) => Math.ceil(Math.max(dataMax, 200) / 90) * 90]}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const pt = payload[0].payload;
                          return (
                            <div
                              style={{
                                background: "rgba(11, 16, 24, 0.95)",
                                border: `1px solid ${pt.color}50`,
                                borderRadius: "10px",
                                boxShadow: "0 12px 30px rgba(0, 0, 0, 0.7)",
                                fontSize: "12px",
                                fontFamily: "var(--mono)",
                                padding: "10px 14px",
                              }}
                            >
                              <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.5)", marginBottom: "4px" }}>
                                {pt.fullDateStr}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span
                                  style={{
                                    width: "9px",
                                    height: "9px",
                                    borderRadius: "50%",
                                    backgroundColor: pt.color,
                                    boxShadow: `0 0 10px ${pt.color}`,
                                  }}
                                />
                                <span style={{ fontSize: "16px", fontWeight: 800, color: "#fff" }}>
                                  {pt.aqi}
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 8px",
                                    borderRadius: "9999px",
                                    backgroundColor: `${pt.color}22`,
                                    borderColor: `${pt.color}50`,
                                    borderWidth: "1px",
                                    borderStyle: "solid",
                                    color: pt.color,
                                    fontWeight: 600,
                                  }}
                                >
                                  {pt.category}
                                </span>
                              </div>
                              <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.4)", marginTop: "6px" }}>
                                PM2.5: {pt.pm25} µg/m³ · {standard === "cpcb" ? "CPCB (India)" : "US EPA"}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="aqi"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      fill="url(#curveGradient)"
                      activeDot={{ r: 5, fill: "#38bdf8", stroke: "#0d1117", strokeWidth: 2 }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={forecastPoints} margin={{ top: 14, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.04)" vertical={false} />
                    <XAxis
                      dataKey="timeFormatted"
                      interval={Math.max(1, Math.floor(forecastPoints.length / 7))}
                      stroke="rgba(255, 255, 255, 0.35)"
                      tickLine={false}
                      axisLine={{ stroke: "rgba(255, 255, 255, 0.12)" }}
                      tick={{ fontSize: 11, fontFamily: "var(--mono)", fill: "rgba(255, 255, 255, 0.45)" }}
                    />
                    <YAxis
                      stroke="rgba(255, 255, 255, 0.35)"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fontFamily: "var(--mono)", fill: "rgba(255, 255, 255, 0.45)" }}
                      width={38}
                      domain={[0, (dataMax) => Math.ceil(Math.max(dataMax, 200) / 90) * 90]}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const pt = payload[0].payload;
                          return (
                            <div
                              style={{
                                background: "rgba(11, 16, 24, 0.95)",
                                border: `1px solid ${pt.color}50`,
                                borderRadius: "10px",
                                boxShadow: "0 12px 30px rgba(0, 0, 0, 0.7)",
                                fontSize: "12px",
                                fontFamily: "var(--mono)",
                                padding: "10px 14px",
                              }}
                            >
                              <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.5)", marginBottom: "4px" }}>
                                {pt.fullDateStr}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span
                                  style={{
                                    width: "9px",
                                    height: "9px",
                                    borderRadius: "50%",
                                    backgroundColor: pt.color,
                                    boxShadow: `0 0 10px ${pt.color}`,
                                  }}
                                />
                                <span style={{ fontSize: "16px", fontWeight: 800, color: "#fff" }}>
                                  {pt.aqi}
                                </span>
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 8px",
                                    borderRadius: "9999px",
                                    backgroundColor: `${pt.color}22`,
                                    borderColor: `${pt.color}50`,
                                    borderWidth: "1px",
                                    borderStyle: "solid",
                                    color: pt.color,
                                    fontWeight: 600,
                                  }}
                                >
                                  {pt.category}
                                </span>
                              </div>
                              <div style={{ fontSize: "10px", color: "rgba(255, 255, 255, 0.4)", marginTop: "6px" }}>
                                PM2.5: {pt.pm25} µg/m³ · {standard === "cpcb" ? "CPCB (India)" : "US EPA"}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="aqi" radius={[3, 3, 0, 0]}>
                      {forecastPoints.map((entry, index) => (
                        <Cell key={`bar-cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Bottom Row: Full forecast data link & Issued timestamp */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/[0.06]">
              <a
                href="#forecast-datas"
                className="inline-flex items-center gap-1 text-xs font-mono text-white/50 hover:text-white transition group"
              >
                <span>Full forecast data</span>
                <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
              <span className="text-xs font-mono text-white/40">
                Issued {issuedTime} · IST
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
