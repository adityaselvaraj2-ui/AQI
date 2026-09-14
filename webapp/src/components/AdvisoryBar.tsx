import { useEffect, useMemo, useState } from "react";
import { Megaphone, ShieldCheck, Send, Loader2, Trash2, Info, AlertTriangle, Siren } from "lucide-react";
import { getAuthToken, type AuthUser } from "@/lib/auth";

interface Advisory {
  id: string;
  author_name: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  areas: string[];
  created_at: number;
}

interface AdvisoryBarProps {
  user: AuthUser | null;
  onAuthRequired: () => void;
}

const SEVERITY_META: Record<
  Advisory["severity"],
  { color: string; label: string; icon: typeof Info }
> = {
  critical: { color: "#ef4444", label: "Critical", icon: Siren },
  warning: { color: "#f97316", label: "Warning", icon: AlertTriangle },
  info: { color: "#38bdf8", label: "Info", icon: Info },
};

export function AdvisoryBar({ user, onAuthRequired }: AdvisoryBarProps) {
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<Advisory["severity"]>("info");
  const [areas, setAreas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthority = user?.role === "authority";

  const load = async () => {
    try {
      const res = await fetch("/api/v1/auth/advisories?limit=20");
      if (res.ok) {
        const data = await res.json();
        setAdvisories(data.advisories ?? []);
      }
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/advisories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken() ?? ""}`,
        },
        body: JSON.stringify({
          title,
          body,
          severity,
          areas: areas.split(",").map((a) => a.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? `HTTP ${res.status}`);
      }
      setTitle("");
      setBody("");
      setAreas("");
      setSeverity("info");
      setShowCompose(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  const retract = async (id: string) => {
    await fetch(`/api/v1/auth/advisories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` },
    });
    await load();
  };

  const latest = useMemo(() => advisories[0] ?? null, [advisories]);

  if (!loaded) return null;

  return (
    <section
      id="official-advisories"
      style={{
        margin: "0 auto 2.4rem",
        maxWidth: "1320px",
        padding: "0 clamp(1rem, 3vw, 2.5rem)",
      }}
    >
      <div
        style={{
          background: "rgba(12,16,26,0.8)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "14px",
          padding: "clamp(1rem, 2.5vw, 1.5rem)",
          backdropFilter: "blur(14px)",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.8rem", marginBottom: latest || isAuthority ? "1rem" : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <Megaphone size={16} style={{ color: "var(--cyan)" }} />
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--mono)",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#fff",
              }}
            >
              Official advisories
            </h2>
            <span style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: "rgba(255,255,255,0.5)" }}>
              {advisories.length === 0
                ? "none published"
                : `${advisories.length} active`}
            </span>
          </div>

          {isAuthority ? (
            <button
              type="button"
              onClick={() => setShowCompose((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.9rem",
                background: showCompose ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.14)",
                border: "1px solid rgba(56,189,248,0.5)",
                borderRadius: "8px",
                color: "#7dd3fc",
                fontFamily: "var(--mono)",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Send size={12} />
              {showCompose ? "Close composer" : "Publish advisory"}
            </button>
          ) : user ? (
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: "10.5px",
                color: "rgba(255,255,255,0.45)",
              }}
              title="Advisory publishing is restricted to authority accounts. Click your name chip (top right) to redeem an invite code."
            >
              Publishing is restricted to authority accounts
            </span>
          ) : (
            <button
              type="button"
              onClick={onAuthRequired}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.9rem",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "8px",
                color: "rgba(255,255,255,0.75)",
                fontFamily: "var(--mono)",
                fontSize: "11px",
                cursor: "pointer",
              }}
              title="Government officials sign in with an invite code to publish here"
            >
              <ShieldCheck size={12} style={{ color: "var(--cyan)" }} />
              Authority? Sign in to publish
            </button>
          )}
        </div>

        {/* Composer (authority only) */}
        {isAuthority && showCompose && (
          <form
            onSubmit={publish}
            style={{
              marginBottom: "1.1rem",
              padding: "1rem",
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(56,189,248,0.25)",
              borderRadius: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}
          >
            <input
              type="text"
              placeholder="Advisory title — e.g. GRAP Stage III invoked"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              style={{
                padding: "0.55rem 0.75rem",
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: "8px",
                color: "#fff",
                fontFamily: "var(--mono)",
                fontSize: "12.5px",
                outline: "none",
              }}
            />
            <textarea
              placeholder="What should the public do? e.g. construction dust suspended; N95 advised for outdoor workers…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={4000}
              rows={3}
              style={{
                padding: "0.55rem 0.75rem",
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: "8px",
                color: "#fff",
                fontFamily: "var(--mono)",
                fontSize: "12.5px",
                outline: "none",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
              {/* Severity picker */}
              <div style={{ display: "flex", gap: "0.25rem", padding: "3px", background: "rgba(0,0,0,0.4)", borderRadius: "9999px", border: "1px solid rgba(255,255,255,0.12)" }}>
                {(Object.keys(SEVERITY_META) as Advisory["severity"][]).map((s) => {
                  const meta = SEVERITY_META[s];
                  const active = severity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: "0.28rem 0.7rem",
                        borderRadius: "9999px",
                        background: active ? `${meta.color}33` : "transparent",
                        border: `1px solid ${active ? meta.color : "transparent"}`,
                        color: active ? meta.color : "rgba(255,255,255,0.55)",
                        fontFamily: "var(--mono)",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <meta.icon size={11} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder="Areas (comma-separated) — Delhi, Gurugram, Noida"
                value={areas}
                onChange={(e) => setAreas(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: "220px",
                  padding: "0.5rem 0.75rem",
                  background: "rgba(0,0,0,0.45)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  borderRadius: "8px",
                  color: "#fff",
                  fontFamily: "var(--mono)",
                  fontSize: "12px",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={busy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.5rem 1rem",
                  background: busy ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.85)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#04121e",
                  fontFamily: "var(--mono)",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                {busy ? <Loader2 size={13} /> : <Send size={13} />}
                Publish
              </button>
            </div>
            {error && (
              <div style={{ color: "#fca5a5", fontFamily: "var(--mono)", fontSize: "11.5px" }}>{error}</div>
            )}
          </form>
        )}

        {/* Advisory list */}
        {latest ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {advisories.slice(0, 5).map((a) => {
              const meta = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
              const Icon = meta.icon;
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.7rem",
                    padding: "0.75rem 0.9rem",
                    background: `${meta.color}0d`,
                    border: `1px solid ${meta.color}55`,
                    borderLeft: `3px solid ${meta.color}`,
                    borderRadius: "10px",
                  }}
                >
                  <Icon size={15} style={{ color: meta.color, marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: 3 }}>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "12.5px",
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        {a.title}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: "9px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          background: `${meta.color}22`,
                          color: meta.color,
                        }}
                      >
                        {meta.label}
                      </span>
                      {a.areas.length > 0 && (
                        <span style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>
                          {a.areas.join(" · ")}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: "12.5px", lineHeight: 1.5, color: "rgba(255,255,255,0.82)" }}>
                      {a.body}
                    </p>
                    <div style={{ marginTop: 4, fontFamily: "var(--mono)", fontSize: "10px", color: "rgba(255,255,255,0.45)" }}>
                      {a.author_name || "Official"} ·{" "}
                      {new Date(a.created_at * 1000).toLocaleString([], {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  {isAuthority && user && a.author_name === user.full_name && (
                    <button
                      type="button"
                      onClick={() => retract(a.id)}
                      aria-label="Retract advisory"
                      title="Retract"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.4)",
                        cursor: "pointer",
                        padding: "4px",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          isAuthority && (
            <div style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
              Nothing published yet — your advisories appear here for every visitor.
            </div>
          )
        )}
      </div>
    </section>
  );
}
