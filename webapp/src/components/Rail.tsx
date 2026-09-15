import { useState, useEffect } from "react";
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
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import type { Feeds } from "@/hooks/useForecastData";
import { useTranslation } from "@/i18n";
import { LanguageSelector } from "@/components/LanguageSelector";
import { logout, type AuthUser } from "@/lib/auth";

export type PageType =
  | "overview"
  | "forecast-datas"
  | "historic-data"
  | "atmospheric-dynamics"
  | "exposure-tracker"
  | "transports"
  | "industry-map"
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
}: RailProps) {
  const { t } = useTranslation();

  const isAuthorityPage =
    currentPage === "forecast-datas" ||
    currentPage === "historic-data" ||
    currentPage === "atmospheric-dynamics" ||
    currentPage === "transports" ||
    currentPage === "industry-map";

  const isCitizenPage =
    currentPage === "exposure-tracker" ||
    currentPage === "citizen-industry" ||
    currentPage === "health-assistant";

  // Role gating: citizens see only the Citizen tab; authorities see both.
  // Signed-out users see neither (they are on the landing page).
  const canViewCitizen = !!user;
  const canViewAuthority = user?.role === "authority";

  // Active category: "authority" | "citizen" | null
  const [activeCategory, setActiveCategory] = useState<"authority" | "citizen" | null>(() => {
    if (isAuthorityPage) return "authority";
    if (isCitizenPage) return "citizen";
    return null;
  });

  useEffect(() => {
    if (isAuthorityPage) {
      setActiveCategory("authority");
    } else if (isCitizenPage) {
      setActiveCategory("citizen");
    } else if (currentPage === "overview") {
      setActiveCategory(null);
    }
  }, [currentPage, isAuthorityPage, isCitizenPage]);

  const handleSelectPage = (page: PageType) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  const handleCategoryClick = (category: "authority" | "citizen") => {
    if (activeCategory === category && currentPage === "overview") {
      // Toggle off if on overview
      setActiveCategory(null);
      return;
    }

    setActiveCategory(category);

    if (category === "authority") {
      if (!canViewAuthority) return; // defense-in-depth; tab is hidden anyway
      if (!isAuthorityPage && onPageChange) {
        onPageChange("forecast-datas");
      }
    } else if (category === "citizen") {
      if (!canViewCitizen) return;
      if (!isCitizenPage && onPageChange) {
        onPageChange("exposure-tracker");
      }
    }
  };

  const authorityItems = [
    { id: "forecast-datas", label: t("navigation.forecast"), icon: BarChart3 },
    { id: "historic-data", label: t("navigation.historic"), icon: History },
    { id: "atmospheric-dynamics", label: t("navigation.atmosphere"), icon: CloudRain },
    { id: "transports", label: t("navigation.transports") || "Transports", icon: Truck },
    { id: "industry-map", label: t("landing.industryMap") || "Industry Intelligence & Map", icon: Factory },
  ];

  const citizenItems = [
    { id: "exposure-tracker", label: t("navigation.exposure"), icon: HeartPulse },
    { id: "health-assistant", label: t("navigation.healthAdvisory") || t("navigation.healthAssistant") || "Health Advisory", icon: Bot },
    { id: "citizen-industry", label: "Local Industry & Sources", icon: Factory },
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
      {/* Left: Brand Logo & Download Report Trigger (Stacked in top-left) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.35rem", zIndex: 10 }}>
        <div
          className="rail__brand"
          style={{ cursor: "pointer", display: "flex", alignItems: "baseline", gap: "0.5rem" }}
          onClick={() => handleSelectPage("overview")}
          title="Return to Main Overview Console"
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "var(--live)",
              borderRadius: "1px",
              transform: "rotate(45deg)",
              boxShadow: "0 0 10px var(--live)",
              alignSelf: "center",
            }}
            aria-hidden="true"
          />
          <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: "14px", color: "#FFFFFF", letterSpacing: "0.06em", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
            NCR<span style={{ color: "var(--live)" }}>·</span>72
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: "rgba(255, 255, 255, 0.55)", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            coupled aqi forecast
          </span>
        </div>

        {/* Compact Premium Download Report Action placed directly under brand text */}
        {onPageChange && (
          <button
            type="button"
            onClick={() => onPageChange("report")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.26rem 0.65rem",
              background: currentPage === "report" ? "rgba(56, 189, 248, 0.25)" : "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${currentPage === "report" ? "rgba(56, 189, 248, 0.5)" : "rgba(255, 255, 255, 0.18)"}`,
              borderRadius: "5px",
              color: currentPage === "report" ? "var(--cyan)" : "#FFFFFF",
              fontFamily: "var(--mono)",
              fontSize: "10.5px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "report" ? "0 0 12px rgba(56, 189, 248, 0.4)" : "0 2px 6px rgba(0,0,0,0.3)",
              whiteSpace: "nowrap",
            }}
            title="Download Official Delhi-NCR AQI Intelligence Report"
          >
            <Download size={11} style={{ color: "var(--cyan)" }} />
            <span>{t("navigation.downloadReport") || "Download Report"}</span>
          </button>
        )}
      </div>

      {/* Center: Major 2-Option Menu Bar (Authority & Citizen) with Dynamic Submenu */}
      {onPageChange && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 50,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Primary Top Bar: Exactly 2 Options (Authority & Citizen) */}
          <div
            className="liquid-glass"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.28rem 0.35rem",
              borderRadius: "9999px",
              background: "rgba(12, 16, 26, 0.7)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1.5px rgba(255, 255, 255, 0.25)",
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            {/* Option 1: Authority (authorities only) */}
            {canViewAuthority && (
            <button
              type="button"
              onClick={() => handleCategoryClick("authority")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.34rem 0.95rem",
                borderRadius: "9999px",
                background: isAuthorityPage || activeCategory === "authority" ? "rgba(255, 255, 255, 0.22)" : "transparent",
                border: `1px solid ${isAuthorityPage || activeCategory === "authority" ? "rgba(255, 255, 255, 0.42)" : "transparent"}`,
                boxShadow: isAuthorityPage || activeCategory === "authority"
                  ? "0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)"
                  : "none",
                color: isAuthorityPage || activeCategory === "authority" ? "#FFFFFF" : "rgba(255, 255, 255, 0.75)",
                fontFamily: "var(--mono)",
                fontSize: "12px",
                fontWeight: isAuthorityPage || activeCategory === "authority" ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                whiteSpace: "nowrap",
                outline: "none",
              }}
              onMouseEnter={(e) => {
                if (!isAuthorityPage && activeCategory !== "authority") {
                  e.currentTarget.style.color = "#FFFFFF";
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isAuthorityPage && activeCategory !== "authority") {
                  e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <Building2
                size={13}
                style={{
                  color: isAuthorityPage || activeCategory === "authority" ? "var(--cyan)" : "rgba(255, 255, 255, 0.6)",
                  transition: "color 0.25s ease",
                }}
              />
              <span>{t("navigation.authority") || "Authority"}</span>
            </button>
            )}

            {/* Option 2: Citizen (any signed-in user) */}
            {canViewCitizen && (
            <button
              type="button"
              onClick={() => handleCategoryClick("citizen")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.34rem 0.95rem",
                borderRadius: "9999px",
                background: isCitizenPage || activeCategory === "citizen" ? "rgba(255, 255, 255, 0.22)" : "transparent",
                border: `1px solid ${isCitizenPage || activeCategory === "citizen" ? "rgba(255, 255, 255, 0.42)" : "transparent"}`,
                boxShadow: isCitizenPage || activeCategory === "citizen"
                  ? "0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)"
                  : "none",
                color: isCitizenPage || activeCategory === "citizen" ? "#FFFFFF" : "rgba(255, 255, 255, 0.75)",
                fontFamily: "var(--mono)",
                fontSize: "12px",
                fontWeight: isCitizenPage || activeCategory === "citizen" ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                whiteSpace: "nowrap",
                outline: "none",
              }}
              onMouseEnter={(e) => {
                if (!isCitizenPage && activeCategory !== "citizen") {
                  e.currentTarget.style.color = "#FFFFFF";
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isCitizenPage && activeCategory !== "citizen") {
                  e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <Users
                size={13}
                style={{
                  color: isCitizenPage || activeCategory === "citizen" ? "var(--live)" : "rgba(255, 255, 255, 0.6)",
                  transition: "color 0.25s ease",
                }}
              />
              <span>{t("navigation.citizen") || "Citizen"}</span>
            </button>
            )}
          </div>

          {/* Submenu Pills: Floating Directly Below with White-Rounded Liquid Glass Animation */}
          <AnimatePresence>
            {activeCategory && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="liquid-glass"
                style={{
                  position: "absolute",
                  top: "calc(100% + 7px)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  padding: "0.26rem 0.32rem",
                  borderRadius: "9999px",
                  background: "rgba(10, 14, 24, 0.85)",
                  backdropFilter: "blur(28px) saturate(190%)",
                  WebkitBackdropFilter: "blur(28px) saturate(190%)",
                  border: "1px solid rgba(255, 255, 255, 0.22)",
                  boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6), inset 0 1px 1.5px rgba(255, 255, 255, 0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                {(activeCategory === "authority" ? authorityItems : citizenItems).map((btn) => {
                  const isActive = currentPage === btn.id;
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => handleSelectPage(btn.id as PageType)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        padding: "0.32rem 0.75rem",
                        borderRadius: "9999px",
                        background: isActive ? "rgba(255, 255, 255, 0.22)" : "transparent",
                        border: `1px solid ${isActive ? "rgba(255, 255, 255, 0.42)" : "transparent"}`,
                        boxShadow: isActive
                          ? "0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)"
                          : "none",
                        color: isActive ? "#FFFFFF" : "rgba(255, 255, 255, 0.75)",
                        fontFamily: "var(--mono)",
                        fontSize: "11.5px",
                        fontWeight: isActive ? 600 : 400,
                        cursor: "pointer",
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        whiteSpace: "nowrap",
                        outline: "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.color = "#FFFFFF";
                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
                          e.currentTarget.style.background = "transparent";
                        }
                      }}
                    >
                      <Icon
                        size={12.5}
                        style={{
                          color: isActive ? "var(--live)" : "rgba(255, 255, 255, 0.6)",
                          transition: "color 0.25s ease",
                        }}
                      />
                      <span>{btn.label}</span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Right: Alert Bell Quick Icon, Timestamp, Refresh & Language Selector */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          zIndex: 10,
        }}
      >
        {/* Auth: user chip or sign-in button */}
        {user ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.28rem 0.55rem 0.28rem 0.4rem",
              background: "rgba(255,255,255,0.07)",
              border: `1px solid ${user.role === "authority" ? "rgba(56,189,248,0.45)" : "rgba(255,255,255,0.2)"}`,
              borderRadius: "9999px",
            }}
            title={`${user.full_name} · ${user.email} · ${user.role}`}
          >
            {user.role === "authority" ? (
              <ShieldCheck size={13} style={{ color: "var(--cyan)" }} />
            ) : (
              <Users size={13} style={{ color: "var(--live)" }} />
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: "11px",
                color: "#fff",
                maxWidth: "130px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.full_name}
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "1.5px 6px",
                borderRadius: "9999px",
                background: user.role === "authority" ? "rgba(56,189,248,0.18)" : "rgba(255,255,255,0.1)",
                color: user.role === "authority" ? "#7dd3fc" : "rgba(255,255,255,0.75)",
              }}
            >
              {user.role}
            </span>
            <button
              type="button"
              onClick={(e) => {
                // Stop the click from bubbling to the chip's onClick, which
                // would re-open the auth modal right after signing out.
                e.stopPropagation();
                logout();
              }}
              aria-label="Sign out"
              title="Sign out"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.55)",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
              }}
            >
              <LogOut size={12} />
            </button>
          </div>
        ) : (
          onSignIn && (
            <button
              type="button"
              className="auth-chip-glow"
              onClick={onSignIn}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.32rem 0.75rem",
                background: "rgba(56,189,248,0.14)",
                border: "1px solid rgba(56,189,248,0.45)",
                borderRadius: "9999px",
                color: "#7dd3fc",
                fontFamily: "var(--mono)",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              title="Sign in as a citizen or an official authority account"
            >
              <LogIn size={12} />
              <span>{t("landing.signInChip") || "Sign in"}</span>
            </button>
          )
        )}

        {/* Operator console (invite-code management) — discreet key icon */}
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
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.22)",
              borderRadius: "50%",
              color: "rgba(255, 255, 255, 0.85)",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <KeyRound size={14} />
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
              background: currentPage === "alerts" ? "rgba(168, 85, 247, 0.35)" : "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${currentPage === "alerts" ? "#a855f7" : "rgba(255, 255, 255, 0.22)"}`,
              borderRadius: "50%",
              color: currentPage === "alerts" ? "#FFFFFF" : "rgba(255, 255, 255, 0.85)",
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: currentPage === "alerts" ? "0 0 12px rgba(168, 85, 247, 0.5)" : "none",
            }}
            title={t("header.alertsTooltip")}
            aria-label="Real-time Alerts"
          >
            <Bell size={14} style={{ color: currentPage === "alerts" || unreadAlertsCount > 0 ? "#c084fc" : undefined }} />
            {unreadAlertsCount > 0 && (
              <span
                className={hasCriticalAlert ? "alert-bell-pulse" : ""}
                style={{
                  position: "absolute",
                  top: "-2px",
                  right: "-2px",
                  minWidth: "16px",
                  height: "16px",
                  padding: "0 4px",
                  borderRadius: "9999px",
                  background: hasCriticalAlert ? "#ef4444" : "#a855f7",
                  color: "#FFFFFF",
                  fontSize: "9px",
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

        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.6)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {stamp}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.32rem 0.65rem",
            background: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: "4px",
            color: "#FFFFFF",
            fontFamily: "var(--mono)",
            fontSize: "11.5px",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.2s ease",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          <RotateCw size={12} aria-hidden="true" />
          <span>{t("header.refresh")}</span>
        </button>

        {/* Premium Language Selector (Top Right Box) */}
        <LanguageSelector />
      </div>
    </header>
  );
}
