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
  MapPin,
} from "lucide-react";
import type { Panel } from "@/hooks/useForecastData";
import { int } from "@/lib/format";
import { pollutantSubIndex } from "@/lib/aqi";
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
import { useTheme } from "@/context/ThemeContext";
import { useTranslation } from "@/i18n";

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
  /** ONE app-wide station selection — when set, the live panel shows THAT station */
  selectedStation?: { uid: string; name: string; aqi: number; category: string; dominant_pollutant: string; pollutants?: Partial<Record<string, number>>; weather?: { temperature?: number; humidity?: number; wind_speed?: number; wind_direction?: number } } | null;
  stationsLoading?: boolean;
}

interface ScaleBand {
  name: string;
  min: number;
  max: number;
  color: string;
  pctWidth: number;
}

const CPCB_BANDS: readonly ScaleBand[] = [
  { name: "hero.categories.good", min: 0, max: 50, color: "#3fbf6f", pctWidth: 10 },
  { name: "hero.categories.satisfactory", min: 51, max: 100, color: "#a8c256", pctWidth: 10 },
  { name: "hero.categories.moderate", min: 101, max: 200, color: "#e8a13c", pctWidth: 20 },
  { name: "hero.categories.poor", min: 201, max: 300, color: "#e2634a", pctWidth: 20 },
  { name: "hero.categories.veryPoor", min: 301, max: 400, color: "#d04a6e", pctWidth: 20 },
  { name: "hero.categories.severe", min: 401, max: 500, color: "#a34ac9", pctWidth: 20 },
] as const;

const EPA_BANDS: readonly ScaleBand[] = [
  { name: "hero.categories.good", min: 0, max: 50, color: "#3fbf6f", pctWidth: 10 },
  { name: "hero.categories.moderate", min: 51, max: 100, color: "#a8c256", pctWidth: 10 },
  { name: "hero.categories.unhealthySensitive", min: 101, max: 150, color: "#e8a13c", pctWidth: 10 },
  { name: "hero.categories.unhealthy", min: 151, max: 200, color: "#e2634a", pctWidth: 10 },
  { name: "hero.categories.veryUnhealthy", min: 201, max: 300, color: "#d04a6e", pctWidth: 20 },
  { name: "hero.categories.hazardous", min: 301, max: 500, color: "#a34ac9", pctWidth: 40 },
] as const;

export function Hero({
  hour,
  cursor,
  consensus,
  cityAggregate,
  realtime,
  weatherapi,
  selectedStation,
}: HeroProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isLight = theme === "light";
  const [scaleMode, setScaleMode] = useState<"cpcb" | "epa">("cpcb");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLiveNow = cursor === 0;

  // Station-first live values: when the user picked a station (header picker),
  // the panel shows THAT station's sensor reading; otherwise the city aggregate.
  // Raw sensor concentrations (µg/m³) are kept alongside so the US-EPA toggle
  // can RECOMPUTE the AQI with EPA breakpoints instead of just relabeling.
  const stationConcs = selectedStation?.pollutants ?? null;

  const displayAqi = useMemo(() => {
    // US-EPA mode: recompute from the raw concentrations with EPA breakpoints
    if (scaleMode === "epa") {
      const subs: number[] = [];
      if (stationConcs) {
        for (const [p, c] of Object.entries(stationConcs)) {
          if (typeof c === "number" && c > 0 && p !== "CO") {
            subs.push(pollutantSubIndex(p, c, "epa"));
          }
        }
      }
      if (subs.length > 0) return Math.max(...subs);
      // no raw concentrations available (city aggregate): convert PM2.5 via EPA
      const pm25 = realtime?.pm25 ?? cityAggregate?.sub_indices?.["PM2.5"]?.conc;
      if (pm25 != null) return pollutantSubIndex("PM2.5", pm25, "epa");
      // last resort: show the CPCB number rather than a wrong EPA number
    }
    if (isLiveNow && selectedStation?.aqi != null) {
      return selectedStation.aqi;
    }
    if (isLiveNow && realtime?.aqi !== undefined && realtime.aqi !== null) {
      return realtime.aqi;
    }
    if (cityAggregate?.overall_aqi) return cityAggregate.overall_aqi;
    if (hour?.aqi) return hour.aqi;
    if (consensus?.metrics?.aqi) return Math.round(consensus.metrics.aqi);
    return 145;
  }, [scaleMode, stationConcs, isLiveNow, selectedStation, realtime, cityAggregate, hour, consensus]);

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
  const categoryName = t(currentBandInfo.category);

  // Dominant pollutant & concentration — station-first, then city aggregate
  const dominantPollutant = useMemo(() => {
    return (selectedStation?.dominant_pollutant as string | undefined)
      ?? cityAggregate?.dominant_pollutant
      ?? hour?.dominant_pollutant
      ?? "PM2.5";
  }, [selectedStation, cityAggregate, hour]);

  const dominantConcentration = useMemo(() => {
    const stDominant = selectedStation?.dominant_pollutant as string | undefined;
    const stConc = stDominant ? selectedStation?.pollutants?.[stDominant] : undefined;
    if (stConc != null) return Math.round(stConc);
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
  }, [selectedStation, realtime, cityAggregate, hour]);

  // Weather metrics — station's own sensor weather first, then city feeds
  const temperature = useMemo(() => {
    const stTemp = selectedStation?.weather?.temperature;
    if (stTemp != null) return Math.round(stTemp);
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
  }, [selectedStation, weatherapi, realtime, hour]);

  const conditionLabel = useMemo(() => {
    // The backend sentinel "Clear / Real-time" must not leak English into a
    // translated UI — treat it as "clear now"; other provider conditions pass through.
    const raw = weatherapi?.condition;
    if (raw && raw !== "Clear / Real-time") return raw;
    if (displayAqi > 300) return t("hero.denseHaze");
    if (displayAqi > 200) return t("hero.veryUnhealthyHaze");
    if (displayAqi > 100) return t("hero.haze");
    return t("hero.clearNow");
  }, [weatherapi, displayAqi, t]);

  const humidity = useMemo(() => {
    const stHum = selectedStation?.weather?.humidity;
    if (stHum != null) return Math.round(stHum);
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
  }, [selectedStation, weatherapi, realtime, hour]);

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
    <div className="relative w-full flex flex-col items-center pt-[66px] sm:pt-[72px] pb-16 sm:pb-20 px-3 sm:px-6 md:px-10 lg:px-12 bg-transparent">
      {/* ── AMBIENT DARK BACKDROP RADIAL GLOW ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 75% 60% at 50% 45%, color-mix(in srgb, ${categoryAccent} 12%, transparent) 0%, transparent 80%)`,
        }}
      />

      {/* ── WRAPPER ENCOMPASSING HEADER + CARD ── */}
      <div className="relative w-full max-w-[1240px] flex flex-col gap-2 z-10">
        {/* ── 1. HEADER ROW (NOW OUTSIDE/ABOVE THE BOX AT THE PRECISE CUT LINE) ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-1">
          {/* Left: City Title & Subtitle */}
          <div>
            <h2 className={`text-[1.35rem] md:text-[1.55rem] font-bold tracking-tight flex items-center gap-2.5 ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>
              <span>Delhi NCR</span>
              {isLiveNow && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-mono tracking-wider font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </h2>
            <p className={`text-xs md:text-sm mt-0.5 font-medium ${isLight ? "text-slate-600" : "text-[#9aa3b2]"}`}>
              {t("hero.lastUpdated")} {updatedTimestamp} ({t("hero.localTime")})
              {selectedStation && (
                <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${isLight ? "bg-sky-500/10 text-sky-700 border border-sky-500/25" : "bg-sky-500/10 text-sky-400 border border-sky-500/30"}`}>
                  <MapPin size={9} />
                  {selectedStation.name} · {t("header.stationSensor")}
                </span>
              )}
              {!selectedStation && (
                <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono ${isLight ? "bg-slate-500/10 text-slate-600 border border-slate-500/25" : "bg-white/5 text-[#9aa3b2] border border-white/15"}`}>
                  {t("hero.cityAggregate")}
                </span>
              )}
            </p>
          </div>

          {/* Right: Segmented Toggle & Action Buttons */}
          <div className="flex items-center gap-2.5">
            {/* Segmented scale toggle */}
            <div
              className="inline-flex p-1 rounded-xl backdrop-blur-md transition-colors"
              style={{
                background: isLight ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.5)",
                border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.08)"}`,
                boxShadow: isLight ? "0 2px 8px rgba(15, 23, 42, 0.05)" : "none",
              }}
            >
              <button
                type="button"
                onClick={() => setScaleMode("cpcb")}
                className={`px-3.5 py-1.5 text-xs md:text-sm font-semibold rounded-lg transition-all ${
                  scaleMode === "cpcb"
                    ? isLight
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white/15 text-[#f2f4f8] shadow-sm"
                    : isLight
                    ? "text-slate-600 hover:text-slate-900"
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
                    ? isLight
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white/15 text-[#f2f4f8] shadow-sm"
                    : isLight
                    ? "text-slate-600 hover:text-slate-900"
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
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                isLight
                  ? "bg-white/90 border border-slate-200 text-slate-700 hover:text-slate-950 hover:bg-white shadow-sm"
                  : "bg-black/40 border border-white/[0.08] text-[#9aa3b2] hover:text-[#f2f4f8] hover:bg-white/10"
              }`}
            >
              <RefreshCw size={15} className={isRefreshing ? "animate-spin" : ""} />
            </button>

            {/* Share circular button */}
            <button
              type="button"
              onClick={handleShare}
              title="Share air quality report"
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all relative ${
                isLight
                  ? "bg-white/90 border border-slate-200 text-slate-700 hover:text-slate-950 hover:bg-white shadow-sm"
                  : "bg-black/40 border border-white/[0.08] text-[#9aa3b2] hover:text-[#f2f4f8] hover:bg-white/10"
              }`}
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Share2 size={15} />}
            </button>
          </div>
        </div>

        {/* ── 2. MAIN HERO BOX (STARTS DIRECTLY AT THE USER-MARKED WHITE LINE) ── */}
        <motion.div
          layout
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full rounded-[18px] overflow-hidden shadow-2xl p-4 sm:p-5 md:p-6 pb-3 sm:pb-3.5 md:pb-3.5 transition-all duration-700 flex flex-col justify-between"
          style={{
            background: isLight
              ? `linear-gradient(180deg, #FFFFFF 0%, color-mix(in srgb, ${categoryAccent} 10%, #F8FAFC) 55%, color-mix(in srgb, ${categoryAccent} 22%, #E2E8F0) 100%)`
              : `linear-gradient(180deg, #0a0b0d 0%, color-mix(in srgb, ${categoryAccent} 16%, #111318) 55%, ${categoryAccent} 130%)`,
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.1)" : "rgba(255, 255, 255, 0.08)"}`,
            boxShadow: isLight
              ? `0 20px 50px -15px rgba(15, 23, 42, 0.09), 0 0 35px -10px color-mix(in srgb, ${categoryAccent} 25%, transparent)`
              : `0 24px 60px -15px rgba(0, 0, 0, 0.85), 0 0 45px -12px color-mix(in srgb, ${categoryAccent} 22%, transparent)`,
          }}
        >
          {/* ── REALISTIC DRIFTING CLOUDS (ACROSS UPPER SKY BAND) ── */}
          <MovingClouds accentColor={categoryAccent} />

          {/* ── DELHI MONUMENTS SKYLINE SILHOUETTE ── */}
          <div
            className={`absolute bottom-0 left-0 right-0 h-[75px] sm:h-[90px] md:h-[105px] pointer-events-none z-[1] overflow-hidden select-none transition-opacity ${isLight ? "opacity-20" : "opacity-45"}`}
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
              bottom: "44px",
              transform: "translateX(-50%)",
            }}
            aria-hidden="true"
          >
            {/* Contact drop shadow on scale bar */}
            <div className="w-16 h-2 rounded-[100%] bg-black/60 blur-[3px] absolute -bottom-0.5 left-1/2 -translate-x-1/2" />

            <img
              src={boyCharacter}
              alt="AQI Guide Character"
              className="h-[130px] sm:h-[145px] md:h-[165px] w-auto object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.65)]"
            />
          </motion.div>

          {/* ── HERO BODY ROW: AQI METRIC STACK + WEATHER CARD ── */}
          <div className="relative z-20 flex flex-wrap items-center justify-between gap-4 my-0.5">
            {/* Left: AQI Metric Stack */}
            <div className="flex flex-col gap-2">
              {/* Live AQI status indicator pill */}
              <div
                className={`inline-flex items-center gap-2 w-fit px-3 py-0.5 rounded-full text-xs font-mono font-medium tracking-wide uppercase ${
                  isLight
                    ? "bg-white/80 border border-slate-200 text-slate-700 shadow-sm"
                    : "bg-black/30 border border-white/[0.08] text-[#9aa3b2]"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: categoryAccent,
                    boxShadow: `0 0 10px ${categoryAccent}`,
                  }}
                />
                <span className={`font-semibold ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>{t("hero.liveAqi")}</span>
                <span className="opacity-40">·</span>
                <span>{isLiveNow ? t("hero.continuousMonitor") : t("hero.forecastPlus", { h: cursor })}</span>
              </div>

              {/* Large Numerical Display */}
              <div className="flex items-baseline gap-3 mt-0.5">
                <span
                  className="text-[3.1rem] sm:text-[3.6rem] md:text-[4rem] font-[800] font-mono tracking-[-0.03em] leading-none"
                  style={{
                    color: categoryAccent,
                    textShadow: isLight
                      ? `0 0 25px ${categoryAccent}30, 0 2px 8px rgba(0,0,0,0.08)`
                      : `0 0 35px ${categoryAccent}70, 0 3px 12px rgba(0,0,0,0.8)`,
                  }}
                >
                  {int(displayAqi)}
                </span>
                <span className={`text-xs md:text-sm font-semibold font-mono uppercase tracking-wider ${isLight ? "text-slate-600" : "text-[#9aa3b2]"}`}>
                  {scaleMode === "cpcb" ? "AQI (CPCB)" : "AQI (US EPA)"}
                </span>
              </div>

              {/* Verdict line */}
              <div className={`flex items-center gap-2 text-sm md:text-base font-medium mt-0.5 ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>
                <span>{t("hero.airQualityIs")}</span>
                <span
                  className="px-3 py-0.5 rounded-full text-xs font-semibold tracking-wide border transition-all"
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
              <p className={`text-xs font-mono mt-0.5 ${isLight ? "text-slate-600" : "text-[#9aa3b2]"}`}>
                {t("hero.dominant")}: <strong className={`font-bold ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>{dominantPollutant}</strong> ·{" "}
                <span>{dominantConcentration} µg/m³</span>
              </p>
            </div>

            {/* Right: Glass Weather Card */}
            <div
              className="rounded-[14px] p-3 sm:p-3.5 md:p-4 min-w-[215px] md:min-w-[240px] flex flex-col justify-between gap-2 backdrop-blur-md transition-transform hover:scale-[1.02]"
              style={{
                background: isLight ? "rgba(255, 255, 255, 0.85)" : "rgba(10, 11, 13, 0.42)",
                border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.1)" : "rgba(255, 255, 255, 0.08)"}`,
                boxShadow: isLight ? "0 8px 22px rgba(15, 23, 42, 0.06)" : "0 10px 28px rgba(0, 0, 0, 0.35)",
              }}
            >
              {/* Top row: Thermometer icon + large temperature */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-2 text-xl md:text-2xl font-bold font-mono ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>
                  <Thermometer size={20} className="text-amber-500" />
                  {temperature} °C
                </span>
                <span className={`text-[11px] font-mono uppercase tracking-wider font-semibold ${isLight ? "text-slate-500" : "text-[#9aa3b2]"}`}>
                  {t("hero.weather")}
                </span>
              </div>

              {/* Middle: Condition label */}
              <div className={`text-xs md:text-sm font-semibold tracking-wide ${isLight ? "text-slate-900" : "text-[#f2f4f8]"}`}>
                {conditionLabel}
              </div>

              {/* Bottom row: Inline stat row with Lucide icons */}
              <div className={`flex items-center justify-between gap-3 text-[11px] font-mono pt-1.5 border-t ${isLight ? "border-slate-200 text-slate-600" : "border-white/[0.08] text-[#9aa3b2]"}`}>
                {/* Humidity */}
                <div className="flex items-center gap-1" title="Relative Humidity">
                  <Droplets size={13} className="text-sky-500" />
                  <span>{humidity}%</span>
                </div>

                {/* Wind Speed */}
                <div className="flex items-center gap-1" title="Wind Speed">
                  <Wind size={13} className="text-teal-500" />
                  <span>{windSpeed} km/h</span>
                </div>

                {/* Precipitation */}
                <div className="flex items-center gap-1" title="Precipitation">
                  <CloudRain size={13} className="text-indigo-500" />
                  <span>{precip}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── BOTTOM: AQI SEVERITY SCALE BAR ── */}
          <div className="relative z-20 mt-2.5 sm:mt-3 pt-0.5">
            {/* Labels row: Proportional category labels */}
            <div className={`flex w-full text-[11px] md:text-xs font-mono font-medium mb-1.5 px-0.5 ${isLight ? "text-slate-600" : "text-[#9aa3b2]"}`}>
              {activeBands.map((band) => {
                const isCurrent = band.name === currentBandInfo.category;
                return (
                  <div
                    key={band.name}
                    style={{ width: `${band.pctWidth}%` }}
                    className={`text-center px-1 transition-all ${
                      isCurrent
                        ? isLight
                          ? "font-bold text-slate-900 scale-105"
                          : "font-bold text-white scale-105"
                        : isLight
                        ? "text-slate-600"
                        : "text-[#9aa3b2]"
                    }`}
                  >
                    {t(band.name)}
                  </div>
                );
              })}
            </div>

            {/* Ramp bar: 8px tall track with 6 colored segments */}
            <div className={`relative w-full h-[8px] rounded-full flex overflow-visible shadow-inner ${isLight ? "bg-slate-200/80" : "bg-black/60"}`}>
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
                <div className="mb-2 px-2 py-0.5 rounded-md bg-[#0a0b0d]/95 border border-white/20 text-[#f2f4f8] text-[11px] font-mono font-extrabold shadow-xl whitespace-nowrap">
                  {int(displayAqi)}
                </div>

                {/* 13px Indicator dot with double ring shadow */}
                <div
                  className="w-[13px] h-[13px] rounded-full bg-white border-2 border-[#0a0b0d]"
                  style={{
                    boxShadow:
                      "0 0 0 2px rgba(255, 255, 255, 0.45), 0 2px 8px rgba(0, 0, 0, 0.85)",
                  }}
                />
              </motion.div>
            </div>

            {/* Ticks row: Numeric cutoff labels */}
            <div className="relative w-full text-[10px] md:text-[10.5px] font-mono text-[#9aa3b2] mt-1.5 h-4">
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
