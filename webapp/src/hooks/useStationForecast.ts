import { useEffect, useRef, useState } from "react";

import { getStationForecastWithModel } from "@/lib/api";
import type { StationForecastResponse } from "@/lib/types";

export type StationModel = "lightgbm" | "chronos2";

/**
 * Shared per-station model forecast fetcher with a module-level cache.
 *
 * Chronos-2 inference takes ~20-30s on first load, so every consumer
 * (consensus chart on the overview, station forecast module on the forecast
 * page) shares one cache keyed by `${stationId}:${model}` — a model toggled or
 * a station revisited never re-runs inference within the session.
 */
const cache = new Map<string, StationForecastResponse>();

export function useStationForecast(
  stationId: number | null,
  model: StationModel,
  stationName: string | null,
) {
  const [data, setData] = useState<StationForecastResponse | null>(
    () => (stationId != null ? cache.get(`${stationId}:${model}`) ?? null : null),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const alive = () => aliveRef.current;
    if (stationId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const key = `${stationId}:${model}`;
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getStationForecastWithModel(stationId, model)
      .then((r) => {
        cache.set(key, r);
        if (alive()) setData(r);
      })
      .catch(() => {
        if (alive()) {
          setError("station model unavailable — showing city-wide forecast");
          setData(null);
        }
      })
      .finally(() => {
        if (alive()) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [stationId, model]);

  return {
    data: stationId != null ? data : null,
    stationLabel: stationName,
    loading,
    error,
  };
}
