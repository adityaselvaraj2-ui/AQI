import { useMemo } from "react";
import type { Panel } from "@/hooks/useForecastData";
import { signed } from "@/lib/format";
import type { InversionStatus } from "@/lib/types";
import { PanelMessage } from "@/components/ui/panel-message";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n";

interface InversionStripProps {
  inversion: Panel<InversionStatus[]>;
  cursor: number;
}

// ── Chart geometry (viewBox units) ───────────────────────────────────────────
const W = 560;
const H = 300;
const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const HOUR_TICKS = [0, 12, 24, 36, 48, 60, 72];

export function InversionStrip({ inversion, cursor }: InversionStripProps) {
  const { t } = useTranslation();
  const series = inversion.data ?? [];
  const idx = Math.max(0, Math.min(series.length - 1, cursor));
  const cur = series[idx] ?? null;
  const lidHours = series.filter((s) => s.inversion_present).length;

  // Y domain from the ΔT profile, padded, with 0 °C always inside the range so
  // the inversion/non-inversion split is visible.
  const { yMin, yMax } = useMemo(() => {
    if (series.length === 0) return { yMin: -4, yMax: 4 };
    const vals = series.map((s) => s.delta_t_celsius);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(1, ...vals);
    const pad = Math.max(0.8, (hi - lo) * 0.12);
    return { yMin: lo - pad, yMax: hi + pad };
  }, [series]);

  const xAt = (i: number) =>
    PAD_L + (series.length > 1 ? (i / (series.length - 1)) * PLOT_W : PLOT_W / 2);
  const yAt = (dt: number) =>
    PAD_T + (1 - (dt - yMin) / (yMax - yMin)) * PLOT_H;

  const staticLayer = useMemo(() => {
    if (series.length === 0) return null;

    const pts = series.map((s, i) => ({ x: xAt(i), y: yAt(s.delta_t_celsius), s }));
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const zeroY = yAt(0);

    return (
      <>
        {/* horizontal ΔT gridlines */}
        {ticks(yMin, yMax).map((dtv) => (
          <g key={dtv} className="inv-grid">
            <line x1={PAD_L} y1={yAt(dtv)} x2={W - PAD_R} y2={yAt(dtv)} />
            <text x={PAD_L - 6} y={yAt(dtv) + 3} textAnchor="end">
              {dtv > 0 ? `+${dtv}` : `${dtv}`}
            </text>
          </g>
        ))}

        {/* 0 °C neutral line */}
        <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} className="inv-zero" />

        {/* hour ticks */}
        {HOUR_TICKS.map((hh) => {
          const i = Math.min(series.length - 1, hh);
          return (
            <text key={hh} x={xAt(i)} y={H - 12} textAnchor={hh === 0 ? "start" : hh >= 72 ? "end" : "middle"} className="inv-hour">
              {hh === 0 ? "now" : `+${hh}h`}
            </text>
          );
        })}

        {/* ΔT trace */}
        <path d={line} fill="none" className="inv-trace" />

        {/* severity markers: filled = lid present, colour by severity; hollow = normal */}
        {pts.map((p, i) => {
          const fill =
            p.s.severity === "Strong"
              ? "var(--aqi-5)"
              : p.s.severity === "Moderate"
                ? "var(--aqi-4)"
                : p.s.severity === "Weak"
                  ? "var(--aqi-3)"
                  : "none";
          const stroke = fill === "none" ? "#38bdf8" : "none";
          return <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={fill} stroke={stroke} strokeWidth={1.1} />;
        })}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, yMin, yMax]);

  const curX = series.length ? xAt(idx) : PAD_L;
  const curY = cur ? yAt(cur.delta_t_celsius) : PAD_T;

  const yLabel = (dt: number): string => {
    if (dt <= 0.2) return t("atmosphere.noLidVentilated");
    if (dt < 2) return t("atmosphere.weakLid");
    if (dt < 4) return t("atmosphere.moderateLid");
    return t("atmosphere.strongLid");
  };

  return (
    <section className="section section--inv" aria-labelledby="inv-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <p className="eyebrow">lid</p>
          <h2 className="section__h section__h--sm" id="inv-h">
            {t("atmosphere.inversionStrength")}
          </h2>
        </div>
        <div style={{ marginTop: "0.25rem" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.25rem 0.65rem",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--mono)",
              background: lidHours > 0 ? "rgba(239, 68, 68, 0.15)" : "rgba(56, 189, 248, 0.12)",
              color: lidHours > 0 ? "var(--aqi-5)" : "#38bdf8",
              border: `1px solid ${lidHours > 0 ? "rgba(239, 68, 68, 0.3)" : "rgba(56, 189, 248, 0.25)"}`,
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: lidHours > 0 ? "var(--aqi-5)" : "#38bdf8",
              }}
            />
            {lidHours > 0 ? t("atmosphere.inversionActive") : t("atmosphere.inversionNormal")}
          </span>
        </div>
      </div>

      <p className="section__lede section__lede--sm">
        {t("atmosphere.inversionLede")}
      </p>

      {inversion.status === "error" ? (
        <PanelMessage tone="warn" style={{ marginTop: "2rem" }}>
          <b>Meteorology feed unavailable.</b> The inversion series could not be retrieved from the
          upstream met provider.
        </PanelMessage>
      ) : inversion.status === "loading" ? (
        <Skeleton style={{ width: "100%", aspectRatio: `${W} / ${H}`, marginTop: "1.5rem", borderRadius: 4 }} />
      ) : series.length === 0 ? (
        <PanelMessage tone="warn" style={{ marginTop: "2rem" }}>
          <b>No inversion data.</b> The met provider returned an empty ΔT series.
        </PanelMessage>
      ) : (
        <>
          <div className="inv__chart" aria-hidden="true">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
              {staticLayer}
              {/* cursor: vertical line at the scrubbed hour + marker on the trace */}
              <line x1={curX} y1={PAD_T} x2={curX} y2={H - PAD_B} className="inv-cursor" />
              <circle cx={curX} cy={curY} r={4} className="inv-cursor-dot" />
            </svg>
          </div>
          <div className="inv__axisnote">
            <span>
              x · forecast hour · y · ΔT 925–1000 hPa (°C)
            </span>
            <span>
              {cur ? `${signed(cur.delta_t_celsius, 1)} °C · ${yLabel(cur.delta_t_celsius)}` : ""}
            </span>
          </div>
        </>
      )}

      <dl className="inv__stats" aria-live="polite">
        <div>
          <dt>{t("atmosphere.deltaTCursor")}</dt>
          <dd>{cur ? `${signed(cur.delta_t_celsius, 1)} °C` : "—"}</dd>
        </div>
        <div>
          <dt>{t("atmosphere.severity")}</dt>
          <dd>{cur ? (cur.severity === "None" ? t("atmosphere.noneNormalLapse") : cur.severity) : "—"}</dd>
        </div>
        <div>
          <dt>{t("atmosphere.lapseRate")}</dt>
          <dd>{cur ? `${signed(cur.lapse_rate_k_per_km, 1)} K/km` : "—"}</dd>
        </div>
        <div>
          <dt>{t("atmosphere.hoursWithLid")}</dt>
          <dd>{series.length ? `${lidHours} ${t("map.ofUnits")} ${series.length}` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

/** ~5 evenly spaced y-axis ticks between yMin and yMax, rounded to 0.5 °C. */
function ticks(yMin: number, yMax: number): number[] {
  const span = yMax - yMin;
  const step0 = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    out.push(Math.round(v * 10) / 10);
  }
  return out.length > 1 ? out : [Math.round(yMin), Math.round(yMax)];
}
