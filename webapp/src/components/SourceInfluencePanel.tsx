import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  ExternalLink,
  Factory,
  Flame,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wind,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import type { Panel } from "@/hooks/useForecastData";
import type {
  InversionStatus,
  PlumeVectorsResponse,
  StationReading,
} from "@/lib/types";
import {
  calculateBearingDeg,
  calculateUpwindSourceInfluence,
  haversineDistanceKm,
  type UpwindSourceInfluenceItem,
  type UpwindSourceInfluenceResponse,
} from "@/lib/industrySupabase";

interface Props {
  stations: Panel<StationReading[]>;
  plume?: Panel<PlumeVectorsResponse>;
  inversion?: Panel<InversionStatus[]>;
  hour?: any;
}

type TabCategory = "overview" | "industries" | "biomass" | "high" | "exposure";

const CACHE_STORAGE_KEY_PREFIX = "ncr72_source_influence_136k_";

const ACTIVITY_RATES: Record<string, { label: string; rate_m3_h: number; icon: string }> = {
  rest: { label: "Rest / Indoors", rate_m3_h: 0.5, icon: "🧘" },
  walking: { label: "Brisk Walking", rate_m3_h: 1.2, icon: "🚶" },
  running: { label: "Running / Jogging", rate_m3_h: 2.5, icon: "🏃" },
  cycling: { label: "Cycling / Commute", rate_m3_h: 2.0, icon: "🚴" },
  work: { label: "Outdoor Heavy Work", rate_m3_h: 1.8, icon: "🔨" },
};

export function SourceInfluencePanel({ stations, plume, inversion, hour }: Props) {
  const { t } = useTranslation();
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabCategory>("overview");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customLat, setCustomLat] = useState<string>("");
  const [customLon, setCustomLon] = useState<string>("");
  const [isCustomLoc, setIsCustomLoc] = useState<boolean>(false);

  // Activity Simulator State
  const [activityKey, setActivityKey] = useState<string>("walking");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);

  // 136k+ Supabase Geospatial Source Influence State
  const [liveData, setLiveData] = useState<UpwindSourceInfluenceResponse | null>(null);
  const [isCached, setIsCached] = useState<boolean>(false);
  const [cachedTime, setCachedTime] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stationRows = stations.data ?? [];
  const selectedStation = stationRows.find((s) => s.uid === selectedUid) ?? stationRows[0] ?? null;

  useEffect(() => {
    if (!selectedUid && stationRows[0]) {
      setSelectedUid(stationRows[0].uid);
    }
  }, [stationRows, selectedUid]);

  // Determine current evaluation coordinates
  const evalCoords = useMemo(() => {
    if (isCustomLoc && customLat && customLon) {
      const lat = parseFloat(customLat);
      const lon = parseFloat(customLon);
      if (!isNaN(lat) && !isNaN(lon) && lat >= 25 && lat <= 32 && lon >= 74 && lon <= 80) {
        return { lat, lon, name: `Custom Location (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)` };
      }
    }
    if (selectedStation) {
      return { lat: selectedStation.lat, lon: selectedStation.lon, name: selectedStation.name };
    }
    return { lat: 28.6139, lon: 77.209, name: "Delhi-ITO" };
  }, [isCustomLoc, customLat, customLon, selectedStation]);

  // 136k+ Supabase Geospatial Upwind Source Influence Calculation
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setErrorMsg(null);

    const cacheKey = `${CACHE_STORAGE_KEY_PREFIX}${evalCoords.lat.toFixed(3)}_${evalCoords.lon.toFixed(3)}`;

    const windSpeed = hour?.wind_speed_ms ?? 3.2;
    const windDir = hour?.wind_direction_deg ?? 315.0;
    const pbl = hour?.pbl_height_m ?? inversion?.data?.[0]?.pbl_height_m ?? 650.0;
    const invDelta = hour?.inversion_delta_t ?? inversion?.data?.[0]?.delta_t_celsius ?? 3.2;

    calculateUpwindSourceInfluence(
      evalCoords.lat,
      evalCoords.lon,
      evalCoords.name,
      windSpeed,
      windDir,
      pbl,
      invDelta,
      35
    )
      .then((res) => {
        if (!isMounted) return;

        // Also evaluate NASA FIRMS biomass fire plumes if available from plume feed
        const fireSources: UpwindSourceInfluenceItem[] = [];
        if (plume?.data?.plumes && plume.data.plumes.length > 0) {
          const transportDir = (windDir + 180.0) % 360.0;
          for (let idx = 0; idx < plume.data.plumes.length; idx++) {
            const p = plume.data.plumes[idx];
            const pLat = p.origin?.lat ?? 30.2;
            const pLon = p.origin?.lon ?? 75.5;
            const frp = p.origin?.frp_mw || 35;
            const stateName = p.origin?.source_state || "Punjab/Haryana";
            const dist = haversineDistanceKm(pLat, pLon, evalCoords.lat, evalCoords.lon);
            if (dist > 220) continue;
            const bearing = calculateBearingDeg(pLat, pLon, evalCoords.lat, evalCoords.lon);
            const angleDiff = Math.abs(((bearing - transportDir + 180) % 360) - 180);
            const align = angleDiff <= 85 ? Math.max(0, Math.cos((angleDiff * Math.PI) / 180) * 100) : 0;
            const rawScore = frp * (1 / Math.pow(Math.max(10, dist), 0.85)) * (align / 100);
            const score = Number(Math.min(0.95, Math.max(0.08, rawScore / 10)).toFixed(2));
            const plumeId = `FIRE_${pLat.toFixed(2)}_${pLon.toFixed(2)}_${idx}`;

            fireSources.push({
              id: plumeId,
              source_id: plumeId,
              name: `Stubble Fire Plume · ${stateName}`,
              source_type: "biomass",
              category: "Agricultural Biomass Burning",
              tier: "orange",
              tierColor: "#ff9f1c",
              tierLabel: "Biomass Burning",
              latitude: pLat,
              longitude: pLon,
              distance_km: Number(dist.toFixed(1)),
              bearing_deg: bearing,
              wind_alignment_pct: Number(align.toFixed(1)),
              confidence_pct: Math.min(95, Math.max(70, Math.round(align * 0.5 + 45))),
              confidence_level: align > 60 ? "HIGH" : "MEDIUM",
              influence_score: score,
              influence_level: score >= 0.5 ? "HIGH" : score >= 0.25 ? "MEDIUM" : "LOW",
              detail_summary: `Lagrangian Fire Plume · ${dist.toFixed(1)} km upwind · FRP: ${Math.round(frp)} MW`,
              physics_explanation: `VIIRS active fire detection with ${Math.round(frp)} MW thermal radiation power. Smoke transported along ${Math.round(transportDir)}° wind vector, reaching ${evalCoords.name} in ~${Math.round((dist * 1000) / (windSpeed * 60))} mins.`,
              daily_pm25_kg: Math.round(frp * 8.5),
              daily_so2_kg: 12,
              daily_no2_kg: 28,
              tons_per_year: Math.round(frp * 2.8),
              stack_height_m: 350,
              data_source: "NASA VIIRS Satellite / FIRMS",
            });
          }
        }

        const combinedSources = [...res.ranked_sources, ...fireSources].sort(
          (a, b) => b.influence_score - a.influence_score
        );

        const finalResult: UpwindSourceInfluenceResponse = {
          target: res.target,
          atmospheric_conditions: res.atmospheric_conditions,
          ranked_sources: combinedSources,
          total_evaluated: combinedSources.length,
        };

        setLiveData(finalResult);
        setIsCached(false);
        setLoading(false);

        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ data: finalResult, time: new Date().toLocaleTimeString() })
          );
        } catch {
          // ignore quota
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn("136k+ Supabase source influence calculation error:", err);
        try {
          const rawCache = localStorage.getItem(cacheKey);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            setLiveData(parsed.data);
            setIsCached(true);
            setCachedTime(parsed.time || "Recent");
          } else {
            setErrorMsg("Source influence telemetry temporarily unavailable for this target.");
          }
        } catch {
          setErrorMsg("Source influence feed unavailable.");
        }
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [evalCoords.lat, evalCoords.lon, evalCoords.name, hour, inversion?.data, plume?.data]);

  // Atmospheric Context
  const atmosphere = useMemo(() => {
    if (liveData?.atmospheric_conditions) {
      return liveData.atmospheric_conditions;
    }
    return {
      wind_speed_ms: hour?.wind_speed_ms ?? 3.2,
      wind_direction_deg: hour?.wind_direction_deg ?? 315.0,
      transport_direction_deg: ((hour?.wind_direction_deg ?? 315.0) + 180.0) % 360.0,
      pbl_height_m: hour?.pbl_height_m ?? inversion?.data?.[0]?.pbl_height_m ?? 650.0,
      inversion_delta_t_celsius: hour?.inversion_delta_t ?? inversion?.data?.[0]?.delta_t_celsius ?? 3.2,
      inversion_state: "Uncapped / Normal",
      mixing_category: "Moderate Mixing",
      trapping_potential: "Moderate",
      trapping_factor: 1.15,
    };
  }, [liveData, hour, inversion?.data]);

  const allSources = liveData?.ranked_sources ?? [];
  const topSources = allSources.slice(0, 3);
  const industrialSources = allSources.filter((s) => s.source_type === "industry");
  const biomassSources = allSources.filter((s) => s.source_type === "biomass");
  const highInfluenceSources = allSources.filter((s) => s.influence_level === "HIGH" || s.influence_score >= 0.55);

  const displayedSources = useMemo(() => {
    if (activeTab === "industries") return industrialSources;
    if (activeTab === "biomass") return biomassSources;
    if (activeTab === "high") return highInfluenceSources;
    return allSources;
  }, [activeTab, allSources, industrialSources, biomassSources, highInfluenceSources]);

  // Activity Inhaled Dose Calculation
  const currentPm25 = selectedStation?.pollutants?.["PM2.5"] ?? 118.5;
  const currentActivity = ACTIVITY_RATES[activityKey] || ACTIVITY_RATES.walking;
  const inhaledDoseUg = Math.round(currentPm25 * currentActivity.rate_m3_h * (durationMinutes / 60));

  const doseTier = useMemo(() => {
    if (inhaledDoseUg > 150) return { label: "Severe Particulate Load", color: "text-red-400 bg-red-500/15 border-red-500/30" };
    if (inhaledDoseUg > 75) return { label: "High Inhaled Exposure", color: "text-amber-400 bg-amber-500/15 border-amber-500/30" };
    if (inhaledDoseUg > 35) return { label: "Moderate Exposure", color: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30" };
    return { label: "Low Inhaled Dose", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30" };
  }, [inhaledDoseUg]);

  const levelColorClass = (lvl: string) => {
    const l = (lvl || "").toUpperCase();
    if (l === "HIGH") return "text-red-400 bg-red-500/15 border-red-500/30";
    if (l === "MEDIUM") return "text-amber-400 bg-amber-500/15 border-amber-500/30";
    if (l === "LOW") return "text-blue-400 bg-blue-500/15 border-blue-500/30";
    return "text-slate-400 bg-slate-500/15 border-slate-500/30";
  };

  const levelBarClass = (lvl: string) => {
    const l = (lvl || "").toUpperCase();
    if (l === "HIGH") return "bg-gradient-to-r from-orange-500 to-red-500";
    if (l === "MEDIUM") return "bg-gradient-to-r from-yellow-500 to-amber-500";
    if (l === "LOW") return "bg-gradient-to-r from-cyan-500 to-blue-500";
    return "bg-slate-500";
  };

  return (
    <section className="section source-influence-panel" aria-labelledby="source-influence-h">
      {/* Header & Controls */}
      <div className="section__head flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="eyebrow flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-cyan-400 font-mono">
              <Crosshair size={13} className="text-cyan-400 animate-pulse" />
              GEOSPATIAL INTELLIGENCE · 136K+ INDUSTRIAL REGISTRY
            </span>
            {isCached ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono flex items-center gap-1">
                <Clock size={10} />
                Cached · {cachedTime}
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono flex items-center gap-1">
                <CheckCircle2 size={10} />
                Live 136k+ Supabase Registry Sync
              </span>
            )}
          </div>
          <h2 className="section__h section__h--sm text-xl sm:text-2xl font-bold tracking-tight text-white" id="source-influence-h">
            Source influence at your location
          </h2>
          <p className="section__lede section__lede--sm max-w-3xl text-sm text-slate-400 mt-1">
            Evaluates which identifiable industrial facilities from our 136,000+ registry and satellite biomass fire plumes are most aligned with current atmospheric transport winds toward your selected target.
          </p>
        </div>

        {/* Target Selector Bar */}
        <div className="flex flex-wrap items-center gap-2.5 self-start">
          <div className="source-target-select flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700/60 shadow-inner">
            <MapPin size={15} className="text-cyan-400 shrink-0" />
            <select
              value={isCustomLoc ? "custom" : selectedStation?.uid ?? ""}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setIsCustomLoc(true);
                  if (!customLat) setCustomLat(selectedStation ? selectedStation.lat.toFixed(4) : "28.6139");
                  if (!customLon) setCustomLon(selectedStation ? selectedStation.lon.toFixed(4) : "77.2090");
                } else {
                  setIsCustomLoc(false);
                  setSelectedUid(e.target.value);
                }
              }}
              aria-label={t("pages.source.ariaStation")}
              className="bg-transparent text-sm text-slate-100 font-medium focus:outline-none cursor-pointer pr-2"
            >
              {stationRows.map((s) => (
                <option key={s.uid} value={s.uid} className="bg-slate-900 text-slate-100">
                  {s.name}
                </option>
              ))}
              <option value="custom" className="bg-slate-900 text-cyan-300 font-semibold">
                📍 Custom Coordinates...
              </option>
            </select>
          </div>

          {isCustomLoc && (
            <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-900 border border-cyan-500/40 text-xs">
              <input
                type="number"
                step="0.001"
                placeholder="Lat"
                value={customLat}
                onChange={(e) => setCustomLat(e.target.value)}
                className="w-16 px-2 py-1 bg-slate-950 rounded text-slate-100 border border-slate-700 focus:outline-none"
              />
              <span className="text-slate-400">°N</span>
              <input
                type="number"
                step="0.001"
                placeholder="Lon"
                value={customLon}
                onChange={(e) => setCustomLon(e.target.value)}
                className="w-16 px-2 py-1 bg-slate-950 rounded text-slate-100 border border-slate-700 focus:outline-none"
              />
              <span className="text-slate-400">°E</span>
            </div>
          )}

          {loading && (
            <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-700/60 text-cyan-400 animate-spin">
              <RefreshCw size={15} />
            </div>
          )}
        </div>
      </div>

      {/* Atmospheric Context & Ventilation Bar */}
      <div className="source-target-strip grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs mt-4">
        <div className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/60">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{t("pages.source.targetLocation")}</span>
          <strong className="text-white font-semibold block truncate mt-0.5">{evalCoords.name}</strong>
          <span className="text-[10px] text-slate-400 font-mono">
            {evalCoords.lat.toFixed(3)}°N, {evalCoords.lon.toFixed(3)}°E
          </span>
        </div>

        <div className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/60">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{t("pages.source.transportVector")}</span>
          <strong className="text-cyan-300 font-semibold block mt-0.5">
            {atmosphere.wind_speed_ms.toFixed(1)} m/s · {Math.round(atmosphere.wind_direction_deg)}°
          </strong>
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Navigation size={10} style={{ transform: `rotate(${atmosphere.transport_direction_deg}deg)` }} className="text-cyan-400" />
            Advects to {Math.round(atmosphere.transport_direction_deg)}°
          </span>
        </div>

        <div className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/60">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{t("pages.source.mixingDepth")}</span>
          <strong className="text-white font-semibold block mt-0.5">{Math.round(atmosphere.pbl_height_m)} m</strong>
          <span className="text-[10px] text-slate-400">{atmosphere.mixing_category}</span>
        </div>

        <div className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/60">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{t("pages.source.ventTrapping")}</span>
          <strong className="text-white font-semibold block mt-0.5">{atmosphere.inversion_state}</strong>
          <span
            className={`text-[10px] font-medium ${
              atmosphere.trapping_potential === "High"
                ? "text-red-400"
                : atmosphere.trapping_potential === "Moderate"
                ? "text-amber-400"
                : "text-emerald-400"
            }`}
          >
            {atmosphere.trapping_potential} Trapping ({atmosphere.trapping_factor.toFixed(2)}x)
          </span>
        </div>
      </div>

      {/* Feature Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-1">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
              activeTab === "overview"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles size={13} />
            Why Is My Location Polluted?
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("industries")}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
              activeTab === "industries"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Factory size={13} />
            Industries Affecting Me ({industrialSources.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("biomass")}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
              activeTab === "biomass"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Flame size={13} />
            Fire → Plume Transport ({biomassSources.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("exposure")}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
              activeTab === "exposure"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity size={13} />
            Activity Exposure Simulator
          </button>
        </div>

        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
          <Layers size={12} className="text-cyan-400" />
          {allSources.length} identifiable upwind sources evaluated
        </span>
      </div>

      {/* Main Content Layout */}
      <div className="source-influence-grid grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        {/* Left Column: Dynamic Context / Ranked Source Cards */}
        <div className="flex flex-col gap-4">
          {/* 1. WHY IS MY LOCATION POLLUTED? */}
          {activeTab === "overview" && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-cyan-500/20 shadow-lg flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      Why Is {evalCoords.name} Polluted Right Now?
                    </h3>
                    <p className="text-[11px] text-slate-400">{t("pages.source.synthesis")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">{t("pages.source.currentPm")}</span>
                  <strong className="text-base font-bold text-amber-400">{Math.round(currentPm25)} µg/m³</strong>
                </div>
              </div>

              {/* Dynamic Synthesis Paragraph */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
                <p>
                  Current atmospheric telemetry indicates{" "}
                  <strong className="text-white">{atmosphere.mixing_category.toLowerCase()}</strong> with a boundary layer height of{" "}
                  <strong className="text-cyan-300">{Math.round(atmosphere.pbl_height_m)} m</strong> and{" "}
                  <strong className="text-amber-300">{atmosphere.inversion_state.toLowerCase()}</strong> (
                  {atmosphere.inversion_delta_t_celsius > 0 ? `+${atmosphere.inversion_delta_t_celsius.toFixed(1)}°C` : `${atmosphere.inversion_delta_t_celsius.toFixed(1)}°C`}
                  ).
                  {atmosphere.trapping_factor >= 1.2
                    ? " This thermal lid significantly suppresses vertical ventilation, trapping particulate accumulation near ground level."
                    : " Atmospheric dispersion is currently active, allowing moderate convective mixing."}
                </p>
                <p className="mt-2">
                  Under the current transport wind blowing toward{" "}
                  <strong className="text-cyan-300">{Math.round(atmosphere.transport_direction_deg)}°</strong> at{" "}
                  <strong className="text-white">{atmosphere.wind_speed_ms.toFixed(1)} m/s</strong>, the primary upwind contributors
                  estimated to have the strongest downwind alignment are{" "}
                  {topSources.map((s, idx) => (
                    <span key={s.source_id}>
                      <strong className="text-slate-100">{s.name}</strong> ({s.distance_km} km,{" "}
                      {Math.round(s.wind_alignment_pct)}% wind alignment)
                      {idx < topSources.length - 1 ? ", " : "."}
                    </span>
                  ))}
                </p>
              </div>

              {/* Top 3 Quick Chips */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {topSources.map((s, i) => (
                  <div key={s.source_id} className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-cyan-400 font-mono">#{i + 1} UPWIND</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${levelColorClass(s.influence_level)}`}>
                        {s.influence_level}
                      </span>
                    </div>
                    <strong className="text-slate-100 text-xs truncate">{s.name}</strong>
                    <span className="text-[10px] text-slate-400">
                      {s.distance_km} km away · {Math.round(s.wind_alignment_pct)}% aligned
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. FIRE -> PLUME -> LOCATION STORY */}
          {activeTab === "biomass" && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-950/30 to-slate-950 border border-amber-500/30 shadow-lg flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                <Flame size={18} className="text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">{t("pages.source.fireChain")}</h3>
                  <p className="text-[11px] text-slate-400">
                    Lagrangian 850 hPa Smoke Advection Pathway
                    {plume?.data?.hotspot_count_total !== undefined && ` (${plume.data.hotspot_count_total} regional detections)`}
                  </p>
                </div>
              </div>

              {/* Visual Pipeline Flow */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                <div className="p-2 rounded-xl bg-slate-900/80 border border-amber-500/20 flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold text-amber-400">1. Thermal Anomaly</span>
                  <Flame size={20} className="text-amber-400 my-1" />
                  <span className="text-[11px] text-slate-300">VIIRS FRP &gt; 25 MW</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">2. Deterministic ID</span>
                  <span className="font-mono text-[10px] text-cyan-300 my-1 bg-slate-950 px-1 py-0.5 rounded">FIRE_lat_lon</span>
                  <span className="text-[11px] text-slate-400">{t("pages.source.trackedSource")}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">3. 850 hPa Wind</span>
                  <Wind size={20} className="text-cyan-400 my-1" />
                  <span className="text-[11px] text-slate-300">{t("pages.source.advectionVector")}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">4. Closest Approach</span>
                  <Crosshair size={20} className="text-purple-400 my-1" />
                  <span className="text-[11px] text-slate-300">{t("pages.source.gaussianSpread")}</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/80 border border-emerald-500/30 flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-400">5. Target Station</span>
                  <MapPin size={20} className="text-emerald-400 my-1" />
                  <span className="text-[11px] text-slate-100 truncate w-full">{evalCoords.name}</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Agricultural crop residue fires detected in Punjab and Haryana inject smoke into the boundary layer. Plumes are transported by regional winds, and their estimated downwind influence on {evalCoords.name} is computed from closest approach distance and wind alignment.
              </p>
            </div>
          )}

          {/* 3. ACTIVITY EXPOSURE SIMULATOR */}
          {activeTab === "exposure" && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-emerald-500/30 shadow-lg flex flex-col gap-3.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-emerald-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">{t("pages.source.exposureSim")}</h3>
                    <p className="text-[11px] text-slate-400">{t("pages.source.exposureSimDesc")}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${doseTier.color}`}>
                  {doseTier.label}
                </span>
              </div>

              {/* Interactive Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">{t("pages.source.selectActivity")}</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(ACTIVITY_RATES).map(([k, act]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setActivityKey(k)}
                        className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all ${
                          activityKey === k
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
                            : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <span className="text-base">{act.icon}</span>
                        <div>
                          <strong className="block text-[11px] leading-tight">{act.label}</strong>
                          <span className="text-[9px] text-slate-400 font-mono">{act.rate_m3_h} m³/h breath</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">{t("pages.source.duration")}</label>
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    {[15, 30, 45, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDurationMinutes(mins)}
                        className={`py-2 rounded-xl border font-bold text-xs transition-all ${
                          durationMinutes === mins
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-sm"
                            : "bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>

                  {/* Estimated Inhaled Dose Box */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">{t("pages.source.inhaledPm")}</span>
                      <strong className="text-lg font-bold text-white">{inhaledDoseUg} µg</strong>
                      <span className="text-[10px] text-slate-400 block">
                        across {durationMinutes} min ({currentActivity.rate_m3_h} m³/h × {Math.round(currentPm25)} µg/m³)
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                        <Clock size={11} />
                        Safer Window
                      </span>
                      <strong className="text-xs text-slate-200 block mt-0.5">13:00 – 16:00 IST</strong>
                      <span className="text-[10px] text-slate-400">{t("pages.source.peakMixing")}</span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400">
                Estimated personal exposure is calculated using standardized physiological ventilation rates and current ambient particulate concentrations.
              </p>
            </div>
          )}

          {/* Source Cards List */}
          <div className="source-cards flex flex-col gap-2.5">
            {errorMsg && (
              <div className="p-6 rounded-2xl border border-dashed border-red-500/30 bg-red-950/20 text-center text-red-300 text-sm flex flex-col items-center gap-2">
                <AlertTriangle size={20} className="text-red-400" />
                <p>{errorMsg}</p>
              </div>
            )}

            {displayedSources.map((s) => {
              const isExpanded = expandedId === s.source_id;
              const isBiomass = s.source_type === "biomass";

              return (
                <article
                  className="source-card p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700/80 transition-all shadow-sm"
                  key={s.source_id}
                >
                  <div className="flex items-start gap-3.5">
                    {/* Icon */}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isBiomass
                          ? "bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-amber-950/20"
                          : "bg-purple-500/15 border-purple-500/30 text-purple-400 shadow-purple-950/20"
                      }`}
                    >
                      {isBiomass ? <Flame size={20} /> : <Factory size={20} />}
                    </div>

                    {/* Content Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <strong className="text-white text-sm font-semibold truncate block">
                            {s.name}
                          </strong>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/50 shrink-0">
                            ID: #{s.id}
                          </span>
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                            style={{
                              color: s.tierColor,
                              borderColor: `${s.tierColor}55`,
                              backgroundColor: `${s.tierColor}15`,
                            }}
                          >
                            {s.tierLabel}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border tracking-wider uppercase ${levelColorClass(
                              s.influence_level
                            )}`}
                          >
                            {s.influence_level} ESTIMATED INFLUENCE
                          </span>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : s.source_id)}
                            aria-label={isExpanded ? "Collapse physics details" : "Expand physics details"}
                            className="p-1 rounded-md bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                      </div>

                      {/* Detail string */}
                      <p className="text-xs text-slate-400 mt-1 truncate">{s.detail_summary}</p>

                      {/* Key Metrics */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs text-slate-300">
                        <span className="flex items-center gap-1">
                          <MapPin size={12} className="text-cyan-400" />
                          <strong>{s.distance_km} km</strong> away ({Math.round(s.bearing_deg)}° bearing)
                        </span>
                        <span className="flex items-center gap-1">
                          <Wind size={12} className="text-cyan-400" />
                          Wind Alignment:{" "}
                          <strong className={s.wind_alignment_pct >= 75 ? "text-emerald-400" : "text-amber-400"}>
                            {Math.round(s.wind_alignment_pct)}%
                          </strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <ShieldCheck size={12} className="text-cyan-400" />
                          Confidence: <strong>{Math.round(s.confidence_pct)}%</strong> ({s.confidence_level})
                        </span>
                      </div>

                      {/* Animated Progress Meter */}
                      <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${levelBarClass(s.influence_level)}`}
                          style={{ width: `${Math.max(4, Math.round(s.influence_score * 100))}%` }}
                        />
                      </div>

                      {/* Expandable Physics Breakdown */}
                      {isExpanded && (
                        <div className="mt-3 p-3.5 rounded-lg bg-slate-950/90 border border-slate-800 text-xs text-slate-300 flex flex-col gap-2.5">
                          <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-[11px] uppercase tracking-wide">
                            <Info size={13} />
                            Physics & Atmospheric Transport Rationale
                          </div>
                          <p className="text-slate-300 leading-relaxed">{s.physics_explanation}</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                            <div>
                              <span className="text-slate-400 block">{t("pages.source.catalog")}</span>
                              <strong className="text-slate-200">{s.data_source}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 block">{t("pages.source.coordinates")}</span>
                              <strong className="text-slate-200 font-mono">
                                {s.latitude.toFixed(3)}°N, {s.longitude.toFixed(3)}°E
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-400 block">{t("pages.source.emissionBudget")}</span>
                              <strong className="text-slate-200">
                                {s.daily_pm25_kg} kg/day PM2.5 · {s.tons_per_year} t/yr
                              </strong>
                            </div>
                            <div>
                              <span className="text-slate-400 block">{t("pages.source.stackTrapping")}</span>
                              <strong className="text-amber-400">
                                {s.stack_height_m}m stack · {atmosphere.trapping_factor.toFixed(2)}x trapping
                              </strong>
                            </div>
                          </div>
                          {s.source_type === "industry" && (
                            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                              <span className="text-slate-400 text-[11px]">
                                Full industrial site profile, compliance history & emission modeling
                              </span>
                              <a
                                href={`/industry-details.html?id=${s.id}&lat=${s.latitude}&lng=${s.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold transition-all shadow-sm"
                              >
                                Digital Twin Profile <ExternalLink size={12} />
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && displayedSources.length === 0 && !errorMsg && (
              <div className="p-8 rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 text-center text-slate-400 text-sm">
                No identifiable source matches the selected filter for the current wind transport vector.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Transport Compass & Top Influence Callout */}
        <aside className="source-atmosphere-card p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col gap-4 self-start">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
              <Compass size={15} className="text-cyan-400" />
              Transport Compass
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
              Advection
            </span>
          </div>

          {/* Compass Visualization */}
          <div className="source-compass flex flex-col items-center justify-center py-2">
            <div className="source-compass__ring relative w-32 h-32 rounded-full border border-slate-700/80 bg-slate-950/60 flex items-center justify-center shadow-inner">
              <span className="absolute top-1 text-[9px] font-bold text-slate-400">N</span>
              <span className="absolute right-1 text-[9px] font-bold text-slate-400">E</span>
              <span className="absolute bottom-1 text-[9px] font-bold text-slate-400">S</span>
              <span className="absolute left-1 text-[9px] font-bold text-slate-400">W</span>

              {/* Rotating Advection Arrow */}
              <div
                className="transition-transform duration-700 ease-out flex flex-col items-center"
                style={{ transform: `rotate(${atmosphere.transport_direction_deg}deg)` }}
              >
                <ArrowDown size={36} className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
              </div>

              <div className="absolute inset-0 rounded-full border border-cyan-500/10 pointer-events-none" />
            </div>
            <div className="mt-2 text-center">
              <span className="text-xs font-bold text-white block">
                Transport Heading: {Math.round(atmosphere.transport_direction_deg)}°
              </span>
              <span className="text-[11px] text-slate-400">
                (Wind blowing FROM {Math.round(atmosphere.wind_direction_deg)}°)
              </span>
            </div>
          </div>

          {/* Atmospheric Telemetry */}
          <div className="flex flex-col gap-2 text-xs divide-y divide-slate-800/60">
            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Gauge size={14} className="text-cyan-400" />
                PBL Mixing Depth
              </span>
              <strong className="text-white font-semibold">{Math.round(atmosphere.pbl_height_m)} m</strong>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Wind size={14} className="text-cyan-400" />
                Wind Velocity
              </span>
              <strong className="text-white font-semibold">{atmosphere.wind_speed_ms.toFixed(1)} m/s</strong>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Layers size={14} className="text-cyan-400" />
                Thermal Inversion
              </span>
              <strong
                className={
                  atmosphere.inversion_delta_t_celsius > 1.5 ? "text-amber-400 font-semibold" : "text-slate-300 font-semibold"
                }
              >
                {atmosphere.inversion_delta_t_celsius > 0
                  ? `+${atmosphere.inversion_delta_t_celsius.toFixed(1)}°C`
                  : `${atmosphere.inversion_delta_t_celsius.toFixed(1)}°C`}
              </strong>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-400 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-cyan-400" />
                Trapping Potential
              </span>
              <strong
                className={`font-semibold ${
                  atmosphere.trapping_potential === "High"
                    ? "text-red-400"
                    : atmosphere.trapping_potential === "Moderate"
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}
              >
                {atmosphere.trapping_potential} ({atmosphere.trapping_factor.toFixed(2)}x)
              </strong>
            </div>
          </div>

          {/* Top Source Highlight */}
          {topSources[0] && (
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 text-xs flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400 flex items-center gap-1">
                <ArrowUpRight size={12} />
                Top Estimated Influence
              </span>
              <strong className="text-white font-semibold line-clamp-1">{topSources[0].name}</strong>
              <p className="text-[11px] text-slate-400 line-clamp-2">{topSources[0].detail_summary}</p>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px]">
                <span className="text-slate-400">{topSources[0].distance_km} km away</span>
                <span className="text-cyan-300 font-mono font-bold">
                  {Math.round(topSources[0].influence_score * 100)} / 100 score
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Non-Negotiable Scientific Positioning Disclaimer (Phase 2) */}
      <div className="source-disclaimer mt-4 p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-400 flex items-start gap-2.5">
        <HelpCircle size={16} className="text-cyan-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-200">{t("pages.source.positioningLabel")}</strong> {t("pages.source.positioning1")}{" "}
          <strong className="text-cyan-300">{t("pages.source.positioning2")}</strong> {t("pages.source.positioning3")}
        </p>
      </div>
    </section>
  );
}
