import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type MeResponse } from "./api";

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  username?: string;
  setupRequired: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refresh" | "signOut">>({
    loading: true,
    authenticated: false,
    setupRequired: false,
  });

  const apply = useCallback((me: MeResponse) => {
    setState({
      loading: false,
      authenticated: me.authenticated,
      username: me.username,
      setupRequired: me.setup_required,
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.me());
    } catch {
      setState((s) => ({ ...s, loading: false, authenticated: false }));
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setState((s) => ({ ...s, authenticated: false }));
    window.addEventListener("wn:unauthorized", onUnauthorized);
    return () => window.removeEventListener("wn:unauthorized", onUnauthorized);
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ loading: false, authenticated: false, setupRequired: false });
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ...state, refresh, signOut }),
    [state, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}

/** 发音音色偏好（跟随账号设置，本地缓存兜底） */
export function useVoice(): [string, (v: string) => void] {
  const [voice, setVoice] = useState(() => localStorage.getItem("wn.voice") || "F5");
  const update = (v: string) => {
    setVoice(v);
    localStorage.setItem("wn.voice", v);
  };
  return [voice, update];
}
