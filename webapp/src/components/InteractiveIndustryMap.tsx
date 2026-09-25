import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Circle,
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  Compass,
  Crosshair,
  Factory,
  Flame,
  Maximize2,
  Minimize2,
  Radio,
  Search,
  Wind,
  Zap,
} from "lucide-react";
import { useTranslation } from "@/i18n";

import {
  fetchIndustriesInViewport,
  type CpcbTier,
  type SupabaseIndustryRecord,
  type ViewportBounds,
} from "@/lib/industrySupabase";
import "@/styles/industry-intelligence.css";
import { useTheme } from "@/context/ThemeContext";

// Escape helper for safe HTML popup injection
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper to generate rich glassmorphic HTML popup for each industry pin
function renderPopupHtml(record: SupabaseIndustryRecord): string {
  const tierBadgeClass =
    record.tier === "red"
      ? "badge-red"
      : record.tier === "orange"
      ? "badge-orange"
      : "badge-green";

  return `
    <div class="p-4 font-sans text-white">
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid rgba(56,180,255,0.15); padding-bottom:8px; margin-bottom:8px; gap:8px;">
        <div>
          <h4 style="font-weight:700; font-size:13px; color:#ffffff; line-height:1.2; margin:0;">
            ${escapeHtml(record.industry_name)}
          </h4>
          <p style="font-size:11px; color:#94a3b8; margin:2px 0 0 0;">
            ${escapeHtml(record.city || "Delhi NCR")}, ${escapeHtml(record.state || "India")}
          </p>
        </div>
        <span class="${tierBadgeClass}" style="padding:2px 6px; border-radius:4px; font-size:10px; font-family:monospace; text-transform:uppercase; font-weight:700; flex-shrink:0;">
          ${record.tier}
        </span>
      </div>

      <!-- Sector & Stack Info -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; margin-bottom:10px;">
        <div class="glass-panel-sub" style="padding:6px; border-radius:6px; background:rgba(8,16,30,0.6); border:1px solid rgba(56,180,255,0.12);">
          <span style="color:#94a3b8; display:block; font-size:10px;">{t("pages.industry.sector")}:</span>
          <span style="font-weight:600; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block;">
            ${escapeHtml(record.category || "General Industry")}
          </span>
        </div>
        <div class="glass-panel-sub" style="padding:6px; border-radius:6px; background:rgba(8,16,30,0.6); border:1px solid rgba(56,180,255,0.12);">
          <span style="color:#94a3b8; display:block; font-size:10px;">{t("pages.industry.stackHeight")}:</span>
          <span style="font-weight:600; color:#e2e8f0; display:block;">
            ${record.estimatedStackHeight}m (Active)
          </span>
        </div>
      </div>

      <!-- Estimated Daily Stack Emissions -->
      <div class="glass-panel-sub" style="padding:6px; border-radius:6px; background:rgba(8,16,30,0.6); border:1px solid rgba(56,180,255,0.12); margin-bottom:10px;">
        <div style="font-size:10px; font-family:monospace; color:#38b4ff; margin-bottom:6px; display:flex; justify-content:space-between;">
          <span>{t("pages.industry.thEmissions")}</span>
          <span>kg/day</span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; text-align:center; font-family:monospace;">
          <div style="background:rgba(255,59,92,0.1); padding:4px; border-radius:4px; border:1px solid rgba(255,59,92,0.3);">
            <span style="font-size:9px; color:#94a3b8; display:block;">PM2.5</span>
            <span style="color:#ff3b5c; font-weight:700; font-size:11px;">
              ${record.estimatedEmissions.pm25_kg_day}
            </span>
          </div>
          <div style="background:rgba(255,159,28,0.1); padding:4px; border-radius:4px; border:1px solid rgba(255,159,28,0.3);">
            <span style="font-size:9px; color:#94a3b8; display:block;">SO2</span>
            <span style="color:#ff9f1c; font-weight:700; font-size:11px;">
              ${record.estimatedEmissions.so2_kg_day}
            </span>
          </div>
          <div style="background:rgba(0,229,200,0.1); padding:4px; border-radius:4px; border:1px solid rgba(0,229,200,0.3);">
            <span style="font-size:9px; color:#94a3b8; display:block;">NO2</span>
            <span style="color:#00e5c8; font-weight:700; font-size:11px;">
              ${record.estimatedEmissions.no2_kg_day}
            </span>
          </div>
        </div>
      </div>

      <!-- Deep Intelligence Action CTA -->
      <a
        href="/industry-details.html?id=${encodeURIComponent(String(record.id))}&lat=${record.latitude}&lng=${record.longitude}"
        target="_blank"
        rel="noopener noreferrer"
        class="cyber-btn"
        style="width:100%; justify-content:center; font-size:11px; text-align:center; text-decoration:none; display:flex; padding:7px 12px; box-sizing:border-box;"
      >
        <span>{t("pages.industry.deepProfileLink")}</span>
      </a>
    </div>
  `;
}

// Helper to create custom animated HTML DivIcon with zoom-in entrance animation
function createPulsingPinIcon(record: SupabaseIndustryRecord, isSelected: boolean, currentZoom: number) {
  const color = record.tierColor;
  const isRed = record.tier === "red";
  // Adjust pin size dynamically based on zoom level
  const baseSize = isRed ? 16 : record.tier === "orange" ? 14 : 12;
  const scaleFactor = currentZoom >= 15 ? 1.25 : currentZoom >= 13 ? 1.1 : currentZoom <= 9 ? 0.85 : 1.0;
  const size = Math.round(baseSize * scaleFactor);

  const html = `
    <div 
      class="industry-pin ${isSelected ? "pin-selected" : ""}" 
      style="
        color: ${color}; 
        background: ${color}; 
        width: ${size}px; 
        height: ${size}px; 
        box-shadow: 0 0 10px ${color}, 0 0 20px ${color}88;
      "
      title="${escapeHtml(record.industry_name)} (${record.tierLabel})"
    ></div>
  `;

  return L.divIcon({
    html,
    className: "custom-industry-div-icon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size],
  });
}

// High-Performance Animated Marker Cluster Component
function IndustryClusterGroup({
  records,
  selectedIndustry,
  onSelectIndustry,
  currentZoom,
}: {
  records: SupabaseIndustryRecord[];
  selectedIndustry: SupabaseIndustryRecord | null;
  onSelectIndustry: (industry: SupabaseIndustryRecord | null) => void;
  currentZoom: number;
}) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    // Initialize Leaflet Marker Cluster Group with radar pulse badges & spring unbundling
    const clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: (zoom) => (zoom >= 14 ? 35 : zoom >= 12 ? 45 : 60),
      disableClusteringAtZoom: 16,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: true,
      spiderLegPolylineOptions: {
        weight: 1.8,
        color: "#38b4ff",
        opacity: 0.85,
        dashArray: "4, 3",
      },
      iconCreateFunction: (cluster) => {
        const children = cluster.getAllChildMarkers();
        const count = cluster.getChildCount();

        // Determine worst pollution severity among grouped facilities
        let hasRed = false;
        let hasOrange = false;

        for (const marker of children) {
          const tier = (marker as any)._industryRecord?.tier;
          if (tier === "red") {
            hasRed = true;
            break;
          } else if (tier === "orange") {
            hasOrange = true;
          }
        }

        let clusterColor = "#00e676"; // Green
        let glowColor = "rgba(0, 230, 118, 0.55)";
        let tierClass = "cluster-tier-green";

        if (hasRed) {
          clusterColor = "#ff3b5c"; // Red
          glowColor = "rgba(255, 59, 92, 0.65)";
          tierClass = "cluster-tier-red";
        } else if (hasOrange) {
          clusterColor = "#ff9f1c"; // Orange
          glowColor = "rgba(255, 159, 28, 0.6)";
          tierClass = "cluster-tier-orange";
        }

        const size = count > 100 ? 46 : count > 20 ? 40 : 34;

        const html = `
          <div 
            class="cluster-pulse-ring ${tierClass}" 
            style="
              --cluster-color: ${clusterColor}; 
              --cluster-glow: ${glowColor}; 
              width: ${size}px; 
              height: ${size}px;
            "
          >
            <div class="cluster-inner-badge">
              <span class="cluster-count">${count > 999 ? (count / 1000).toFixed(1) + "k" : count}</span>
            </div>
          </div>
        `;

        return L.divIcon({
          html,
          className: "custom-cluster-wrapper",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    clusterGroupRef.current = clusterGroup;
    map.addLayer(clusterGroup);

    return () => {
      map.removeLayer(clusterGroup);
    };
  }, [map]);

  // Sync cluster markers when visible section records or zoom changes
  useEffect(() => {
    const clusterGroup = clusterGroupRef.current;
    if (!clusterGroup) return;

    clusterGroup.clearLayers();

    const markers: L.Marker[] = [];

    for (const record of records) {
      const isSelected = selectedIndustry?.id === record.id;
      const icon = createPulsingPinIcon(record, isSelected, currentZoom);

      const marker = L.marker([record.latitude, record.longitude], { icon });
      (marker as any)._industryRecord = record;

      marker.on("click", () => {
        onSelectIndustry(record);
      });

      marker.bindPopup(renderPopupHtml(record), {
        className: "industry-leaflet-popup",
        maxWidth: 320,
        minWidth: 280,
      });

      markers.push(marker);
    }

    clusterGroup.addLayers(markers);
  }, [records, selectedIndustry, currentZoom, onSelectIndustry]);

  return null;
}

// Subcomponent that listens to map moves/zooms with debounce and reports exact visible bounds
function ViewportListener({
  onViewportChange,
}: {
  onViewportChange: (bounds: ViewportBounds, exactBounds: ViewportBounds, zoom: number) => void;
}) {
  const map = useMap();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const b = map.getBounds();
      const exact = {
        south: b.getSouth(),
        north: b.getNorth(),
        west: b.getWest(),
        east: b.getEast(),
      };
      // Padded bounds for background prefetching
      const latSpan = exact.north - exact.south;
      const lonSpan = exact.east - exact.west;
      const padded = {
        south: exact.south - latSpan * 0.15,
        north: exact.north + latSpan * 0.15,
        west: exact.west - lonSpan * 0.15,
        east: exact.east + lonSpan * 0.15,
      };
      onViewportChange(padded, exact, map.getZoom());
    }, 250);
  }, [map, onViewportChange]);

  useMapEvents({
    moveend: update,
    zoomend: update,
  });

  useEffect(() => {
    update();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [update]);

  return null;
}

// Controller component to handle flyTo actions
function MapController({
  flyTarget,
}: {
  flyTarget: { lat: number; lng: number; zoom?: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (flyTarget) {
      map.flyTo([flyTarget.lat, flyTarget.lng], flyTarget.zoom || 14, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, [flyTarget, map]);

  return null;
}

// Module-level default so the destructure below never allocates a fresh object
// per render — a fresh object would change `activeFocusPoint` identity every
// render, recompute `industriesInRadius`, and re-fire the parent-state effect,
// producing a "Maximum update depth exceeded" render loop.
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 };

export interface InteractiveIndustryMapProps {
  selectedIndustry: SupabaseIndustryRecord | null;
  onSelectIndustry: (industry: SupabaseIndustryRecord | null) => void;
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  onIndustriesInRadiusChange?: (records: SupabaseIndustryRecord[]) => void;
  centerCoords?: { lat: number; lng: number };
  windSpeedKmh?: number;
  windDirectionDeg?: number;
}

export function InteractiveIndustryMap({
  selectedIndustry,
  onSelectIndustry,
  radiusKm,
  onRadiusChange,
  onIndustriesInRadiusChange,
  centerCoords = DEFAULT_CENTER,
  windSpeedKmh = 12.0,
  windDirectionDeg = 300,
}: InteractiveIndustryMapProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isLight = theme === "light";

  const [records, setRecords] = useState<SupabaseIndustryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchBounds, setFetchBounds] = useState<ViewportBounds | null>(null);
  const [exactBounds, setExactBounds] = useState<ViewportBounds | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(11);

  // Filter States
  const [activeTiers, setActiveTiers] = useState<CpcbTier[]>(["red", "orange", "green"]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SupabaseIndustryRecord[]>([]);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  // Layer Toggles
  const [showIndustries, setShowIndustries] = useState(true);
  const [showWindVectors, setShowWindVectors] = useState(true);
  const [showPlumeHalo, setShowPlumeHalo] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Callback when viewport changes
  const handleViewportChange = useCallback(
    (padded: ViewportBounds, exact: ViewportBounds, zoom: number) => {
      setFetchBounds(padded);
      setExactBounds(exact);
      setCurrentZoom(zoom);
    },
    []
  );

  // Fetch records whenever bounds, tiers, category, or search changes
  useEffect(() => {
    if (!fetchBounds) return;

    let isMounted = true;
    setLoading(true);

    fetchIndustriesInViewport(fetchBounds, {
      tiers: activeTiers,
      category: selectedCategory,
      searchQuery: searchQuery.length > 2 ? searchQuery : undefined,
    })
      .then((data) => {
        if (isMounted) {
          setRecords(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [fetchBounds, activeTiers, selectedCategory]);

  // Handle Search Input autocomplete
  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      const q = searchQuery.toLowerCase().trim();
      const matched = records.filter(
        (r) =>
          r.industry_name.toLowerCase().includes(q) ||
          (r.city && r.city.toLowerCase().includes(q)) ||
          (r.category && r.category.toLowerCase().includes(q))
      );
      setSearchResults(matched.slice(0, 8));
      setShowSearchDropdown(true);
    } else {
      setSearchResults([]);
      setShowSearchDropdown(false);
    }
  }, [searchQuery, records]);

  // Toggle tier pill
  const toggleTier = (tier: CpcbTier) => {
    setActiveTiers((prev) =>
      prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]
    );
  };

  // Strictly filter markers to the current zoomed-in visible viewport
  const visibleSectionRecords = useMemo(() => {
    if (!exactBounds) return records;
    return records.filter((r) => {
      return (
        r.latitude >= exactBounds.south &&
        r.latitude <= exactBounds.north &&
        r.longitude >= exactBounds.west &&
        r.longitude <= exactBounds.east
      );
    });
  }, [records, exactBounds]);

  // Focus point for radius buffer. Memoized: identity must stay stable across
  // renders or the industriesInRadius memo below recomputes endlessly.
  const activeFocusPoint = useMemo(
    () =>
      selectedIndustry
        ? { lat: selectedIndustry.latitude, lng: selectedIndustry.longitude }
        : centerCoords,
    [selectedIndustry, centerCoords]
  );

  const industriesInRadius = useMemo(() => {
    return visibleSectionRecords.filter((r) => {
      const dLat = (r.latitude - activeFocusPoint.lat) * 111;
      const dLng =
        (r.longitude - activeFocusPoint.lng) *
        111 *
        Math.cos((activeFocusPoint.lat * Math.PI) / 180);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      return dist <= radiusKm;
    });
  }, [visibleSectionRecords, activeFocusPoint, radiusKm]);

  useEffect(() => {
    if (onIndustriesInRadiusChange) {
      onIndustriesInRadiusChange(industriesInRadius);
    }
  }, [industriesInRadius, onIndustriesInRadiusChange]);

  // Calculate downwind plume vector coordinates for selected industry
  const plumeLineCoords = useMemo(() => {
    if (!selectedIndustry || !showPlumeHalo) return null;
    const originLat = selectedIndustry.latitude;
    const originLng = selectedIndustry.longitude;

    const blowAngleRad = ((windDirectionDeg + 180) * Math.PI) / 180;
    const plumeLengthKm = Math.min(radiusKm, 15);

    const latDelta = (plumeLengthKm / 111) * Math.cos(blowAngleRad);
    const lngDelta =
      (plumeLengthKm / (111 * Math.cos((originLat * Math.PI) / 180))) *
      Math.sin(blowAngleRad);

    const endLat = originLat + latDelta;
    const endLng = originLng + lngDelta;

    return [
      [originLat, originLng] as [number, number],
      [endLat, endLng] as [number, number],
    ];
  }, [selectedIndustry, showPlumeHalo, windDirectionDeg, radiusKm]);

  // Sector Quick Jumps
  const hotZones = [
    { label: "Narela Zone", lat: 28.835, lng: 77.085, zoom: 14 },
    { label: "Badarpur Thermal", lat: 28.503, lng: 77.307, zoom: 14 },
    { label: "Okhla Phase", lat: 28.535, lng: 77.275, zoom: 14 },
    { label: "Mayapuri Auto", lat: 28.638, lng: 77.125, zoom: 14 },
    { label: "Full NCR", lat: 28.6139, lng: 77.209, zoom: 11 },
  ];

  return (
    <div
      className={`relative w-full ${
        isFullscreen
          ? "fixed inset-0 z-50 h-screen bg-[#080e18] p-4"
          : "h-[700px] rounded-2xl overflow-hidden border border-[var(--border-glass)]"
      } shadow-2xl transition-all duration-300`}
      id="industry-interactive-map-view"
    >
      {/* ── Top Floating Glassmorphism Control Panel ───────────────────────── */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex flex-wrap gap-3 items-center justify-between pointer-events-none">
        {/* Left: Search & Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {/* Global Search Bar */}
          <div className="relative w-64 md:w-80">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(10,20,38,0.85)] backdrop-blur-md border border-[var(--border-glass)] text-xs text-white shadow-lg">
              <Search className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />
              <input
                type="text"
                placeholder="Search 136k+ industrial facilities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.length >= 2 && setShowSearchDropdown(true)}
                className="w-full bg-transparent outline-none text-white placeholder-slate-400 font-sans"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setShowSearchDropdown(false);
                  }}
                  className="text-slate-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Autocomplete Dropdown */}
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg bg-[rgba(10,20,38,0.95)] backdrop-blur-xl border border-[var(--border-glass-bright)] shadow-2xl p-1 z-50">
                {searchResults.map((r) => (
                  <div
                    key={String(r.id)}
                    onClick={() => {
                      onSelectIndustry(r);
                      setFlyTarget({ lat: r.latitude, lng: r.longitude, zoom: 15 });
                      setShowSearchDropdown(false);
                      setSearchQuery(r.industry_name);
                    }}
                    className="p-2 rounded hover:bg-[rgba(56,180,255,0.15)] cursor-pointer flex items-center justify-between text-xs transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-white truncate max-w-[200px]">
                        {r.industry_name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {r.category || "General Industry"} · {r.city || "Delhi"}
                      </div>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                        r.tier === "red"
                          ? "badge-red"
                          : r.tier === "orange"
                          ? "badge-orange"
                          : "badge-green"
                      }`}
                    >
                      {r.tier}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Severity Filter Pills */}
          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[rgba(10,20,38,0.85)] backdrop-blur-md border border-[var(--border-glass)] shadow-lg text-xs">
            <button
              onClick={() => toggleTier("red")}
              className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                activeTiers.includes("red")
                  ? "bg-[rgba(255,59,92,0.25)] text-[#ff3b5c] border border-[#ff3b5c]/60 shadow-[0_0_8px_rgba(255,59,92,0.3)]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#ff3b5c] inline-block animate-pulse" />
              Red Emitters
            </button>

            <button
              onClick={() => toggleTier("orange")}
              className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                activeTiers.includes("orange")
                  ? "bg-[rgba(255,159,28,0.25)] text-[#ff9f1c] border border-[#ff9f1c]/60 shadow-[0_0_8px_rgba(255,159,28,0.3)]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#ff9f1c] inline-block" />
              Orange
            </button>

            <button
              onClick={() => toggleTier("green")}
              className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                activeTiers.includes("green")
                  ? "bg-[rgba(0,230,118,0.25)] text-[#00e676] border border-[#00e676]/60 shadow-[0_0_8px_rgba(0,230,118,0.3)]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#00e676] inline-block" />
              Green
            </button>
          </div>

          {/* Category Dropdown */}
          <div className="p-1 rounded-lg bg-[rgba(10,20,38,0.85)] backdrop-blur-md border border-[var(--border-glass)] shadow-lg text-xs">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-slate-200 text-xs px-2 py-1 outline-none cursor-pointer font-sans"
            >
              <option value="all" className="bg-[#0e192d] text-white">
                All Industrial Sectors
              </option>
              <option value="power" className="bg-[#0e192d] text-white">
                Thermal & Power Plants
              </option>
              <option value="chemical" className="bg-[#0e192d] text-white">
                Chemicals & Petrochemicals
              </option>
              <option value="steel" className="bg-[#0e192d] text-white">
                Steel & Metal Smelters
              </option>
              <option value="textile" className="bg-[#0e192d] text-white">
                Textile & Dyeing Mills
              </option>
              <option value="food" className="bg-[#0e192d] text-white">
                Food & Agro Processing
              </option>
              <option value="engineering" className="bg-[#0e192d] text-white">
                Engineering & Assembly
              </option>
            </select>
          </div>
        </div>

        {/* Right: Layer Toggles & Fullscreen */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Layer Toggles Pill */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[rgba(10,20,38,0.85)] backdrop-blur-md border border-[var(--border-glass)] shadow-lg">
            <button
              onClick={() => setShowIndustries(!showIndustries)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showIndustries
                  ? "bg-[rgba(56,180,255,0.2)] text-[var(--accent-cyan)]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title={t("pages.industry.togglePins")}
            >
              <Factory className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowWindVectors(!showWindVectors)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showWindVectors
                  ? "bg-[rgba(56,180,255,0.2)] text-[var(--accent-teal)]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title={t("pages.industry.toggleWind")}
            >
              <Wind className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowPlumeHalo(!showPlumeHalo)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showPlumeHalo
                  ? "bg-[rgba(255,59,92,0.2)] text-[#ff3b5c]"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title={t("pages.industry.togglePlume")}
            >
              <Flame className="w-4 h-4" />
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg bg-[rgba(10,20,38,0.85)] backdrop-blur-md border border-[var(--border-glass)] text-slate-300 hover:text-white shadow-lg transition-all"
            title={isFullscreen ? "Exit Fullscreen" : "Expand Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Sub-header: Quick Sector Focus Jumps ───────────────────────────── */}
      <div className="absolute top-18 left-4 z-[999] pointer-events-none hidden sm:flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[rgba(10,20,38,0.75)] backdrop-blur-md border border-[rgba(56,180,255,0.15)] shadow-md text-[11px] pointer-events-auto">
          <span className="font-mono text-slate-400 px-1 flex items-center gap-1 text-[10px]">
            <Crosshair className="w-3 h-3 text-[var(--accent-cyan)]" />
            SECTOR FOCUS:
          </span>
          {hotZones.map((z) => (
            <button
              key={z.label}
              onClick={() => setFlyTarget({ lat: z.lat, lng: z.lng, zoom: z.zoom })}
              className="px-2 py-0.5 rounded bg-[rgba(56,180,255,0.1)] hover:bg-[rgba(56,180,255,0.25)] text-slate-200 hover:text-white font-mono text-[10px] transition-colors"
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bottom Floating Radius & Analytics Bar ─────────────────────────── */}
      <div className="absolute bottom-4 left-4 right-4 z-[1000] pointer-events-none flex flex-wrap gap-3 items-end justify-between">
        {/* Radius Impact Slider Control */}
        <div className="glass-panel p-3 pointer-events-auto max-w-sm w-full">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-mono text-[var(--accent-cyan)] flex items-center gap-1.5 font-semibold">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Impact Radius Buffer
            </span>
            <span className="font-mono text-white px-2 py-0.5 rounded bg-[rgba(56,180,255,0.15)] border border-[var(--border-glass)]">
              {radiusKm} km
            </span>
          </div>

          <input
            type="range"
            min="5"
            max="50"
            step="5"
            value={radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            className="glass-slider cursor-pointer"
          />

          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
            <span>5 km</span>
            <span>10 km</span>
            <span>25 km</span>
            <span>50 km</span>
          </div>

          <div className="mt-2 pt-2 border-t border-[rgba(56,180,255,0.1)] flex items-center justify-between text-[11px]">
            <span className="text-slate-300">{t("pages.industry.activeStacks")}</span>
            <span className="font-mono font-bold text-white text-xs">
              {visibleSectionRecords.length} visible ({industriesInRadius.length} in {radiusKm}km circle)
            </span>
          </div>
        </div>

        {/* Live Status HUD Badge */}
        <div className="glass-panel px-3 py-2 pointer-events-auto flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Compass className="w-3.5 h-3.5 text-[var(--accent-cyan)]" />
            <span>
              Zoom: <strong className="text-white">{currentZoom}x</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-300">
            <Wind className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
            <span>
              {windSpeedKmh} km/h @ {windDirectionDeg}°
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-300">
            <Zap className="w-3.5 h-3.5 text-[#ff9f1c]" />
            <span>{t("pages.industry.dbCount")}</span>
          </div>

          {loading && (
            <span className="text-[10px] text-[var(--accent-cyan)] animate-pulse">
              Syncing Section...
            </span>
          )}
        </div>
      </div>

      {/* ── Leaflet Map Container ───────────────────────────────────────────── */}
      <MapContainer
        center={[centerCoords.lat, centerCoords.lng]}
        zoom={11}
        minZoom={5}
        maxZoom={18}
        scrollWheelZoom={true}
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

        <ViewportListener onViewportChange={handleViewportChange} />
        <MapController flyTarget={flyTarget} />

        {/* Radius Buffer Circle around Focus Point */}
        <Circle
          center={[activeFocusPoint.lat, activeFocusPoint.lng]}
          radius={radiusKm * 1000}
          pathOptions={{
            color: "#38b4ff",
            weight: 1.5,
            fillColor: "#38b4ff",
            fillOpacity: 0.05,
            dashArray: "6, 6",
          }}
        />

        {/* Selected Industry Downwind Plume Vector & Halo */}
        {selectedIndustry && plumeLineCoords && (
          <>
            <Polyline
              positions={plumeLineCoords}
              pathOptions={{
                color: "#ff3b5c",
                weight: 3,
                opacity: 0.85,
                dashArray: "8, 6",
              }}
            />
            <Circle
              center={[selectedIndustry.latitude, selectedIndustry.longitude]}
              radius={Math.max(selectedIndustry.estimatedStackHeight * 25, 1200)}
              pathOptions={{
                color: selectedIndustry.tierColor,
                fillColor: selectedIndustry.tierColor,
                fillOpacity: 0.18,
                weight: 1,
              }}
            />
          </>
        )}

        {/* Industry Pin Markers: High-Performance Animated Cluster Group with Dynamic Unbundling */}
        {showIndustries && (
          <IndustryClusterGroup
            records={visibleSectionRecords}
            selectedIndustry={selectedIndustry}
            onSelectIndustry={onSelectIndustry}
            currentZoom={currentZoom}
          />
        )}
      </MapContainer>
    </div>
  );
}
