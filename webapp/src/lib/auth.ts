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
  } catch {
    logout();
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
  if (!hash.includes("access_token=")) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const errorDesc = params.get("error_description");

  // Scrub immediately either way.
  history.replaceState(null, "", window.location.pathname + window.location.search);

  if (errorDesc || !accessToken) {
    throw new Error(errorDesc || "Google sign-in was cancelled or failed.");
  }

  const sb = getSupabaseAuth();
  const { error } = await sb.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken ?? "",
  });
  if (error) throw new Error(`Supabase session error: ${error.message}`);

  // Verify with our backend (which validates the token against Supabase) and
  // mint the local JWT so every role-gated API works identically.
  const data = await authFetch<TokenPayload>("/api/v1/auth/supabase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  persist(data.user, data.access_token);

  // Auto-redeem a pending authority invite code (authority-via-Google flow).
  const PENDING_KEY = "ncr72.pending_authority_code";
  const pendingCode = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (pendingCode && data.user.role === "citizen") {
    try {
      return await elevate(pendingCode);
    } catch (err) {
      // Never block the sign-in over elevation; the user can still redeem
      // the code from the header chip afterwards.
      console.warn("Automatic authority elevation failed:", err);
    }
  }
  return data.user;
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
  const redirectTo = `${window.location.origin}/`;
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
