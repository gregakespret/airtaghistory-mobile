import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { api, ApiError, Me } from "./api";
import { API_BASE_URL } from "./config";
import { parseCallback } from "./deeplink";

const TOKEN_KEY = "airtaghistory.token";
const GOOGLE_LOGIN_URL = `${API_BASE_URL}/auth/google/login?native=1`;
const REDIRECT_URL = "airtaghistory://auth";

// Backend error slugs -> copy. Anything unrecognised falls through to generic.
const ERROR_COPY: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  bad_state: "Sign-in expired. Please try again.",
  provider_error: "Something went wrong.",
};

type AuthState = {
  user: Me | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const persist = async (token: string, me: Me) => {
    api.setToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setUser(me);
  };

  // On launch, restore a saved token. /api/auth/me both validates it and returns
  // the real user, so the account sheet has an email to show.
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (token) {
          api.setToken(token);
          try {
            setUser(await api.me());
          } catch {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            api.setToken(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user } = await api.login(email, password);
    await persist(token, { ...user, providers: [] });
  };

  const signInWithGoogle = async () => {
    const result = await WebBrowser.openAuthSessionAsync(GOOGLE_LOGIN_URL, REDIRECT_URL);
    // Backing out of the browser sheet is a choice, not an error.
    if (result.type !== "success") return;

    const parsed = parseCallback(result.url);
    if ("error" in parsed) {
      throw new Error(ERROR_COPY[parsed.error] ?? ERROR_COPY.provider_error);
    }
    try {
      const { token, user } = await api.exchangeCode(parsed.code);
      await persist(token, { ...user, providers: ["google"] });
    } catch (e) {
      throw new Error(
        e instanceof ApiError && e.status === 401
          ? "Sign-in expired. Please try again."
          : "Something went wrong.",
      );
    }
  };

  // Best-effort server-side revoke, then clear locally no matter what: signing
  // out has to work offline, and must never strand the user on a screen.
  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      // already-dead token, or no network — the local clear below is what counts
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    api.setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
