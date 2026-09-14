import { Building2, Users, BarChart3, HeartPulse, ShieldCheck, ArrowRight } from "lucide-react";
import { useTranslation } from "@/i18n";

interface LandingProps {
  onSignIn: () => void;
}

/**
 * Pre-login landing view. Shows NO data content — everything behind the
 * console is role-gated, so the signed-out page only explains the platform
 * and invites the visitor to sign in.
 */
export function Landing({ onSignIn }: LandingProps) {
  const { t } = useTranslation();
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(1.5rem, 5vw, 4rem)",
        textAlign: "center",
        gap: "2rem",
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.55rem" }}>
          <span
            aria-hidden="true"
            style={{
              width: "10px",
              height: "10px",
              backgroundColor: "var(--live)",
              borderRadius: "1px",
              transform: "rotate(45deg)",
              boxShadow: "0 0 14px var(--live)",
              alignSelf: "center",
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              fontSize: "clamp(28px, 6vw, 44px)",
              color: "#FFFFFF",
              letterSpacing: "0.06em",
              textShadow: "0 2px 12px rgba(0,0,0,0.8)",
            }}
          >
            NCR<span style={{ color: "var(--live)" }}>·</span>72
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--mono)",
            fontSize: "clamp(11px, 2.4vw, 13px)",
            color: "rgba(255, 255, 255, 0.65)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {t("landing.tagline")}
        </p>
      </div>

      {/* Value line */}
      <p
        style={{
          margin: 0,
          maxWidth: "640px",
          fontFamily: "var(--mono)",
          fontSize: "clamp(12px, 2.6vw, 14px)",
          lineHeight: 1.75,
          color: "rgba(255, 255, 255, 0.78)",
        }}
      >
        {t("landing.valueLine")}
        <strong style={{ color: "#fff" }}>{t("landing.signInStrong")}</strong>
      </p>

      {/* Sign-in CTA */}
      <button
        type="button"
        onClick={onSignIn}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.9rem 2.2rem",
          background: "rgba(56, 189, 248, 0.85)",
          border: "none",
          borderRadius: "9999px",
          color: "#04121e",
          fontFamily: "var(--mono)",
          fontSize: "14px",
          fontWeight: 700,
          letterSpacing: "0.05em",
          cursor: "pointer",
          boxShadow: "0 10px 36px rgba(56, 189, 248, 0.35)",
          transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 14px 44px rgba(56, 189, 248, 0.5)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 10px 36px rgba(56, 189, 248, 0.35)";
        }}
      >
        <ShieldCheck size={17} />
        <span>{t("landing.signInCta")}</span>
        <ArrowRight size={16} />
      </button>

      {/* What each role gets — informative cards, NOT live content */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
          gap: "1rem",
          width: "min(880px, 100%)",
          marginTop: "0.5rem",
        }}
      >
        {/* Citizen card */}
        <div
          className="liquid-glass"
          style={{
            textAlign: "left",
            padding: "1.4rem 1.5rem",
            borderRadius: "16px",
            background: "rgba(12, 16, 26, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "34px",
                height: "34px",
                borderRadius: "9px",
                background: "rgba(255, 255, 255, 0.1)",
              }}
            >
              <Users size={17} style={{ color: "var(--live)" }} />
            </span>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: "14px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#fff",
              }}
            >
              {t("landing.citizenTitle")}
            </h3>
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0.55rem",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              lineHeight: 1.6,
              color: "rgba(255, 255, 255, 0.72)",
            }}
          >
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <HeartPulse size={13} style={{ color: "var(--live)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.citizenPoint1")}</span>
            </li>
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <HeartPulse size={13} style={{ color: "var(--live)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.citizenPoint2")}</span>
            </li>
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <BarChart3 size={13} style={{ color: "var(--live)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.citizenPoint3")}</span>
            </li>
          </ul>
        </div>

        {/* Authority card */}
        <div
          className="liquid-glass"
          style={{
            textAlign: "left",
            padding: "1.4rem 1.5rem",
            borderRadius: "16px",
            background: "rgba(12, 16, 26, 0.7)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "34px",
                height: "34px",
                borderRadius: "9px",
                background: "rgba(56, 189, 248, 0.12)",
              }}
            >
              <Building2 size={17} style={{ color: "var(--cyan)" }} />
            </span>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: "14px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#fff",
              }}
            >
              {t("landing.authorityTitle")}
            </h3>
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0.55rem",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              lineHeight: 1.6,
              color: "rgba(255, 255, 255, 0.72)",
            }}
          >
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <BarChart3 size={13} style={{ color: "var(--cyan)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.authorityPoint1")}</span>
            </li>
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <BarChart3 size={13} style={{ color: "var(--cyan)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.authorityPoint2")}</span>
            </li>
            <li style={{ display: "flex", gap: "0.5rem" }}>
              <Building2 size={13} style={{ color: "var(--cyan)", flexShrink: 0, marginTop: 3 }} />
              <span>{t("landing.authorityPoint3")}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Footer note */}
      <p
        style={{
          margin: 0,
          fontFamily: "var(--mono)",
          fontSize: "10.5px",
          color: "rgba(255, 255, 255, 0.42)",
          letterSpacing: "0.08em",
        }}
      >
        {t("landing.footerNote")}
      </p>
    </main>
  );
}
