import { useState, useEffect, useRef } from "react";
import {
  RotateCw,
  History,
  CloudRain,
  HeartPulse,
  BarChart3,
  Bot,
  Bell,
  Download,
  Truck,
  Building2,
  Users,
  Factory,
  LogIn,
  LogOut,
  KeyRound,
  Eye,
  MapPin,
  X,
} from "lucide-react";
import { CircleMenu, type CircleMenuItem } from "@/components/ui/circle-menu";

import type { Feeds } from "@/hooks/useForecastData";
import { useTranslation } from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/context/ThemeContext";
import { elevate, logout, type AuthUser } from "@/lib/auth";

const getInitials = (name?: string, role?: string): string => {
  if (!name || name.trim() === "") {
    return role === "authority" ? "AO" : "CU";
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export type PageType =
  | "overview"
  | "forecast-datas"
  | "historic-data"
  | "atmospheric-dynamics"
  | "exposure-tracker"
  | "transports"
  | "industry-map"
  | "model-transparency"
  | "citizen-industry"
  | "health-assistant"
  | "alerts"
  | "report";

export interface RailProps {
  feeds?: Feeds;
  stamp: string;
  onRefresh: () => void;
  currentPage?: PageType;
  onPageChange?: (page: PageType) => void;
  activeVideo?: number;
  onVideoChange?: (index: number) => void;
  unreadAlertsCount?: number;
  hasCriticalAlert?: boolean;
  user?: AuthUser | null;
  onSignIn?: () => void;
  onOperatorConsole?: () => void;
  stations?: { uid: string; name: string; aqi: number }[] | null;
  selectedStationUid?: string | null;
  onStationSelect?: (uid: string) => void;
}

export function Rail({
  stamp,
  onRefresh,
  currentPage = "overview",
  onPageChange,
  unreadAlertsCount = 0,
  hasCriticalAlert = false,
  user = null,
  onSignIn,
  onOperatorConsole,
  stations = null,
  selectedStationUid = null,
  onStationSelect,
}: RailProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isLight = theme === "light";

  const isAuthorityPage =
    currentPage === "forecast-datas" ||
    currentPage === "historic-data" ||
    currentPage === "atmospheric-dynamics" ||
    currentPage === "transports" ||
    currentPage === "industry-map" ||
    currentPage === "model-transparency";

  const isCitizenPage =
    currentPage === "exposure-tracker" ||
    currentPage === "citizen-industry" ||
    currentPage === "health-assistant";

  // Role gating:
  // - Authorities see only the Authority Master Menu (which already includes all Citizen sections + Overview).
  // - Citizens see the Citizen Menu.
  // - Signed-out users see neither (they remain on the landing console).
  const canViewCitizen = user?.role === "citizen";
  const canViewAuthority = user?.role === "authority";

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [profileRedeemCode, setProfileRedeemCode] = useState("");
  const [profileRedeemError, setProfileRedeemError] = useState<string | null>(null);
  const [profileRedeemBusy, setProfileRedeemBusy] = useState(false);
  const [profileRedeemed, setProfileRedeemed] = useState(false);

  useEffect(() => {
    if (!isProfileOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isProfileOpen]);

  const handleSelectPage = (page: PageType) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  // Authority master menu: all platform sections with icons, tiers, and badges.
  // Since authorities have full command over all sections, this lists both Authority and Citizen sections + City Overview.
  const authorityMenuItems: CircleMenuItem[] = [
    // Tier 1 (Outer Arc): Authority Deep-Tech & Atmospheric Intelligence
    {
      label: t("navigation.forecast") || "Coupled Forecast (NCR-72)",
      icon: <BarChart3 size={15} className="text-cyan-400" />,
      href: "#forecast-datas",
      onClick: () => handleSelectPage("forecast-datas"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    {
      label: t("navigation.historic") || "Historic Data & Replay",
      icon: <History size={15} className="text-sky-400" />,
      href: "#historic-data",
      onClick: () => handleSelectPage("historic-data"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    {
      label: t("navigation.atmosphere") || "Atmospheric Dynamics",
      icon: <CloudRain size={15} className="text-blue-400" />,
      href: "#atmospheric-dynamics",
      onClick: () => handleSelectPage("atmospheric-dynamics"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    {
      label: t("navigation.transports") || "Plume Transport & Advection",
      icon: <Truck size={15} className="text-teal-400" />,
      href: "#transports",
      onClick: () => handleSelectPage("transports"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    {
      label: t("landing.industryMap") || "Industry Intelligence & Map",
      icon: <Factory size={15} className="text-indigo-400" />,
      href: "#industry-map",
      onClick: () => handleSelectPage("industry-map"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    {
      label: "Model Transparency",
      icon: <Eye size={15} className="text-violet-400" />,
      href: "#model-transparency",
      onClick: () => handleSelectPage("model-transparency"),
      tier: 1,
      badge: "AUTHORITY",
      badgeColor: "#38bdf8",
    },
    // Tier 2 (Inner Arc): Citizen Oversight & Platform Overview
    {
      label: t("navigation.exposure") || "Exposure Tracker",
      icon: <HeartPulse size={15} className="text-emerald-400" />,
      href: "#exposure-tracker",
      onClick: () => handleSelectPage("exposure-tracker"),
      tier: 2,
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
    {
      label: t("navigation.healthAdvisory") || t("navigation.healthAssistant") || "Health Advisory",
      icon: <Bot size={15} className="text-purple-400" />,
      href: "#health-assistant",
      onClick: () => handleSelectPage("health-assistant"),
      tier: 2,
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
    {
      label: "Local Industry & Sources",
      icon: <Building2 size={15} className="text-amber-400" />,
      href: "#citizen-industry",
      onClick: () => handleSelectPage("citizen-industry"),
      tier: 2,
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
    {
      label: "City Overview Console",
      icon: <RotateCw size={15} className="text-rose-400" />,
      href: "#overview",
      onClick: () => handleSelectPage("overview"),
      tier: 2,
      badge: "OVERVIEW",
      badgeColor: "#fb7185",
    },
  ];

  // Citizen menu: dedicated citizen sections
  const citizenMenuItems: CircleMenuItem[] = [
    {
      label: t("navigation.exposure") || "Exposure Tracker",
      icon: <HeartPulse size={15} className="text-emerald-400" />,
      href: "#exposure-tracker",
      onClick: () => handleSelectPage("exposure-tracker"),
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
    {
      label: t("navigation.healthAdvisory") || t("navigation.healthAssistant") || "Health Advisory",
      icon: <Bot size={15} className="text-cyan-400" />,
      href: "#health-assistant",
      onClick: () => handleSelectPage("health-assistant"),
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
    {
      label: "Local Industry & Sources",
      icon: <Factory size={15} className="text-amber-400" />,
      href: "#citizen-industry",
      onClick: () => handleSelectPage("citizen-industry"),
      badge: "CITIZEN",
      badgeColor: "#34d399",
    },
  ];

  return (
    <header
      className="rail"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.85rem clamp(1rem, 3vw, 2.5rem)",
        background: "transparent",
        border: "none",
        boxShadow: "none",
        zIndex: 40,
      }}
    >
      {/* Left: Brand Capsule & Download Report Pill (Horizontal Unified Row) */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", zIndex: 10, flex: "1 1 0", minWidth: 0 }}>
        {/* Brand Capsule */}
        <div
          onClick={() => handleSelectPage("overview")}
          title="Return to Main Overview Console"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.55rem",
            height: "32px",
            padding: "0 0.85rem 0 0.75rem",
            background: isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)"}`,
            borderRadius: "9999px",
            boxShadow: isLight ? "0 4px 16px rgba(15, 23, 42, 0.08)" : "0 4px 16px rgba(0, 0, 0, 0.35)",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = isLight ? "rgba(2, 132, 199, 0.45)" : "rgba(56, 189, 248, 0.4)";
            e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(16, 22, 36, 0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)";
            e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)";
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              backgroundColor: "var(--live)",
              borderRadius: "1.5px",
              transform: "rotate(45deg)",
              boxShadow: "0 0 8px var(--live)",
            }}
            aria-hidden="true"
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              fontSize: "13px",
              color: isLight ? "#0f172a" : "#FFFFFF",
              letterSpacing: "0.06em",
            }}
          >
            NCR<span style={{ color: "var(--live)" }}>·</span>72
          </span>
          <span
            style={{
              width: "1px",
              height: "12px",
              background: isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.18)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: "10px",
              fontWeight: 500,
              color: isLight ? "#64748b" : "rgba(255, 255, 255, 0.55)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            coupled aqi
          </span>
        </div>

        {/* Download Report Pill Button */}
        {onPageChange && (
          <button
            type="button"
            onClick={() => onPageChange("report")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              height: "32px",
              padding: "0 0.85rem",
              background: currentPage === "report"
                ? (isLight ? "rgba(2, 132, 199, 0.16)" : "rgba(56, 189, 248, 0.22)")
                : (isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)"),
              border: `1px solid ${currentPage === "report" ? (isLight ? "rgba(2, 132, 199, 0.5)" : "rgba(56, 189, 248, 0.55)") : (isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)")}`,
              borderRadius: "9999px",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              color: currentPage === "report" ? (isLight ? "#0284c7" : "var(--cyan)") : (isLight ? "#0f172a" : "rgba(255, 255, 255, 0.85)"),
              fontFamily: "var(--mono)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "report"
                ? (isLight ? "0 0 12px rgba(2, 132, 199, 0.25)" : "0 0 12px rgba(56, 189, 248, 0.4)")
                : (isLight ? "0 4px 12px rgba(15, 23, 42, 0.06)" : "0 4px 12px rgba(0,0,0,0.25)"),
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (currentPage !== "report") {
                e.currentTarget.style.borderColor = isLight ? "rgba(2, 132, 199, 0.45)" : "rgba(56, 189, 248, 0.45)";
                e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(16, 22, 36, 0.85)";
                e.currentTarget.style.color = isLight ? "#0284c7" : "#FFFFFF";
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== "report") {
                e.currentTarget.style.borderColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)";
                e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)";
                e.currentTarget.style.color = isLight ? "#0f172a" : "rgba(255, 255, 255, 0.85)";
              }
            }}
            title="Download Official Delhi-NCR AQI Intelligence Report"
          >
            <Download size={12} style={{ color: isLight ? "#0284c7" : "var(--cyan)" }} />
            <span>{t("navigation.downloadReport") || "Download Report"}</span>
          </button>
        )}
      </div>

      {/* Center: Major 2-Option Menu Bar (Authority & Citizen) with Dynamic Submenu */}
      {onPageChange && (
        <div
          style={{
            position: "relative",
            zIndex: 50,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {/* Primary Top Bar: Authority & Citizen Animated Circular Menus */}
          <div
            className="liquid-glass"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.28rem 0.45rem",
              borderRadius: "9999px",
              background: isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.75)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.2)"}`,
              boxShadow: isLight
                ? "0 8px 32px rgba(15, 23, 42, 0.08), inset 0 1px 1.5px rgba(255, 255, 255, 0.9)"
                : "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1.5px rgba(255, 255, 255, 0.25)",
              overflow: "visible",
              maxWidth: "100%",
            }}
          >
            {/* Option 1: Authority Master Circular Menu (authorities only) */}
            {canViewAuthority && (
              <CircleMenu
                items={authorityMenuItems}
                openIcon={<Building2 size={14} className="text-cyan-400" />}
                closeIcon={<X size={14} className="text-cyan-300" />}
                triggerLabel={t("navigation.authority") || "Authority"}
                itemSize={34}
                radius={86}
                direction="down"
                fitTrigger={true}
                active={isAuthorityPage || isCitizenPage}
                activeClassName="ring-2 ring-cyan-400/50 shadow-[0_0_12px_rgba(56,189,248,0.45)]"
                title="Authority Master Menu — Full Platform Intelligence & Control"
                triggerClassName={
                  isAuthorityPage || isCitizenPage
                    ? "bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 shadow-[0_0_14px_rgba(56,189,248,0.35)] backdrop-blur-md"
                    : isLight
                    ? "bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 backdrop-blur-md"
                    : "bg-white/10 hover:bg-white/20 border border-white/20 text-white backdrop-blur-md"
                }
              />
            )}

            {/* Option 2: Citizen Circular Menu */}
            {canViewCitizen && (
              <CircleMenu
                items={citizenMenuItems}
                openIcon={<Users size={14} className="text-emerald-400" />}
                closeIcon={<X size={14} className="text-emerald-300" />}
                triggerLabel={t("navigation.citizen") || "Citizen"}
                itemSize={34}
                radius={82}
                direction="down"
                fitTrigger={true}
                active={isCitizenPage}
                activeClassName="ring-2 ring-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.45)]"
                title="Citizen Menu — Explore Citizen Sections"
                triggerClassName={
                  isCitizenPage
                    ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.35)] backdrop-blur-md"
                    : isLight
                    ? "bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 backdrop-blur-md"
                    : "bg-white/10 hover:bg-white/20 border border-white/20 text-white backdrop-blur-md"
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Right: Actions, Live Telemetry, Language Selector & Rightmost Round Profile Icon */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "0.9rem",
          paddingLeft: "0.75rem",
          zIndex: 10,
          flex: "0 0 auto",
        }}
      >
        {/* Operator console (invite-code management) — discreet key button */}
        {onOperatorConsole && (
          <button
            type="button"
            onClick={onOperatorConsole}
            aria-label="Operator console"
            title="Operator console — invite-code management"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              background: "rgba(12, 16, 26, 0.7)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              borderRadius: "50%",
              backdropFilter: "blur(20px)",
              color: "rgba(255, 255, 255, 0.75)",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.4)";
              e.currentTarget.style.color = "#7dd3fc";
              e.currentTarget.style.background = "rgba(16, 22, 36, 0.85)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.16)";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
              e.currentTarget.style.background = "rgba(12, 16, 26, 0.7)";
            }}
          >
            <KeyRound size={13} />
          </button>
        )}

        {/* Dedicated Header Bell Quick Button */}
        {onPageChange && (
          <button
            type="button"
            onClick={() => onPageChange("alerts")}
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              background: currentPage === "alerts"
                ? (isLight ? "rgba(147, 51, 234, 0.18)" : "rgba(168, 85, 247, 0.25)")
                : (isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)"),
              border: `1px solid ${currentPage === "alerts" ? "#9333ea" : (isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)")}`,
              borderRadius: "50%",
              backdropFilter: "blur(20px)",
              color: currentPage === "alerts" ? (isLight ? "#9333ea" : "#FFFFFF") : (isLight ? "#475569" : "rgba(255, 255, 255, 0.75)"),
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "alerts"
                ? "0 0 12px rgba(168, 85, 247, 0.4)"
                : (isLight ? "0 2px 8px rgba(15, 23, 42, 0.05)" : "none"),
            }}
            onMouseEnter={(e) => {
              if (currentPage !== "alerts") {
                e.currentTarget.style.borderColor = "rgba(192, 132, 252, 0.5)";
                e.currentTarget.style.color = "#a855f7";
                e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.98)" : "rgba(16, 22, 36, 0.85)";
              }
            }}
            onMouseLeave={(e) => {
              if (currentPage !== "alerts") {
                e.currentTarget.style.borderColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)";
                e.currentTarget.style.color = isLight ? "#475569" : "rgba(255, 255, 255, 0.75)";
                e.currentTarget.style.background = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)";
              }
            }}
            title={t("header.alertsTooltip")}
            aria-label="Real-time Alerts"
          >
            <Bell size={13} style={{ color: currentPage === "alerts" || unreadAlertsCount > 0 ? "#a855f7" : undefined }} />
            {unreadAlertsCount > 0 && (
              <span
                className={hasCriticalAlert ? "alert-bell-pulse" : ""}
                style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  minWidth: "15px",
                  height: "15px",
                  padding: "0 3.5px",
                  borderRadius: "9999px",
                  background: hasCriticalAlert ? "#ef4444" : "#a855f7",
                  color: "#FFFFFF",
                  fontSize: "8.5px",
                  fontWeight: 700,
                  fontFamily: "var(--mono)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: hasCriticalAlert ? "0 0 8px #ef4444" : "0 0 6px #a855f7",
                  lineHeight: 1,
                }}
              >
                {unreadAlertsCount > 9 ? "9+" : unreadAlertsCount}
              </span>
            )}
          </button>
        )}

        {/* Telemetry Capsule: Timestamp + Refresh Action Unified */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: "32px",
            background: isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(12, 16, 26, 0.7)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)"}`,
            borderRadius: "9999px",
            padding: "0 0.35rem 0 0.75rem",
            gap: "0.5rem",
            boxShadow: isLight ? "0 4px 12px rgba(15, 23, 42, 0.06)" : "0 4px 12px rgba(0, 0, 0, 0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "var(--live)",
                boxShadow: "0 0 6px var(--live)",
              }}
              aria-hidden="true"
            />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: "11px",
                color: isLight ? "#334155" : "rgba(255, 255, 255, 0.7)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
              title="Live Delhi-NCR Forecast Clock"
            >
              {stamp}
            </span>
          </div>

          <span
            style={{
              width: "1px",
              height: "14px",
              background: isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.15)",
            }}
          />

          <span
            style={{
              width: "1px",
              height: "14px",
              background: isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.15)",
            }}
          />

          <button
            type="button"
            onClick={onRefresh}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              height: "24px",
              padding: "0 0.55rem",
              background: "transparent",
              border: "none",
              borderRadius: "9999px",
              color: isLight ? "#0f172a" : "rgba(255, 255, 255, 0.85)",
              fontFamily: "var(--mono)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.18s ease",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isLight ? "rgba(15, 23, 42, 0.06)" : "rgba(255, 255, 255, 0.12)";
              e.currentTarget.style.color = isLight ? "#0284c7" : "#FFFFFF";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = isLight ? "#0f172a" : "rgba(255, 255, 255, 0.85)";
            }}
            title="Sync and Refresh Atmospheric Feeds"
          >
            <RotateCw size={11} style={{ color: isLight ? "#0284c7" : "var(--cyan)" }} />
            <span>{t("header.refresh")}</span>
          </button>
        </div>

        {/* Station picker — ONE selection drives the whole app (signed-in only:
            the landing page has no station context yet) */}
        {user && stations && stations.length > 0 && (
          <div
            className="flex items-center gap-1.5"
            style={{
              padding: "0 10px",
              height: "32px",
              borderRadius: "10px",
              background: isLight ? "rgba(255, 255, 255, 0.9)" : "rgba(12, 16, 26, 0.7)",
              border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.16)"}`,
              backdropFilter: "blur(20px)",
            }}
            title="Select your station — live AQI, forecast and area analysis all follow this choice"
          >
            <MapPin size={12} style={{ color: isLight ? "#0284c7" : "#38bdf8", flexShrink: 0 }} />
            <select
              value={selectedStationUid ?? ""}
              onChange={(e) => onStationSelect?.(e.target.value)}
              aria-label="Select station — drives live AQI, forecast and area analysis"
              className="cursor-pointer focus:outline-none"
              style={{
                background: "transparent",
                border: "none",
                color: isLight ? "#0f172a" : "rgba(255, 255, 255, 0.92)",
                fontFamily: "var(--mono)",
                fontSize: "11px",
                fontWeight: 600,
                maxWidth: "130px",
              }}
            >
              {stations.map((s) => (
                <option key={s.uid} value={s.uid} style={{ color: "#0f172a" }}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Premium Language Selector */}
        <LanguageSelector />

        {/* Theme Toggle Button */}
        <ThemeToggle />

        {/* Rightmost: Round Profile Avatar with 2-Letter Initials */}
        {user ? (
          <div ref={profileMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setIsProfileOpen((prev) => !prev)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: user.role === "authority"
                  ? "linear-gradient(135deg, rgba(14, 165, 233, 0.35) 0%, rgba(12, 16, 26, 0.95) 100%)"
                  : "linear-gradient(135deg, rgba(16, 185, 129, 0.35) 0%, rgba(12, 16, 26, 0.95) 100%)",
                border: `1.5px solid ${user.role === "authority" ? "rgba(56, 189, 248, 0.65)" : "rgba(52, 211, 153, 0.65)"}`,
                boxShadow: user.role === "authority"
                  ? "0 0 12px rgba(56, 189, 248, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.2)"
                  : "0 0 12px rgba(52, 211, 153, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.2)",
                color: "#FFFFFF",
                fontFamily: "var(--mono)",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                outline: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.06)";
                e.currentTarget.style.boxShadow = user.role === "authority"
                  ? "0 0 18px rgba(56, 189, 248, 0.6)"
                  : "0 0 18px rgba(52, 211, 153, 0.6)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = user.role === "authority"
                  ? "0 0 12px rgba(56, 189, 248, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.2)"
                  : "0 0 12px rgba(52, 211, 153, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.2)";
              }}
              title={`${user.full_name} (${user.role.toUpperCase()}) — Click for details & logout`}
              aria-label={`Profile of ${user.full_name}`}
            >
              <span>{getInitials(user.full_name, user.role)}</span>
            </button>

            {/* Compact Profile Popover / Dropdown */}
            {isProfileOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  minWidth: "195px",
                  background: isLight
                    ? "linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%)"
                    : "linear-gradient(135deg, rgba(16, 22, 38, 0.97) 0%, rgba(10, 14, 24, 0.98) 100%)",
                  border: `1px solid ${user.role === "authority" ? "rgba(56, 189, 248, 0.35)" : "rgba(52, 211, 153, 0.35)"}`,
                  borderRadius: "10px",
                  boxShadow: isLight
                    ? "0 16px 40px rgba(15, 23, 42, 0.12), 0 0 20px rgba(15, 23, 42, 0.06)"
                    : "0 16px 40px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 0, 0, 0.5)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  padding: "0.65rem 0.75rem",
                  zIndex: 100,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.55rem",
                  animation: "fadeIn 0.15s ease",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", paddingBottom: "0.5rem", borderBottom: `1px solid ${isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.1)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: "12px", fontWeight: 700, color: isLight ? "#0f172a" : "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.full_name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "8.5px",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        padding: "1.5px 5.5px",
                        borderRadius: "9999px",
                        background: user.role === "authority" ? "rgba(56,189,248,0.2)" : "rgba(52,211,153,0.2)",
                        color: user.role === "authority" ? (isLight ? "#0284c7" : "#7dd3fc") : (isLight ? "#059669" : "#6ee7b7"),
                        border: `1px solid ${user.role === "authority" ? "rgba(56,189,248,0.4)" : "rgba(52,211,153,0.4)"}`,
                      }}
                    >
                      {user.role}
                    </span>
                  </div>
                  {user.email && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: "10px", color: isLight ? "#64748b" : "rgba(255, 255, 255, 0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {user.email}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsProfileOpen(false);
                    logout();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.45rem",
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "6px",
                    background: "rgba(244, 63, 94, 0.12)",
                    border: "1px solid rgba(244, 63, 94, 0.25)",
                    color: isLight ? "#e11d48" : "#fda4af",
                    fontFamily: "var(--mono)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(244, 63, 94, 0.25)";
                    e.currentTarget.style.color = isLight ? "#9f1239" : "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(244, 63, 94, 0.12)";
                    e.currentTarget.style.color = isLight ? "#e11d48" : "#fda4af";
                  }}
                >
                  <LogOut size={12} />
                  <span>Sign Out</span>
                </button>

                {/* Citizen with an authority code: visible retry path. Covers
                    the Google flow when the automatic post-redirect redemption
                    failed (e.g. code consumed elsewhere first). */}
                {user.role === "citizen" && (
                  <div style={{ marginTop: "0.45rem" }}>
                    {profileRedeemed ? (
                      <div style={{ fontFamily: "var(--mono)", fontSize: "9.5px", color: isLight ? "#0284c7" : "#7dd3fc", padding: "0.25rem 0" }}>
                        Code applied — re-login to refresh your session.
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: "0.35rem" }}>
                          <input
                            value={profileRedeemCode}
                            onChange={(e) => {
                              setProfileRedeemCode(e.target.value);
                              setProfileRedeemError(null);
                            }}
                            placeholder="NCR72-XXXXXXXX"
                            aria-label="Authority invite code"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: "0.35rem 0.5rem",
                              background: isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(0,0,0,0.4)",
                              border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255,255,255,0.16)"}`,
                              borderRadius: "6px",
                              color: isLight ? "#0f172a" : "#fff",
                              fontFamily: "var(--mono)",
                              fontSize: "10px",
                            }}
                          />
                          <button
                            type="button"
                            disabled={profileRedeemBusy || !profileRedeemCode.trim()}
                            onClick={async () => {
                              setProfileRedeemBusy(true);
                              setProfileRedeemError(null);
                              try {
                                await elevate(profileRedeemCode);
                                setProfileRedeemed(true);
                                // refresh the session role server-side, then reload
                                setTimeout(() => window.location.reload(), 800);
                              } catch (err) {
                                setProfileRedeemError(err instanceof Error ? err.message : "Code redemption failed.");
                              } finally {
                                setProfileRedeemBusy(false);
                              }
                            }}
                            style={{
                              padding: "0.35rem 0.55rem",
                              background: "rgba(56,189,248,0.15)",
                              border: "1px solid rgba(56,189,248,0.4)",
                              borderRadius: "6px",
                              color: isLight ? "#0284c7" : "#7dd3fc",
                              fontFamily: "var(--mono)",
                              fontSize: "10px",
                              fontWeight: 700,
                              cursor: profileRedeemBusy || !profileRedeemCode.trim() ? "not-allowed" : "pointer",
                              opacity: profileRedeemBusy || !profileRedeemCode.trim() ? 0.5 : 1,
                            }}
                          >
                            {profileRedeemBusy ? "…" : "Apply"}
                          </button>
                        </div>
                        {profileRedeemError && (
                          <div style={{ fontFamily: "var(--mono)", fontSize: "9.5px", color: isLight ? "#e11d48" : "#fda4af", marginTop: "0.3rem" }}>
                            {profileRedeemError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          onSignIn && (
            <button
              type="button"
              onClick={onSignIn}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: isLight ? "rgba(2, 132, 199, 0.12)" : "rgba(56, 189, 248, 0.14)",
                border: `1px solid ${isLight ? "rgba(2, 132, 199, 0.4)" : "rgba(56, 189, 248, 0.45)"}`,
                color: isLight ? "#0284c7" : "#7dd3fc",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              title="Sign in as a citizen or an official authority account"
              aria-label="Sign in"
            >
              <LogIn size={13} />
            </button>
          )
        )}
      </div>
    </header>
  );
}
