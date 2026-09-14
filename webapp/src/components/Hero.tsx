import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Thermometer,
  Droplets,
  Wind,
  CloudRain,
  RefreshCw,
  Share2,
  Check,
} from "lucide-react";
import type { Panel } from "@/hooks/useForecastData";
import { int } from "@/lib/format";
import type {
  CityAggregateResponse,
  ConsensusResponse,
  ForecastResponse,
  HourlyForecast,
} from "@/lib/types";
import type { PageType } from "@/components/Rail";
import delhiSkyline from "@/assets/delhi_skyline.png";
import boyCharacter from "@/assets/boy_character.png";
import { MovingClouds } from "@/components/MovingClouds";

export interface HeroProps {
  forecast: Panel<ForecastResponse | any>;
  hour: HourlyForecast | null;
  cursor: number;
  consensus?: ConsensusResponse | null;
  cityAggregate?: CityAggregateResponse | null;
  realtime?: {
    aqi: number;
    category: string;
    color: string;
    pm25: number | null;
    pm10: number | null;
    no2: number | null;
    o3: number | null;
    so2: number | null;
    co: number | null;
    updated: string | null;
    temp: number | null;
    wind: number | null;
    humidity: number | null;
    pressure: number | null;
    source: string;
  } | null;
  weatherapi?: {
    temp: number | null;
    feels_like: number | null;
    humidity: number | null;
    wind_kph: number | null;
    wind_dir: string | null;
    condition: string | null;
    air_quality: Record<string, number | null>;
    last_updated: string | null;
    precip_mm?: number | null;
  } | null;
  activeVideo?: number;
  onVideoChange?: (index: number) => void;
  ready?: boolean;
  currentPage?: PageType;
  onPageChange?: (page: PageType) => void;
}

interface ScaleBand {
  name: string;
  min: number;
  max: number;
  color: string;
  pctWidth: number;
}

const CPCB_BANDS: readonly ScaleBand[] = [
  { name: "Good", min: 0, max: 50, color: "#3fbf6f", pctWidth: 10 },
  { name: "Satisfactory", min: 51, max: 100, color: "#a8c256", pctWidth: 10 },
  { name: "Moderate", min: 101, max: 200, color: "#e8a13c", pctWidth: 20 },
  { name: "Poor", min: 201, max: 300, color: "#e2634a", pctWidth: 20 },
  { name: "Very Poor", min: 301, max: 400, color: "#d04a6e", pctWidth: 20 },
  { name: "Severe", min: 401, max: 500, color: "#a34ac9", pctWidth: 20 },
] as const;

const EPA_BANDS: readonly ScaleBand[] = [
  { name: "Good", min: 0, max: 50, color: "#3fbf6f", pctWidth: 10 },
  { name: "Moderate", min: 51, max: 100, color: "#a8c256", pctWidth: 10 },
  { name: "Unhealthy for Sensitive", min: 101, max: 150, color: "#e8a13c", pctWidth: 10 },
  { name: "Unhealthy", min: 151, max: 200, color: "#e2634a", pctWidth: 10 },
  { name: "Very Unhealthy", min: 201, max: 300, color: "#d04a6e", pctWidth: 20 },
  { name: "Hazardous", min: 301, max: 500, color: "#a34ac9", pctWidth: 40 },
] as const;

export function Hero({
  hour,
  cursor,
  consensus,
  cityAggregate,
  realtime,
  weatherapi,
}: HeroProps) {
  const [scaleMode, setScaleMode] = useState<"cpcb" | "epa">("cpcb");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLiveNow = cursor === 0;

  // Derive current AQI value
  const displayAqi = useMemo(() => {
    if (isLiveNow && realtime?.aqi !== undefined && realtime.aqi !== null) {
      return realtime.aqi;
    }
    if (cityAggregate?.overall_aqi) return cityAggregate.overall_aqi;
    if (hour?.aqi) return hour.aqi;
    if (consensus?.metrics?.aqi) return Math.round(consensus.metrics.aqi);
    return 145;
  }, [isLiveNow, realtime, cityAggregate, hour, consensus]);

  // Derive active category & accent color based on active scale mode
  const currentBandInfo = useMemo(() => {
    const bands = scaleMode === "cpcb" ? CPCB_BANDS : EPA_BANDS;
    for (const b of bands) {
      if (displayAqi <= b.max) return { category: b.name, color: b.color };
    }
    const last = bands[bands.length - 1];
    return { category: last.name, color: last.color };
  }, [displayAqi, scaleMode]);

  const categoryAccent = currentBandInfo.color;
  const categoryName = currentBandInfo.category;

  // Dominant pollutant & concentration
  const dominantPollutant = useMemo(() => {
    return cityAggregate?.dominant_pollutant ?? hour?.dominant_pollutant ?? "PM2.5";
  }, [cityAggregate, hour]);

  const dominantConcentration = useMemo(() => {
    if (realtime?.pm25 !== null && realtime?.pm25 !== undefined) {
      return Math.round(realtime.pm25);
    }
    if (cityAggregate?.sub_indices?.["PM2.5"]?.conc !== undefined) {
      return Math.round(cityAggregate.sub_indices["PM2.5"].conc);
    }
    const pmSub = hour?.sub_indices?.find((s) => s.pollutant === "PM2.5");
    if (pmSub?.concentration !== undefined) {
      return Math.round(pmSub.concentration);
    }
    return 148;
  }, [realtime, cityAggregate, hour]);

  // Weather metrics
  const temperature = useMemo(() => {
    if (weatherapi?.temp !== null && weatherapi?.temp !== undefined) {
      return Math.round(weatherapi.temp);
    }
    if (realtime?.temp !== null && realtime?.temp !== undefined) {
      return Math.round(realtime.temp);
    }
    if (hour?.temperature_2m_c !== null && hour?.temperature_2m_c !== undefined) {
      return Math.round(hour.temperature_2m_c);
    }
    return 31;
  }, [weatherapi, realtime, hour]);

  const conditionLabel = useMemo(() => {
    if (weatherapi?.condition) return weatherapi.condition;
    if (displayAqi > 300) return "Dense Haze";
    if (displayAqi > 200) return "Very Unhealthy Haze";
    if (displayAqi > 100) return "Haze";
    return "Clear / Real-time";
  }, [weatherapi, displayAqi]);

  const humidity = useMemo(() => {
    if (weatherapi?.humidity !== null && weatherapi?.humidity !== undefined) {
      return Math.round(weatherapi.humidity);
    }
    if (realtime?.humidity !== null && realtime?.humidity !== undefined) {
      return Math.round(realtime.humidity);
    }
    if (hour?.relative_humidity_pct !== null && hour?.relative_humidity_pct !== undefined) {
      return Math.round(hour.relative_humidity_pct);
    }
    return 68;
  }, [weatherapi, realtime, hour]);

  const windSpeed = useMemo(() => {
    if (weatherapi?.wind_kph !== null && weatherapi?.wind_kph !== undefined) {
      return Math.round(weatherapi.wind_kph);
    }
    if (realtime?.wind !== null && realtime?.wind !== undefined) {
      return Math.round(realtime.wind * 3.6);
    }
    if (hour?.wind_speed_ms !== null && hour?.wind_speed_ms !== undefined) {
      return Math.round(hour.wind_speed_ms * 3.6);
    }
    return 32;
  }, [weatherapi, realtime, hour]);

  const precip = useMemo(() => {
    if (weatherapi?.precip_mm !== undefined && weatherapi?.precip_mm !== null) {
      return `${Math.round(weatherapi.precip_mm)}% precip`;
    }
    if (hour?.precipitation_mm !== undefined && hour?.precipitation_mm !== null) {
      return `${Math.round(hour.precipitation_mm * 10)}% precip`;
    }
    return "0% precip";
  }, [weatherapi, hour]);

  // Formatted timestamp
  const updatedTimestamp = useMemo(() => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      window.location.reload();
    }, 600);
  }, []);

  // Share handler
  const handleShare = useCallback(() => {
    if (navigator.share) {
      navigator
        .share({
          title: "Delhi NCR Air Quality Live Status",
          text: `Current Delhi NCR AQI is ${int(displayAqi)} (${categoryName}).`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [displayAqi, categoryName]);

  // Pointer position clamped 0..100%
  const pointerPercentage = Math.min(100, Math.max(0, (displayAqi / 500) * 100));

  const activeBands = scaleMode === "cpcb" ? CPCB_BANDS : EPA_BANDS;

  return (
    <div className="relative w-full min-h-[calc(100vh-5rem)] flex flex-col justify-center items-center py-12 md:py-16 px-3 sm:px-6 md:px-10 lg:px-12 bg-[#08090c]">
      {/* ── AMBIENT DARK BACKDROP RADIAL GLOW ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 75% 60% at 50% 45%, color-mix(in srgb, ${categoryAccent} 12%, transparent) 0%, transparent 80%)`,
        }}
      />

      {/* ── WRAPPER ENCOMPASSING HEADER + CARD ── */}
      <div className="relative w-full max-w-[1340px] flex flex-col gap-3 z-10">
        {/* ── 1. HEADER ROW (NOW OUTSIDE/ABOVE THE BOX AT THE PRECISE CUT LINE) ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-1">
          {/* Left: City Title & Subtitle */}
          <div>
            <h2 className="text-[1.35rem] md:text-[1.55rem] font-bold text-[#f2f4f8] tracking-tight flex items-center gap-2.5">
              <span>Delhi NCR</span>
              {isLiveNow && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-mono tracking-wider font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              )}
            </h2>
            <p className="text-[#9aa3b2] text-xs md:text-sm mt-0.5 font-medium">
              Last updated: {updatedTimestamp} (Local Time)
            </p>
          </div>

          {/* Right: Segmented Toggle & Action Buttons */}
          <div className="flex items-center gap-2.5">
            {/* Segmented scale toggle */}
            <div className="inline-flex p-1 rounded-xl bg-black/50 border border-white/[0.08] backdrop-blur-md">
              <button
                type="button"
                onClick={() => setScaleMode("cpcb")}
                className={`px-3.5 py-1.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${
                  scaleMode === "cpcb"
                    ? "bg-white/15 text-[#f2f4f8] shadow-sm"
                    : "text-[#9aa3b2] hover:text-[#f2f4f8]"
                }`}
              >
                AQI (CPCB)
              </button>
              <button
                type="button"
                onClick={() => setScaleMode("epa")}
                className={`px-3.5 py-1.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${
                  scaleMode === "epa"
                    ? "bg-white/15 text-[#f2f4f8] shadow-sm"
                    : "text-[#9aa3b2] hover:text-[#f2f4f8]"
                }`}
              >
                AQI (US EPA)
              </button>
            </div>

            {/* Refresh circular button */}
            <button
              type="button"
              onClick={handleRefresh}
              title="Refresh live data"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 border border-white/[0.08] text-[#9aa3b2] hover:text-[#f2f4f8] hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={15} className={isRefreshing ? "animate-spin text-white" : ""} />
            </button>

            {/* Share circular button */}
            <button
              type="button"
              onClick={handleShare}
              title="Share air quality report"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-black/40 border border-white/[0.08] text-[#9aa3b2] hover:text-[#f2f4f8] hover:bg-white/10 transition-colors relative"
            >
              {copied ? <Check size={15} className="text-emerald-400" /> : <Share2 size={15} />}
            </button>
          </div>
        </div>

        {/* ── 2. MAIN HERO BOX (STARTS DIRECTLY AT THE USER-MARKED WHITE LINE) ── */}
        <motion.div
          layout
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full rounded-[20px] overflow-hidden shadow-2xl p-6 sm:p-8 md:p-9 lg:p-10 transition-all duration-700 min-h-[350px] flex flex-col justify-between"
          style={{
            background: `linear-gradient(180deg, #0a0b0d 0%, color-mix(in srgb, ${categoryAccent} 16%, #111318) 55%, ${categoryAccent} 130%)`,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: `0 24px 60px -15px rgba(0, 0, 0, 0.85), 0 0 45px -12px color-mix(in srgb, ${categoryAccent} 22%, transparent)`,
          }}
        >
          {/* ── REALISTIC DRIFTING CLOUDS (ACROSS UPPER SKY BAND) ── */}
          <MovingClouds accentColor={categoryAccent} />

          {/* ── DELHI MONUMENTS SKYLINE SILHOUETTE ── */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[115px] sm:h-[135px] md:h-[155px] opacity-45 pointer-events-none z-[1] overflow-hidden select-none"
            aria-hidden="true"
          >
            <img
              src={delhiSkyline}
              alt="Delhi NCR Skyline"
              className="w-full h-full object-fill object-bottom pointer-events-none"
            />
          </div>

          {/* ── 3D BOY CHARACTER (HERO MASCOT) ── */}
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-[15] pointer-events-none transition-all duration-500 flex flex-col items-center"
            style={{
              left: "47%",
              bottom: "74px",
              transform: "translateX(-50%)",
            }}
            aria-hidden="true"
          >
            {/* Contact drop shadow on scale bar */}
            <div className="w-20 h-2.5 rounded-[100%] bg-black/60 blur-[3.5px] absolute -bottom-0.5 left-1/2 -translate-x-1/2" />

            <img
              src={boyCharacter}
              alt="AQI Guide Character"
              className="h-[170px] sm:h-[190px] md:h-[210px] w-auto object-contain drop-shadow-[0_14px_28px_rgba(0,0,0,0.65)]"
            />
          </motion.div>

          {/* ── HERO BODY ROW: AQI METRIC STACK + WEATHER CARD ── */}
          <div className="relative z-20 flex flex-wrap items-center justify-between gap-6 my-2">
            {/* Left: AQI Metric Stack */}
            <div className="flex flex-col gap-2">
              {/* Live AQI status indicator pill */}
              <div className="inline-flex items-center gap-2 w-fit px-3 py-0.5 rounded-full text-xs font-mono font-medium tracking-wide uppercase bg-black/30 border border-white/[0.08] text-[#9aa3b2]">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: categoryAccent,
                    boxShadow: `0 0 10px ${categoryAccent}`,
                  }}
                />
                <span className="text-[#f2f4f8] font-semibold">Live AQI</span>
                <span className="opacity-40">·</span>
                <span>{isLiveNow ? "Continuous Monitor" : `Forecast +${cursor}h`}</span>
              </div>

              {/* Large Numerical Display */}
              <div className="flex items-baseline gap-4 mt-0.5">
                <span
                  className="text-[3.8rem] sm:text-[4.4rem] md:text-[4.8rem] font-[800] font-mono tracking-[-0.03em] leading-none"
                  style={{
                    color: categoryAccent,
                    textShadow: `0 0 45px ${categoryAccent}70, 0 3px 12px rgba(0,0,0,0.8)`,
                  }}
                >
                  {int(displayAqi)}
                </span>
                <span className="text-[#9aa3b2] text-sm md:text-base font-semibold font-mono uppercase tracking-wider">
                  {scaleMode === "cpcb" ? "AQI (CPCB)" : "AQI (US EPA)"}
                </span>
              </div>

              {/* Verdict line */}
              <div className="flex items-center gap-2.5 text-base md:text-lg font-medium text-[#f2f4f8] mt-0.5">
                <span>Air quality is</span>
                <span
                  className="px-3.5 py-0.5 rounded-full text-xs md:text-sm font-semibold tracking-wide border transition-all"
                  style={{
                    borderColor: categoryAccent,
                    color: categoryAccent,
                    backgroundColor: `color-mix(in srgb, ${categoryAccent} 15%, transparent)`,
                    boxShadow: `0 0 14px ${categoryAccent}35`,
                  }}
                >
                  {categoryName}
                </span>
              </div>

              {/* Dominant Pollutant Caption */}
              <p className="text-[#9aa3b2] text-xs md:text-sm font-mono mt-0.5">
                Dominant: <strong className="text-[#f2f4f8] font-bold">{dominantPollutant}</strong> ·{" "}
                <span>{dominantConcentration} µg/m³</span>
              </p>
            </div>

            {/* Right: Glass Weather Card */}
            <div
              className="rounded-[16px] p-4 sm:p-5 md:p-6 min-w-[250px] md:min-w-[280px] flex flex-col justify-between gap-3 backdrop-blur-md transition-transform hover:scale-[1.02]"
              style={{
                background: "rgba(10, 11, 13, 0.42)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
              }}
            >
              {/* Top row: Thermometer icon + large temperature */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2.5 text-2xl md:text-3xl font-bold text-[#f2f4f8] font-mono">
                  <Thermometer size={24} className="text-amber-400" />
                  {temperature} °C
                </span>
                <span className="text-xs font-mono text-[#9aa3b2] uppercase tracking-wider font-semibold">
                  Weather
                </span>
              </div>

              {/* Middle: Condition label */}
              <div className="text-sm md:text-base font-semibold text-[#f2f4f8] tracking-wide">
                {conditionLabel}
              </div>

              {/* Bottom row: Inline stat row with Lucide icons */}
              <div className="flex items-center justify-between gap-4 text-xs font-mono text-[#9aa3b2] pt-2 border-t border-white/[0.08]">
                {/* Humidity */}
                <div className="flex items-center gap-1.5" title="Relative Humidity">
                  <Droplets size={14} className="text-sky-400" />
                  <span>{humidity}%</span>
                </div>

                {/* Wind Speed */}
                <div className="flex items-center gap-1.5" title="Wind Speed">
                  <Wind size={14} className="text-teal-400" />
                  <span>{windSpeed} km/h</span>
                </div>

                {/* Precipitation */}
                <div className="flex items-center gap-1.5" title="Precipitation">
                  <CloudRain size={14} className="text-indigo-400" />
                  <span>{precip}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── BOTTOM: AQI SEVERITY SCALE BAR ── */}
          <div className="relative z-20 mt-6 pt-2">
            {/* Labels row: Proportional category labels */}
            <div className="flex w-full text-xs md:text-sm font-mono font-medium text-[#9aa3b2] mb-2.5 px-1">
              {activeBands.map((band) => {
                const isCurrent = band.name.toLowerCase() === categoryName.toLowerCase();
                return (
                  <div
                    key={band.name}
                    style={{ width: `${band.pctWidth}%` }}
                    className={`text-center px-1 transition-all ${
                      isCurrent
                        ? "font-bold text-white scale-105"
                        : "text-[#9aa3b2]"
                    }`}
                  >
                    {band.name}
                  </div>
                );
              })}
            </div>

            {/* Ramp bar: 8px tall track with 6 colored segments */}
            <div className="relative w-full h-[9px] rounded-full flex overflow-visible shadow-inner bg-black/60">
              {activeBands.map((band, idx) => (
                <div
                  key={band.name}
                  style={{
                    width: `${band.pctWidth}%`,
                    backgroundColor: band.color,
                    borderTopLeftRadius: idx === 0 ? "9999px" : "0",
                    borderBottomLeftRadius: idx === 0 ? "9999px" : "0",
                    borderTopRightRadius: idx === activeBands.length - 1 ? "9999px" : "0",
                    borderBottomRightRadius: idx === activeBands.length - 1 ? "9999px" : "0",
                  }}
                  className="h-full transition-colors duration-300"
                />
              ))}

              {/* Pointer Marker */}
              <motion.div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${pointerPercentage}%`,
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                  zIndex: 30,
                }}
                animate={{ left: `${pointerPercentage}%` }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                className="flex flex-col items-center"
              >
                {/* Floating dark pill with exact numeric score */}
                <div className="mb-2.5 px-2.5 py-0.5 rounded-md bg-[#0a0b0d]/95 border border-white/20 text-[#f2f4f8] text-xs font-mono font-extrabold shadow-xl whitespace-nowrap">
                  {int(displayAqi)}
                </div>

                {/* 14px Indicator dot with double ring shadow */}
                <div
                  className="w-[14px] h-[14px] rounded-full bg-white border-2 border-[#0a0b0d]"
                  style={{
                    boxShadow:
                      "0 0 0 2px rgba(255, 255, 255, 0.45), 0 2px 8px rgba(0, 0, 0, 0.85)",
                  }}
                />
              </motion.div>
            </div>

            {/* Ticks row: Numeric cutoff labels */}
            <div className="relative w-full text-[11px] md:text-xs font-mono text-[#9aa3b2] mt-2.5 h-5">
              <span className="absolute left-0 -translate-x-0">0</span>
              <span className="absolute left-[10%] -translate-x-1/2">50</span>
              <span className="absolute left-[20%] -translate-x-1/2">100</span>
              <span className="absolute left-[40%] -translate-x-1/2">200</span>
              <span className="absolute left-[60%] -translate-x-1/2">300</span>
              <span className="absolute left-[80%] -translate-x-1/2">400</span>
              <span className="absolute right-0 translate-x-0">500</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
