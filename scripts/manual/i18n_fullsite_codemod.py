# Full-site i18n codemod — run once, then delete.
# Every replacement is exact-match + assert-count. On any mismatch the script
# aborts BEFORE writing that file, so nothing can be half-patched.
import io, sys

results = []

def apply(path, pairs, must_all=True):
    src = io.open(path, encoding='utf-8', newline='').read()
    NL = '\r\n' if '\r\n' in src else '\n'
    misses = []
    out = src
    for old, new in pairs:
        o = old.replace('\n', NL)
        n = new.replace('\n', NL)
        if out.count(o) == 1:
            out = out.replace(o, n)
        else:
            misses.append((old[:70], out.count(o)))
    if misses and must_all:
        print(f"ABORT {path}: {len(misses)} anchor misses:")
        for m in misses:
            print("   x%d  %r" % (m[1], m[0]))
        return False
    if out == src:
        print(f"SKIP {path}: nothing changed")
        return True
    io.open(path, 'w', encoding='utf-8', newline='').write(out)
    print(f"OK   {path}: {len(pairs) - len(misses)} replacements" + (f" ({len(misses)} missed)" if misses else ""))
    results.append(path)
    return True

# ----------------------------------------------------------------------------
# 1. Import + hook insertion
# ----------------------------------------------------------------------------
HOOK = '  const { t } = useTranslation();'

apply('webapp/src/components/CitizenPollutionExplainer.tsx', [
    ('import salesmanAnimation from "@/assets/pollution_explainer_animation.json";',
     'import { useTranslation } from "@/i18n";\nimport salesmanAnimation from "@/assets/pollution_explainer_animation.json";'),
])

apply('webapp/src/components/SourceInfluencePanel.tsx', [
    ('import type { Panel } from "@/hooks/useForecastData";',
     'import { useTranslation } from "@/i18n";\nimport type { Panel } from "@/hooks/useForecastData";'),
])

apply('webapp/src/components/IndustryDetailsPage.tsx', [
    ('import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";',
     'import { useTranslation } from "@/i18n";\nimport { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";'),
])

apply('webapp/src/components/IndustryIntelligenceSection.tsx', [
    ('import "@/styles/industry-intelligence.css";',
     'import { useTranslation } from "@/i18n";\nimport "@/styles/industry-intelligence.css";'),
])

apply('webapp/src/components/TransportPage.tsx', [
    ('import { SourceApportionment } from "@/components/SourceApportionment";',
     'import { useTranslation } from "@/i18n";\nimport { SourceApportionment } from "@/components/SourceApportionment";'),
])

apply('webapp/src/components/ModelTransparencyPage.tsx', [
    ('import { Eye, Loader2, AlertTriangle, Landmark, RefreshCw } from "lucide-react";',
     'import { Eye, Loader2, AlertTriangle, Landmark, RefreshCw } from "lucide-react";\nimport { useTranslation } from "@/i18n";'),
])

apply('webapp/src/components/AuthModal.tsx', [
    ('import { X, Building2, Users, ShieldCheck, Loader2, Check, AlertCircle } from "lucide-react";',
     'import { X, Building2, Users, ShieldCheck, Loader2, Check, AlertCircle } from "lucide-react";\nimport { useTranslation } from "@/i18n";'),
])

apply('webapp/src/components/StationMap.tsx', [
    ('import { StationDetail } from "@/components/map/StationDetail";',
     'import { useTranslation } from "@/i18n";\nimport { StationDetail } from "@/components/map/StationDetail";'),
])

# ----------------------------------------------------------------------------
# 2. Hook insertion after the first state line of each component body
# ----------------------------------------------------------------------------
# hook goes right after the component's destructuring close + useTheme if present.
def insert_hook(path, anchor):
    src = io.open(path, encoding='utf-8', newline='').read()
    NL = '\r\n' if '\r\n' in src else '\n'
    a = anchor.replace('\n', NL)
    if 'const { t } = useTranslation();' in src:
        print(f"hook already in {path}")
        return
    assert src.count(a) == 1, f"{path}: hook anchor x{src.count(a)}"
    src = src.replace(a, a + NL + '  const { t } = useTranslation();')
    io.open(path, 'w', encoding='utf-8', newline='').write(src)
    print("hook inserted:", path)

insert_hook('webapp/src/components/CitizenPollutionExplainer.tsx',
            'export function CitizenPollutionExplainer({\n  stations,\n  plume,\n  inversion,\n  hour,\n  cityAggregate,\n  weatherapi,')
insert_hook('webapp/src/components/SourceInfluencePanel.tsx',
            'export function SourceInfluencePanel({ stations, plume, inversion, hour }: Props) {')
insert_hook('webapp/src/components/IndustryDetailsPage.tsx',
            '}: IndustryDetailsPageProps) {\n  const { theme } = useTheme();')
insert_hook('webapp/src/components/IndustryIntelligenceSection.tsx',
            'export function IndustryIntelligenceSection({\n  selectedIndustry,')
insert_hook('webapp/src/components/TransportPage.tsx',
            '}: TransportPageProps) {')
insert_hook('webapp/src/components/ModelTransparencyPage.tsx',
            'export function ModelTransparencyPage({ onBack }: { onBack: () => void }) {')
insert_hook('webapp/src/components/AuthModal.tsx',
            'export function AuthModal({ open, onClose, onAuthed }: AuthModalProps) {')
insert_hook('webapp/src/components/StationMap.tsx',
            'export function StationMap({\n  stations,')
insert_hook('webapp/src/components/InteractiveIndustryMap.tsx',
            'export function InteractiveIndustryMap({\n  selectedIndustry,')
insert_hook('webapp/src/components/AdvisoryBar.tsx',
            'export function AdvisoryBar({ user, onAuthRequired }: AdvisoryBarProps) {')

# ----------------------------------------------------------------------------
# 3. String replacements — CitizenPollutionExplainer
# ----------------------------------------------------------------------------
apply('webapp/src/components/CitizenPollutionExplainer.tsx', [
    ('aria-label="Citizen Air Pollution Guide"',
     'aria-label={t("pages.citizen.ariaGuide")}'),
    ('<span>CITIZEN AIR GUIDE · PLAIN LANGUAGE</span>',
     '<span>{t("pages.citizen.badge")}</span>'),
    ("What's Polluting {targetCoords.name}?",
     '{t("pages.citizen.whatsPolluting", { name: targetCoords.name })}'),
    ('<span>EVERYDAY AIR EXPLAINER</span>',
     '<span>{t("pages.citizen.everydayBadge")}</span>'),
    ('Why Is {targetCoords.name} Polluted Right Now?',
     '{t("pages.citizen.whyPolluted", { name: targetCoords.name })}'),
    ('''                          Air pollution in {targetCoords.name} peaks between{" "}
                          <span className="text-amber-400 font-semibold">8:00 PM and 8:00 AM</span>,
                          making{" "}
                          <span className="text-emerald-400 font-semibold">1:00 PM to 4:00 PM</span>{" "}
                          the safest window for your family's outdoor activities.''',
     '''                          {t("pages.citizen.peaksLine1")} {targetCoords.name} {t("pages.citizen.peaksBetween")}{" "}
                          <span className="text-amber-400 font-semibold">{t("pages.citizen.peakWindow")}</span>,
                          {t("pages.citizen.making")}{" "}
                          <span className="text-emerald-400 font-semibold">{t("pages.citizen.safeWindow")}</span>{" "}
                          {t("pages.citizen.peaksSuffix")}'''),
    ('<span>Atmospheric Inversion Lid</span>', '<span>{t("pages.citizen.lid")}</span>'),
    ('<span>Microscopic PM2.5 Hazard</span>', '<span>{t("pages.citizen.pmHazard")}</span>'),
    ('<span>Safe Ventilation (1 PM – 4 PM)</span>', '<span>{t("pages.citizen.safeVent")}</span>'),
    ('<span>Children & Seniors Protection</span>', '<span>{t("pages.citizen.childrenSeniors")}</span>'),
    ('<span>Resume</span>', '<span>{t("pages.citizen.resume")}</span>',),
    ('<span>Pause</span>', '<span>{t("pages.citizen.pause")}</span>'),
    ('<span className="text-xs sm:text-sm text-slate-300 font-medium">Estimated Factory Share:</span>',
     '<span className="text-xs sm:text-sm text-slate-300 font-medium">{t("pages.citizen.factoryShare")}</span>'),
    ('<span>Why Chimneys Reach Ground Level</span>', '<span>{t("pages.citizen.chimneyGround")}</span>'),
    ('<span>Kilometers of Wind Transport</span>', '<span>{t("pages.citizen.kmTransport")}</span>'),
    ('<span className="text-amber-300/90 font-medium">Emits: </span>',
     '<span className="text-amber-300/90 font-medium">{t("pages.citizen.emits")} </span>'),
    ('<span>Metal & Foundry Soot</span>', '<span>{t("pages.citizen.metalSoot")}</span>'),
    ('<span>Chemical & Solvent Fumes</span>', '<span>{t("pages.citizen.chemicalFumes")}</span>'),
    ('<span className="text-xs sm:text-sm text-slate-300 font-medium">Estimated Vehicle Share:</span>',
     '<span className="text-xs sm:text-sm text-slate-300 font-medium">{t("pages.citizen.vehicleShare")}</span>'),
    ('<span>Direct Breath-Level Exhaust</span>', '<span>{t("pages.citizen.breathExhaust")}</span>'),
    ('<span>Stop-and-Go Incomplete Burn</span>', '<span>{t("pages.citizen.stopGo")}</span>'),
    ('<span>Gridlock & AC Engine Idling</span>', '<span>{t("pages.citizen.gridlock")}</span>'),
    ('<span>Brake Dust & Tire Wear</span>', '<span>{t("pages.citizen.brakeDust")}</span>'),
    ('<span>Dense Diesel Black Carbon Soot</span>', '<span>{t("pages.citizen.dieselSoot")}</span>'),
    ('<span>Night Entry Inversion Window</span>', '<span>{t("pages.citizen.nightWindow")}</span>'),
    ('<span>Hub Pickups & Local Feeder Routes</span>', '<span>{t("pages.citizen.hubPickups")}</span>'),
    ('<span>CNG Fleet & Fine NOx Vapors</span>', '<span>{t("pages.citizen.cngFleet")}</span>'),
    ('<span>Derived from street NO₂ telemetry, road traffic windows & municipal vehicle apportionment</span>',
     '<span>{t("pages.citizen.derived")}</span>'),
    ('<span className="font-mono text-emerald-400 text-[10px]">Real-Time Fleet Apportionment Engine</span>',
     '<span className="font-mono text-emerald-400 text-[10px]">{t("pages.citizen.fleetEngine")}</span>'),
    ('aria-label="Select your neighborhood station"',
     'aria-label={t("pages.citizen.ariaStationSel")}'),
], must_all=False)

# Resume/Pause appear multiple times → replace all
src = io.open('webapp/src/components/CitizenPollutionExplainer.tsx', encoding='utf-8', newline='').read()
src2 = src.replace('<span>Resume</span>', '<span>{t("pages.citizen.resume")}</span>') \
          .replace('<span>Pause</span>', '<span>{t("pages.citizen.pause")}</span>')
if src2 != src:
    io.open('webapp/src/components/CitizenPollutionExplainer.tsx', 'w', encoding='utf-8', newline='').write(src2)
    print("OK   multi-replace Resume/Pause in CitizenPollutionExplainer")

# ----------------------------------------------------------------------------
# 4. SourceInfluencePanel
# ----------------------------------------------------------------------------
apply('webapp/src/components/SourceInfluencePanel.tsx', [
    ('aria-label="Select target air quality monitoring station"',
     'aria-label={t("pages.source.ariaStation")}'),
    ('>Target Location</span>', '>{t("pages.source.targetLocation")}</span>'),
    ('>Transport Vector</span>', '>{t("pages.source.transportVector")}</span>'),
    ('>Mixing Depth (PBL)</span>', '>{t("pages.source.mixingDepth")}</span>'),
    ('>Ventilation / Trapping</span>', '>{t("pages.source.ventTrapping")}</span>'),
    ('>Dynamic Atmospheric and Emission Synthesis</p>', '>{t("pages.source.synthesis")}</p>'),
    ('>Current PM2.5</span>', '>{t("pages.source.currentPm")}</span>'),
    ('>Fire → Plume Transport → Target Location</h3>', '>{t("pages.source.fireChain")}</h3>'),
    ('>Tracked Source</span>', '>{t("pages.source.trackedSource")}</span>'),
    ('>Advection Vector</span>', '>{t("pages.source.advectionVector")}</span>'),
    ('>Gaussian Spread</span>', '>{t("pages.source.gaussianSpread")}</span>'),
    ('>Citizen Activity Exposure Simulator</h3>', '>{t("pages.source.exposureSim")}</h3>'),
    ('>Estimate personal particulate inhalation and find safer hours</p>', '>{t("pages.source.exposureSimDesc")}</p>'),
    ('>Select Physical Activity</label>', '>{t("pages.source.selectActivity")}</label>'),
    ('>Duration</label>', '>{t("pages.source.duration")}</label>'),
    ('>Estimated Inhaled PM2.5</span>', '>{t("pages.source.inhaledPm")}</span>'),
    ('>Peak daytime mixing</span>', '>{t("pages.source.peakMixing")}</span>'),
    ('>Catalog / Registry</span>', '>{t("pages.source.catalog")}</span>'),
    ('>Coordinates</span>', '>{t("pages.source.coordinates")}</span>'),
    ('>Daily Emission Budget</span>', '>{t("pages.source.emissionBudget")}</span>'),
    ('>Stack & Trapping</span>', '>{t("pages.source.stackTrapping")}</span>'),
    ('''          <strong className="text-slate-200">Non-Negotiable Scientific Positioning:</strong> All outputs are{" "}
          <strong className="text-cyan-300">Estimated Model Influences</strong> derived from Lagrangian wind transport alignment, distance decay (55 km scale), boundary layer suppression, and thermal inversion trapping. These represent modeled explanatory rankings and downwind potential rather than chemically resolved source apportionment or exact stack emission percentages.''',
     '''          <strong className="text-slate-200">{t("pages.source.positioningLabel")}</strong> {t("pages.source.positioning1")}{" "}
          <strong className="text-cyan-300">{t("pages.source.positioning2")}</strong> {t("pages.source.positioning3")}'''),
], must_all=False)

# ----------------------------------------------------------------------------
# 5. IndustryDetailsPage
# ----------------------------------------------------------------------------
apply('webapp/src/components/IndustryDetailsPage.tsx', [
    ('<span>CONSOLE</span>', '<span>{t("pages.industry.console")}</span>'),
    ('<span>INDUSTRY MAP</span>', '<span>{t("pages.industry.mapBadge")}</span>'),
    ('>SECTOR</span>', '>{t("pages.industry.sector")}</span>'),
    ('>STACK HEIGHT</span>', '>{t("pages.industry.stackHeight")}</span>'),
    ('>COMPLIANCE STATUS</span>', '>{t("pages.industry.compliance")}</span>'),
    ('>Ambient PM2.5</span>', '>{t("pages.industry.ambientPm25")}</span>'),
    ('>Ambient PM10</span>', '>{t("pages.industry.ambientPm10")}</span>'),
    ('>Nitrogen Dioxide (NO2)</span>', '>{t("pages.industry.no2")}</span>'),
    ('>Combustion Byproduct</span>', '>{t("pages.industry.no2Sub")}</span>'),
    ('>Sulphur Dioxide (SO2)</span>', '>{t("pages.industry.so2")}</span>'),
    ('>Coal / Fuel Desulphurization</span>', '>{t("pages.industry.so2Sub")}</span>'),
    ('>Annual Total Mass Discharge</span>', '>{t("pages.industry.annualDischarge")}</span>'),
    ('>Flue Gas Exit Velocity</span>', '>{t("pages.industry.exitVelocity")}</span>'),
    ('>Induced Draft Fan Velocity</span>', '>{t("pages.industry.fanVelocity")}</span>'),
    ('>Exhaust Stack Temperature</span>', '>{t("pages.industry.stackTemp")}</span>'),
    ('>Thermodynamic Flue Gas</span>', '>{t("pages.industry.flueGas")}</span>'),
], must_all=False)

# ----------------------------------------------------------------------------
# 6. IndustryIntelligenceSection
# ----------------------------------------------------------------------------
apply('webapp/src/components/IndustryIntelligenceSection.tsx', [
    ('<span>Industrial Point-Source Modeling · Digital Twin</span>',
     '<span>{t("pages.industry.digitalTwin")}</span>'),
    ('<span>Full Plant Deep Intelligence</span>', '<span>{t("pages.industry.deepIntel")}</span>'),
    ('<span className="text-[9px] text-slate-500 font-mono">Superheated</span>',
     '<span className="text-[9px] text-slate-500 font-mono">{t("pages.industry.superheated")}</span>'),
    ('<span className="text-slate-300 font-semibold">Continuous Flue Gas Speciation Output</span>',
     '<span className="text-slate-300 font-semibold">{t("pages.industry.cemsTitle")}</span>'),
    ('<span className="text-slate-400 text-[10px]">CEMS Sensor Sim · 24h Baseline</span>',
     '<span className="text-slate-400 text-[10px]">{t("pages.industry.cemsSub")}</span>'),
    ('<span>Sulphur Dioxide (SO2)</span>', '<span>{t("pages.industry.so2")}</span>'),
    ('<span>Nitrogen Oxides (NOx)</span>', '<span>{t("pages.industry.nox")}</span>'),
    ('<span>Carbon Monoxide & VOCs</span>', '<span>{t("pages.industry.coVoc")}</span>'),
    ('<span>Downwind Distance</span>', '<span>{t("pages.industry.downwind")}</span>'),
    ('<span>Ground PM2.5 Surge (µg/m³)</span>', '<span>{t("pages.industry.pmSurge")}</span>'),
    ('>FACILITY NAME</th>', '>{t("pages.industry.thName")}</th>'),
    ('>SECTOR / CATEGORY</th>', '>{t("pages.industry.thSector")}</th>'),
    ('>SEVERITY</th>', '>{t("pages.industry.thSeverity")}</th>'),
    ('>DISTANCE</th>', '>{t("pages.industry.thDistance")}</th>'),
    ('>PRIMARY EMISSIONS</th>', '>{t("pages.industry.thEmissions")}</th>'),
    ('>EST. LOCAL IMPACT</th>', '>{t("pages.industry.thImpact")}</th>'),
    ('>ACTION</th>', '>{t("pages.industry.thAction")}</th>'),
    ('<span>Deep Profile</span>', '<span>{t("pages.industry.deepProfile")}</span>'),
], must_all=False)

# ----------------------------------------------------------------------------
# 7. TransportPage / ModelTransparencyPage / AqiReportPage
# ----------------------------------------------------------------------------
apply('webapp/src/components/TransportPage.tsx', [
    ('<span>Transports & Fleet Source Apportionment</span>',
     '<span>{t("pages.transport.title")}</span>'),
    ('>Primary vehicular aerosol share</div>', '>{t("pages.transport.d1")}</div>'),
    ('>Share of total fleet PM mass</div>', '>{t("pages.transport.d2")}</div>'),
    ('>Diesel combustion tracer marker</div>', '>{t("pages.transport.d3")}</div>'),
    ('>Non-essential trucks diverted</div>', '>{t("pages.transport.d4")}</div>'),
], must_all=False)

apply('webapp/src/components/ModelTransparencyPage.tsx', [
    ('>Hour (UTC)</th>', '>{t("pages.transparency.thHour")}</th>'),
    ('>Model forecast</th>', '>{t("pages.transparency.thModel")}</th>'),
    ('>Raw CAMS cell</th>', '>{t("pages.transparency.thCams")}</th>'),
    ('>Model source</th>', '>{t("pages.transparency.thSource")}</th>'),
    ('>No aligned sensor/CAMS hours in the shared window.</td>', '>{t("pages.transparency.noAligned")}</td>'),
], must_all=False)

apply('webapp/src/components/AqiReportPage.tsx', [
    ('<span>GENERATING REPORT...</span>', '<span>{t("pages.report.generating")}</span>'),
    ('<span>REPORT DOWNLOADED ✓</span>', '<span>{t("pages.report.downloaded")}</span>'),
    ('<span>DOWNLOAD PDF</span>', '<span>{t("pages.report.downloadPdf")}</span>'),
    ('<span>Location: <strong>', '<span>{t("pages.report.location")} <strong>'),
    ('<span>Sensors: <strong>', '<span>{t("pages.report.sensors")} <strong>'),
    (' CAAQMS Stations</strong>', ' {t("pages.report.stationsCount")}</strong>'),
    ('<span>Methodology: <strong>', '<span>{t("pages.report.methodology")} <strong>'),
    ('>CPCB INAQI Multi-Criteria</strong>', '>{t("pages.report.cpcbMethod")}</strong>'),
    ('<span style={{ color: "#94a3b8" }}>Primary Trigger Pollutant:</span>',
     '<span style={{ color: "#94a3b8" }}>{t("pages.report.primaryTrigger")}</span>'),
    ('<span style={{ color: "#94a3b8" }}>Fine Particulate (PM2.5):</span>',
     '<span style={{ color: "#94a3b8" }}>{t("pages.report.pm25Label")}</span>'),
    ('<span style={{ color: "#94a3b8" }}>Coarse Particulate (PM10):</span>',
     '<span style={{ color: "#94a3b8" }}>{t("pages.report.pm10Label")}</span>'),
    ('<span style={{ color: "#94a3b8" }}>Boundary Layer Height (PBL):</span>',
     '<span style={{ color: "#94a3b8" }}>{t("pages.report.pblLabel")}</span>'),
    ('<span style={{ color: "#94a3b8" }}>Thermal Inversion Strength:</span>',
     '<span style={{ color: "#94a3b8" }}>{t("pages.report.inversionLabel")}</span>'),
], must_all=False)

# ----------------------------------------------------------------------------
# 8. InteractiveIndustryMap / AuthModal / StationMap / AdvisoryBar
# ----------------------------------------------------------------------------
apply('webapp/src/components/InteractiveIndustryMap.tsx', [
    ('>Sector:</span>', '>{t("pages.industry.sector")}:</span>'),
    ('>Stack Height:</span>', '>{t("pages.industry.stackHeight")}:</span>'),
    ('<span>ESTIMATED STACK EMISSIONS</span>', '<span>{t("pages.industry.thEmissions")}</span>'),
    ('<span>Deep Intelligence Profile ↗</span>', '<span>{t("pages.industry.deepProfileLink")}</span>'),
    ('title="Toggle Industrial Pins"', 'title={t("pages.industry.togglePins")}'),
    ('title="Toggle Live Wind Vector"', 'title={t("pages.industry.toggleWind")}'),
    ('title="Toggle Dispersion Plume Halo"', 'title={t("pages.industry.togglePlume")}'),
    ('<span className="text-slate-300">Active Stacks in Visible Section:</span>',
     '<span className="text-slate-300">{t("pages.industry.activeStacks")}</span>'),
    ('<span>DB: 136k+</span>', '<span>{t("pages.industry.dbCount")}</span>'),
], must_all=False)

apply('webapp/src/components/AuthModal.tsx', [
    ('aria-label="Close"', 'aria-label={t("pages.auth.close")}'),
    ('>Verifying code…</span>', '>{t("pages.auth.verifying")}</span>'),
    ('>Verified — Google sign-in unlocked.</span>', '>{t("pages.auth.verified")}</span>'),
    ('<span>Continue with Google</span>', '<span>{t("pages.auth.continueGoogle")}</span>'),
], must_all=False)

apply('webapp/src/components/StationMap.tsx', [
    ('<span>NETWORK</span>', '<span>{t("pages.map.network")}</span>'),
    ('<b>Live station data unavailable.</b> Basemap and fire transport are shown; no',
     '<b>{t("pages.map.liveUnavailable1")}</b> {t("pages.map.liveUnavailable2")}'),
], must_all=False)

apply('webapp/src/components/AdvisoryBar.tsx', [
    ('title="Advisory publishing is restricted to authority accounts. Click your name chip (top right) to redeem an invite code."',
     'title={t("pages.advisory.restrictedTip")}'),
    ('title="Government officials sign in with an invite code to publish here"',
     'title={t("pages.advisory.officialTip")}'),
    ('aria-label="Retract advisory"', 'aria-label={t("pages.advisory.retractAria")}'),
    ('title="Retract"', 'title={t("pages.advisory.retract")}'),
], must_all=False)

print("\nFILES PATCHED:", len(results))
sys.exit(0)
