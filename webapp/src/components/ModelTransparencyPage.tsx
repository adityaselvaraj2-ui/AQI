import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2, AlertTriangle, Landmark, RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n";

import { getAuthToken } from "@/lib/auth";
import { getStationRegistry } from "@/lib/api";
import type { StationRegistryResponse } from "@/lib/types";
import type { StationRegistryEntry } from "@/lib/types";

/**
 * Model Transparency (AUTHORITY-ONLY page).
 *
 * Side-by-side of the three "truths" for the same station/hour:
 *  - sensor:   the real CPCB/OpenAQ measurement (ground truth)
 *  - model:    what our trained model forecast for that hour (where the live
 *              run's horizon covers; null otherwise — shown as "—")
 *  - cams:     the raw CAMS regional cell value (~40 km, smoothed — NOT a
 *              station reading; this is the column the teammate repo scores
 *              against to get R² 0.96)
 *
 * The gap between the sensor column and the other two is exactly what the
 * holdout metrics measure. This page makes that gap visible instead of
 * documented.
 */

const API = "/api/v1";
const POLLS = ["pm25", "pm10", "no2", "o3", "so2"] as const;
const POLL_LABEL: Record<string, string> = {
  pm25: "PM2.5", pm10: "PM10", no2: "NO₂", o3: "O₃", so2: "SO₂",
};

interface TransparencyRow {
  timestamp: string;
  sensor: Record<string, number | null>;
  cams_cell: Record<string, number | null>;
  model_forecast: Record<string, number | null> | null;
  model_aq_source: string | null;
}

interface TransparencyPayload {
  station_id: number;
  station_name: string;
  generated_at: string;
  note: string;
  rows: TransparencyRow[];
}

interface SafarRow {
  date: string;
  category: string | null;
  aqi: number | null;
  lead_pollutant: string | null;
}

interface SafarPayload {
  source: string;
  fetched_at: string;
  note: string;
  stations: { station: string; forecast: SafarRow[] }[];
}

async function authedJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(path, {
    signal,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—";
}

export function ModelTransparencyPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<StationRegistryResponse | null>(null);
  const [stationId, setStationId] = useState<number | null>(null);
  const [poll, setPoll] = useState<(typeof POLLS)[number]>("pm25");
  const [data, setData] = useState<TransparencyPayload | null>(null);
  const [safar, setSafar] = useState<SafarPayload | null>(null);
  const [safarErr, setSafarErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getStationRegistry(ctrl.signal)
      .then((r) => {
        setRegistry(r);
        const trained = r.stations.filter((s) => s.trained);
        if (trained.length) setStationId((cur) => cur ?? trained[0].station_id);
      })
      .catch(() => setRegistry(null));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (stationId == null) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    authedJson<TransparencyPayload>(
      `${API}/forecast/model-transparency?station_id=${stationId}`, ctrl.signal,
    )
      .then(setData)
      .catch((e: Error) => {
        if (e.name !== "TimeoutError" && !ctrl.signal.aborted) setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [stationId]);

  useEffect(() => {
    const ctrl = new AbortController();
    authedJson<SafarPayload>(`${API}/forecast/safar-reference`, ctrl.signal)
      .then((s) => { setSafar(s); setSafarErr(null); })
      .catch((e: Error) => {
        if (!ctrl.signal.aborted) setSafarErr(e.message);
      });
    return () => ctrl.abort();
  }, []);

  const stats = useMemo(() => {
    if (!data?.rows?.length) return null;
    const rows = data.rows.filter(
      (r) => r.sensor[poll] != null && r.cams_cell[poll] != null,
    );
    if (rows.length < 10) return null;
    const rmse = (get: (r: TransparencyRow) => number) =>
      Math.sqrt(rows.reduce((a, r) => a + (get(r) - (r.sensor[poll] as number)) ** 2, 0) / rows.length);
    return {
      n: rows.length,
      camsRmse: rmse((r) => r.cams_cell[poll] as number),
      // model rows exist only where the live run's horizon covers past hours
      modelRows: rows.filter((r) => r.model_forecast && r.model_forecast[poll] != null),
    };
  }, [data, poll]);

  const shown = useMemo(() => {
    if (!data?.rows?.length) return [];
    return data.rows.slice(-48); // most recent 48 hours
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-200">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Eye className="h-5 w-5 text-amber-400" /> Model Transparency
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Three different things people call &quot;the AQ value&quot; for the same station and hour:
            the <b className="text-emerald-400">real sensor reading</b>,{" "}
            <b className="text-sky-400">our model&apos;s forecast</b> for that hour, and the{" "}
            <b className="text-fuchsia-400">raw CAMS regional cell</b> (~40 km, smoothed — the column
            whose low error other systems quote as R² 0.96). The gap between them is real and permanent.
          </p>
        </div>
        <button
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          Back
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs"
          value={stationId ?? ""}
          onChange={(e) => setStationId(Number(e.target.value))}
        >
          {(registry?.stations ?? []).filter((s: StationRegistryEntry) => s.trained).map((s: StationRegistryEntry) => (
            <option key={s.station_id} value={s.station_id}>
              {s.name} ({s.station_id})
            </option>
          ))}
        </select>
        {POLLS.map((p) => (
          <button
            key={p}
            onClick={() => setPoll(p)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              poll === p ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {POLL_LABEL[p]}
          </button>
        ))}
        <button
          onClick={() => setStationId((s) => s)} // retrigger fetch
          className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Transparency data unavailable: {error}</span>
        </div>
      )}

      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Hours compared (sensor↔CAMS)" value={String(stats.n)} />
          <Stat label="Raw CAMS RMSE vs sensor" value={stats.camsRmse.toFixed(1)} sub="µg/m³ — the 'smooth cell' error" />
          <Stat
            label="Model rows covering past hours"
            value={String(stats.modelRows.length)}
            sub="live run horizon reaches only recent hours"
          />
          <Stat
            label="Model RMSE (covered hours)"
            value={
              stats.modelRows.length >= 10
                ? Math.sqrt(
                    stats.modelRows.reduce(
                      (a, r) => a + ((r.model_forecast![poll] as number) - (r.sensor[poll] as number)) ** 2,
                      0,
                    ) / stats.modelRows.length,
                  ).toFixed(1)
                : "—"
            }
            sub="µg/m³ vs the same sensor column"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("pages.transparency.thHour")}</th>
              <th className="px-3 py-2 text-right font-medium text-emerald-400">Sensor ({POLL_LABEL[poll]})</th>
              <th className="px-3 py-2 text-right font-medium text-sky-400">{t("pages.transparency.thModel")}</th>
              <th className="px-3 py-2 text-right font-medium text-fuchsia-400">{t("pages.transparency.thCams")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("pages.transparency.thSource")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            )}
            {!loading && shown.map((r) => {
              const m = r.model_forecast?.[poll];
              const s = r.sensor[poll];
              const c = r.cams_cell[poll];
              const deltaC = s != null && c != null ? (c as number) - (s as number) : null;
              return (
                <tr key={r.timestamp} className="hover:bg-slate-900/50">
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400">{r.timestamp.slice(5, 16)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-emerald-400">{num(s)}</td>
                  <td className="px-3 py-1.5 text-right text-sky-400">{m != null ? num(m) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right ${deltaC != null && Math.abs(deltaC) > 40 ? "text-rose-400" : "text-fuchsia-400"}`}>
                    {num(c)}
                    {deltaC != null && (
                      <span className="ml-1 text-[10px] text-slate-500">({deltaC > 0 ? "+" : ""}{deltaC.toFixed(0)})</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-slate-500">{r.model_aq_source ?? "—"}</td>
                </tr>
              );
            })}
            {!loading && !shown.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">{t("pages.transparency.noAligned")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Landmark className="h-4 w-4 text-amber-400" /> SAFAR (IITM) — government forecast reference
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Live bulletin from India&apos;s operational WRF-Chem-class forecast system. Shown for
          cross-checking only — it is daily and categorical, and is never used to train,
          tune, or select our models.
        </p>
        {safarErr && (
          <p className="mt-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-300">
            SAFAR bulletin unavailable: {safarErr}
          </p>
        )}
        {safar && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {safar.stations.slice(0, 12).map((s) => (
              <div key={s.station} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
                <div className="font-medium text-slate-200">{s.station}</div>
                {s.forecast.map((f) => (
                  <div key={f.date} className="mt-1 flex items-center justify-between text-slate-400">
                    <span className="font-mono text-[10px]">{f.date}</span>
                    <span className="text-slate-300">{f.category ?? "—"}</span>
                    <span>{f.aqi != null ? `AQI ${f.aqi}` : "AQI n/a"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
