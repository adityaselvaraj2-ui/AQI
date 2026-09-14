import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck, Users } from "lucide-react";

import type { AuthUser } from "@/lib/auth";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface UserMenuProps {
  user: AuthUser;
}

/**
 * Signed-in identity control for the header rail. A compact avatar chip that
 * opens a dropdown with the full identity (name, email, role badge) and the
 * sign-out action. Closes on outside click and Escape; aria-wired for
 * keyboard use.
 */
export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAuthority = user.role === "authority";
  const accent = isAuthority ? "var(--cyan)" : "var(--live)";

  const handleSignOut = () => {
    setOpen(false);
    // Full reload so every page forgets cached authority-only data.
    window.location.reload();
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.45rem",
          padding: "0.22rem 0.5rem 0.22rem 0.28rem",
          background: open ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)",
          border: `1px solid ${isAuthority ? "rgba(56,189,248,0.45)" : "rgba(255,255,255,0.2)"}`,
          borderRadius: "9999px",
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
        title="Account"
      >
        <span
          aria-hidden="true"
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "9999px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: isAuthority
              ? "linear-gradient(135deg, rgba(56,189,248,0.85), rgba(99,102,241,0.85))"
              : "linear-gradient(135deg, rgba(255,90,90,0.85), rgba(255,160,80,0.85))",
            color: "#0b1220",
            fontFamily: "var(--mono)",
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          {initialsOf(user.full_name)}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "11px",
            color: "#fff",
            maxWidth: "110px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {user.full_name}
        </span>
        <ChevronDown
          size={12}
          style={{
            color: "rgba(255,255,255,0.55)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="liquid-glass"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: "250px",
            padding: "0.9rem 0.9rem 0.75rem",
            borderRadius: "14px",
            background: "rgba(10,14,24,0.95)",
            backdropFilter: "blur(28px) saturate(190%)",
            WebkitBackdropFilter: "blur(28px) saturate(190%)",
            border: "1px solid rgba(255,255,255,0.2)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.65), inset 0 1px 1.5px rgba(255,255,255,0.25)",
            zIndex: 60,
          }}
        >
          {/* Identity */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.7rem" }}>
            <span
              aria-hidden="true"
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "9999px",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: isAuthority
                  ? "linear-gradient(135deg, rgba(56,189,248,0.85), rgba(99,102,241,0.85))"
                  : "linear-gradient(135deg, rgba(255,90,90,0.85), rgba(255,160,80,0.85))",
                color: "#0b1220",
                fontFamily: "var(--mono)",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              {initialsOf(user.full_name)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.full_name}
              </div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "10.5px",
                  color: "rgba(255,255,255,0.55)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={user.email}
              >
                {user.email}
              </div>
            </div>
          </div>

          {/* Role badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.5rem 0.6rem",
              borderRadius: "9px",
              background: isAuthority ? "rgba(56,189,248,0.09)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isAuthority ? "rgba(56,189,248,0.3)" : "rgba(255,255,255,0.12)"}`,
              marginBottom: "0.75rem",
            }}
          >
            {isAuthority ? (
              <ShieldCheck size={14} style={{ color: "var(--cyan)" }} />
            ) : (
              <Users size={14} style={{ color: "var(--live)" }} />
            )}
            <div>
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: isAuthority ? "#7dd3fc" : "#ffb4a2",
                }}
              >
                {isAuthority ? "Official authority" : "Citizen account"}
              </div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", fontFamily: "var(--mono)" }}>
                {isAuthority ? "Can publish public advisories" : "Personal exposure tools unlocked"}
              </div>
            </div>
          </div>

          {/* Sign out */}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            style={{
              width: "100%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.45rem",
              padding: "0.55rem 0",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: "8px",
              color: "rgba(255,255,255,0.85)",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239,68,68,0.14)";
              e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            }}
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      )}
      {/* accent keeps the role color referenced so palette stays coherent */}
      <span style={{ display: "none" }}>{accent}</span>
    </div>
  );
}
