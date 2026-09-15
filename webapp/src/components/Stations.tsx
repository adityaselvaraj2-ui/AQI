import type { Panel } from "@/hooks/useForecastData";
import { aqiColor } from "@/lib/aqi";
import { clock, int } from "@/lib/format";
import type { CityOverview, StationReading } from "@/lib/types";
import { PanelMessage } from "@/components/ui/panel-message";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n";
import { getTranslatedStationName, type StationLang } from "@/lib/stationTranslations";

interface StationsProps {
  stations: Panel<StationReading[]>;
  overview: Panel<CityOverview>;
}

export function Stations({ stations, overview }: StationsProps) {
  const { t, language } = useTranslation();
  const rows = (stations.data ?? []).slice().sort((a, b) => b.aqi - a.aqi); // worst first
  const ov = overview.data;

  const getCategoryLabel = (cat?: string) => {
    if (!cat) return "";
    switch (cat.toLowerCase()) {
      case "good": return t("hero.categories.good");
      case "satisfactory": return t("hero.categories.satisfactory");
      case "moderate": return t("hero.categories.moderate");
      case "poor": return t("hero.categories.poor");
      case "very poor": return t("hero.categories.veryPoor");
      case "severe": return t("hero.categories.severe");
      case "hazardous": return t("hero.categories.hazardous");
      default: return cat;
    }
  };

  const cityName = language === "ta" ? "தில்லி" : language === "hi" ? "दिल्ली" : "Delhi";
  const cityLine = ov
    ? `${cityName} ${int(ov.aqi)} · ${getCategoryLabel(ov.category)}${ov.updated ? ` · ${t("stations.updated")} ${clock(ov.updated)}` : ""}`
    : "";

  return (
    <section className="section section--stations w-full px-6 lg:px-12 xl:px-16 2xl:px-24 mx-auto" aria-labelledby="st-h">
      <div className="pb-3 border-b border-[var(--border-glass)] mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-emerald-400/90 flex items-center gap-2 uppercase tracking-wider">
            <span>{t("stations.groundTruth")}</span>
          </div>
          <h2 className="text-2xl font-bold text-white mt-1 mb-2 font-sans" id="st-h">
            {t("stations.title")}
          </h2>
          <p className="text-base text-white/70 max-w-3xl">
            {t("stations.subtitle")}
          </p>
        </div>
        <p className="text-xs font-mono text-white/40 uppercase tracking-wider whitespace-nowrap">{cityLine}</p>
      </div>

      {stations.status === "loading" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4">
          {Array.from({ length: 10 }, (_, i) => (
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-4 flex items-center gap-3" key={i}>
              <Skeleton style={{ width: "2rem", height: "1.5rem" }} />
              <div className="flex-1">
                <Skeleton style={{ width: "80%", height: "0.8rem", marginBottom: "0.4rem" }} />
                <Skeleton style={{ width: "40%", height: "0.6rem" }} />
              </div>
            </div>
          ))}
        </div>
      ) : stations.status === "error" ? (
        <PanelMessage tone="warn">
          <b>{t("stations.openAqUnavailable")}</b>
        </PanelMessage>
      ) : rows.length === 0 ? (
        <PanelMessage>
          <b>{t("stations.noStations")}</b>
        </PanelMessage>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4">
          {rows.map((s) => (
            <div 
              className="bg-white/[0.03] hover:bg-white/[0.08] transition-colors border border-white/10 rounded-xl p-4 flex flex-col justify-center gap-1 cursor-default" 
              key={s.uid} 
              title={s.dominant_pollutant ? `${t("hero.dominant")} ${s.dominant_pollutant}` : undefined}
            >
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-bold font-sans tabular-nums min-w-[2.5rem]" style={{ color: aqiColor(s.aqi) }}>
                  {int(s.aqi)}
                </span>
                <span className="text-[13px] font-medium text-white/90 truncate font-sans">
                  {getTranslatedStationName(s.name, (language as StationLang) || "en")}
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-mono text-white/40 pl-[3.25rem]">
                {getCategoryLabel(s.category)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
