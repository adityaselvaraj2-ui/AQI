import { ArrowLeft } from "lucide-react";
import { SourceInfluencePanel } from "@/components/SourceInfluencePanel";
import { IndustryMapView } from "@/components/IndustryMapView";
import type { Panel } from "@/hooks/useForecastData";
import type {
  StationReading,
  PlumeVectorsResponse,
  InversionStatus,
  HourlyForecast,
} from "@/lib/types";

interface CitizenIndustryPageProps {
  stations: Panel<StationReading[]>;
  plume?: Panel<PlumeVectorsResponse>;
  inversion?: Panel<InversionStatus[]>;
  hour: HourlyForecast | null;
  windSpeedKmh: number;
  windDirectionDeg: number;
  onBack: () => void;
}

export function CitizenIndustryPage({
  stations,
  plume,
  inversion,
  hour,
  windSpeedKmh,
  windDirectionDeg,
  onBack,
}: CitizenIndustryPageProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--abyss)",
        color: "var(--bone)",
        paddingTop: "4.5rem",
        paddingBottom: "4rem",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
          <button
            onClick={onBack}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--bone)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
            }}
          >
            <ArrowLeft size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-12">
          <IndustryMapView
            windSpeedKmh={windSpeedKmh}
            windDirectionDeg={windDirectionDeg}
          />
          <SourceInfluencePanel
            stations={stations}
            plume={plume}
            inversion={inversion}
            hour={hour}
          />
        </div>
      </div>
    </div>
  );
}
