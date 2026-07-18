import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { api, User } from "./api";

const TOKEN_KEY = "airtaghistory.token";

type AuthState = {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // On launch, restore a saved token. We keep the user null until the first
  // successful call re-hydrates it; a stale token surfaces as a 401 -> signOut.
  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        api.setToken(token);
        try {
          await api.getTags(); // cheap validity probe
          setUser({ id: 0, email: "", timezone: null }); // placeholder; refreshed on screens
        } catch {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          api.setToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user } = await api.login(email, password);
    api.setToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setUser(user);
  };

  const signOut = () => {
    SecureStore.deleteItemAsync(TOKEN_KEY);
    api.setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
