import { useState } from "react";
import { InteractiveIndustryMap } from "./InteractiveIndustryMap";
import { IndustryIntelligenceSection } from "./IndustryIntelligenceSection";
import type { SupabaseIndustryRecord } from "@/lib/industrySupabase";

export interface IndustryMapViewProps {
  onBack?: () => void;
  windSpeedKmh?: number;
  windDirectionDeg?: number;
}

export function IndustryMapView({
  onBack,
  windSpeedKmh = 12.0,
  windDirectionDeg = 300,
}: IndustryMapViewProps) {
  const [selectedIndustry, setSelectedIndustry] = useState<SupabaseIndustryRecord | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(15);
  const [activeIndustries, setActiveIndustries] = useState<SupabaseIndustryRecord[]>([]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-10 animate-fadeIn" id="industry-intelligence-main-view">
      {/* ── Interactive Leaflet Industry Map View ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-glass)] pb-3">
          <div>
            <div className="text-xs font-mono text-[var(--accent-cyan)] flex items-center gap-2">
              <span>GEOSPATIAL INTELLIGENCE</span>
              <span>/</span>
              <span>136K+ INDUSTRIAL REGISTRY</span>
            </div>
            <h1 className="text-2xl font-bold text-white mt-1">
              Interactive Industrial Emitter Map & Viewport Intelligence
            </h1>
          </div>
          {onBack && (
            <button onClick={onBack} className="cyber-btn text-xs">
              ← Back to Overview
            </button>
          )}
        </div>

        <InteractiveIndustryMap
          selectedIndustry={selectedIndustry}
          onSelectIndustry={setSelectedIndustry}
          radiusKm={radiusKm}
          onRadiusChange={setRadiusKm}
          onIndustriesInRadiusChange={setActiveIndustries}
          windSpeedKmh={windSpeedKmh}
          windDirectionDeg={windDirectionDeg}
        />
      </section>

      {/* ── Industry Intelligence & Digital Twin Stack Section ── */}
      <section>
        <IndustryIntelligenceSection
          selectedIndustry={selectedIndustry}
          onSelectIndustry={setSelectedIndustry}
          radiusKm={radiusKm}
          activeIndustries={activeIndustries}
          windSpeedKmh={windSpeedKmh}
        />
      </section>
    </div>
  );
}
