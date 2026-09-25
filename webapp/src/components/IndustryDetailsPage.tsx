import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Flame,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";

import {
  fetchIndustryById,
  fetchLiveLocalAmbientAqi,
  getSensitiveReceptorsEstimate,
  getSectorComplianceMatrix,
  type SupabaseIndustryRecord,
} from "@/lib/industrySupabase";
import "@/styles/industry-intelligence.css";
import { useTheme } from "@/context/ThemeContext";

export interface IndustryDetailsPageProps {
  industryId?: string | number | null;
  latitude?: number | null;
  longitude?: number | null;
  onBack: () => void;
}

export function IndustryDetailsPage({
  industryId,
  latitude,
  longitude,
  onBack,
}: IndustryDetailsPageProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isLight = theme === "light";
  const [record, setRecord] = useState<SupabaseIndustryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveAqi, setLiveAqi] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const targetId = industryId || 136258;
    const targetLat = latitude || 28.5032;
    const targetLng = longitude || 77.3068;

    Promise.all([
      fetchIndustryById(targetId, targetLat, targetLng),
      fetchLiveLocalAmbientAqi(targetLat, targetLng),
    ])
      .then(([indData, aqiData]) => {
        if (isMounted) {
          setRecord(indData);
          setLiveAqi(aqiData);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Industry details fetch error:", err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [industryId, latitude, longitude]);

  const plant = record || {
    id: 136258,
    industry_name: "Badarpur Thermal Complex",
    category: "Thermal Power Plant",
    latitude: 28.5032,
    longitude: 77.3068,
    city: "Delhi",
    state: "Delhi",
    country: "India",
    address: "Badarpur Industrial Area, South East Delhi - 110044",
    tier: "red" as const,
    tierColor: "#ff3b5c",
    tierLabel: "Critical · Red Tier",
    estimatedStackHeight: 120,
    estimatedEmissions: {
      pm25_kg_day: 148.5,
      so2_kg_day: 210.0,
      no2_kg_day: 185.0,
      voc_kg_day: 42.0,
      co_kg_day: 280.0,
      tons_per_year: 285.4,
      flue_gas_velocity_ms: 21.5,
      stack_temp_c: 175,
    },
  };

  const receptors = getSensitiveReceptorsEstimate(plant.latitude, plant.longitude);

  const pinIcon = L.divIcon({
    html: `<div class="industry-pin" style="color: ${plant.tierColor}; background: ${plant.tierColor}"></div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  const compliance = getSectorComplianceMatrix(plant.category, plant.tier);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-6 animate-fadeIn">
      {/* ── Navigation Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-glass)] pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg bg-[rgba(56,180,255,0.1)] hover:bg-[rgba(56,180,255,0.25)] border border-[var(--border-glass)] text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="text-xs font-mono text-[var(--accent-cyan)] flex items-center gap-2">
              <span>{t("pages.industry.console")}</span>
              <span>/</span>
              <span>{t("pages.industry.mapBadge")}</span>
              <span>/</span>
              <span className="text-white font-semibold">{plant.industry_name}</span>
              {loading && (
                <span className="text-[10px] text-[var(--accent-cyan)] animate-pulse ml-2">
                  [SYNCING SUPABASE...]
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white mt-0.5">{plant.industry_name}</h1>
          </div>
        </div>

        <button onClick={onBack} className="cyber-btn text-xs">
          ← Back to Map View
        </button>
      </div>

      {/* ── Plant Hero & Overview ────────────────────────────────────────── */}
      <div className="glass-panel p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded text-xs font-mono uppercase font-bold ${
                  plant.tier === "red"
                    ? "badge-red"
                    : plant.tier === "orange"
                    ? "badge-orange"
                    : "badge-green"
                }`}
              >
                {plant.tierLabel}
              </span>
              <span className="text-xs font-mono text-slate-400">ID: #{plant.id}</span>
              <span className="text-xs font-mono text-[var(--accent-teal)]">● LIVE SENSOR TWIN</span>
            </div>

            <h2 className="text-xl font-bold text-white">{plant.industry_name}</h2>
            <p className="text-sm text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />
              <span>
                {plant.address || `${plant.city}, ${plant.state}`} · GPS: {plant.latitude.toFixed(4)}°N, {plant.longitude.toFixed(4)}°E
              </span>
            </p>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="glass-panel-sub p-3">
                <span className="text-[10px] text-slate-400 font-mono block">{t("pages.industry.sector")}</span>
                <span className="font-semibold text-white text-sm truncate block mt-0.5">
                  {plant.category || "General Industry"}
                </span>
              </div>
              <div className="glass-panel-sub p-3">
                <span className="text-[10px] text-slate-400 font-mono block">{t("pages.industry.stackHeight")}</span>
                <span className="font-semibold text-white text-sm block mt-0.5 font-mono">
                  {plant.estimatedStackHeight}m Flue
                </span>
              </div>
              <div className="glass-panel-sub p-3">
                <span className="text-[10px] text-slate-400 font-mono block">{t("pages.industry.compliance")}</span>
                <span
                  className="font-semibold text-sm block mt-0.5"
                  style={{ color: compliance.statusColor }}
                >
                  {compliance.status}
                </span>
              </div>
            </div>
          </div>

          {/* Plant Perimeter Mini Leaflet Map */}
          <div className="lg:col-span-5 h-[230px] rounded-xl overflow-hidden border border-[var(--border-glass)] relative">
            <MapContainer
              center={[plant.latitude, plant.longitude]}
              zoom={14}
              zoomControl={false}
              className={`w-full h-full ${isLight ? "bg-[#f8fafc]" : "bg-[#080e18]"}`}
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                url={
                  isLight
                    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                }
              />
              <Marker position={[plant.latitude, plant.longitude]} icon={pinIcon} />
              <Circle
                center={[plant.latitude, plant.longitude]}
                radius={1200}
                pathOptions={{
                  color: plant.tierColor,
                  fillColor: plant.tierColor,
                  fillOpacity: 0.15,
                  weight: 1.5,
                }}
              />
            </MapContainer>
          </div>
        </div>
      </div>

      {/* ── Live Local Ambient Air Quality ───────────────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-glass)] pb-3">
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--accent-cyan)]" />
              Live Local Ambient Air Quality at Site Coordinates
            </h3>
            <p className="text-xs text-slate-400">
              Fetched in real-time from Open-Meteo Air Quality telemetry vs regional baseline
            </p>
          </div>

          <div className="text-right">
            <div className="font-mono text-xl font-bold text-[#ff3b5c]">
              AQI {liveAqi ? liveAqi.aqi : 312}
            </div>
            <span className="text-[10px] font-mono text-[#ff3b5c]">
              {liveAqi && liveAqi.aqi <= 100
                ? "SATISFACTORY"
                : liveAqi && liveAqi.aqi <= 200
                ? "MODERATE"
                : liveAqi && liveAqi.aqi <= 300
                ? "POOR"
                : "VERY POOR CATEGORY"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-panel-sub p-4">
            <span className="text-xs font-mono text-slate-400 block">{t("pages.industry.ambientPm25")}</span>
            <div className="text-2xl font-bold font-mono text-[#ff3b5c] mt-1">
              {liveAqi ? liveAqi.pm25 : 142.5}{" "}
              <span className="text-xs text-slate-400 font-normal">µg/m³</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">24h Safe Limit: 60 µg/m³</span>
          </div>

          <div className="glass-panel-sub p-4">
            <span className="text-xs font-mono text-slate-400 block">{t("pages.industry.ambientPm10")}</span>
            <div className="text-2xl font-bold font-mono text-white mt-1">
              {liveAqi ? liveAqi.pm10 : 238.0}{" "}
              <span className="text-xs text-slate-400 font-normal">µg/m³</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">24h Safe Limit: 100 µg/m³</span>
          </div>

          <div className="glass-panel-sub p-4">
            <span className="text-xs font-mono text-slate-400 block">{t("pages.industry.no2")}</span>
            <div className="text-2xl font-bold font-mono text-[var(--accent-teal)] mt-1">
              {liveAqi ? liveAqi.no2 : 58.4}{" "}
              <span className="text-xs text-slate-400 font-normal">µg/m³</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{t("pages.industry.no2Sub")}</span>
          </div>

          <div className="glass-panel-sub p-4">
            <span className="text-xs font-mono text-slate-400 block">{t("pages.industry.so2")}</span>
            <div className="text-2xl font-bold font-mono text-[#ff9f1c] mt-1">
              {liveAqi ? liveAqi.so2 : 32.1}{" "}
              <span className="text-xs text-slate-400 font-normal">µg/m³</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{t("pages.industry.so2Sub")}</span>
          </div>
        </div>
      </div>

      {/* ── Digital Twin Emission Profile & Flue Gas ──────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Flame className="w-5 h-5 text-[#ff3b5c]" />
            Digital Twin Stack Emission & Flue Gas Parameters
          </h3>
          <p className="text-xs text-slate-400">
            Estimated point-source continuous emission rates and thermodynamic discharge
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel-sub p-4">
            <span className="text-xs text-slate-400 font-mono block">{t("pages.industry.annualDischarge")}</span>
            <div className="text-2xl font-bold font-mono text-white mt-1">
              {plant.estimatedEmissions.tons_per_year}{" "}
              <span className="text-xs text-slate-400 font-normal">tons/year</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">330 Operational Days / Year</span>
          </div>

          <div className="glass-panel-sub p-4">
            <span className="text-xs text-slate-400 font-mono block">{t("pages.industry.exitVelocity")}</span>
            <div className="text-2xl font-bold font-mono text-[var(--accent-cyan)] mt-1">
              {plant.estimatedEmissions.flue_gas_velocity_ms}{" "}
              <span className="text-xs text-slate-400 font-normal">m/s</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{t("pages.industry.fanVelocity")}</span>
          </div>

          <div className="glass-panel-sub p-4">
            <span className="text-xs text-slate-400 font-mono block">{t("pages.industry.stackTemp")}</span>
            <div className="text-2xl font-bold font-mono text-[var(--accent-teal)] mt-1">
              {plant.estimatedEmissions.stack_temp_c}°C
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{t("pages.industry.flueGas")}</span>
          </div>
        </div>

        <div className="glass-panel-sub p-4">
          <div className="text-xs font-mono text-[var(--accent-cyan)] mb-3">
            DAILY FLUE GAS MASS BALANCE (KG/DAY)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-lg bg-[rgba(255,59,92,0.1)] border border-[#ff3b5c]/30">
              <span className="text-[10px] text-slate-400 block font-mono">PM2.5</span>
              <span className="text-[#ff3b5c] font-bold text-lg font-mono">
                {plant.estimatedEmissions.pm25_kg_day} kg
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[rgba(255,159,28,0.1)] border border-[#ff9f1c]/30">
              <span className="text-[10px] text-slate-400 block font-mono">SO2</span>
              <span className="text-[#ff9f1c] font-bold text-lg font-mono">
                {plant.estimatedEmissions.so2_kg_day} kg
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[rgba(0,229,200,0.1)] border border-[var(--accent-teal)]/30">
              <span className="text-[10px] text-slate-400 block font-mono">NOx</span>
              <span className="text-[var(--accent-teal)] font-bold text-lg font-mono">
                {plant.estimatedEmissions.no2_kg_day} kg
              </span>
            </div>
            <div className="p-3 rounded-lg bg-[rgba(56,180,255,0.1)] border border-[var(--border-glass)]">
              <span className="text-[10px] text-slate-400 block font-mono">CO & VOCs</span>
              <span className="text-white font-bold text-lg font-mono">
                {Number((plant.estimatedEmissions.co_kg_day + plant.estimatedEmissions.voc_kg_day).toFixed(1))} kg
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Nearby Sensitive Receptors ────────────────────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--accent-teal)]" />
            Nearby Sensitive Receptors & Population Vulnerability
          </h3>
          <p className="text-xs text-slate-400">
            Geospatial proximity count of residential clusters, schools, and hospitals
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-panel-sub p-4 border-l-4 border-l-[#ff3b5c]">
            <span className="font-mono text-xs font-bold text-[#ff3b5c] block mb-2">
              ● 1.0 KM IMMEDIATE ZONE
            </span>
            <div className="text-xs text-slate-300 space-y-1.5">
              <div>• Residential Clusters: <strong className="text-white">{receptors.within1km.residentialClusters} zones</strong></div>
              <div>• Schools & Nurseries: <strong className="text-white">{receptors.within1km.schools} facilities</strong></div>
              <div>• Hospitals / Clinics: <strong className="text-white">{receptors.within1km.hospitals} {receptors.within1km.hospitals === 1 ? "facility" : "facilities"}</strong></div>
              <div>• Population Exposed: <strong className="text-white">~{receptors.within1km.totalPopulation.toLocaleString()}</strong></div>
            </div>
          </div>

          <div className="glass-panel-sub p-4 border-l-4 border-l-[#ff9f1c]">
            <span className="font-mono text-xs font-bold text-[#ff9f1c] block mb-2">
              ● 3.0 KM INTERMEDIATE ZONE
            </span>
            <div className="text-xs text-slate-300 space-y-1.5">
              <div>• Residential Clusters: <strong className="text-white">{receptors.within3km.residentialClusters} zones</strong></div>
              <div>• Schools & Nurseries: <strong className="text-white">{receptors.within3km.schools} facilities</strong></div>
              <div>• Hospitals / Clinics: <strong className="text-white">{receptors.within3km.hospitals} facilities</strong></div>
              <div>• Population Exposed: <strong className="text-white">~{receptors.within3km.totalPopulation.toLocaleString()}</strong></div>
            </div>
          </div>

          <div className="glass-panel-sub p-4 border-l-4 border-l-[var(--accent-cyan)]">
            <span className="font-mono text-xs font-bold text-[var(--accent-cyan)] block mb-2">
              ● 5.0 KM REGIONAL AIRSHED
            </span>
            <div className="text-xs text-slate-300 space-y-1.5">
              <div>• Residential Clusters: <strong className="text-white">{receptors.within5km.residentialClusters} zones</strong></div>
              <div>• Schools & Nurseries: <strong className="text-white">{receptors.within5km.schools} facilities</strong></div>
              <div>• Hospitals / Clinics: <strong className="text-white">{receptors.within5km.hospitals} facilities</strong></div>
              <div>• Population Exposed: <strong className="text-white">~{receptors.within5km.totalPopulation.toLocaleString()}</strong></div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Regulatory Compliance & Mitigation ────────────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[var(--accent-cyan)]" />
            Mandated Air Pollution Control Equipment & Compliance Strategy
          </h3>
          <p className="text-xs text-slate-400">
            CPCB / State Pollution Control Board prescribed mitigation technologies
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-panel-sub p-4 space-y-2">
            <span className="text-xs font-mono text-[var(--accent-cyan)] font-semibold block">
              MANDATED INDUSTRIAL CONTROLS
            </span>
            <ul className="text-xs text-slate-300 space-y-2 list-none">
              {compliance.equipment.map((eq, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[var(--accent-teal)] shrink-0 mt-0.5" />
                  <span>
                    <strong>{eq.name}</strong>: {eq.desc}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-panel-sub p-4 space-y-2">
            <span className="text-xs font-mono text-[var(--accent-teal)] font-semibold block">
              REGULATORY EMISSION LIMITS
            </span>
            <div className="text-xs text-slate-300 space-y-2">
              {compliance.limits.map((lim, i) => (
                <div key={i}>
                  • <strong>{lim.label}</strong>: {lim.val}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
