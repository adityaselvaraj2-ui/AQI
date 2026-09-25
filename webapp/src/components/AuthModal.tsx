import { useEffect, useMemo, useState } from "react";
import { X, Building2, Users, ShieldCheck, Loader2, Check, AlertCircle } from "lucide-react";
import {
  login,
  register,
  signInWithGoogle,
  setPendingAuthorityCode,
  validateInviteCode,
  getAuthState,
  type AuthUser,
  type Role,
} from "@/lib/auth";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthed: (user: AuthUser) => void;
}

type Mode = "signin" | "signup";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const NAME_RE = /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'-]{0,119}$/;
const INVITE_RE = /^NCR72-[A-Z0-9]{6,20}$/;

/** Client mirror of the backend password policy — powers the live checklist. */
function passwordChecks(pw: string) {
  return {
    length: pw.length >= 12,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    noSpaces: pw.length > 0 && !/\s/.test(pw) && ![...pw].some((c) => c.charCodeAt(0) < 32),
  };
}

function emailProblem(email: string): string | null {
  if (!email.trim()) return "Email is required.";
  if (!EMAIL_RE.test(email.trim()))
    return "That doesn't look like a valid email — use the form name@example.com.";
  return null;
}

function nameProblem(name: string): string | null {
  if (!name.trim()) return "Full name is required.";
  if (!NAME_RE.test(name.trim()))
    return "Name may use letters, spaces, dots, apostrophes and hyphens only.";
  return null;
}

export function AuthModal({ open, onClose, onAuthed }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<Role>("citizen");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [inviteValidating, setInviteValidating] = useState(false);
  const [inviteValid, setInviteValid] = useState<"unknown" | "valid" | "invalid">("unknown");
  const [inviteStatusMsg, setInviteStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setError(null);
      setNotice(null);
      setBusy(false);
      setGoogleBusy(false);
      setTouched({});
    }
  }, [open]);

  const pwChecks = useMemo(() => passwordChecks(password), [password]);
  const pwValid = Object.values(pwChecks).every(Boolean);

  // Server-side pre-flight of the authority invite code (debounced): the
  // Google button stays LOCKED until the backend confirms the code exists
  // and is unused. Format-only checks let a well-formed typo sail through a
  // whole OAuth redirect just to die on return — this stops it up front.
  useEffect(() => {
    if (mode !== "signup" || role !== "authority") {
      setInviteValid("unknown");
      setInviteStatusMsg(null);
      return;
    }
    const code = inviteCode.trim().toUpperCase();
    if (!INVITE_RE.test(code)) {
      setInviteValid("unknown");
      setInviteStatusMsg(null);
      return;
    }
    setInviteValidating(true);
    const t = setTimeout(async () => {
      try {
        const res = await validateInviteCode(code);
        if (res.format_ok && res.exists && !res.used) {
          setInviteValid("valid");
          setInviteStatusMsg(res.message);
        } else {
          setInviteValid("invalid");
          setInviteStatusMsg(res.message);
        }
      } catch {
        setInviteValid("unknown");
        setInviteStatusMsg("Could not reach the server to verify the code — Google sign-in stays locked until it can.");
      } finally {
        setInviteValidating(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [inviteCode, mode, role]);

  const emailErr = touched.email ? emailProblem(email) : null;
  const nameErr = touched.fullName && mode === "signup" ? nameProblem(fullName) : null;
  const inviteErr =
    touched.inviteCode && mode === "signup" && role === "authority"
      ? !inviteCode.trim()
        ? "An invite code is required for an authority account."
        : !INVITE_RE.test(inviteCode.trim().toUpperCase())
        ? "Codes look like NCR72-XXXXXXXX — check for typos."
        : null
      : null;

  // Signup can only be submitted when every client-side rule passes; the
  // server re-validates everything anyway (never trust the client).
  const signupBlocked =
    mode === "signup" &&
    (!!emailProblem(email) || !pwValid || !!nameProblem(fullName) || (role === "authority" && !INVITE_RE.test(inviteCode.trim().toUpperCase())));

  const finish = (user: AuthUser) => {
    onAuthed(user);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTouched({ email: true, fullName: true, inviteCode: true });

    if (mode === "signin") {
      const p = emailProblem(email);
      if (p) return setError(p);
      setBusy(true);
      try {
        const user = await login(email.trim().toLowerCase(), password);
        finish(user);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // mode === "signup"
    const p = emailProblem(email);
    if (p) return setError(p);
    if (!pwValid)
      return setError("Password doesn't meet the requirements below yet.");
    const np = nameProblem(fullName);
    if (np) return setError(np);
    if (role === "authority") {
      const code = inviteCode.trim().toUpperCase();
      if (!INVITE_RE.test(code))
        return setError("Enter the official invite code issued to your organisation.");
    }

    setBusy(true);
    try {
      const user = await register({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim(),
        role,
        invite_code: role === "authority" ? inviteCode.trim().toUpperCase() : undefined,
      });
      finish(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const signedInUser = getAuthState().user;

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

  const errStyle = (hasErr: boolean): React.CSSProperties =>
    hasErr ? { ...inputStyle, borderColor: "rgba(239,68,68,0.65)" } : inputStyle;

  const fieldError = (msg: string | null) =>
    msg ? (
      <div style={{ display: "flex", gap: "0.3rem", alignItems: "flex-start", marginTop: "0.3rem" }}>
        <AlertCircle size={12} style={{ color: "#fca5a5", flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: "11px", color: "#fca5a5", fontFamily: "var(--mono)" }}>{msg}</span>
      </div>
    ) : null;

  // Without this guard the modal renders permanently — open on every page
  // load and immune to the X / backdrop (the "asks authority on entry" bug).
  if (!open) return null;

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
      {/*
        Outer card owns the animated .auth-ring border; the inner div scrolls.
        If the ring lived on the scrolling element, its absolute-positioned
        pseudo-elements would scroll with the content and paint over fields
        (the "overlayed borders" bug).
      */}
      <div
        className="liquid-glass auth-ring"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, calc(100vw - 2rem))",
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#fff",
            }}
          >
            {signedInUser
              ? signedInUser.role === "citizen"
                ? "Authority access"
                : "Account"
              : mode === "signin"
              ? "Sign in"
              : "Create account"}
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

        {!signedInUser && (<>
        {/* Mode switch */}
        <div style={{ display: "flex", gap: "0.3rem", padding: "3px", background: "rgba(0,0,0,0.4)", borderRadius: "9999px", marginBottom: "1.1rem", border: "1px solid rgba(255,255,255,0.12)" }}>
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "0.4rem 0",
                borderRadius: "9999px",
                background: mode === m ? "rgba(255,255,255,0.18)" : "transparent",
                border: "none",
                color: mode === m ? "#fff" : "rgba(255,255,255,0.6)",
                fontFamily: "var(--mono)",
                fontSize: "12px",
                fontWeight: mode === m ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {m === "signin" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate>
            <>
              {mode === "signup" && (
                <>
                  {/* Role picker */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
                    {(
                      [
                        { id: "citizen" as Role, icon: Users, label: "Citizen", desc: "Personal air-quality tools", color: "var(--live)" },
                        { id: "authority" as Role, icon: Building2, label: "Authority", desc: "Official account (invite)", color: "var(--cyan)" },
                      ]
                    ).map((r) => {
                      const Icon = r.icon;
                      const active = role === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setRole(r.id)}
                          style={{
                            position: "relative",
                            zIndex: active ? 2 : 1,
                            textAlign: "left",
                            padding: "0.7rem 0.8rem",
                            background: active ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.3)",
                            border: `1px solid ${active ? r.color : "rgba(255,255,255,0.12)"}`,
                            borderRadius: "10px",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Icon size={16} style={{ color: active ? r.color : "rgba(255,255,255,0.5)", marginBottom: 4 }} />
                          <div style={{ fontFamily: "var(--mono)", fontSize: "12.5px", fontWeight: 600, color: "#fff" }}>{r.label}</div>
                          <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.55)", fontFamily: "var(--mono)", marginTop: 2 }}>{r.desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    placeholder="Full name (e.g. Aditya Sharma)"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
                    maxLength={120}
                    autoComplete="name"
                    style={{ ...errStyle(!!nameErr), marginBottom: nameErr ? "0.2rem" : "0.7rem" }}
                  />
                  {fieldError(nameErr)}
                </>
              )}

              <input
                type="email"
                placeholder="Email (name@example.com)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                maxLength={254}
                autoComplete="email"
                style={{ ...errStyle(!!emailErr), marginBottom: emailErr ? "0.2rem" : "0.7rem" }}
              />
              {fieldError(emailErr)}

              <input
                type="password"
                placeholder={mode === "signup" ? "Create a password" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                style={{ ...inputStyle, marginBottom: mode === "signup" ? "0.5rem" : "0.9rem" }}
              />

              {/* Live password checklist (registration only) */}
              {mode === "signup" && (
                <div
                  style={{
                    marginBottom: "0.9rem",
                    padding: "0.6rem 0.75rem",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: "0.4rem" }}>
                    Password must have
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.25rem 0.6rem" }}>
                    {(
                      [
                        ["length", "12+ characters"],
                        ["upper", "An uppercase letter"],
                        ["lower", "A lowercase letter"],
                        ["digit", "A digit"],
                        ["noSpaces", "No spaces/symbols like space or tab"],
                      ] as const
                    ).map(([key, label]) => {
                      const ok = pwChecks[key];
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          {ok ? (
                            <Check size={11} style={{ color: "#4ade80", flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 11, height: 11, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.3)", flexShrink: 0, display: "inline-block" }} />
                          )}
                          <span style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: ok ? "#4ade80" : "rgba(255,255,255,0.55)" }}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {mode === "signup" && role === "authority" && (
                <div
                  style={{
                    marginBottom: "0.7rem",
                    padding: "0.75rem 0.85rem",
                    background: "rgba(56,189,248,0.07)",
                    border: "1px solid rgba(56,189,248,0.3)",
                    borderRadius: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.45rem" }}>
                    <ShieldCheck size={13} style={{ color: "var(--cyan)" }} />
                    <span style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "#7dd3fc", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600 }}>
                      Official invite code required
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="NCR72-XXXXXXXX"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    onBlur={() => setTouched((t) => ({ ...t, inviteCode: true }))}
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ ...errStyle(!!inviteErr), textTransform: "uppercase" }}
                  />
                  {fieldError(inviteErr) ?? (
                    <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.5)", fontFamily: "var(--mono)", marginTop: "0.4rem" }}>
                      Issued by the NCR·72 operator to verified government accounts. Every code is single-use.
                    </div>
                  )}
                  {inviteCode.trim() !== "" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.45rem" }}>
                      {inviteValidating ? (
                        <>
                          <Loader2 size={11} className="spin" style={{ color: "#7dd3fc", flexShrink: 0 }} />
                          <span style={{ fontSize: "10.5px", color: "#7dd3fc", fontFamily: "var(--mono)" }}>Verifying code…</span>
                        </>
                      ) : inviteValid === "valid" ? (
                        <>
                          <Check size={11} style={{ color: "#4ade80", flexShrink: 0 }} />
                          <span style={{ fontSize: "10.5px", color: "#4ade80", fontFamily: "var(--mono)" }}>Verified — Google sign-in unlocked.</span>
                        </>
                      ) : inviteValid === "invalid" ? (
                        <>
                          <AlertCircle size={11} style={{ color: "#fca5a5", flexShrink: 0 }} />
                          <span style={{ fontSize: "10.5px", color: "#fca5a5", fontFamily: "var(--mono)" }}>{inviteStatusMsg}</span>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </>

          {error && (
            <div
              role="alert"
              style={{
                marginBottom: "0.8rem",
                padding: "0.6rem 0.8rem",
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: "8px",
                color: "#fca5a5",
                fontSize: "12px",
                fontFamily: "var(--mono)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || googleBusy || signupBlocked}
            title={signupBlocked ? "Complete the highlighted fields to continue" : undefined}
            style={{
              width: "100%",
              padding: "0.7rem 0",
              background:
                busy || signupBlocked
                  ? "rgba(56,189,248,0.3)"
                  : "rgba(56,189,248,0.85)",
              border: "none",
              borderRadius: "8px",
              color: "#04121e",
              fontFamily: "var(--mono)",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: busy ? "wait" : signupBlocked ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.45rem",
              transition: "background 0.2s ease",
            }}
          >
            {busy && <Loader2 size={14} className="spin" />}
            {mode === "signin"
              ? "Sign in"
              : role === "authority"
              ? "Register as Authority"
              : "Register as Citizen"}
          </button>
        </form>

        {/* Divider + Google (Supabase OAuth) */}
        <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", margin: "1rem 0 0.8rem" }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.14)" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                or
              </span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.14)" }} />
            </div>

            <button
              type="button"
              className="auth-google"
              disabled={busy || googleBusy || (mode === "signup" && role === "authority" && inviteValid !== "valid")}
              title={mode === "signup" && role === "authority" && inviteValid !== "valid" ? "Enter a valid, unused invite code to unlock Google sign-in" : undefined}
              onClick={async () => {
                setError(null);
                if (mode === "signup" && role === "authority") {
                  const code = inviteCode.trim().toUpperCase();
                  if (!INVITE_RE.test(code)) {
                    setError("Enter your official invite code first, then continue with Google.");
                    return;
                  }
                  if (inviteValid !== "valid") {
                    setError(
                      inviteStatusMsg ??
                        "The server must verify this code before Google sign-in unlocks — check the code and try again.",
                    );
                    return;
                  }
                  setPendingAuthorityCode(code);
                }
                setGoogleBusy(true);
                try {
                  await signInWithGoogle();
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Google sign-in is unavailable right now."
                  );
                  setGoogleBusy(false);
                }
              }}
              style={{
                width: "100%",
                padding: "0.65rem 0",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "8px",
                color: "#fff",
                fontFamily: "var(--mono)",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: googleBusy ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.55rem",
                transition: "background 0.2s ease, border-color 0.2s ease",
              }}
            >
              {googleBusy ? <Loader2 size={14} className="spin" /> : <GoogleIcon />}
              <span>Continue with Google</span>
            </button>
            <div
              style={{
                marginTop: "0.55rem",
                textAlign: "center",
                fontFamily: "var(--mono)",
                fontSize: "10px",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              Google continues only after your invite code verifies with the server. The verified code is applied automatically once Google confirms your account — one flow, no second step.
            </div>
        </>
        </>)}

        {/* Authority members see their status */}
        {signedInUser?.role === "authority" && (
          <div
            style={{
              marginTop: "0.8rem",
              padding: "0.6rem 0.8rem",
              background: "rgba(74,222,128,0.1)",
              border: "1px solid rgba(74,222,128,0.4)",
              borderRadius: "8px",
              color: "#86efac",
              fontSize: "12px",
              fontFamily: "var(--mono)",
            }}
          >
            You have authority access, {signedInUser.full_name}.
          </div>
        )}

        {notice && (
          <div
            style={{
              marginTop: "0.8rem",
              padding: "0.6rem 0.8rem",
              background: "rgba(74,222,128,0.1)",
              border: "1px solid rgba(74,222,128,0.4)",
              borderRadius: "8px",
              color: "#86efac",
              fontSize: "12px",
              fontFamily: "var(--mono)",
            }}
          >
            {notice}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
