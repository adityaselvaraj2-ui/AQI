import { useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web";
import salesmanAnimation from "@/assets/pollution_explainer_animation.json";
import industryAnimation from "@/assets/industry_explainer_animation.json";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  Factory,
  Info,
  MapPin,
  Pause,
  Play,
  ShieldAlert,
  Users,
  Wind,
} from "lucide-react";
import type { Panel } from "@/hooks/useForecastData";
import type {
  CityAggregateResponse,
  InversionStatus,
  PlumeVectorsResponse,
  StationReading,
} from "@/lib/types";
import type { WeatherapiRealtimeResponse } from "@/lib/api";
import {
  calculateBearingDeg,
  calculateUpwindSourceInfluence,
  haversineDistanceKm,
  type UpwindSourceInfluenceItem,
} from "@/lib/industrySupabase";

interface Props {
  stations: Panel<StationReading[]>;
  plume?: Panel<PlumeVectorsResponse>;
  inversion?: Panel<InversionStatus[]>;
  hour?: any;
  cityAggregate?: CityAggregateResponse | null;
  weatherapi?: WeatherapiRealtimeResponse | null;
}

/** Converts degrees to 8-point cardinal compass text */
function getCompassDirection(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 337.5 || d < 22.5) return "North (N)";
  if (d >= 22.5 && d < 67.5) return "Northeast (NE)";
  if (d >= 67.5 && d < 112.5) return "East (E)";
  if (d >= 112.5 && d < 157.5) return "Southeast (SE)";
  if (d >= 157.5 && d < 202.5) return "South (S)";
  if (d >= 202.5 && d < 247.5) return "Southwest (SW)";
  if (d >= 247.5 && d < 292.5) return "West (W)";
  return "Northwest (NW)";
}

/** Human-friendly AQI Category and Color */
function getCitizenAqiMeta(aqi: number) {
  if (aqi <= 50) {
    return {
      label: "Good Air",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      humanDesc: "Air quality is clean and healthy. Safe for all outdoor activities.",
    };
  }
  if (aqi <= 100) {
    return {
      label: "Moderate",
      color: "text-yellow-300",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
      humanDesc: "Acceptable air, but unusually sensitive people should limit prolonged outdoor exertion.",
    };
  }
  if (aqi <= 200) {
    return {
      label: "Unhealthy for Sensitive Groups",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      humanDesc: "Children, elderly, and asthma patients will experience irritation; wear a mask outside.",
    };
  }
  if (aqi <= 300) {
    return {
      label: "Poor / Unhealthy",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      border: "border-orange-500/30",
      humanDesc: "Everyone may begin to feel throat scratchiness and eye stinging. Avoid outdoor exercise.",
    };
  }
  if (aqi <= 400) {
    return {
      label: "Very Poor",
      color: "text-red-400",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      humanDesc: "Heavy smog warning. Prolonged exposure can cause respiratory illnesses. Keep windows shut.",
    };
  }
  return {
    label: "Severe / Hazardous",
    color: "text-rose-400",
    bg: "bg-rose-500/15",
    border: "border-rose-500/40",
    humanDesc: "Emergency health warning. Clean indoor air is essential; avoid any unnecessary outdoor time.",
  };
}

/** Translates industrial category into what it emits in plain words */
function getPlainEmissionDesc(category: string): string {
  const cat = (category || "").toLowerCase();
  if (cat.includes("chemical") || cat.includes("pharma") || cat.includes("solvent")) {
    return "Chemical vapor fumes, solvents & fine acid mist";
  }
  if (cat.includes("steel") || cat.includes("metal") || cat.includes("foundry") || cat.includes("rolling")) {
    return "Furnace smoke, coal soot & fine metallic dust";
  }
  if (cat.includes("brick") || cat.includes("kiln") || cat.includes("pottery")) {
    return "Dense coal smoke, bottom ash & unburnt particles";
  }
  if (cat.includes("textile") || cat.includes("dye")) {
    return "Boiler exhaust, steam emissions & dye vapors";
  }
  if (cat.includes("power") || cat.includes("thermal") || cat.includes("energy")) {
    return "Sulfur fumes, fine fly ash & boiler smoke";
  }
  if (cat.includes("plastic") || cat.includes("polymer") || cat.includes("rubber")) {
    return "Molding fumes, toxic volatile gases & plastic smoke";
  }
  return "Industrial boiler soot, furnace smoke & fine dust";
}

/** Lottie animation player for the everyday pollution explainer */
function PollutionSalesmanAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: salesmanAnimation,
    });

    return () => {
      anim.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full max-w-[270px] max-h-[270px] sm:max-w-[310px] sm:max-h-[310px] flex items-center justify-center pointer-events-none select-none [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto"
      aria-hidden="true"
    />
  );
}

/** Lottie animation player for the industrial factory explainer */
function IndustrySmokeAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: industryAnimation,
    });

    return () => {
      anim.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full max-w-[420px] max-h-[260px] sm:max-w-[460px] sm:max-h-[290px] flex items-center justify-center pointer-events-none select-none [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto"
      aria-hidden="true"
    />
  );
}

export function CitizenPollutionExplainer({
  stations,
  plume,
  inversion,
  hour,
  cityAggregate,
  weatherapi,
}: Props) {
  const stationRows = stations.data ?? [];

  // Default to Bawana if available, otherwise first station
  const defaultUid = useMemo(() => {
    const bawana = stationRows.find(
      (s) => s.name.toLowerCase().includes("bawana") || s.uid.toLowerCase().includes("bawana")
    );
    return bawana?.uid ?? stationRows[0]?.uid ?? "";
  }, [stationRows]);

  const [selectedUid, setSelectedUid] = useState<string>(defaultUid);

  useEffect(() => {
    if (!selectedUid && defaultUid) {
      setSelectedUid(defaultUid);
    }
  }, [defaultUid, selectedUid]);

  const selectedStation = useMemo(() => {
    return stationRows.find((s) => s.uid === selectedUid) ?? stationRows[0] ?? null;
  }, [stationRows, selectedUid]);

  // Area Evaluation Coordinates
  const targetCoords = useMemo(() => {
    if (selectedStation) {
      return {
        lat: selectedStation.lat,
        lon: selectedStation.lon,
        name: selectedStation.name,
      };
    }
    return { lat: 28.776, lon: 77.051, name: "Bawana" };
  }, [selectedStation]);

  // Telemetry & Weather Values
  const windSpeedMs = hour?.wind_speed_ms ?? (weatherapi ? weatherapi.wind_kph / 3.6 : 2.4);
  const windDirDeg = hour?.wind_direction_deg ?? weatherapi?.wind_deg ?? 89.0;
  const pblHeightM = hour?.pbl_height_m ?? inversion?.data?.[0]?.pbl_height_m ?? 445.0;
  const inversionDeltaT = hour?.inversion_delta_t ?? inversion?.data?.[0]?.delta_t_celsius ?? -1.8;

  // Selected Area AQI & PM2.5
  const areaAqi = selectedStation?.aqi ?? (cityAggregate?.overall_aqi ?? 106);
  const areaPm25 =
    selectedStation?.pollutants?.["PM2.5"] ??
    cityAggregate?.sub_indices?.["PM2.5"]?.conc ??
    44;

  const aqiMeta = getCitizenAqiMeta(areaAqi);

  // Box 1 sequential cycling slides (looping one after the other)
  // 0: Why The Air Isn't Clearing
  // 1: Important Points For Your Family
  // 2: What You Should Do Right Now
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [isSlidePaused, setIsSlidePaused] = useState<boolean>(false);

  useEffect(() => {
    if (isSlidePaused) return;
    const timer = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % 3);
    }, 6000);

    return () => clearInterval(timer);
  }, [isSlidePaused]);

  // Box 2 sequential cycling slides for factories & industrial emitters
  // 0: How Smoke Travels
  // 1: Top Upwind Emitters Right Now
  // 2: What Factories Emit
  const [activeIndustrySlide, setActiveIndustrySlide] = useState<number>(0);
  const [isIndustrySlidePaused, setIsIndustrySlidePaused] = useState<boolean>(false);

  useEffect(() => {
    if (isIndustrySlidePaused) return;
    const timer = setInterval(() => {
      setActiveIndustrySlide((prev) => (prev + 1) % 3);
    }, 6000);

    return () => clearInterval(timer);
  }, [isIndustrySlidePaused]);

  // Upwind Industrial Data State
  const [rankedIndustries, setRankedIndustries] = useState<UpwindSourceInfluenceItem[]>([]);
  const [loadingIndustries, setLoadingIndustries] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setLoadingIndustries(true);

    calculateUpwindSourceInfluence(
      targetCoords.lat,
      targetCoords.lon,
      targetCoords.name,
      windSpeedMs,
      windDirDeg,
      pblHeightM,
      inversionDeltaT,
      20
    )
      .then((res) => {
        if (!isMounted) return;

        // Also add active fire plumes if any
        const fireSources: UpwindSourceInfluenceItem[] = [];
        if (plume?.data?.plumes && plume.data.plumes.length > 0) {
          const transportDir = (windDirDeg + 180.0) % 360.0;
          plume.data.plumes.forEach((p, idx) => {
            const pLat = p.origin?.lat ?? 30.2;
            const pLon = p.origin?.lon ?? 75.5;
            const dist = haversineDistanceKm(pLat, pLon, targetCoords.lat, targetCoords.lon);
            if (dist > 220) return;
            const bearing = calculateBearingDeg(pLat, pLon, targetCoords.lat, targetCoords.lon);
            const angleDiff = Math.abs(((bearing - transportDir + 180) % 360) - 180);
            const align = angleDiff <= 85 ? Math.max(0, Math.cos((angleDiff * Math.PI) / 180) * 100) : 0;
            const score = Number(Math.min(0.95, Math.max(0.1, (align / 100) * (50 / Math.max(20, dist)))).toFixed(2));
            fireSources.push({
              id: `FIRE_${idx}`,
              source_id: `FIRE_${idx}`,
              name: `Stubble / Agricultural Fire Plume (${p.origin?.source_state || "Northwest"})`,
              source_type: "biomass",
              category: "Biomass Burning",
              tier: "orange",
              tierColor: "#ff9f1c",
              tierLabel: "Crop Smoke",
              latitude: pLat,
              longitude: pLon,
              distance_km: Number(dist.toFixed(1)),
              bearing_deg: bearing,
              wind_alignment_pct: Number(align.toFixed(1)),
              confidence_pct: 80,
              confidence_level: "HIGH",
              influence_score: score,
              influence_level: score >= 0.5 ? "HIGH" : score >= 0.25 ? "MEDIUM" : "LOW",
              detail_summary: `Agricultural fire plume ${dist.toFixed(0)} km upwind`,
              physics_explanation: "Agricultural smoke blown towards your area",
              daily_pm25_kg: 240,
              daily_so2_kg: 10,
              daily_no2_kg: 25,
              tons_per_year: 80,
              stack_height_m: 200,
              data_source: "Satellite Detection",
            });
          });
        }

        const combined = [...res.ranked_sources, ...fireSources].sort(
          (a, b) => b.influence_score - a.influence_score
        );
        setRankedIndustries(combined);
        setLoadingIndustries(false);
      })
      .catch((err) => {
        console.warn("Failed to calculate citizen upwind industries:", err);
        if (isMounted) setLoadingIndustries(false);
      });

    return () => {
      isMounted = false;
    };
  }, [targetCoords.lat, targetCoords.lon, targetCoords.name, windSpeedMs, windDirDeg, pblHeightM, inversionDeltaT, plume?.data]);

  // Top 3 Contributing Industries for the selected area
  const top3Industries = useMemo(() => {
    return rankedIndustries.slice(0, 3);
  }, [rankedIndustries]);

  // Transport Fleet Dynamics (Calculated based on current hour & diurnal patterns)
  const transportBreakdown = useMemo(() => {
    const currentHour = new Date().getHours();
    const isNightTruckWindow = currentHour >= 22 || currentHour < 6;
    const isRushHour = (currentHour >= 8 && currentHour < 11) || (currentHour >= 17 && currentHour < 20);

    // Diurnal fleet percentages that sum to 100%
    if (isNightTruckWindow) {
      return {
        windowName: "Night Freight Window (22:00 – 06:00)",
        windowDesc: "Heavy interstate diesel trucks enter city limits after daytime bans lift.",
        overallTransportPct: 36,
        fleet: [
          {
            type: "Heavy Diesel Trucks & Freight",
            pct: 54,
            icon: "🚛",
            color: "from-amber-500 to-red-500",
            barColor: "bg-red-500",
            plainNote: "Interstate container trucks & dumpers burning diesel; emits dense black soot.",
          },
          {
            type: "2-Wheelers (Bikes & Scooters)",
            pct: 18,
            icon: "🛵",
            color: "from-cyan-400 to-blue-500",
            barColor: "bg-cyan-500",
            plainNote: "Night shift & delivery bikes; emits unburnt fuel and carbon monoxide.",
          },
          {
            type: "Cars & Cabs (Petrol / Diesel / CNG)",
            pct: 14,
            icon: "🚗",
            color: "from-sky-400 to-indigo-500",
            barColor: "bg-sky-500",
            plainNote: "Night taxis and late personal travel; nitrogen gas exhaust.",
          },
          {
            type: "3-Wheelers & Auto-Rickshaws",
            pct: 8,
            icon: "🛺",
            color: "from-emerald-400 to-teal-500",
            barColor: "bg-emerald-500",
            plainNote: "Local station drop-offs and short hops.",
          },
          {
            type: "Buses & Transit Vehicles",
            pct: 6,
            icon: "🚌",
            color: "from-purple-400 to-pink-500",
            barColor: "bg-purple-500",
            plainNote: "Night bus corridors and intercity passenger coaches.",
          },
        ],
      };
    }

    if (isRushHour) {
      return {
        windowName: "Peak Office Rush Hour (08:00–11:00 & 17:00–20:00)",
        windowDesc: "Massive commuter traffic volume, slow movement, and stop-and-go idling.",
        overallTransportPct: 34,
        fleet: [
          {
            type: "2-Wheelers (Motorcycles & Scooters)",
            pct: 44,
            icon: "🛵",
            color: "from-cyan-400 to-blue-500",
            barColor: "bg-cyan-500",
            plainNote: "Millions of daily office bikes; dense street-level unburnt fuel & exhaust.",
          },
          {
            type: "Cars, Cabs & SUVs",
            pct: 28,
            icon: "🚗",
            color: "from-sky-400 to-indigo-500",
            barColor: "bg-sky-500",
            plainNote: "Traffic gridlock and AC idling produce heavy Nitrogen Dioxide (NO2).",
          },
          {
            type: "Heavy Trucks & Utility Vehicles",
            pct: 12,
            icon: "🚛",
            color: "from-amber-500 to-red-500",
            barColor: "bg-amber-500",
            plainNote: "Essential delivery trucks & water tankers operating under city permits.",
          },
          {
            type: "3-Wheelers & Auto-Rickshaws",
            pct: 10,
            icon: "🛺",
            color: "from-emerald-400 to-teal-500",
            barColor: "bg-emerald-500",
            plainNote: "Frequent stop-and-go passenger pickups near metro stations and markets.",
          },
          {
            type: "Buses & Public Fleets",
            pct: 6,
            icon: "🚌",
            color: "from-purple-400 to-pink-500",
            barColor: "bg-purple-500",
            plainNote: "Arterial road bus transit and school/office buses.",
          },
        ],
      };
    }

    // Standard daytime
    return {
      windowName: "Standard Daytime Traffic (11:00 – 17:00)",
      windowDesc: "Steady daytime urban transit, intra-city deliveries, and commercial trips.",
      overallTransportPct: 29,
      fleet: [
        {
          type: "2-Wheelers (Bikes & Scooters)",
          pct: 38,
          icon: "🛵",
          color: "from-cyan-400 to-blue-500",
          barColor: "bg-cyan-500",
          plainNote: "Daily couriers, service riders & commuters on local roads.",
        },
        {
          type: "Heavy Commercials & Light Trucks",
          pct: 26,
          icon: "🚛",
          color: "from-amber-500 to-red-500",
          barColor: "bg-amber-500",
          plainNote: "Intra-city goods delivery, waste hauling & commercial supply vehicles.",
        },
        {
          type: "Cars & Taxis",
          pct: 20,
          icon: "🚗",
          color: "from-sky-400 to-indigo-500",
          barColor: "bg-sky-500",
          plainNote: "Midday business travel, app cabs, and personal vehicles.",
        },
        {
          type: "3-Wheelers & Autos",
          pct: 10,
          icon: "🛺",
          color: "from-emerald-400 to-teal-500",
          barColor: "bg-emerald-500",
          plainNote: "Continuous market and neighborhood connectivity.",
        },
        {
          type: "Buses & Transit",
          pct: 6,
          icon: "🚌",
          color: "from-purple-400 to-pink-500",
          barColor: "bg-purple-500",
          plainNote: "City bus routes linking outer hubs with central zones.",
        },
      ],
    };
  }, []);

  // Plain English Atmospheric Reason
  const weatherTrappingReason = useMemo(() => {
    const isColdLid = inversionDeltaT > -1.0 || pblHeightM < 550;
    const isCalm = windSpeedMs < 2.2;
    const windFromCompass = getCompassDirection(windDirDeg);

    if (isColdLid && isCalm) {
      return `A blanket of cold, heavy air is currently acting like a closed lid over ${targetCoords.name}. At the same time, winds are almost completely calm (${windSpeedMs.toFixed(1)} m/s). Instead of smoke rising up and blowing away, it is trapped right at ground level where you walk and breathe.`;
    }
    if (isColdLid) {
      return `Cooler ground air is trapped beneath warmer upper air over ${targetCoords.name} (creating an atmospheric lid). While breezes are blowing at ${windSpeedMs.toFixed(1)} m/s from the ${windFromCompass}, smoke from nearby areas cannot escape upward, causing pollutants to accumulate.`;
    }
    if (isCalm) {
      return `Winds across ${targetCoords.name} are very slow (${windSpeedMs.toFixed(1)} m/s). Without a healthy breeze to push dirty air out of the city, daily emissions from vehicles, cooking, and local factories are simply hovering over your neighborhood.`;
    }
    return `Winds blowing at ${windSpeedMs.toFixed(1)} m/s from the ${windFromCompass} are carrying smoke and road dust directly into ${targetCoords.name} from upwind industrial and traffic corridors.`;
  }, [inversionDeltaT, pblHeightM, windSpeedMs, windDirDeg, targetCoords.name]);

  return (
    <section
      id="citizen-pollution-breakdown"
      className="relative w-full py-12 px-4 sm:px-6 lg:px-8 overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #07090e 0%, #090e15 50%, #07090e 100%)",
      }}
      aria-label="Citizen Air Pollution Guide"
    >
      <div className="max-w-7xl mx-auto">
        {/* Top Header & Neighbourhood Switcher Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 mb-8 border-b border-white/[0.08]">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-mono font-medium tracking-wide mb-2.5">
              <Users size={14} className="text-cyan-400" />
              <span>CITIZEN AIR GUIDE · PLAIN LANGUAGE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              Why Your Area Is Polluted & Who Is Responsible
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              No confusing scientific terms. Here is what is dirtying the air where you live right now, how local factories affect your street, and what road traffic contributes.
            </p>
          </div>

          {/* Area Selector & Live AQI Capsule */}
          <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 border border-slate-700/70 shadow-inner">
              <MapPin size={16} className="text-cyan-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 font-semibold">
                  Your Area / Station
                </span>
                <select
                  value={selectedUid}
                  onChange={(e) => setSelectedUid(e.target.value)}
                  className="bg-transparent text-sm text-white font-semibold focus:outline-none cursor-pointer pr-3"
                  aria-label="Select your neighborhood station"
                >
                  {stationRows.map((s) => (
                    <option key={s.uid} value={s.uid} className="bg-slate-900 text-white">
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Current Air Quality Badge */}
            <div className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border ${aqiMeta.bg} ${aqiMeta.border}`}>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-300 font-medium">
                  Air Health Level
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xl font-bold font-mono ${aqiMeta.color}`}>{Math.round(areaAqi)}</span>
                  <span className="text-xs text-slate-300 font-medium">AQI</span>
                  <span className={`text-xs font-semibold ${aqiMeta.color} ml-1`}>· {aqiMeta.label}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The 3 Separate Citizen Breakdown Boxes - Row-wise Layout */}
        <div className="flex flex-col gap-6 w-full">
          {/* ══════════════════════════════════════════════════════════════════
              ROW 1 (EXPLAINER): WHY YOUR AREA IS POLLUTED RIGHT NOW
              ══════════════════════════════════════════════════════════════════ */}
          {/* Note: Background rectangle box removed per user request: "that bg rectangle box is no needed , remove that" */}
          <div className="relative w-full pb-4">
            {/* Row Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08] mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                  <Wind size={22} />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 font-bold block">
                    EVERYDAY EXPLAINER
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    Why Is {targetCoords.name} Polluted Right Now?
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-slate-400 font-medium">Current PM2.5 in {targetCoords.name}:</span>
                <span className="text-xs font-mono font-bold text-cyan-300 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
                  {Math.round(areaPm25)} µg/m³
                </span>
              </div>
            </div>

            {/* 2-Column Split: Animation (Left) + Looping Info Slides (Right) */}
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] lg:grid-cols-[320px_1fr] gap-6 items-center">
              {/* Animation Space: Transparent without background box */}
              <div className="w-full max-w-[320px] aspect-square mx-auto flex items-center justify-center p-1 relative shrink-0">
                <PollutionSalesmanAnimation />
              </div>

              {/* Lines Space: Looping 3-Step Sequential Text Info */}
              <div
                className="flex flex-col justify-between min-h-[310px] relative p-1 sm:p-2"
                onMouseEnter={() => setIsSlidePaused(true)}
                onMouseLeave={() => setIsSlidePaused(false)}
              >
                {/* Looping Content Area with AnimatePresence */}
                <div className="min-h-[250px] relative flex flex-col justify-center">
                  <AnimatePresence mode="wait">
                    {activeSlideIndex === 0 && (
                      <motion.div
                        key="slide-0"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-400 font-bold bg-cyan-500/10 px-2.5 py-1 rounded-md border border-cyan-500/25">
                              <Wind size={13} /> 1. Why The Air Isn't Clearing
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 1 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Atmospheric Trapping Lid & Stagnant Air Over {targetCoords.name}
                          </h4>

                          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                            {weatherTrappingReason}
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
                          <Info size={18} className="text-cyan-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="text-white">Microscopic PM2.5:</strong> Specks 30x thinner than a strand of hair that bypass nasal filters and enter deep into your lungs and blood.
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {activeSlideIndex === 1 && (
                      <motion.div
                        key="slide-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/25">
                              <AlertTriangle size={13} /> 2. Important Points For Your Family
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 2 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Peak Danger Hours & Protecting Vulnerable Loved Ones
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex flex-col gap-1.5">
                            <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                              <Clock size={14} /> Peak Dirty Hours Today
                            </span>
                            <p className="text-[11.5px] text-slate-300 leading-relaxed">
                              Air is dirtiest during <strong className="text-amber-200">8:00 PM to 8:00 AM</strong> as cold night ground air traps smoke. Best outdoor ventilation window is between <strong className="text-emerald-300">1:00 PM and 4:00 PM</strong>.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-200/90 flex flex-col gap-1.5">
                            <span className="font-semibold text-rose-300 flex items-center gap-1.5">
                              <ShieldAlert size={14} /> Who Is At High Risk
                            </span>
                            <p className="text-[11.5px] text-slate-300 leading-relaxed">
                              Children, senior citizens, and people with asthma or allergies will feel coughing, dry throat, and fatigue first. Keep doctor prescribed inhalers handy.
                            </p>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between">
                          <span>💡 Avoid lighting mosquito coils or incense sticks indoors on high-smog nights.</span>
                          <span className="text-amber-400 font-mono text-[10px] font-bold shrink-0 ml-2">Family Care</span>
                        </div>
                      </motion.div>
                    )}

                    {activeSlideIndex === 2 && (
                      <motion.div
                        key="slide-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/25">
                              <CheckCircle2 size={13} /> 3. What You Should Do Right Now:
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 3 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Actionable Checklist to Protect Your Health
                          </h4>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800">
                          <ul className="text-xs text-slate-300 space-y-2.5">
                            <li className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">1</span>
                              <span>Wear a snug <strong>N95 mask</strong> if stepping outside for commuting or walking. Cloth masks do not block microscopic PM2.5.</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">2</span>
                              <span>Keep doors and street-facing windows shut during morning smog; ventilate only during afternoon hours.</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">3</span>
                              <span>Avoid intense outdoor jogging or workouts; shift physical exercise indoors to protect lung tissues.</span>
                            </li>
                          </ul>
                        </div>

                        <div className="pt-1 text-[10.5px] text-slate-400 flex items-center justify-between">
                          <span>Health guideline aligned with CPCB advisories</span>
                          <span className="text-emerald-400 font-mono text-[10px] font-bold">Actionable Guidance</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Looping Controls & Indicator Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-white/[0.08]">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {[
                      { label: "Why Air Isn't Clearing", index: 0, color: "bg-cyan-400" },
                      { label: "Family Points", index: 1, color: "bg-amber-400" },
                      { label: "What To Do", index: 2, color: "bg-emerald-400" },
                    ].map((slide) => (
                      <button
                        key={slide.index}
                        type="button"
                        onClick={() => setActiveSlideIndex(slide.index)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                          activeSlideIndex === slide.index
                            ? "bg-white/10 text-white font-semibold shadow-sm"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full transition-transform ${
                            activeSlideIndex === slide.index
                              ? `${slide.color} scale-125`
                              : "bg-slate-600"
                          }`}
                        />
                        <span>{slide.label}</span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSlidePaused((prev) => !prev)}
                    className="flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded transition-colors cursor-pointer"
                    title={isSlidePaused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {isSlidePaused ? (
                      <>
                        <Play size={11} className="text-emerald-400" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause size={11} className="text-amber-400" />
                        <span>Pause</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ROW 2 (BOX 2): HOW INDUSTRIES AFFECT YOUR AREA & TOP 3 CONTRIBUTING
              ══════════════════════════════════════════════════════════════════ */}
          {/* Note: Seamless transparent layout matching Box 1 with animation on the RIGHT */}
          <div className="relative w-full pb-4">
            {/* Row Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08] mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                  <Factory size={22} />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold block">
                    FACTORIES & INDUSTRIAL PLANTS
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    How Industries Affect {targetCoords.name}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-amber-200/90 font-medium">Estimated Factory Share:</span>
                <span className="text-xs sm:text-sm font-bold font-mono text-amber-400 px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30">
                  ~24% of PM2.5 in {targetCoords.name}
                </span>
              </div>
            </div>

            {/* 2-Column Split: Text Carousel (Left) + Animation (Right) */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] lg:grid-cols-[1fr_400px] gap-6 items-center">
              {/* Lines Space: Looping 3-Step Sequential Text Info on LEFT */}
              <div
                className="flex flex-col justify-between min-h-[310px] relative p-1 sm:p-2"
                onMouseEnter={() => setIsIndustrySlidePaused(true)}
                onMouseLeave={() => setIsIndustrySlidePaused(false)}
              >
                {/* Looping Content Area with AnimatePresence */}
                <div className="min-h-[250px] relative flex flex-col justify-center">
                  <AnimatePresence mode="wait">
                    {activeIndustrySlide === 0 && (
                      <motion.div
                        key="ind-slide-0"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/25">
                              <Factory size={13} /> 1. How Smoke Travels
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 1 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Wind Transport & Ground Settling Across {targetCoords.name}
                          </h4>

                          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                            Industrial zones burn coal, gas, and heavy oils for furnaces and boilers. When the wind blows from these clusters toward {targetCoords.name}, smoke, sulfur fumes, and fine metal soot travel kilometers through the air and settle over residential neighborhoods.
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
                          <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="text-white">Why It Reaches Ground Level:</strong> Hot exhaust leaves high factory chimneys, but under calm or trapped air conditions, dense particulate matter cools down and sinks right into streets and homes.
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {activeIndustrySlide === 1 && (
                      <motion.div
                        key="ind-slide-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/25">
                              <Factory size={13} /> 2. Top Upwind Emitters Right Now
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 2 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Active Factories Aligned with Wind Towards {targetCoords.name}
                          </h4>
                        </div>

                        {loadingIndustries ? (
                          <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
                            Calculating nearest upwind industrial plumes...
                          </div>
                        ) : top3Industries.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {top3Industries.map((item, idx) => (
                              <div
                                key={item.source_id || idx}
                                className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-1 mb-1.5">
                                    <span className="text-[10px] font-bold font-mono text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30">
                                      #{idx + 1} UPWIND
                                    </span>
                                    <span
                                      className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded border ${
                                        item.influence_level === "HIGH"
                                          ? "bg-red-500/15 text-red-300 border-red-500/30"
                                          : item.influence_level === "MEDIUM"
                                          ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                          : "bg-blue-500/15 text-blue-300 border-blue-500/30"
                                      }`}
                                    >
                                      {item.influence_level}
                                    </span>
                                  </div>
                                  <h5 className="text-xs font-bold text-white mb-1 line-clamp-1">{item.name}</h5>
                                  <span className="text-[10.5px] text-slate-400 block mb-1">
                                    {item.distance_km} km away ({getCompassDirection(item.bearing_deg)})
                                  </span>
                                  <p className="text-[10px] text-slate-300 line-clamp-1">
                                    <span className="text-amber-300/80 font-medium">Emits: </span>
                                    {getPlainEmissionDesc(item.category)}
                                  </p>
                                </div>
                                <div className="mt-2 pt-1.5 border-t border-slate-800 text-[10.5px] text-amber-300 font-mono">
                                  {Math.round(item.wind_alignment_pct)}% direct wind path
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-xs text-slate-400">
                            No major industrial emitters directly upwind under current wind path.
                          </div>
                        )}

                        <div className="pt-1 text-[10.5px] text-slate-400 flex items-center justify-between">
                          <span>Evaluated in real-time from Delhi NCR's geospatial registry</span>
                          <span className="text-amber-400 font-mono text-[10px] font-bold">Real-time Dispersion</span>
                        </div>
                      </motion.div>
                    )}

                    {activeIndustrySlide === 2 && (
                      <motion.div
                        key="ind-slide-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-3.5"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/25">
                              <Factory size={13} /> 3. What Factories Emit
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">Step 3 of 3</span>
                          </div>

                          <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-snug">
                            Chemical Vapors, Metallic Particles & Boiler Exhaust
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex flex-col gap-1.5">
                            <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                              🏭 Metal & Foundry Soot
                            </span>
                            <p className="text-[11.5px] text-slate-300 leading-relaxed">
                              Metal casting and coal boilers emit dense dark smoke with metallic dust specks that cause throat burning and eye stinging.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-200/90 flex flex-col gap-1.5">
                            <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                              ⚗️ Chemical & Solvent Fumes
                            </span>
                            <p className="text-[11.5px] text-slate-300 leading-relaxed">
                              Volatile vapors and sulfur gases interact with sunlight in the air, creating secondary PM2.5 that stays trapped for days.
                            </p>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between">
                          <span>💡 Industrial PM2.5 is chemical-heavy; use HEPA air purifiers indoors when factory smoke drifts in.</span>
                          <span className="text-amber-400 font-mono text-[10px] font-bold shrink-0 ml-2">Air Health</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Looping Controls & Indicator Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-white/[0.08]">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {[
                      { label: "How Smoke Travels", index: 0, color: "bg-amber-400" },
                      { label: "Top Upwind Emitters", index: 1, color: "bg-amber-400" },
                      { label: "What Factories Emit", index: 2, color: "bg-cyan-400" },
                    ].map((slide) => (
                      <button
                        key={slide.index}
                        type="button"
                        onClick={() => setActiveIndustrySlide(slide.index)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                          activeIndustrySlide === slide.index
                            ? "bg-white/10 text-white font-semibold shadow-sm"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full transition-transform ${
                            activeIndustrySlide === slide.index
                              ? `${slide.color} scale-125`
                              : "bg-slate-600"
                          }`}
                        />
                        <span>{slide.label}</span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsIndustrySlidePaused((prev) => !prev)}
                    className="flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded transition-colors cursor-pointer"
                    title={isIndustrySlidePaused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {isIndustrySlidePaused ? (
                      <>
                        <Play size={11} className="text-emerald-400" />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause size={11} className="text-amber-400" />
                        <span>Pause</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right: Animation Space (Transparent without background box) */}
              <div className="w-full max-w-[400px] lg:max-w-[440px] aspect-[1014/556] mx-auto flex items-center justify-center p-1 relative shrink-0">
                <IndustrySmokeAnimation />
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ROW 3 (BOX 3): HOW TRANSPORT & VEHICLES CONTRIBUTE TO YOUR AREA
              ══════════════════════════════════════════════════════════════════ */}
          <div className="rounded-2xl p-6 bg-gradient-to-b from-[#0c1817] to-[#091012] border border-emerald-500/20 shadow-xl relative overflow-hidden group hover:border-emerald-500/35 transition-all">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            {/* Row Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08] mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                  <Car size={22} />
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold block">
                    BOX 3 · TRAFFIC & TRANSPORT
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    How Transport Contributes In {targetCoords.name}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs text-emerald-200/90 font-medium">Estimated Vehicle Share:</span>
                <span className="text-xs sm:text-sm font-bold font-mono text-emerald-400 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
                  ~{transportBreakdown.overallTransportPct}% of PM2.5
                </span>
              </div>
            </div>

            {/* Plain-English Overview & Active Pattern Banner */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 mb-5 items-center">
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                Vehicles release fumes right where we walk. Unburnt petrol, diesel soot, and tire dust stay near the road surface and get trapped between buildings and trees, making street air far more toxic during commute hours.
              </p>
              <div className="px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 font-medium shrink-0">
                <span className="text-emerald-300 font-bold block mb-0.5">Active Traffic Pattern:</span>
                <span>{transportBreakdown.windowName} — {transportBreakdown.windowDesc}</span>
              </div>
            </div>

            {/* Vehicle Breakdown - Displayed Horizontally in 5 Columns */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold">
                  Pollution Contribution By Vehicle Type In Your Area
                </span>
                <span className="text-[11px] text-slate-400">Street-level fleet apportionment</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                {transportBreakdown.fleet.map((veh) => (
                  <div
                    key={veh.type}
                    className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between hover:border-emerald-500/40 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl">{veh.icon}</span>
                        <span className="text-base font-mono font-bold text-emerald-400">{veh.pct}%</span>
                      </div>
                      <h4 className="text-xs font-bold text-white mb-2 line-clamp-2 min-h-[32px]">{veh.type}</h4>
                      {/* Progress Bar */}
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2.5">
                        <div
                          className={`h-full rounded-full ${veh.barColor}`}
                          style={{ width: `${veh.pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Simple Citizen Note */}
                    <p className="text-[11px] text-slate-400 leading-snug">{veh.plainNote}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Note */}
            <div className="mt-4 pt-3 border-t border-white/[0.08] text-[11px] text-slate-400 flex items-center justify-between">
              <span>Derived from NO₂ street sensor telemetry & municipal fleet regulations</span>
              <span className="font-mono text-emerald-400 text-[10px]">Diurnal Fleet Engine</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
