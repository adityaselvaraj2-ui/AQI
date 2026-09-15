import { useEffect, useState } from "react";
import {
  completeGoogleSignIn,
  getAuthState,
  refreshMe,
  subscribeAuth,
  type AuthState,
} from "@/lib/auth";

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(getAuthState());
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Subscribe immediately so persist() during the Google exchange (commit →
    // listeners) reaches this component even before the async boot finishes.
    const unsubscribe = subscribeAuth(setState);

    const boot = async () => {
      // If the URL came back from a Google OAuth redirect, finish the exchange
      // FIRST (this persists the session and notifies subscribers). Only after
      // it settles do we re-validate the stored token — otherwise refreshMe()
      // could clear a just-minted session, or a failed redirect could silently
      // swallow the reason the user bounced back to the landing page.
      try {
        const user = await completeGoogleSignIn();
        if (user && !cancelled) {
          // The Google exchange succeeded — skip re-validation entirely so the
          // fresh token can't race with /auth/me on a slow backend.
          setAuthError(null);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          // Keep the redirect-failure reason visible to the user (e.g. provider
          // disabled, site origin not registered) instead of returning to the
          // landing page with no feedback.
          setAuthError(
            err instanceof Error ? err.message : "Google sign-in failed. Please try again.",
          );
          console.warn("Google sign-in completion failed:", err);
        }
        return;
      }

      // Normal boot (no OAuth redirect): re-validate whatever token is stored —
      // a server restart with a new signing secret, or an expired token,
      // silently becomes signed-out.
      void refreshMe();
    };

    void boot();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { ...state, authError };
}
