import { useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web";
import { useTranslation } from "@/i18n";
import salesmanAnimation from "@/assets/pollution_explainer_animation.json";
import industryAnimation from "@/assets/industry_explainer_animation.json";
import bikeAnimation from "@/assets/transport_2wheeler_animation.json";
import carAnimation from "@/assets/transport_car_animation.json";
import truckAnimation from "@/assets/transport_truck_animation.json";
import rickshawAnimation from "@/assets/transport_3wheeler_animation.json";
import { AnimatePresence, motion } from "framer-motion";
import {
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
  /** app-wide station selection (header picker) — controls this section when set */
  selectedUid?: string | null;
  onSelectedUidChange?: (uid: string) => void;
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

type TransportVehicleType = "2wheeler" | "car" | "truck" | "3wheeler";

interface TransportVehicleAnimationProps {
  vehicleType: TransportVehicleType;
}

/** Lottie animation player for the transport vehicle fleet explainer */
function TransportVehicleAnimation({ vehicleType }: TransportVehicleAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const animData = useMemo(() => {
    switch (vehicleType) {
      case "2wheeler":
        return bikeAnimation;
      case "car":
        return carAnimation;
      case "truck":
        return truckAnimation;
      case "3wheeler":
        return rickshawAnimation;
      default:
        return bikeAnimation;
    }
  }, [vehicleType]);

  useEffect(() => {
    if (!containerRef.current) return;
    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: animData,
    });

    return () => {
      anim.destroy();
    };
  }, [animData]);

  return (
    <div
      ref={containerRef}
      key={vehicleType}
      className="w-full h-full max-w-[320px] max-h-[220px] sm:max-w-[340px] sm:max-h-[240px] flex items-center justify-center pointer-events-none select-none [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto"
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
  selectedUid: controlledUid,
  onSelectedUidChange,
}: Props) {
  const stationRows = stations.data ?? [];
  const { t } = useTranslation();

  // Default to Bawana if available, otherwise first station
  const defaultUid = useMemo(() => {
    const bawana = stationRows.find(
      (s) => s.name.toLowerCase().includes("bawana") || s.uid.toLowerCase().includes("bawana")
    );
    return bawana?.uid ?? stationRows[0]?.uid ?? "";
  }, [stationRows]);

  // Controlled by the app-wide station selection (header picker) when wired;
  // internal state keeps the component working standalone.
  const [internalUid, setInternalUid] = useState<string>(defaultUid);
  const selectedUid = controlledUid ?? internalUid;
  const setSelectedUid = (uid: string) => {
    setInternalUid(uid);
    onSelectedUidChange?.(uid);
  };

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

  // Row 3 sequential cycling slides for transport & vehicle fleet
  // 0: 2-Wheelers (Bikes & Scooters)
  // 1: Cars & 4-Wheelers (Cabs & SUVs)
  // 2: Trucks & Freight (Diesel Commercial)
  // 3: 3-Wheelers (Auto-Rickshaws)
  const [activeTransportSlide, setActiveTransportSlide] = useState<number>(0);
  const [isTransportSlidePaused, setIsTransportSlidePaused] = useState<boolean>(false);

  useEffect(() => {
    if (isTransportSlidePaused) return;
    const timer = setInterval(() => {
      setActiveTransportSlide((prev) => (prev + 1) % 4);
    }, 6000);

    return () => clearInterval(timer);
  }, [isTransportSlidePaused]);

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

  // Vehicle details mapped for active vehicle display & synchronization
  const vehicleDetails = useMemo(() => {
    const fleet = transportBreakdown.fleet;
    const findItem = (terms: string[]) =>
      fleet.find((f) => terms.some((t) => f.type.toLowerCase().includes(t.toLowerCase())));

    const bikeItem = findItem(["2-wheeler", "bike", "motorcycle", "scooter"]) ?? {
      pct: 38,
      type: "2-Wheelers (Bikes & Scooters)",
      barColor: "bg-cyan-500",
    };
    const carItem = findItem(["car", "taxi", "cab", "suv"]) ?? {
      pct: 22,
      type: "Cars, Cabs & SUVs",
      barColor: "bg-sky-500",
    };
    const truckItem = findItem(["truck", "freight", "commercial"]) ?? {
      pct: 28,
      type: "Heavy Diesel Trucks & Freight",
      barColor: "bg-amber-500",
    };
    const rickshawItem = findItem(["3-wheeler", "auto", "rickshaw"]) ?? {
      pct: 10,
      type: "3-Wheelers & Auto-Rickshaws",
      barColor: "bg-emerald-500",
    };

    return [
      {
        vehicleType: "2wheeler" as const,
        name: "2-Wheelers",
        subName: "Bikes & Scooters",
        icon: "🛵",
        pct: bikeItem.pct,
        color: "from-cyan-400 to-blue-500",
        accentColor: "text-cyan-400",
        bgAccent: "bg-cyan-500/15 border-cyan-500/30",
        barColor: "bg-cyan-500",
        tag: "Direct Breath-Level Exposure",
      },
      {
        vehicleType: "car" as const,
        name: "Cars & Cabs",
        subName: "Personal & App Taxis",
        icon: "🚗",
        pct: carItem.pct,
        color: "from-sky-400 to-indigo-500",
        accentColor: "text-sky-400",
        bgAccent: "bg-sky-500/15 border-sky-500/30",
        barColor: "bg-sky-500",
        tag: "Idling & NO₂ Gas Corridors",
      },
      {
        vehicleType: "truck" as const,
        name: "Trucks & Freight",
        subName: "Diesel Commercial Fleet",
        icon: "🚛",
        pct: truckItem.pct,
        color: "from-amber-400 to-red-500",
        accentColor: "text-amber-400",
        bgAccent: "bg-amber-500/15 border-amber-500/30",
        barColor: "bg-amber-500",
        tag: "Heavy Soot & Night Entry",
      },
      {
        vehicleType: "3wheeler" as const,
        name: "3-Wheelers",
        subName: "Auto-Rickshaws",
        icon: "🛺",
        pct: rickshawItem.pct,
        color: "from-emerald-400 to-teal-500",
        accentColor: "text-emerald-400",
        bgAccent: "bg-emerald-500/15 border-emerald-500/30",
        barColor: "bg-emerald-500",
        tag: "Hub Pickups & Acceleration",
      },
    ];
  }, [transportBreakdown.fleet]);

  const currentVehicle = vehicleDetails[activeTransportSlide] ?? vehicleDetails[0];

  return (
    <section
      id="citizen-pollution-breakdown"
      className="relative w-full py-12 px-4 sm:px-6 lg:px-8 overflow-hidden"
      style={{
        background: "transparent",
      }}
      aria-label={t("pages.citizen.ariaGuide")}
    >
      <div className="max-w-7xl mx-auto">
        {/* Top Header & Neighbourhood Switcher Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-8 mb-8 border-b border-white/[0.08]">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-mono font-medium tracking-wide mb-2.5">
              <Users size={14} className="text-cyan-400" />
              <span>{t("pages.citizen.badge")}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-sans">
              {t("pages.citizen.whatsPolluting", { name: targetCoords.name })}
            </h2>
            {/* 3 compact topic pills instead of a long paragraph */}
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 font-medium">
                <Wind size={11} className="shrink-0" />
                Weather Trapping
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-medium">
                <Factory size={11} className="shrink-0" />
                Industry Smoke
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 font-medium">
                <Car size={11} className="shrink-0" />
                Road Traffic
              </span>
            </div>
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
                  aria-label={t("pages.citizen.ariaStationSel")}
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
        <div className="flex flex-col gap-16 w-full">
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
                  <span className="text-xs font-sans uppercase tracking-wider text-cyan-400 font-semibold block">
                    EVERYDAY AIR EXPLAINER
                  </span>
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-sans">
                    {t("pages.citizen.whyPolluted", { name: targetCoords.name })}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs sm:text-sm text-slate-300 font-medium">Current PM2.5 in {targetCoords.name}:</span>
                <span className="text-xs sm:text-sm font-semibold text-cyan-300 px-3 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/25">
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
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          The current air quality at {targetCoords.name} is{" "}
                          <span className={`font-semibold ${aqiMeta.color}`}>
                            {Math.round(areaPm25)} µg/m³ PM2.5 ({aqiMeta.label})
                          </span>
                          , trapped near the ground because{" "}
                          <span className="text-cyan-300 font-semibold">
                            {windSpeedMs < 2.0 ? "calm stagnant breezes" : "a cool air lid"}
                          </span>{" "}
                          prevent emissions from escaping upward.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                              <Wind size={16} className="shrink-0" />
                              <span>{t("pages.citizen.lid")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              {weatherTrappingReason}
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                              <Info size={16} className="shrink-0" />
                              <span>{t("pages.citizen.pmHazard")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Toxic soot specks 30× thinner than human hair bypass nasal filters and penetrate deep into lungs and blood vessels.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeSlideIndex === 1 && (
                      <motion.div
                        key="slide-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          {t("pages.citizen.peaksLine1")} {targetCoords.name} {t("pages.citizen.peaksBetween")}{" "}
                          <span className="text-amber-400 font-semibold">{t("pages.citizen.peakWindow")}</span>,
                          {t("pages.citizen.making")}{" "}
                          <span className="text-emerald-400 font-semibold">{t("pages.citizen.safeWindow")}</span>{" "}
                          {t("pages.citizen.peaksSuffix")}
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/25 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                              <Clock size={16} className="shrink-0" />
                              <span>{t("pages.citizen.safeVent")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Afternoon sunshine thins out the cold ground smog layer. Air out your home and run outdoor errands during this clean-air window.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-rose-500/[0.08] border border-rose-500/25 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                              <ShieldAlert size={16} className="shrink-0" />
                              <span>{t("pages.citizen.childrenSeniors")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Children and senior citizens experience throat cough and irritation first. Keep doctor prescribed inhalers handy and avoid indoor incense.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeSlideIndex === 2 && (
                      <motion.div
                        key="slide-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          To protect your lungs today, wear a{" "}
                          <span className="text-emerald-400 font-semibold">certified N95 mask outside</span>{" "}
                          and keep{" "}
                          <span className="text-cyan-300 font-semibold">street-facing windows sealed</span>{" "}
                          during morning smog.
                        </div>

                        {/* Structured 3-card checklist */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1 shadow-sm">
                            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                              <CheckCircle2 size={16} className="shrink-0" />
                              <span>1. Use N95 Mask</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                              Cloth masks do not stop PM2.5. A snug N95 or N99 filters over 95% of toxic airborne soot when commuting.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                              <CheckCircle2 size={16} className="shrink-0" />
                              <span>2. Shut Road Windows</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                              Keep street windows closed during night and morning smog peaks; ventilate only after midday sun warms the air.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1 shadow-sm">
                            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                              <CheckCircle2 size={16} className="shrink-0" />
                              <span>3. Exercise Indoors</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                              Outdoor jogging forces toxic soot 5× deeper into lung alveoli. Switch physical workouts to indoor spaces.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Looping Controls & Indicator Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-1 border-t border-white/[0.08]">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {[
                      { label: "Air Status & Weather", index: 0, color: "bg-cyan-400" },
                      { label: "Family Health Hours", index: 1, color: "bg-amber-400" },
                      { label: "Immediate Checklist", index: 2, color: "bg-emerald-400" },
                    ].map((slide) => (
                      <button
                        key={slide.index}
                        type="button"
                        onClick={() => setActiveSlideIndex(slide.index)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                          activeSlideIndex === slide.index
                            ? "bg-white/10 text-white font-semibold shadow-sm border border-white/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
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
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-white/10"
                    title={isSlidePaused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {isSlidePaused ? (
                      <>
                        <Play size={12} className="text-emerald-400" />
                        <span>{t("pages.citizen.resume")}</span>
                      </>
                    ) : (
                      <>
                        <Pause size={12} className="text-amber-400" />
                        <span>{t("pages.citizen.pause")}</span>
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
                  <span className="text-xs font-sans uppercase tracking-wider text-amber-400 font-semibold block">
                    FACTORIES & INDUSTRIAL PLANTS
                  </span>
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-sans">
                    How Industries Affect {targetCoords.name}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs sm:text-sm text-slate-300 font-medium">{t("pages.citizen.factoryShare")}</span>
                <span className="text-xs sm:text-sm font-semibold text-amber-400 px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30">
                  {t("pages.citizen.factorySharePct", { pct: 24, name: targetCoords.name })}
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
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          Industrial plants account for{" "}
                          <span className="text-amber-400 font-semibold">
                            {t("pages.citizen.factorySharePct", { pct: 24, name: targetCoords.name })}
                          </span>
                          , with smokestack emissions cooling and{" "}
                          <span className="text-slate-200 font-semibold">
                            sinking directly into neighborhood streets
                          </span>.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                              <Factory size={16} className="shrink-0" />
                              <span>{t("pages.citizen.chimneyGround")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Hot exhaust starts high in chimneys, but under calm winds and trapped air, the dense particulate smoke cools down and sinks right into street-level air.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                              <Wind size={16} className="shrink-0" />
                              <span>{t("pages.citizen.kmTransport")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Winds blowing from industrial belts push continuous plumes of furnace soot, sulfur, and chemical vapors into residential neighborhoods.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeIndustrySlide === 1 && (
                      <motion.div
                        key="ind-slide-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          Currently,{" "}
                          <span className="text-amber-400 font-semibold">
                            {top3Industries[0]?.name || "upwind industrial clusters"}
                          </span>{" "}
                          {t("pages.citizen.activelyBlowing")}{" "}
                          <span className="text-cyan-300 font-semibold">
                            {t("pages.citizen.windPathInto", { name: targetCoords.name })}
                          </span>.
                        </div>

                        {loadingIndustries ? (
                          <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
                            Calculating nearest upwind industrial plumes...
                          </div>
                        ) : top3Industries.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                            {top3Industries.map((item, idx) => (
                              <div
                                key={item.source_id || idx}
                                className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between shadow-sm"
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-1 mb-1.5">
                                    <span className="text-[10px] font-bold font-sans text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-md border border-amber-500/30">
                                      #{idx + 1} {t("pages.citizen.upwindBadge")}
                                    </span>
                                    <span
                                      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
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
                                  <span className="text-[11px] text-slate-400 block mb-1">
                                    {t("pages.citizen.kmAway", { km: item.distance_km, dir: getCompassDirection(item.bearing_deg) })}
                                  </span>
                                  <p className="text-[10.5px] text-slate-300 line-clamp-1">
                                    <span className="text-amber-300/90 font-medium">{t("pages.citizen.emits")} </span>
                                    {getPlainEmissionDesc(item.category)}
                                  </p>
                                </div>
                                <div className="mt-2 pt-1.5 border-t border-slate-800 text-[11px] text-amber-300 font-sans font-semibold">
                                  {t("pages.citizen.windAlignment", { pct: Math.round(item.wind_alignment_pct) })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 text-xs text-slate-400">
                            No major industrial emitters directly upwind under current wind path.
                          </div>
                        )}
                      </motion.div>
                    )}

                    {activeIndustrySlide === 2 && (
                      <motion.div
                        key="ind-slide-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Prominent Lead Statement in clean font matching Image 2 */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          Factories surrounding the area emit{" "}
                          <span className="text-amber-400 font-semibold">
                            dense furnace soot, sulfur fumes, and solvent vapors
                          </span>{" "}
                          that irritate eyes, throat, and lung tissues.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                              <Factory size={16} className="shrink-0" />
                              <span>{t("pages.citizen.metalSoot")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Metal casting and coal boilers emit dense dark smoke with metallic dust specks that cause throat burning and eye stinging.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                              <Wind size={16} className="shrink-0" />
                              <span>{t("pages.citizen.chemicalFumes")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Volatile vapors and sulfur gases interact with sunlight in the air, creating secondary PM2.5 that lingers for days.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Looping Controls & Indicator Navigation */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-1 border-t border-white/[0.08]">
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
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                          activeIndustrySlide === slide.index
                            ? "bg-white/10 text-white font-semibold shadow-sm border border-white/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
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
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-white/10"
                    title={isIndustrySlidePaused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {isIndustrySlidePaused ? (
                      <>
                        <Play size={12} className="text-emerald-400" />
                        <span>{t("pages.citizen.resume")}</span>
                      </>
                    ) : (
                      <>
                        <Pause size={12} className="text-amber-400" />
                        <span>{t("pages.citizen.pause")}</span>
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
              ROW 3 (BOX 3): HOW VEHICLES & ROAD TRAFFIC AFFECT YOUR AREA
              ══════════════════════════════════════════════════════════════════ */}
          <div className="relative w-full pb-4">
            {/* Row Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.08] mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                  <Car size={22} />
                </div>
                <div>
                  <span className="text-xs font-sans uppercase tracking-wider text-emerald-400 font-semibold block">
                    VEHICLE EMISSIONS & TRAFFIC FLEET
                  </span>
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-sans">
                    How Vehicles & Road Traffic Affect {targetCoords.name}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs sm:text-sm text-slate-300 font-medium">{t("pages.citizen.vehicleShare")}</span>
                <span className="text-xs sm:text-sm font-semibold text-emerald-400 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
                  ~{transportBreakdown.overallTransportPct}% of PM2.5 in {targetCoords.name}
                </span>
              </div>
            </div>

            {/* 2-Column Split: Animation on LEFT + Interactive Vehicle Slides on RIGHT */}
            <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] lg:grid-cols-[340px_1fr] gap-6 items-center">
              {/* Left: Dynamic Multi-Vehicle Lottie Animation & Fleet Badge */}
              <div className="w-full max-w-[340px] mx-auto flex flex-col items-center justify-center gap-3.5 p-1 relative shrink-0">
                <div className="w-full aspect-[16/10] flex items-center justify-center overflow-hidden">
                  <TransportVehicleAnimation vehicleType={currentVehicle.vehicleType} />
                </div>

                {/* Fleet Contribution Indicator below animation */}
                <div className="w-full max-w-[300px] p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-white">
                      <span className="text-base">{currentVehicle.icon}</span>
                      <span>{currentVehicle.name}</span>
                    </div>
                    <span className={`font-mono font-bold ${currentVehicle.accentColor}`}>
                      ~{currentVehicle.pct}% of Fleet
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${currentVehicle.barColor} transition-all duration-500`}
                      style={{ width: `${currentVehicle.pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{currentVehicle.subName}</span>
                    <span className="text-slate-400/80 font-mono text-[10px]">· {currentVehicle.tag}</span>
                  </div>
                </div>
              </div>

              {/* Right: Looping 4-Vehicle Slides with citizen-statement-font */}
              <div
                className="flex flex-col justify-between min-h-[310px] relative p-1 sm:p-2"
                onMouseEnter={() => setIsTransportSlidePaused(true)}
                onMouseLeave={() => setIsTransportSlidePaused(false)}
              >
                {/* Active Traffic Window Banner */}
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium">
                    <Clock size={13} className="text-emerald-400 shrink-0" />
                    <span className="font-semibold">{transportBreakdown.windowName}</span>
                    <span className="text-emerald-400/60 hidden sm:inline">·</span>
                    <span className="text-slate-300 hidden sm:inline">{transportBreakdown.windowDesc}</span>
                  </div>
                </div>

                {/* Looping Content Area with AnimatePresence */}
                <div className="min-h-[220px] relative flex flex-col justify-center">
                  <AnimatePresence mode="wait">
                    {activeTransportSlide === 0 && (
                      <motion.div
                        key="veh-slide-0"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Lead Statement */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          2-Wheelers represent{" "}
                          <span className="text-cyan-400 font-semibold">
                            ~{vehicleDetails[0].pct}% of local vehicle PM2.5 in {targetCoords.name}
                          </span>
                          , discharging unburnt hydrocarbons and fine soot{" "}
                          <span className="text-cyan-200 font-semibold">
                            directly at pedestrian breathing height
                          </span>.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                              <Wind size={16} className="shrink-0" />
                              <span>{t("pages.citizen.breathExhaust")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Unlike trucks with tall stacks, motorcycle and scooter exhausts sit 30–45 cm off the road, bathing pedestrians, cyclists, and nearby riders directly in raw tailpipe fumes.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                              <Info size={16} className="shrink-0" />
                              <span>{t("pages.citizen.stopGo")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Frequent low-gear throttling and deceleration at traffic choke points prevent complete combustion, pumping dense unburnt carbon monoxide and black soot into street air.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTransportSlide === 1 && (
                      <motion.div
                        key="veh-slide-1"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Lead Statement */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          Cars, Cabs & SUVs generate{" "}
                          <span className="text-sky-400 font-semibold">
                            ~{vehicleDetails[1].pct}% of vehicle emissions
                          </span>
                          , multiplying toxic{" "}
                          <span className="text-sky-200 font-semibold">
                            Nitrogen Dioxide (NO₂) and ozone
                          </span>{" "}
                          during congested bumper-to-bumper commutes.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm">
                              <Clock size={16} className="shrink-0" />
                              <span>{t("pages.citizen.gridlock")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Cars crawling in traffic jams with air conditioning running idle fuel inefficiently, producing up to 3× higher nitrogen oxides (NO₂) that react with sunlight into stinging smog.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                              <ShieldAlert size={16} className="shrink-0" />
                              <span>{t("pages.citizen.brakeDust")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Heavier four-wheelers produce substantial non-exhaust PM10 particles through abrasive brake pad friction and rubber tire tread wear on paved road surfaces.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTransportSlide === 2 && (
                      <motion.div
                        key="veh-slide-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Lead Statement */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          Heavy Diesel Trucks account for{" "}
                          <span className="text-amber-400 font-semibold">
                            ~{vehicleDetails[2].pct}% of road soot in {targetCoords.name}
                          </span>
                          , spewing thick plumes of{" "}
                          <span className="text-amber-200 font-semibold">
                            carcinogenic black carbon
                          </span>{" "}
                          when nighttime city entry bans lift.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                              <Factory size={16} className="shrink-0" />
                              <span>{t("pages.citizen.dieselSoot")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Interstate commercial diesel trailers burning fuel under heavy cargo loads release elemental black carbon (soot) that lodges deep in human lung alveoli.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-rose-400 font-semibold text-sm">
                              <ShieldAlert size={16} className="shrink-0" />
                              <span>{t("pages.citizen.nightWindow")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              When highway entry bans lift after 10 PM, thousands of freight trucks enter arterial rings just as cold night air traps exhaust within 100 meters of the ground.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTransportSlide === 3 && (
                      <motion.div
                        key="veh-slide-3"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="flex flex-col justify-between h-full space-y-4"
                      >
                        {/* Lead Statement */}
                        <div className="citizen-statement-font text-base sm:text-lg lg:text-[20px] font-medium text-slate-100 leading-relaxed">
                          3-Wheelers & Auto-Rickshaws generate{" "}
                          <span className="text-emerald-400 font-semibold">
                            ~{vehicleDetails[3].pct}% of transit emissions
                          </span>
                          , running continuous{" "}
                          <span className="text-emerald-200 font-semibold">
                            last-mile feeder trips
                          </span>{" "}
                          with repeated rapid acceleration at neighborhood hubs.
                        </div>

                        {/* Structured 2-card breakdown */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                              <CheckCircle2 size={16} className="shrink-0" />
                              <span>{t("pages.citizen.hubPickups")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              Navigating narrow neighborhood roads, frequent passenger pickups, and idling near metro station gates produce concentrated localized tailpipe bursts.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 shadow-sm">
                            <div className="flex items-center gap-2 text-teal-400 font-semibold text-sm">
                              <Info size={16} className="shrink-0" />
                              <span>{t("pages.citizen.cngFleet")}</span>
                            </div>
                            <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed">
                              While Delhi's CNG fleet emits virtually no coarse black diesel soot, older engines and unserviced fuel kits still discharge fine nitrogen gases and vapor particles.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Navigation Pill Tabs for 4 Vehicles + Pause/Resume Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-1 border-t border-white/[0.08]">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    {[
                      { label: "2-Wheelers", index: 0, color: "bg-cyan-400" },
                      { label: "Cars & Cabs", index: 1, color: "bg-sky-400" },
                      { label: "Trucks & Freight", index: 2, color: "bg-amber-400" },
                      { label: "3-Wheelers", index: 3, color: "bg-emerald-400" },
                    ].map((slide) => (
                      <button
                        key={slide.index}
                        type="button"
                        onClick={() => setActiveTransportSlide(slide.index)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                          activeTransportSlide === slide.index
                            ? "bg-white/10 text-white font-semibold shadow-sm border border-white/10"
                            : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full transition-transform ${
                            activeTransportSlide === slide.index
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
                    onClick={() => setIsTransportSlidePaused((prev) => !prev)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-white/10"
                    title={isTransportSlidePaused ? "Resume auto-advance" : "Pause auto-advance"}
                  >
                    {isTransportSlidePaused ? (
                      <>
                        <Play size={12} className="text-emerald-400" />
                        <span>{t("pages.citizen.resume")}</span>
                      </>
                    ) : (
                      <>
                        <Pause size={12} className="text-amber-400" />
                        <span>{t("pages.citizen.pause")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Info Footnote */}
            <div className="mt-4 pt-3 border-t border-white/[0.08] text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
              <span>{t("pages.citizen.derived")}</span>
              <span className="font-mono text-emerald-400 text-[10px]">{t("pages.citizen.fleetEngine")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
