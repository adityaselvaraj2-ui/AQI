import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/i18n";
import { StationDetail } from "@/components/map/StationDetail";
import { MapCanvas } from "@/components/map/MapCanvas";
import { Skeleton } from "@/components/ui/skeleton";
import type { Panel } from "@/hooks/useForecastData";
import { useOnline } from "@/hooks/useOnline";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  HEAT_GRADIENT,
  MAP_STYLE_ORDER,
  MAP_STYLES,
  type MapLayers,
  type MapStyleId,
} from "@/lib/mapgeo";
import type {
  CityAggregateResponse,
  CityOverview,
  ForecastResponse,
  PlumeVectorsResponse,
  StationReading,
} from "@/lib/types";

// Leaflet's bundle is only fetched when the online renderer actually mounts —
// offline mode never pays for it.
const MapLeaflet = lazy(() => import("@/components/map/MapLeaflet"));

/** How many tileerror events in `auto` mode before we fall back to the canvas. */
const TILE_ERROR_LIMIT = 8;

type RenderMode = "auto" | "tiles" | "offline";

interface StationMapProps {
  stations: Panel<StationReading[]>;
  plume: Panel<PlumeVectorsResponse>;
  forecast: Panel<ForecastResponse>;
  overview: Panel<CityOverview>;
  cursor: number;
  cityAggregate?: CityAggregateResponse | null;
}

const LAYER_DEFS: Array<{ key: keyof MapLayers; label: string }> = [
  { key: "stations", label: "Stations" },
  { key: "heatmap", label: "Heatmap" },
  { key: "fires", label: "Fires" },
];

const MODE_DEFS: Array<{ key: RenderMode; label: string }> = [
  { key: "auto", label: "Auto" },
  { key: "tiles", label: "Live" },
  { key: "offline", label: "Offline" },
];

/**
 * The map section. One shell that owns selection, layer, style and render-mode
 * state, and swaps between two renderers that share it all:
 *   - online (or forced "Live") → a real interactive Leaflet map on keyless tiles
 *   - offline (or forced/failed) → the self-contained Canvas schematic
 *
 * The whole section is encased in an outer glassmorphic container with the
 * 3D Physics Lanyard card hanging dynamically from the top ceiling anchor.
 */
export function StationMap({
  stations,
  plume,
  forecast,
  overview,
  cursor,
  cityAggregate,
}: StationMapProps) {
  const { t } = useTranslation();
  const online = useOnline();
  const reduced = useReducedMotion();

  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>({
    stations: true,
    heatmap: false,
    fires: true,
    industries: false,
  });
  const [styleId, setStyleId] = useState<MapStyleId>("dark");
  const [renderMode, setRenderMode] = useState<RenderMode>("auto");
  const [tileFailed, setTileFailed] = useState(false);

  const tileErrCount = useRef(0);

  // Clean slate whenever style changes
  useEffect(() => {
    tileErrCount.current = 0;
    setTileFailed(false);
  }, [styleId]);

  const onTileError = useCallback(() => {
    tileErrCount.current += 1;
    if (tileErrCount.current >= TILE_ERROR_LIMIT) setTileFailed(true);
  }, []);

  const stationList = stations.data ?? [];
  const selected = useMemo(
    () => stationList.find((s) => s.uid === selectedUid) ?? null,
    [stationList, selectedUid],
  );

  const useTiles =
    renderMode === "tiles" ? true : renderMode === "offline" ? false : online && !tileFailed;

  const chooseMode = useCallback((mode: RenderMode) => {
    if (mode === "tiles") {
      tileErrCount.current = 0;
      setTileFailed(false);
    }
    setRenderMode(mode);
  }, []);

  const toggleLayer = useCallback((key: keyof MapLayers) => {
    setLayers((l) => ({ ...l, [key]: !l[key] }));
  }, []);

  const clearSelection = useCallback(() => setSelectedUid(null), []);

  const feedsLoading = stations.status === "loading" && plume.status === "loading";
  const stationsFailed = stations.status === "error";
  const noFires = layers.fires && plume.data != null && plume.data.hotspots.length === 0;

  const statusLabel = useTiles
    ? "live tiles"
    : renderMode === "offline" || !online
      ? "offline · schematic"
      : "tiles unavailable · schematic";

  return (
    <section className="section section--map station-map-outer" aria-labelledby="map-h">
      <div className="station-map-layout">
        {/* Left Column: Heading, Controls, Viewport */}
        <div className="station-map-main">
          <div className="pb-3 border-b border-[var(--border-glass)] mb-4">
            <div>
              <div className="text-xs font-mono text-emerald-400/90 flex items-center gap-2 uppercase tracking-wider">
                <span>{t("pages.map.network")}</span>
              </div>
              <h2 className="text-2xl font-bold text-white mt-1 mb-2 font-sans" id="map-h">
                Station map
              </h2>
              <p className="text-base text-white/70 max-w-3xl">
                Explore live OpenAQ stations across Delhi-NCR. Select a station for detailed readings.
              </p>
            </div>
          </div>

          <div className="map__controls" role="group" aria-label="Map controls">
            <div className="map__ctrlGroup">
              <span className="map__ctrlLabel">basemap</span>
              <div className="map__ctrlRow">
                {MAP_STYLE_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="btn btn--solid map__ctrlBtn"
                    aria-pressed={styleId === id}
                    onClick={() => setStyleId(id)}
                  >
                    {MAP_STYLES[id].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="map__ctrlGroup">
              <span className="map__ctrlLabel">layers</span>
              <div className="map__ctrlRow">
                {LAYER_DEFS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className="btn btn--solid map__ctrlBtn"
                    aria-pressed={layers[key]}
                    onClick={() => toggleLayer(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="map__ctrlGroup">
              <span className="map__ctrlLabel">render</span>
              <div className="map__ctrlRow">
                {MODE_DEFS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className="btn btn--solid map__ctrlBtn"
                    aria-pressed={renderMode === key}
                    onClick={() => chooseMode(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="map__viewport plume__mapWrap" style={{ marginTop: '1.2rem' }}>
            {useTiles ? (
              <Suspense fallback={<Skeleton style={{ width: "100%", height: "100%" }} />}>
                <MapLeaflet
                  stations={layers.stations ? stationList : []}
                  plume={plume.data}
                  industries={[]}
                  layers={layers}
                  style={MAP_STYLES[styleId]}
                  selectedUid={selectedUid}
                  onSelect={setSelectedUid}
                  onTileError={onTileError}
                />
              </Suspense>
            ) : (
              <MapCanvas
                stations={stationList}
                plume={plume.data}
                industries={[]}
                layers={layers}
                style={styleId}
                cursor={cursor}
                selectedUid={selectedUid}
                onSelect={setSelectedUid}
                animate={!reduced}
              />
            )}

            <span className="map__badge" aria-hidden={false}>
              <i className="map__badgeDot" data-live={useTiles} />
              {statusLabel}
            </span>

            <div className="map__ov">
              {feedsLoading ? <p className="map__flag">loading live feeds…</p> : null}
              {stationsFailed ? (
                <p className="map__flag">
                  <b>{t("pages.map.liveUnavailable1")}</b> {t("pages.map.liveUnavailable2")}
                  station markers are invented in their place.
                </p>
              ) : null}
              {noFires ? (
                <p className="map__flag">
                  No active fire detections in the transport domain — nothing is inferred where FIRMS
                  reports nothing.
                </p>
              ) : null}

              {layers.heatmap ? (
                <figure className="map__legend">
                  <span
                    className="map__legendBar"
                    style={{
                      background: `linear-gradient(90deg, ${Object.values(HEAT_GRADIENT).join(", ")})`,
                    }}
                  />
                  <figcaption className="map__legendCap">
                    AQI surface · interpolated from {stationList.length} live stations — not measured
                    between them
                  </figcaption>
                </figure>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right Column: Full-Height Hanging 3D Lanyard Pass from Top Ceiling */}
        <div className="station-map-side">
          <StationDetail
            station={selected}
            overview={overview.data}
            plume={plume.data}
            forecast={forecast.data}
            cursor={cursor}
            stationCount={stationList.length}
            cityAggregate={cityAggregate}
            onClear={clearSelection}
          />
        </div>
      </div>
    </section>
  );
}
