import { useCallback, useEffect, useMemo, useState } from "react";

import { getStationRegistry } from "@/lib/api";
import type { StationReading } from "@/lib/types";

/**
 * ONE station selection for the whole app.
 *
 * The live network (realtime/stations) and the trained-model registry
 * (forecast/stations) are two different lists from two different sources, so
 * the selection is keyed by the live station's uid/name and bridged to the
 * trained-model `station_id` by name (the live feed's names are CPCB station
 * names; the registry names come from the OpenAQ archive with the same
 * spelling in the vast majority of cases).
 *
 * Selection persists across reloads via localStorage.
 */
const STORAGE_KEY = "ncr72.selected_station_uid";

export interface StationSelection {
  /** live stations currently available (already sorted by AQI desc from API) */
  stations: StationReading[];
  /** the selected live station (null until the network loads) */
  selected: StationReading | null;
  /** selected live station uid ("" when none) — for select inputs */
  selectedUid: string;
  selectByUid: (uid: string) => void;
  /** trained-model station_id for the selected station, when it can be bridged */
  trainedStationId: number | null;
  /** trained-model registry name for the selected station */
  trainedName: string | null;
  /** live network loading state passthrough */
  loading: boolean;
}

/** normalise a station name for cross-list matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function useStationSelection(
  liveStations: StationReading[] | null,
): StationSelection {
  const stations = useMemo(() => liveStations ?? [], [liveStations]);

  const [selectedUid, setSelectedUid] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );

  // trained-model registry (fetch once per session). Indexed by normalised name
  // AND kept as an array for the nearest-coordinate fallback (some CPCB sites
  // appear under different names in the live vs archive lists).
  const [registry, setRegistry] = useState<Map<string, { id: number; name: string }>>(
    () => new Map());
  const [registryPts, setRegistryPts] = useState<{ id: number; name: string; lat: number; lon: number }[]>(
    () => []);
  useEffect(() => {
    let alive = true;
    getStationRegistry()
      .then((r) => {
        if (!alive) return;
        const m = new Map<string, { id: number; name: string }>();
        for (const s of r.stations) m.set(norm(s.name), { id: s.station_id, name: s.name });
        setRegistry(m);
        setRegistryPts(r.stations.map((s) => ({ id: s.station_id, name: s.name, lat: s.lat, lon: s.lon })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const selectByUid = useCallback((uid: string) => {
    setSelectedUid(uid);
    try {
      localStorage.setItem(STORAGE_KEY, uid);
    } catch {
      /* storage unavailable — selection stays in memory */
    }
  }, []);

  // Auto-pick: saved selection if still present, else keep it empty until the
  // user chooses (the UI falls back to the city aggregate in that case).
  useEffect(() => {
    if (!selectedUid && stations.length > 0) {
      // no saved selection: default to the highest-AQI station so the panel is
      // never blank, without overwriting the (empty) stored preference
      setSelectedUid(stations[0].uid);
    }
    if (selectedUid && stations.length > 0 && !stations.some((s) => s.uid === selectedUid)) {
      // saved station vanished from the live network (offline station) — fall
      // back to the top of the list for this session only
      setSelectedUid(stations[0].uid);
    }
  }, [stations, selectedUid]);

  const selected = useMemo(
    () => stations.find((s) => s.uid === selectedUid) ?? null,
    [stations, selectedUid],
  );

  const bridge = useMemo(() => {
    if (!selected) return null;
    const byName = registry.get(norm(selected.name));
    if (byName) return byName;
    // fallback: nearest trained station within ~3 km (same physical site,
    // different archive name). Registry coordinates are the archive's own.
    let best: { id: number; name: string } | null = null;
    let bestD = Infinity;
    for (const p of registryPts) {
      const d = (p.lat - selected.lat) ** 2 + ((p.lon - selected.lon) * 0.86) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { id: p.id, name: p.name };
      }
    }
    // ~0.0007 deg^2 ≈ 3 km at Delhi's latitude
    return bestD <= 0.0007 ? best : null;
  }, [selected, registry, registryPts]);

  return {
    stations,
    selected,
    selectedUid,
    selectByUid,
    trainedStationId: bridge?.id ?? null,
    trainedName: bridge?.name ?? null,
    loading: liveStations == null,
  };
}
