import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Boot } from "@/components/Boot";
import { ConsensusDashboard } from "@/components/ConsensusDashboard";
import { HazeField } from "@/components/HazeField";
import { Hero } from "@/components/Hero";
import { Rail, type PageType } from "@/components/Rail";
import { StationMap } from "@/components/StationMap";
import { Stations } from "@/components/Stations";
import { ForecastDataPage } from "@/components/ForecastDataPage";
import { HistoricDataPage } from "@/components/HistoricDataPage";
import { AtmosphericDynamicsPage } from "@/components/AtmosphericDynamicsPage";
import { ExposureTrackerPage } from "@/components/ExposureTrackerPage";
import { TransportPage } from "@/components/TransportPage";
import { HealthCareAssistantPage } from "@/components/HealthCareAssistantPage";
import { AlertsPage } from "@/components/AlertsPage";
import { AqiReportPage } from "@/components/AqiReportPage";
import { AuthModal } from "@/components/AuthModal";
import { OperatorConsole } from "@/components/OperatorConsole";
import { AdvisoryBar } from "@/components/AdvisoryBar";
import { Landing } from "@/components/Landing";
import { useAuth } from "@/hooks/useAuth";
import { IndustryMapView } from "@/components/IndustryMapView";
import { PollutantCardStackSection } from "@/components/PollutantCardStackSection";
import { CitizenIndustryPage } from "@/components/CitizenIndustryPage";
import { CitizenPollutionExplainer } from "@/components/CitizenPollutionExplainer";
import GradualBlur from "@/components/ui/GradualBlur";
import { useCityAggregate } from "@/hooks/useCityAggregate";
import { useConsensus } from "@/hooks/useConsensus";
import { useCursor } from "@/hooks/useCursor";
import { useForecastData } from "@/hooks/useForecastData";
import { useRealtimeData } from "@/hooks/useRealtimeData";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { categoryColor } from "@/lib/aqi";
import { stamp as fmtStamp } from "@/lib/format";
import { evaluateAlerts, loadAlertSettings } from "@/lib/alertsEngine";

// Pages reserved for authority accounts. Citizens get the citizen pages +
// shared pages; authorities get everything.
const AUTHORITY_PAGES: PageType[] = [
  "forecast-datas",
  "historic-data",
  "atmospheric-dynamics",
  "transports",
  "industry-map",
];

export default function App() {
  const reduced = useReducedMotion();
  const data = useForecastData();
  const consensus = useConsensus();
  const cityAggregate = useCityAggregate();
  const realtime = useRealtimeData();
  const auth = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<number>(0);

  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    if (typeof window !== "undefined") {
      if (
        window.location.hash === "#forecast-datas" ||
        window.location.hash === "#forecast-data"
      ) {
        return "forecast-datas";
      }
      if (
        window.location.hash === "#historic-data" ||
        window.location.hash === "#historic-datas"
      ) {
        return "historic-data";
      }
      if (
        window.location.hash === "#atmospheric-dynamics" ||
        window.location.hash === "#atmosphere"
      ) {
        return "atmospheric-dynamics";
      }
      if (
        window.location.hash === "#exposure-tracker" ||
        window.location.hash === "#exposure"
      ) {
        return "exposure-tracker";
      }
      if (
        window.location.hash === "#transports" ||
        window.location.hash === "#transport"
      ) {
        return "transports";
      }
      if (
        window.location.hash === "#health-assistant" ||
        window.location.hash === "#healthcare" ||
        window.location.hash === "#health"
      ) {
        return "health-assistant";
      }
      if (
        window.location.hash === "#alerts" ||
        window.location.hash === "#alert"
      ) {
        return "alerts";
      }
      if (
        window.location.hash === "#report" ||
        window.location.hash === "#aqi-report"
      ) {
        return "report";
      }
      if (
        window.location.hash === "#industry-map" ||
        window.location.hash === "#industry-intelligence" ||
        window.location.hash === "#industries"
      ) {
        return "industry-map";
      }
      if (
        window.location.hash === "#citizen-industry" ||
        window.location.hash === "#local-industry"
      ) {
        return "citizen-industry";
      }
    }
    return "overview";
  });

  useEffect(() => {
    const handleHash = () => {
      if (
        window.location.hash === "#forecast-datas" ||
        window.location.hash === "#forecast-data"
      ) {
        setCurrentPage("forecast-datas");
      } else if (
        window.location.hash === "#historic-data" ||
        window.location.hash === "#historic-datas"
      ) {
        setCurrentPage("historic-data");
      } else if (
        window.location.hash === "#atmospheric-dynamics" ||
        window.location.hash === "#atmosphere"
      ) {
        setCurrentPage("atmospheric-dynamics");
      } else if (
        window.location.hash === "#exposure-tracker" ||
        window.location.hash === "#exposure"
      ) {
        setCurrentPage("exposure-tracker");
      } else if (
        window.location.hash === "#transports" ||
        window.location.hash === "#transport"
      ) {
        setCurrentPage("transports");
      } else if (
        window.location.hash === "#industry-map" ||
        window.location.hash === "#industry-intelligence" ||
        window.location.hash === "#industries"
      ) {
        setCurrentPage("industry-map");
      } else if (
        window.location.hash === "#citizen-industry" ||
        window.location.hash === "#local-industry"
      ) {
        setCurrentPage("citizen-industry");
      } else if (
        window.location.hash === "#health-assistant" ||
        window.location.hash === "#healthcare" ||
        window.location.hash === "#health"
      ) {
        setCurrentPage("health-assistant");
      } else if (
        window.location.hash === "#alerts" ||
        window.location.hash === "#alert"
      ) {
        setCurrentPage("alerts");
      } else if (
        window.location.hash === "#report" ||
        window.location.hash === "#aqi-report"
      ) {
        setCurrentPage("report");
      } else if (window.location.hash === "#overview" || window.location.hash === "") {
        setCurrentPage("overview");
      }
    };
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  // Role-gating: authority pages require an authority account. If a citizen
  // (or a signed-out user) somehow lands on one, fall back to overview.
  const effectivePage: PageType =
    AUTHORITY_PAGES.includes(currentPage) && auth.user?.role !== "authority"
      ? "overview"
      : currentPage;

  const handlePageChange = (page: PageType) => {
    setCurrentPage(page);
    window.location.hash =
      page === "forecast-datas"
        ? "forecast-datas"
        : page === "historic-data"
        ? "historic-data"
        : page === "atmospheric-dynamics"
        ? "atmospheric-dynamics"
        : page === "exposure-tracker"
        ? "exposure-tracker"
        : page === "transports"
        ? "transports"
        : page === "industry-map"
        ? "industry-map"
        : page === "citizen-industry"
        ? "citizen-industry"
        : page === "health-assistant"
        ? "health-assistant"
        : page === "alerts"
        ? "alerts"
        : page === "report"
        ? "report"
        : "overview";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hours = data.forecast.data?.forecast_hours ?? [];
  const n = hours.length;
  const cursor = useCursor(Math.max(0, n - 1), reduced);
  const hour = hours[cursor.cursor] ?? null;

  // Reactively compute alert stats for header bell icon
  const alertEvaluation = useMemo(() => {
    return evaluateAlerts({
      cityAggregate: cityAggregate.data,
      stations: data.stations.data ?? [],
      forecast: data.forecast.data,
      currentHour: hour,
      plume: data.plume.data,
      consensus: consensus.data,
      userSettings: loadAlertSettings(),
    });
  }, [cityAggregate.data, data.stations.data, data.forecast.data, hour, data.plume.data, consensus.data]);

  const unreadAlertsCount = alertEvaluation.unreadCount;
  const hasCriticalAlert = alertEvaluation.criticalCount > 0;

  const pm25 = hour?.sub_indices.find((s) => s.pollutant === "PM2.5")?.concentration ?? null;
  const stamp = data.forecast.data?.generated_at ? fmtStamp(data.forecast.data.generated_at) : "—";

  // ── data-anim: motion preference (set before paint to avoid a reveal flash) ──
  useLayoutEffect(() => {
    document.documentElement.dataset.anim = reduced ? "off" : "on";
  }, [reduced]);

  // ── data-state: boot overlay visibility ────────────────────────────────────
  useEffect(() => {
    document.documentElement.dataset.state = data.ready ? "ready" : "boot";
  }, [data.ready]);

  // ── --live: bind the whole console's accent to the scrubbed hour's category ──
  useEffect(() => {
    const root = document.documentElement.style;
    if (hour) root.setProperty("--live", categoryColor(hour.category));
    else root.removeProperty("--live");
  }, [hour]);

  // ── Entrance reveal: fade sections up as they enter view (motion only) ───────
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reduced || effectivePage !== "overview") return;
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;

    const targets = Array.from(
      root.querySelectorAll<HTMLElement>(":scope > .hero, :scope > .section, :scope > .split > .section, :scope > .foot"),
    );
    targets.forEach((el, i) => {
      el.classList.add("reveal");
      el.style.setProperty("--d", `${Math.min(i, 4) * 60}ms`);
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [reduced, effectivePage]);

  return (
    <>
      <HazeField pm25={pm25} reduced={reduced} />

      <Rail
        feeds={data.feeds}
        stamp={stamp}
        onRefresh={data.refresh}
        activeVideo={activeVideo}
        onVideoChange={setActiveVideo}
        unreadAlertsCount={unreadAlertsCount}
        hasCriticalAlert={hasCriticalAlert}
        user={auth.user}
        currentPage={effectivePage}
        onSignIn={() => setAuthOpen(true)}
        onOperatorConsole={() => setOperatorOpen(true)}
        onPageChange={(page) => {
          // Extra guard: a citizen clicking an authority page can't happen via
          // the UI, but keep hash-url deep links from doing it either.
          if (AUTHORITY_PAGES.includes(page) && auth.user?.role !== "authority") return;
          handlePageChange(page);
        }}
      />

      {/* Auth gate: signed-out users see ONLY the landing page — no data, no tabs. */}
      {!auth.user ? (
        <Landing onSignIn={() => setAuthOpen(true)} signInError={auth.authError} />
      ) : effectivePage === "forecast-datas" ? (
        <ForecastDataPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "historic-data" ? (
        <HistoricDataPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "atmospheric-dynamics" ? (
        <AtmosphericDynamicsPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor}
          inversion={data.inversion}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "exposure-tracker" ? (
        <ExposureTrackerPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "transports" ? (
        <TransportPage
          hour={hour}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "health-assistant" ? (
        <HealthCareAssistantPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "alerts" ? (
        <AlertsPage
          cityAggregate={cityAggregate.data}
          stations={data.stations}
          forecast={data.forecast}
          hour={hour}
          plume={data.plume}
          consensus={consensus.data}
          onBack={() => handlePageChange("overview")}
          onNavigate={(p) => handlePageChange(p)}
        />
      ) : effectivePage === "report" ? (
        <AqiReportPage
          forecast={data.forecast}
          hour={hour}
          cursor={cursor.cursor}
          consensus={consensus.data}
          cityAggregate={cityAggregate.data}
          stations={data.stations}
          plume={data.plume}
          inversion={data.inversion}
          onBack={() => handlePageChange("overview")}
        />
      ) : effectivePage === "industry-map" ? (
        <IndustryMapView
          onBack={() => handlePageChange("overview")}
          windSpeedKmh={realtime.weatherapi.data?.wind_kph ?? 12.0}
          windDirectionDeg={realtime.weatherapi.data?.wind_deg ?? 300}
        />
      ) : effectivePage === "citizen-industry" ? (
        <CitizenIndustryPage
          stations={data.stations}
          plume={data.plume}
          inversion={data.inversion}
          hour={hour}
          windSpeedKmh={realtime.weatherapi.data?.wind_kph ?? 12.0}
          windDirectionDeg={realtime.weatherapi.data?.wind_deg ?? 300}
          onBack={() => handlePageChange("overview")}
        />
      ) : (
        <main ref={mainRef}>
          {/* 1. Hero Section (AQI Value with Full Screen Video Background) */}
          <div id="forecast-hero">
            <Hero
              forecast={data.forecast}
              hour={hour}
              cursor={cursor.cursor}
              consensus={consensus.data}
              cityAggregate={cityAggregate.data}
              realtime={realtime.iqair.data}
              weatherapi={realtime.weatherapi.data}
              activeVideo={activeVideo}
              onVideoChange={setActiveVideo}
              ready={data.ready}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          </div>

          {/* 1.5. Live Pollutant Particle Breakdown - 3D Fanning Card Stack */}
          <PollutantCardStackSection
            cityAggregate={cityAggregate.data}
            consensus={consensus.data}
            hour={hour}
            cursor={cursor.cursor}
            weatherapi={realtime.weatherapi.data}
            realtimeIqair={realtime.iqair.data}
          />

          {/* 2. Delhi NCR Live Condition */}
          <div id="consensus-dashboard">
            <ConsensusDashboard
              data={consensus.data}
              forecast={data.forecast.data}
              loading={consensus.status === "loading"}
              error={consensus.error}
              cityAggregate={cityAggregate.data}
              realtimeIqair={realtime.iqair.data}
            />
          </div>

          {/* 2.5. Citizen Air Guide - 3 Plain-Language Breakdown Boxes */}
          <div id="citizen-pollution-breakdown">
            <CitizenPollutionExplainer
              stations={data.stations}
              plume={data.plume}
              inversion={data.inversion}
              hour={hour}
              cityAggregate={cityAggregate.data}
              weatherapi={realtime.weatherapi.data}
            />
          </div>

          {/* 3. Map View Stations */}
          <div id="station-map-view" className="w-full px-6 lg:px-12 xl:px-16 2xl:px-24 mx-auto">
            <StationMap
              stations={data.stations}
              plume={data.plume}
              forecast={data.forecast}
              overview={data.overview}
              cursor={cursor.cursor}
              cityAggregate={cityAggregate.data}
            />
          </div>



          {/* 5. List All Live Stations */}
          <div id="stations-grid">
            <Stations stations={data.stations} overview={data.overview} />
          </div>
        </main>
      )}

      <Boot boot={data.boot} ready={data.ready} />

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthed={() => undefined} />

      <OperatorConsole open={operatorOpen} onClose={() => setOperatorOpen(false)} />

      {/* Progressive Gradual Blur Overlay at Website Bottom (GPU Optimized) */}
      <GradualBlur
        target="page"
        position="bottom"
        height="5rem"
        strength={1.8}
        divCount={2}
        curve="bezier"
        opacity={0.85}
        zIndex={35}
      />
    </>
  );
}
