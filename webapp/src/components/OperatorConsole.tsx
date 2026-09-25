import { useEffect, useRef, useState } from "react";
import { X, KeyRound, Loader2, Check, AlertCircle, ShieldCheck, Sparkles, Trash2, Lock } from "lucide-react";

/**
 * Operator console — invite-code management behind the operator password.
 *
 * Flow: enter the operator password once → a 30-minute session token
 * (sessionStorage; dies with the tab) unlocks create / list / revoke. Code
 * format rules are taught inline; a debounced real-time duplicate check runs
 * against the live database while typing.
 */

const CODE_RE = /^NCR72-[A-Z0-9]{6,20}$/;
const SESSION_KEY = "ncr72.operator.token";

interface InviteCode {
  code: string;
  label: string;
  created_by: string;
  created_at?: string | number | null;
  used_by?: string | null;
  used_by_email?: string | null;
  used_at?: string | number | null;
}

interface OperatorConsoleProps {
  open: boolean;
  onClose: () => void;
  onOpenAuthorityLogin?: () => void;
}

type Phase = "locked" | "ready";

async function opFetch<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 204 */
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string"
        ? (body as { detail: string }).detail
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return body as T;
}

export function OperatorConsole({ open, onClose, onOpenAuthorityLogin }: OperatorConsoleProps) {
  const [phase, setPhase] = useState<Phase>("locked");
  const [token, setToken] = useState<string | null>(null);
  const [store, setStore] = useState<string>("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [dupe, setDupe] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const dupeTimer = useRef<number | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const [codes, setCodes] = useState<InviteCode[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      setToken(saved);
      setPhase("ready");
      void refresh(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = async (t: string | null) => {
    try {
      const data = await opFetch<{ store: string; codes: InviteCode[] }>("/api/v1/auth/operator/codes", {}, t ?? token);
      setStore(data.store);
      setCodes(data.codes);
    } catch (err) {
      if (err instanceof Error && /expired|session/i.test(err.message)) {
        sessionStorage.removeItem(SESSION_KEY);
        setToken(null);
        setPhase("locked");
      }
    }
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await opFetch<{ token: string; store: string }>("/api/v1/auth/operator/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      sessionStorage.setItem(SESSION_KEY, data.token);
      setToken(data.token);
      setStore(data.store);
      setPhase("ready");
      setPassword("");
      void refresh(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock.");
    } finally {
      setBusy(false);
    }
  };

  // Real-time duplicate check: debounced 450 ms, only when the format is valid.
  useEffect(() => {
    if (dupeTimer.current) window.clearTimeout(dupeTimer.current);
    const norm = code.trim().toUpperCase();
    if (!norm || !CODE_RE.test(norm) || phase !== "ready") {
      setDupe(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    dupeTimer.current = window.setTimeout(async () => {
      try {
        const data = await opFetch<{ exists: boolean; used: boolean; message: string }>(
          `/api/v1/auth/operator/codes/status?code=${encodeURIComponent(norm)}`,
          {},
          token,
        );
        setDupe({ ok: !data.exists, message: data.message });
      } catch {
        setDupe({ ok: false, message: "Could not reach the database to check." });
      } finally {
        setChecking(false);
      }
    }, 450);
    return () => {
      if (dupeTimer.current) window.clearTimeout(dupeTimer.current);
    };
  }, [code, phase, token]);

  const formatChecks = (() => {
    const norm = code.trim().toUpperCase();
    return {
      prefix: norm.startsWith("NCR72-"),
      charset: /^NCR72-[A-Z0-9]*$/.test(norm),
      length: /^NCR72-/.test(norm) && norm.length >= 12 && norm.length <= 26,
    };
  })();

  const createCode = async () => {
    setError(null);
    const norm = code.trim().toUpperCase();
    if (!CODE_RE.test(norm)) {
      setError("Fix the format first — NCR72- followed by 6–20 uppercase letters/digits.");
      return;
    }
    if (dupe && !dupe.ok) {
      setError(dupe.message);
      return;
    }
    setBusy(true);
    try {
      await opFetch(
        "/api/v1/auth/operator/codes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: norm, label }),
        },
        token,
      );
      setCreated(norm);
      setCode("");
      setLabel("");
      setDupe(null);
      void refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the code.");
    } finally {
      setBusy(false);
    }
  };

  const generateRandom = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await opFetch<InviteCode>(
        `/api/v1/auth/operator/codes/generate?label=${encodeURIComponent(label.trim())}`,
        { method: "POST" },
        token,
      );
      setCreated(data.code);
      setCode("");
      setLabel("");
      void refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a code.");
    } finally {
      setBusy(false);
    }
  };

  const revokeCode = async (target: string) => {
    setError(null);
    setBusy(true);
    try {
      await opFetch(`/api/v1/auth/operator/codes/${encodeURIComponent(target)}`, { method: "DELETE" }, token);
      void refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.6rem 0.75rem",
    background: "rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "8px",
    color: "#fff",
    fontFamily: "var(--mono)",
    fontSize: "13px",
    outline: "none",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        className="liquid-glass auth-ring"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 4rem)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(10,14,24,0.96)",
          border: "1px solid rgba(255,255,255,0.22)",
          borderRadius: "16px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ overflowY: "auto", width: "100%", padding: "1.6rem" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontFamily: "var(--mono)",
                fontSize: "16px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#fff",
              }}
            >
              <KeyRound size={15} style={{ color: "var(--cyan)" }} />
              Operator console
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.6)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
              }}
            >
              <X size={18} />
            </button>
          </div>

          {phase === "locked" && (
            <form onSubmit={unlock}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.7rem 0.85rem",
                  background: "rgba(56,189,248,0.07)",
                  border: "1px solid rgba(56,189,248,0.3)",
                  borderRadius: "10px",
                  marginBottom: "1rem",
                }}
              >
                <Lock size={13} style={{ color: "var(--cyan)", flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "#7dd3fc", lineHeight: 1.5 }}>
                  Restricted area. Enter the operator password to manage authority invite codes. Sessions expire after 30 minutes.
                </span>
              </div>
              <input
                type="password"
                placeholder="Operator password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="off"
                style={{ ...inputStyle, marginBottom: "0.8rem" }}
              />
              {error && (
                <div role="alert" style={{ marginBottom: "0.8rem", padding: "0.55rem 0.75rem", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "8px", color: "#fca5a5", fontSize: "12px", fontFamily: "var(--mono)" }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !password}
                style={{
                  width: "100%",
                  padding: "0.65rem 0",
                  background: busy || !password ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.85)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#04121e",
                  fontFamily: "var(--mono)",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: busy ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.45rem",
                }}
              >
                {busy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                Unlock console
              </button>

              {password.trim().toUpperCase().startsWith("NCR72-") && (
                <div
                  style={{
                    marginTop: "0.8rem",
                    padding: "0.6rem 0.75rem",
                    background: "rgba(56,189,248,0.1)",
                    border: "1px solid rgba(56,189,248,0.35)",
                    borderRadius: "8px",
                    fontFamily: "var(--mono)",
                    fontSize: "11px",
                    color: "#7dd3fc",
                    textAlign: "center",
                  }}
                >
                  It looks like you entered an Authority Console Code!
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthorityLogin?.();
                    }}
                    style={{
                      display: "block",
                      margin: "0.4rem auto 0",
                      background: "rgba(56,189,248,0.25)",
                      border: "1px solid rgba(56,189,248,0.5)",
                      borderRadius: "6px",
                      padding: "0.3rem 0.6rem",
                      color: "#fff",
                      fontFamily: "var(--mono)",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Log in with Authority Code &rarr;
                  </button>
                </div>
              )}

              {onOpenAuthorityLogin && (
                <div style={{ marginTop: "1rem", textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "0.8rem" }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "rgba(255,255,255,0.5)", marginBottom: "0.4rem" }}>
                    Are you an authority officer with a console code?
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthorityLogin();
                    }}
                    style={{
                      background: "rgba(56,189,248,0.1)",
                      border: "1px solid rgba(56,189,248,0.3)",
                      borderRadius: "6px",
                      padding: "0.35rem 0.75rem",
                      color: "var(--cyan)",
                      fontFamily: "var(--mono)",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    <ShieldCheck size={13} />
                    Log in with Authority Code
                  </button>
                </div>
              )}
            </form>
          )}

          {phase === "ready" && (
            <>
              {store && (
                <div style={{ fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: "0.9rem" }}>
                  Store: {store === "supabase" ? "Supabase (live database)" : "Local SQLite (run supabase/invite_codes.sql to go live)"}
                </div>
              )}

              {created && (
                <div style={{ marginBottom: "0.9rem", padding: "0.65rem 0.8rem", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: "8px", color: "#86efac", fontSize: "12px", fontFamily: "var(--mono)", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                  <Check size={13} /> Created <strong style={{ letterSpacing: "0.05em" }}>{created}</strong> — share it with one authority only.
                </div>
              )}

              {/* Create */}
              <div style={{ padding: "0.9rem", background: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", marginBottom: "1rem" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7dd3fc", marginBottom: "0.6rem" }}>
                  Create an invite code
                </div>

                {/* Format teacher */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.9rem", marginBottom: "0.6rem" }}>
                  {(
                    [
                      ["prefix", "Starts with NCR72-"],
                      ["charset", "Uppercase A–Z and 0–9 after the dash"],
                      ["length", "6–20 characters long"],
                    ] as const
                  ).map(([key, text]) => {
                    const ok = formatChecks[key];
                    return (
                      <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontFamily: "var(--mono)", fontSize: "10.5px", color: ok ? "#4ade80" : "rgba(255,255,255,0.5)" }}>
                        {ok ? <Check size={11} style={{ color: "#4ade80" }} /> : <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.3)", display: "inline-block" }} />}
                        {text}
                      </span>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="NCR72-YOURCODE1"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ ...inputStyle, flex: 1, borderColor: dupe && !dupe.ok ? "rgba(239,68,68,0.65)" : undefined }}
                  />
                  <button
                    type="button"
                    onClick={generateRandom}
                    disabled={busy}
                    title="Generate a cryptographically random code instead (recommended)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0 0.85rem",
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "8px",
                      color: "#fff",
                      fontFamily: "var(--mono)",
                      fontSize: "12px",
                      cursor: busy ? "wait" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Sparkles size={13} style={{ color: "var(--cyan)" }} />
                    Random
                  </button>
                </div>

                {/* Real-time duplicate status */}
                <div style={{ minHeight: "18px", marginBottom: "0.45rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  {checking && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontFamily: "var(--mono)", fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
                      <Loader2 size={11} className="spin" /> Checking the database…
                    </span>
                  )}
                  {!checking && dupe && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontFamily: "var(--mono)", fontSize: "11px", color: dupe.ok ? "#4ade80" : "#fca5a5" }}>
                      {dupe.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                      {dupe.message}
                    </span>
                  )}
                  {!checking && !dupe && code.trim() === "" && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                      Duplicates are rejected in real time as you type.
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Label (optional) — e.g. CPCB regional office"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                  style={{ ...inputStyle, marginBottom: "0.6rem" }}
                />

                {error && (
                  <div role="alert" style={{ marginBottom: "0.6rem", padding: "0.5rem 0.7rem", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "8px", color: "#fca5a5", fontSize: "11.5px", fontFamily: "var(--mono)" }}>
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={createCode}
                  disabled={busy || !CODE_RE.test(code.trim().toUpperCase()) || (!!dupe && !dupe.ok)}
                  title={
                    !CODE_RE.test(code.trim().toUpperCase())
                      ? "Complete the format first"
                      : dupe && !dupe.ok
                      ? "This code already exists"
                      : "Create the code"
                  }
                  style={{
                    width: "100%",
                    padding: "0.55rem 0",
                    background: busy || !CODE_RE.test(code.trim().toUpperCase()) || (!!dupe && !dupe.ok) ? "rgba(56,189,248,0.3)" : "rgba(56,189,248,0.85)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#04121e",
                    fontFamily: "var(--mono)",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: busy ? "wait" : "pointer",
                  }}
                >
                  {busy ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />}
                  Create code
                </button>
              </div>

              {/* Code list */}
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: "0.5rem" }}>
                  All codes ({codes.length})
                </div>
                {codes.length === 0 ? (
                  <div style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
                    No codes yet — create the first one above.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {codes.map((c) => {
                      const used = !!c.used_by;
                      return (
                        <div
                          key={c.code}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.6rem",
                            padding: "0.55rem 0.75rem",
                            background: used ? "rgba(255,255,255,0.04)" : "rgba(56,189,248,0.06)",
                            border: `1px solid ${used ? "rgba(255,255,255,0.12)" : "rgba(56,189,248,0.3)"}`,
                            borderRadius: "8px",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--mono)", fontSize: "12.5px", fontWeight: 700, color: used ? "rgba(255,255,255,0.55)" : "#fff", letterSpacing: "0.04em" }}>
                              {c.code}
                            </div>
                            <div style={{ fontFamily: "var(--mono)", fontSize: "10px", color: used ? "#fda4af" : "#4ade80", marginTop: 1 }}>
                              {used
                                ? `USED${c.used_by_email ? ` by ${c.used_by_email}` : ""}`
                                : "UNUSED"}
                              {c.label ? ` · ${c.label}` : ""}
                            </div>
                          </div>
                          {!used && (
                            <button
                              type="button"
                              onClick={() => revokeCode(c.code)}
                              aria-label={`Revoke ${c.code}`}
                              title="Delete this unused code"
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "rgba(255,255,255,0.4)",
                                cursor: "pointer",
                                padding: "4px",
                                display: "flex",
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
