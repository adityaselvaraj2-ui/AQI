/**
 * Auth client for the console.
 *
 * The JWT is kept in localStorage under a single key. That is the honest
 * trade-off for a same-origin demo deployment: httpOnly cookies would need a
 * cookie-session backend, and the API is already Bearer-based. XSS is the
 * residual risk and the console's CSP (script-src 'self', no inline scripts)
 * is the mitigation.
 */

const TOKEN_KEY = "ncr72.auth.token";
const USER_KEY = "ncr72.auth.user";

export type Role = "citizen" | "authority";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** Populated when a sign-in attempt (e.g. the Google OAuth return) failed. */
  authError?: string | null;
}

type Listener = (state: AuthState) => void;

function readState(): AuthState {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (!token || !raw) return { user: null, token: null };
    const user = JSON.parse(raw) as AuthUser;
    if (!user || (user.role !== "citizen" && user.role !== "authority")) {
      return { user: null, token: null };
    }
    return { user, token };
  } catch {
    return { user: null, token: null };
  }
}

let cachedState: AuthState = readState();
const listeners = new Set<Listener>();

function commit(next: AuthState) {
  cachedState = next;
  listeners.forEach((fn) => fn(next));
}

export function getAuthState(): AuthState {
  return cachedState;
}

export function subscribeAuth(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuthToken(): string | null {
  return cachedState.token;
}

function persist(user: AuthUser, token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  commit({ user, token });
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  commit({ user: null, token: null });
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  // Read the body exactly once — a second res.json() throws
  // "body stream already read" and breaks every successful call.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
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

interface TokenPayload {
  access_token: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await authFetch<TokenPayload>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  persist(data.user, data.access_token);
  return data.user;
}

export async function register(input: {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  invite_code?: string;
}): Promise<AuthUser> {
  const data = await authFetch<TokenPayload>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  persist(data.user, data.access_token);
  return data.user;
}

/** Re-validate the stored token against the server; clears it if rejected. */
export async function refreshMe(): Promise<AuthUser | null> {
  const { token } = cachedState;
  if (!token) return null;
  try {
    const data = await authFetch<{ user: AuthUser }>("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    commit({ user: data.user, token });
    return data.user;
  } catch (err) {
    // If the backend is unreachable (network error, not running) keep the
    // existing session alive rather than silently logging the user out.
    // Only clear the session on a definitive 401/403 from the server.
    const msg = err instanceof Error ? err.message : "";
    const isAuthFailure = /401|403|unauthorized|forbidden|invalid|expired/i.test(msg);
    if (isAuthFailure) {
      logout();
    } else {
      // Backend not reachable — keep current cached state (Supabase session).
      console.warn("refreshMe: backend unreachable, keeping existing session.", err);
    }
    return null;
  }
}

// ── Google sign-in via Supabase OAuth ────────────────────────────────────────
// Flow: browser → Supabase /authorize → Google consent → redirect back to the
// console with #access_token=…&refresh_token=…. signInWithGoogle() kicks off
// the redirect; completeGoogleSignIn() runs on return, exchanges the tokens
// via supabase-js, then posts the Supabase access token to the backend which
// verifies it against Supabase and mints our local JWT. The hash fragment is
// scrubbed afterwards so the token never lingers in the URL bar.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "https://ozaxpjkmubtnotwiltfc.supabase.co").trim();
const SUPABASE_ANON_KEY = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96YXhwamttdWJ0bm90d2lsdGZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MjEzMjAsImV4cCI6MjEwMDI5NzMyMH0.F8I1hE-y9oG4D-rtJr1Efs8dmjF814NqRg_jx6jieKk"
).trim();

let supabaseAuth: ReturnType<typeof createClient> | null = null;

function getSupabaseAuth() {
  if (!supabaseAuth) {
    supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        // Pin the implicit flow: completeGoogleSignIn() reads the access token
        // from the URL hash on return. (The library default — switching to
        // PKCE in newer majors — would instead come back with ?code=… and
        // silently break sign-in here.)
        flowType: "implicit",
      },
    });
  }
  return supabaseAuth;
}

/**
 * Called once on app boot (before any auth state is read). If the URL came
 * back from a Google OAuth redirect, completes the exchange, signs the local
 * backend session in, and cleans the URL. Returns the user when a redirect
 * was actually handled.
 *
 * Authority-via-Google: if the user entered an invite code before starting
 * Google sign-in (stored in sessionStorage by the modal), it is redeemed
 * automatically after the account is created — one flow, no extra step.
 */
export async function completeGoogleSignIn(): Promise<AuthUser | null> {
  const hash = window.location.hash;
  const query = window.location.search;

  // Supabase can bounce back with the failure surfaced as QUERY parameters
  // (e.g. ?error=provider_disabled&error_description=…) — detect that BEFORE
  // the token check so the failure is never mistaken for "no redirect".
  if (query.includes("error=")) {
    const q = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const errorCode = q.get("error") || q.get("error_code") || "";
    const errorDesc = q.get("error_description") || "";
    history.replaceState(null, "", window.location.pathname);
    throw new Error(friendlyGoogleError(errorCode, errorDesc));
  }

  if (!hash.includes("access_token=")) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const errorDesc = params.get("error_description");
  const errorCode = params.get("error_code") || params.get("error") || "";

  // Scrub immediately either way.
  history.replaceState(null, "", window.location.pathname + window.location.search);

  if (errorDesc || errorCode || !accessToken) {
    throw new Error(friendlyGoogleError(errorCode, errorDesc ?? ""));
  }

  const sb = getSupabaseAuth();
  const { data: sessionData, error } = await sb.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken ?? "",
  });
  if (error) throw new Error(`Supabase session error: ${error.message}`);

  // Backend exchange: mints the local JWT AND (when an invite code is
  // pending) validates + redeems the code server-side, so the response role
  // is authoritative. The code travels WITH the exchange — one call, no
  // second round-trip that could fail silently and strand a citizen.
  const PENDING_KEY = "ncr72.pending_authority_code";
  const pendingCode = sessionStorage.getItem(PENDING_KEY);

  let localUser: AuthUser;
  let localToken: string;

  try {
    const data = await authFetch<TokenPayload>("/api/v1/auth/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        invite_code: pendingCode || undefined,
      }),
    });
    localUser = data.user;
    localToken = data.access_token;
    sessionStorage.removeItem(PENDING_KEY); // consumed (or not needed)
  } catch (backendErr) {
    const reason = backendErr instanceof Error ? backendErr.message : String(backendErr);
    const networkDown = /failed to fetch|network|load failed/i.test(reason);
    if (!networkDown) {
      // Definitive server rejection (bad/expired token, code not recognised
      // or already used): do NOT fabricate a citizen session — surface the
      // exact reason. The Supabase session is discarded so nothing half-
      // signed-in lingers.
      sessionStorage.removeItem(PENDING_KEY);
      await sb.auth.signOut().catch(() => undefined);
      throw new Error(
        pendingCode
          ? `Google sign-in stopped: ${reason} Your invite code was NOT consumed — try again.`
          : `Google sign-in failed: ${reason}`,
      );
    }
    // Backend genuinely unreachable (dev without API, offline): keep a
    // degraded citizen session from the Supabase profile so the UI works.
    const sbUser = sessionData?.user;
    if (!sbUser) throw new Error("Google sign-in failed: no session from Supabase.");
    localUser = {
      id: sbUser.id,
      email: sbUser.email ?? "",
      full_name:
        sbUser.user_metadata?.full_name ||
        sbUser.user_metadata?.name ||
        sbUser.email?.split("@")[0] ||
        "User",
      role: "citizen" as Role,
    };
    // Use the Supabase access token directly as the local token for API calls.
    localToken = accessToken!;
    // Keep the pending code stored: the profile-menu redeem box can apply it
    // once the backend is reachable again.
    console.warn("Backend auth exchange skipped (not reachable); signed in via Supabase session.", backendErr);
  }

  persist(localUser, localToken);
  return localUser;
}

/**
 * Pre-flight check of an authority invite code WITHOUT consuming it.
 * Backs the Google-sign-in gate: the button stays locked until the server
 * confirms the code exists and is unused, so a typo never sails through an
 * entire OAuth redirect just to fail afterwards.
 */
export interface InviteValidation {
  code: string;
  format_ok: boolean;
  exists: boolean;
  used: boolean;
  message: string;
}

export async function validateInviteCode(code: string): Promise<InviteValidation> {
  return authFetch<InviteValidation>("/api/v1/auth/invite/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  });
}

/**
 * Translate a Supabase/Google OAuth failure into a message a citizen can act
 * on. The two most common causes are a disabled Google provider and an
 * unregistered site origin (the deploy/dev URL is missing from the Supabase
 * redirect-allow list) — surface those explicitly instead of a bare 400.
 */
function friendlyGoogleError(code: string, description: string): string {
  const desc = (description || "").replace(/\+/g, " ").trim();
  const c = (code || "").toLowerCase();
  const d = desc.toLowerCase();

  if (c.includes("provider") || d.includes("provider is not enabled")) {
    return "Google sign-in isn't enabled on the authentication server yet (provider disabled).";
  }
  if (
    d.includes("unregistered") ||
    d.includes("redirect url") ||
    d.includes("redirect_uri") ||
    d.includes("not allowed") ||
    c === "validation_failed"
  ) {
    return `This site's address isn't registered for Google sign-in. Add "${window.location.origin}" to the allowed redirect URLs in the Supabase auth settings, then retry.`;
  }
  if (d.includes("cancelled") || d.includes("access_denied")) {
    return "Google sign-in was cancelled before it completed.";
  }
  return desc || code || "Google sign-in was cancelled or failed.";
}

/**
 * Remember that the Google sign-in about to start is for authority
 * registration. The code is consumed (redeemed) automatically after the
 * redirect back. Single-use is enforced server-side either way.
 */
export function setPendingAuthorityCode(code: string): void {
  sessionStorage.setItem("ncr72.pending_authority_code", code.trim().toUpperCase());
}

export async function signInWithGoogle(): Promise<void> {
  // Return to the exact page that started the flow (path preserved) so the
  // OAuth return lands wherever the user was — root in prod, any base path.
  const redirectTo =
    window.location.origin + (window.location.pathname || "/");
  const { error } = await getSupabaseAuth().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // Ask Google for the profile scopes we actually use (email + name).
      scopes: "email profile",
    },
  });
  if (error) throw new Error(`Could not start Google sign-in: ${error.message}`);
}

/**
 * Redeem an authority invite code on the signed-in account. The only path
 * from Google-sign-in citizen to authority (Google accounts can never
 * self-promote; the backend mints a fresh JWT with the elevated role).
 */
export async function elevate(inviteCode: string): Promise<AuthUser> {
  const { token } = cachedState;
  if (!token) throw new Error("Sign in first, then redeem the invite code.");
  const data = await authFetch<TokenPayload>("/api/v1/auth/elevate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ invite_code: inviteCode }),
  });
  persist(data.user, data.access_token);
  return data.user;
}
