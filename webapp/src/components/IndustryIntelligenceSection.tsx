import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart2,
  Cpu,
  ExternalLink,
  Factory,
  Flame,
  Gauge,
  Radio,
  ShieldAlert,
  Thermometer,
  Wind,
} from "lucide-react";

import {
  calculateGaussianPlumeConcentration,
  haversineDistanceKm,
  type SupabaseIndustryRecord,
} from "@/lib/industrySupabase";
import { useTranslation } from "@/i18n";
import "@/styles/industry-intelligence.css";

export interface IndustryIntelligenceSectionProps {
  selectedIndustry: SupabaseIndustryRecord | null;
  onSelectIndustry: (ind: SupabaseIndustryRecord) => void;
  radiusKm: number;
  centerCoords?: { lat: number; lng: number };
  activeIndustries?: SupabaseIndustryRecord[];
  windSpeedKmh?: number;
}

export function IndustryIntelligenceSection({
  selectedIndustry,
  onSelectIndustry,
  radiusKm,
  centerCoords: _centerCoords = { lat: 28.6139, lng: 77.209 },
  activeIndustries = [],
  windSpeedKmh = 12.0,
}: IndustryIntelligenceSectionProps) {
  const { t } = useTranslation();
  // Default mock plant if none clicked yet
  const displayIndustry: SupabaseIndustryRecord = selectedIndustry || {
    id: 136258,
    industry_name: "Badarpur Thermal Power Station",
    category: "Thermal Power Plant",
    latitude: 28.5032,
    longitude: 77.3068,
    city: "Delhi",
    state: "Delhi",
    country: "India",
    tier: "red",
    tierColor: "#ff3b5c",
    tierLabel: "Critical · Red Tier",
    estimatedStackHeight: 120,
    estimatedEmissions: {
      pm25_kg_day: 148.5,
      so2_kg_day: 210.0,
      no2_kg_day: 185.0,
      voc_kg_day: 42.0,
      co_kg_day: 280.0,
      tons_per_year: 285.5,
      flue_gas_velocity_ms: 22.4,
      stack_temp_c: 185,
    },
  };

  // Top local contributors dynamically calculated from active industries or surrounding airshed
  const topContributors = useMemo(() => {
    const centerLat = selectedIndustry ? selectedIndustry.latitude : _centerCoords.lat;
    const centerLng = selectedIndustry ? selectedIndustry.longitude : _centerCoords.lng;

    let sourceList: SupabaseIndustryRecord[] = [];
    if (activeIndustries && activeIndustries.length > 0) {
      sourceList = activeIndustries;
    }

    if (sourceList.length === 0) {
      const defaultSet: SupabaseIndustryRecord[] = [
        displayIndustry,
        {
          id: 136311,
          industry_name: "Narela Speciality Petrochemicals #17",
          category: "Petrochemicals & Polymers",
          latitude: 28.835087,
          longitude: 77.089032,
          city: "Delhi",
          state: "Delhi",
          country: "India",
          tier: "red",
          tierColor: "#ff3b5c",
          tierLabel: "Critical · Red Tier",
          estimatedStackHeight: 90,
          estimatedEmissions: {
            pm25_kg_day: 120,
            so2_kg_day: 180,
            no2_kg_day: 160,
            voc_kg_day: 95,
            co_kg_day: 140,
            tons_per_year: 245,
            flue_gas_velocity_ms: 19.5,
            stack_temp_c: 160,
          },
        },
        {
          id: 136312,
          industry_name: "Narela High-Alloy Castings #18",
          category: "Steel & Foundry Smelting",
          latitude: 28.831291,
          longitude: 77.087458,
          city: "Delhi",
          state: "Delhi",
          country: "India",
          tier: "red",
          tierColor: "#ff3b5c",
          tierLabel: "Critical · Red Tier",
          estimatedStackHeight: 75,
          estimatedEmissions: {
            pm25_kg_day: 110,
            so2_kg_day: 130,
            no2_kg_day: 90,
            voc_kg_day: 25,
            co_kg_day: 190,
            tons_per_year: 195,
            flue_gas_velocity_ms: 18.0,
            stack_temp_c: 175,
          },
        },
        {
          id: 136309,
          industry_name: "Narela Fabric & Dyeing Works #15",
          category: "Textile Finishing",
          latitude: 28.835777,
          longitude: 77.08337,
          city: "Delhi",
          state: "Delhi",
          country: "India",
          tier: "orange",
          tierColor: "#ff9f1c",
          tierLabel: "Moderate · Orange Tier",
          estimatedStackHeight: 45,
          estimatedEmissions: {
            pm25_kg_day: 48,
            so2_kg_day: 55,
            no2_kg_day: 42,
            voc_kg_day: 30,
            co_kg_day: 80,
            tons_per_year: 85,
            flue_gas_velocity_ms: 12.0,
            stack_temp_c: 125,
          },
        },
      ];
      sourceList = defaultSet;
    }

    const mapped = sourceList.map((ind) => {
      const distance = haversineDistanceKm(centerLat, centerLng, ind.latitude, ind.longitude);
      const em = ind.estimatedEmissions;
      const dailyOutputKg = Number(
        (em.pm25_kg_day + em.so2_kg_day + em.no2_kg_day + (em.co_kg_day || 0) * 0.2).toFixed(1)
      );

      let primaryPollutant = "PM2.5 / SO2";
      const cat = (ind.category || "").toLowerCase();
      if (cat.includes("power") || cat.includes("coal") || cat.includes("thermal")) {
        primaryPollutant = "PM2.5 / SO2";
      } else if (cat.includes("petro") || cat.includes("chemical") || cat.includes("pharma")) {
        primaryPollutant = "VOCs / NO2";
      } else if (cat.includes("steel") || cat.includes("foundry") || cat.includes("smelt")) {
        primaryPollutant = "PM2.5 / Heavy Metals";
      } else if (cat.includes("textile") || cat.includes("dye") || cat.includes("garment")) {
        primaryPollutant = "PM10 / Boiler Smoke";
      } else if (cat.includes("food") || cat.includes("dairy") || cat.includes("agro")) {
        primaryPollutant = "PM10 / Flue Gas";
      } else if (cat.includes("ceramic") || cat.includes("glass") || cat.includes("cement")) {
        primaryPollutant = "PM2.5 / Silica Dust";
      }

      const proximityWeight = 1 / Math.max(0.4, distance * 0.7);
      const impactScore = dailyOutputKg * proximityWeight;

      return {
        industryRecord: ind,
        id: ind.id,
        name: ind.industry_name,
        category: ind.category || "Industrial Facility",
        tier: (ind.tier === "green" || ind.tier === "white" ? "green" : ind.tier) as "red" | "orange" | "green",
        tierColor: ind.tierColor,
        distanceKm: distance,
        primaryPollutant,
        dailyOutputKg,
        impactScore,
        lat: ind.latitude,
        lng: ind.longitude,
      };
    });

    const sorted = [...mapped].sort((a, b) => b.impactScore - a.impactScore).slice(0, 8);
    const totalScore = sorted.reduce((sum, item) => sum + item.impactScore, 0) || 1;

    return sorted.map((item) => ({
      ...item,
      impactPercent: Number(((item.impactScore / totalScore) * 100).toFixed(1)),
    }));
  }, [activeIndustries, selectedIndustry, _centerCoords.lat, _centerCoords.lng, displayIndustry]);

  // Compute Gaussian Plume curve at distances
  const plumeDistances = [100, 300, 700, 1500, 3000, 5000, 8000, 12000]; // meters
  const windMps = (windSpeedKmh * 1000) / 3600;
  const pm25RateGps = (displayIndustry.estimatedEmissions.pm25_kg_day * 1000) / 86400;

  const plumeConcentrations = useMemo(() => {
    return plumeDistances.map((dist) => {
      const conc = calculateGaussianPlumeConcentration(
        dist,
        pm25RateGps,
        windMps,
        displayIndustry.estimatedStackHeight
      );
      return {
        distLabel: dist >= 1000 ? `${dist / 1000}km` : `${dist}m`,
        distMeters: dist,
        concentration: conc,
      };
    });
  }, [pm25RateGps, windMps, displayIndustry.estimatedStackHeight]);

  const maxPlume = useMemo(() => {
    let top = plumeConcentrations[0];
    for (const p of plumeConcentrations) {
      if (p.concentration > top.concentration) top = p;
    }
    return top;
  }, [plumeConcentrations]);

  const hourlyPm25Rate = (displayIndustry.estimatedEmissions.pm25_kg_day / 24).toFixed(2);
  const hourlyTotalRate = (
    (displayIndustry.estimatedEmissions.pm25_kg_day +
      displayIndustry.estimatedEmissions.so2_kg_day +
      displayIndustry.estimatedEmissions.no2_kg_day) /
    24
  ).toFixed(2);

  return (
    <div className="w-full space-y-6" id="industry-intelligence-dashboard">
      {/* ── Section Title Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-glass)] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[var(--accent-cyan)] font-mono text-xs uppercase tracking-wider">
            <Cpu className="w-4 h-4 text-[var(--accent-cyan)] animate-pulse" />
            <span>{t("pages.industry.digitalTwin")}</span>
          </div>
          <h2 className="text-2xl font-bold text-white mt-1 font-sans">
            Stack Emission Intelligence & Downwind Dispersion
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-[rgba(10,20,38,0.7)] border border-[var(--border-glass)] text-xs font-mono text-slate-300 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
            <span>Active Sector Radius: {radiusKm} km</span>
          </div>

          <a
            href={`/industry-details.html?id=${encodeURIComponent(
              String(displayIndustry.id)
            )}&lat=${displayIndustry.latitude}&lng=${displayIndustry.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="cyber-btn text-xs"
          >
            <span>{t("pages.industry.deepIntel")}</span>
            <ExternalLink className="w-3.5 h-3.5 ml-1" />
          </a>
        </div>
      </div>

      {/* ── Top Row: Digital Twin Stack Card + Plume Dispersion Simulator ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 1. Digital Twin Stack Emission Card (7 cols) */}
        <div className="lg:col-span-7 glass-panel p-5 space-y-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-lg"
                style={{
                  backgroundColor: `${displayIndustry.tierColor}15`,
                  borderColor: `${displayIndustry.tierColor}40`,
                  color: displayIndustry.tierColor,
                }}
              >
                <Factory className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white leading-tight">
                  {displayIndustry.industry_name}
                </h3>
                <p className="text-xs text-slate-400">
                  {displayIndustry.category || "Industrial Complex"} · {displayIndustry.city || "Delhi"}
                </p>
              </div>
            </div>

            <span
              className={`px-2.5 py-1 rounded text-xs font-mono uppercase font-semibold ${
                displayIndustry.tier === "red"
                  ? "badge-red"
                  : displayIndustry.tier === "orange"
                  ? "badge-orange"
                  : "badge-green"
              }`}
            >
              {displayIndustry.tierLabel}
            </span>
          </div>

          {/* Key Metrics Micro-Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-panel-sub p-3">
              <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <Flame className="w-3 h-3 text-[#ff3b5c]" />
                PM2.5 Rate
              </span>
              <div className="text-lg font-bold font-mono text-[#ff3b5c] mt-0.5">
                {hourlyPm25Rate} <span className="text-xs text-slate-400 font-normal">kg/hr</span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                {displayIndustry.estimatedEmissions.pm25_kg_day} kg/day
              </span>
            </div>

            <div className="glass-panel-sub p-3">
              <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <Activity className="w-3 h-3 text-[#ff9f1c]" />
                Total Emission
              </span>
              <div className="text-lg font-bold font-mono text-[#ff9f1c] mt-0.5">
                {hourlyTotalRate} <span className="text-xs text-slate-400 font-normal">kg/hr</span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                {displayIndustry.estimatedEmissions.tons_per_year} tons/yr
              </span>
            </div>

            <div className="glass-panel-sub p-3">
              <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <Gauge className="w-3 h-3 text-[var(--accent-cyan)]" />
                Stack Height
              </span>
              <div className="text-lg font-bold font-mono text-white mt-0.5">
                {displayIndustry.estimatedStackHeight} <span className="text-xs text-slate-400 font-normal">m</span>
              </div>
              <span className="text-[9px] text-slate-500 font-mono">
                {displayIndustry.estimatedEmissions.flue_gas_velocity_ms} m/s Flue
              </span>
            </div>

            <div className="glass-panel-sub p-3">
              <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                <Thermometer className="w-3 h-3 text-[var(--accent-teal)]" />
                Exhaust Temp
              </span>
              <div className="text-lg font-bold font-mono text-[var(--accent-teal)] mt-0.5">
                {displayIndustry.estimatedEmissions.stack_temp_c}°C
              </div>
              <span className="text-[9px] text-slate-500 font-mono">{t("pages.industry.superheated")}</span>
            </div>
          </div>

          {/* Full Pollutant Speciation Spectrum */}
          <div className="glass-panel-sub p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-semibold">{t("pages.industry.cemsTitle")}</span>
              <span className="text-slate-400 text-[10px]">{t("pages.industry.cemsSub")}</span>
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>{t("pages.industry.so2")}</span>
                  <span className="text-[#ff9f1c] font-bold">
                    {displayIndustry.estimatedEmissions.so2_kg_day} kg/day
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        (displayIndustry.estimatedEmissions.so2_kg_day / 220) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>{t("pages.industry.nox")}</span>
                  <span className="text-[var(--accent-teal)] font-bold">
                    {displayIndustry.estimatedEmissions.no2_kg_day} kg/day
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-400 to-cyan-500 rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        (displayIndustry.estimatedEmissions.no2_kg_day / 200) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1 font-mono">
                  <span>{t("pages.industry.coVoc")}</span>
                  <span className="text-slate-200 font-bold">
                    {displayIndustry.estimatedEmissions.co_kg_day +
                      displayIndustry.estimatedEmissions.voc_kg_day}{" "}
                    kg/day
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        ((displayIndustry.estimatedEmissions.co_kg_day +
                          displayIndustry.estimatedEmissions.voc_kg_day) /
                          300) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Plume Dispersion Simulator (5 cols) */}
        <div className="lg:col-span-5 glass-panel p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border-glass)] pb-3">
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Wind className="w-4 h-4 text-[var(--accent-cyan)]" />
                Gaussian Plume Downwind Dispersion
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                C(x) = [Q / (π·u·σy·σz)] · exp(-H² / 2σz²)
              </p>
            </div>
            <span className="px-2 py-0.5 rounded bg-[rgba(56,180,255,0.1)] text-[var(--accent-cyan)] font-mono text-[10px]">
              Class D Neutral
            </span>
          </div>

          {/* Peak Ground Impact Alert */}
          <div className="glass-panel-sub p-3 border-l-4 border-l-[#ff3b5c] flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[#ff3b5c] shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold text-white block">
                Peak Ground Contamination at {maxPlume.distLabel}
              </span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Maximum calculated downwind PM2.5 ground surge reaches{" "}
                <span className="font-mono text-[#ff3b5c] font-bold">
                  +{maxPlume.concentration} µg/m³
                </span>{" "}
                above ambient baseline.
              </p>
            </div>
          </div>

          {/* Discrete Concentration Falloff Chart */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono text-slate-400 flex justify-between">
              <span>{t("pages.industry.downwind")}</span>
              <span>{t("pages.industry.pmSurge")}</span>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs">
              {plumeConcentrations.slice(0, 4).map((p) => (
                <div key={p.distLabel} className="glass-panel-sub p-2">
                  <span className="text-[10px] text-slate-400 block">{p.distLabel}</span>
                  <span className="font-bold text-white text-xs mt-0.5 block">
                    {p.concentration}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs">
              {plumeConcentrations.slice(4, 8).map((p) => (
                <div key={p.distLabel} className="glass-panel-sub p-2">
                  <span className="text-[10px] text-slate-400 block">{p.distLabel}</span>
                  <span className="font-bold text-slate-300 text-xs mt-0.5 block">
                    {p.concentration}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Sensitive Zone Intersection Notice */}
          <div className="p-3 rounded-lg bg-[rgba(245,158,11,0.1)] border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Downwind trajectory intersects residential cluster & 3 schools within 2.5km.
            </span>
          </div>
        </div>
      </div>

      {/* ── Bottom Row: Top Local Industrial Polluters Table ─────────────────── */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-glass)] pb-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[var(--accent-teal)]" />
              Top Industrial Emitters Contributing to Local Airshed
            </h3>
            <p className="text-xs text-slate-400">
              Ranked by total mass discharge and geospatial proximity to active city centroid ({radiusKm}km radius)
            </p>
          </div>

          <span className="text-xs font-mono text-slate-400">
            {topContributors.length} Critical Facilities Tracked
          </span>
        </div>

        {/* Contributors List */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-[rgba(56,180,255,0.12)] text-slate-400 font-mono text-[11px]">
                <th className="pb-2.5 font-normal">{t("pages.industry.thName")}</th>
                <th className="pb-2.5 font-normal">{t("pages.industry.thSector")}</th>
                <th className="pb-2.5 font-normal text-center">{t("pages.industry.thSeverity")}</th>
                <th className="pb-2.5 font-normal text-right">{t("pages.industry.thDistance")}</th>
                <th className="pb-2.5 font-normal text-right">{t("pages.industry.thEmissions")}</th>
                <th className="pb-2.5 font-normal text-right">{t("pages.industry.thImpact")}</th>
                <th className="pb-2.5 font-normal text-center">{t("pages.industry.thAction")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(56,180,255,0.06)]">
              {topContributors.map((c, idx) => (
                <tr
                  key={String(c.id)}
                  onClick={() => {
                    onSelectIndustry(c.industryRecord);
                  }}
                  className="hover:bg-[rgba(56,180,255,0.08)] cursor-pointer transition-colors"
                >
                  <td className="py-3 pr-2">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-mono text-[10px] flex items-center justify-center shrink-0 border border-slate-700">
                        #{idx + 1}
                      </span>
                      <span className="truncate max-w-[240px]">{c.name}</span>
                    </div>
                  </td>

                  <td className="py-3 px-2 text-slate-300">{c.category}</td>

                  <td className="py-3 px-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                        c.tier === "red" ? "badge-red" : "badge-orange"
                      }`}
                    >
                      {c.tier}
                    </span>
                  </td>

                  <td className="py-3 px-2 text-right font-mono text-slate-300">
                    {c.distanceKm} km
                  </td>

                  <td className="py-3 px-2 text-right font-mono text-white font-semibold">
                    {c.dailyOutputKg} kg/d <span className="text-[10px] text-slate-400 font-normal">({c.primaryPollutant})</span>
                  </td>

                  <td className="py-3 px-2 text-right font-mono font-bold text-[#ff3b5c]">
                    {c.impactPercent}%
                  </td>

                  <td className="py-3 pl-2 text-center">
                    <a
                      href={`/industry-details.html?id=${encodeURIComponent(
                        String(c.id)
                      )}&lat=${c.lat}&lng=${c.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1 rounded bg-[rgba(56,180,255,0.15)] hover:bg-[rgba(56,180,255,0.3)] text-[var(--accent-cyan)] font-mono text-[10px] inline-flex items-center gap-1 transition-colors"
                    >
                      <span>{t("pages.industry.deepProfile")}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
