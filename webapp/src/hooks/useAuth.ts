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

  useEffect(() => {
    // If the URL came back from a Google OAuth redirect, finish the exchange
    // first (this persists the session and notifies subscribers); then
    // re-validate whatever token is stored — a server restart with a new
    // signing secret, or an expired token, silently becomes signed-out.
    completeGoogleSignIn().catch((err) => {
      console.warn("Google sign-in completion failed:", err);
    });
    void refreshMe();
    return subscribeAuth(setState);
  }, []);

  return state;
}
