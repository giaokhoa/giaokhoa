import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UserProfile } from '@giaokhoa/contracts';
import { userProfileSchema } from '@giaokhoa/contracts';
import { apiErrorFromAuthClient, apiFetch, TwoFactorRedirectError } from '#lib/api';
import { authClient, useSession } from '#lib/auth-client';
import { queryClient } from '#lib/query-client';

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<UserProfile>;
  completeMfaLogin: (code: string) => Promise<UserProfile>;
  requestEmailOtp: (email: string) => Promise<void>;
  loginWithEmailOtp: (email: string, otp: string) => Promise<UserProfile>;
  loginWithSocial: (provider: 'google' | 'facebook') => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser?: UserProfile | null }) {
  const [user, setUser] = useState<UserProfile | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);
  const session = useSession();
  const syncedForRef = useRef<string | null | undefined>(undefined);

  const profileFlightRef = useRef<{ id: string; promise: Promise<void> } | null>(null);

  const applySession = useCallback(async (sessionUserId: string | null, force = false) => {
    if (sessionUserId === null) {
      profileFlightRef.current = null;
      if (syncedForRef.current !== null) {
        syncedForRef.current = null;
        setUser(null);
      }
      setLoading(false);
      return;
    }
    const flight = profileFlightRef.current;
    if (flight && flight.id === sessionUserId) {
      await flight.promise;
      return;
    }
    if (!force && syncedForRef.current === sessionUserId) {
      setLoading(false);
      return;
    }
    syncedForRef.current = sessionUserId;
    const record: { id: string; promise: Promise<void> } = {
      id: sessionUserId,
      promise: Promise.resolve(),
    };
    profileFlightRef.current = record;
    record.promise = (async () => {
      try {
        const res = await apiFetch('/api/v1/users/me');
        if (profileFlightRef.current !== record) return;
        if (res.ok) setUser(userProfileSchema.parse(await res.json()));
        else setUser(null);
      } catch {
        if (profileFlightRef.current === record) setUser(null);
      }
      if (profileFlightRef.current === record) setLoading(false);
    })();
    try {
      await record.promise;
    } finally {
      if (profileFlightRef.current === record) profileFlightRef.current = null;
    }
  }, []);

  const mountSettledRef = useRef(initialUser !== undefined);
  const consumedAtomDataRef = useRef<unknown>(undefined);
  const sessionDataRef = useRef(session.data);
  useEffect(() => { sessionDataRef.current = session.data; }, [session.data]);
  const [mountTick, setMountTick] = useState(0);

  useEffect(() => {
    if (session.isPending) return;
    if (!mountSettledRef.current) return;
    if (consumedAtomDataRef.current === session.data) return;
    consumedAtomDataRef.current = session.data;
    void applySession(session.data?.user?.id ?? null);
  }, [session.data, session.isPending, applySession, mountTick]);

  const reload = useCallback(async (): Promise<boolean> => {
    let sessionUserId: string | null;
    try {
      const { data } = await authClient.getSession();
      sessionUserId = data?.user?.id ?? null;
    } catch {
      return false;
    }
    await applySession(sessionUserId, true);
    return true;
  }, [applySession]);

  const mountReloadedRef = useRef(false);
  useEffect(() => {
    if (initialUser !== undefined || mountReloadedRef.current) return;
    mountReloadedRef.current = true;
    let alive = true;
    void reload().then((applied) => {
      if (!alive) return;
      if (applied) consumedAtomDataRef.current = sessionDataRef.current;
      mountSettledRef.current = true;
      setMountTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [initialUser, reload]);

  const establishSession = useCallback(async (): Promise<UserProfile> => {
    queryClient.clear();
    profileFlightRef.current = null;
    const res = await apiFetch('/api/v1/users/me');
    const profile = userProfileSchema.parse(await res.json());
    syncedForRef.current = profile.id;
    setUser(profile);
    setLoading(false);
    return profile;
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<UserProfile> => {
      const { data, error } = await authClient.signIn.username({ username, password });
      if (error) throw apiErrorFromAuthClient(error);
      const redirect = (data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect;
      if (redirect) throw new TwoFactorRedirectError();
      return establishSession();
    },
    [establishSession],
  );




  const completeMfaLogin = useCallback(
    async (code: string): Promise<UserProfile> => {
      const trimmed = code.trim();
      if (!/^\d{6}$/.test(trimmed)) throw new Error('INVALID_TOTP_CODE');
      const { error } = await authClient.twoFactor.verifyTotp({ code: trimmed });
      if (error) throw apiErrorFromAuthClient(error);
      return establishSession();
    },
    [establishSession],
  );

  const requestEmailOtp = useCallback(async (email: string): Promise<void> => {
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    if (error) throw apiErrorFromAuthClient(error);
  }, []);

  const loginWithEmailOtp = useCallback(
    async (email: string, otp: string): Promise<UserProfile> => {
      const { data, error } = await authClient.signIn.emailOtp({ email, otp });
      if (error) throw apiErrorFromAuthClient(error);
      const redirect = (data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect;
      if (redirect) throw new TwoFactorRedirectError();
      return establishSession();
    },
    [establishSession],
  );

  const loginWithSocial = useCallback(async (provider: 'google' | 'facebook'): Promise<void> => {
    const { error } = await authClient.signIn.social({ provider, callbackURL: '/oauth/callback' });
    if (error) throw apiErrorFromAuthClient(error);
  }, []);

  const logout = useCallback(async () => {
    const { error } = await authClient.signOut();
    if (error) throw apiErrorFromAuthClient(error);
    queryClient.clear();
    profileFlightRef.current = null;
    syncedForRef.current = null;
    setUser(null);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      completeMfaLogin,
      requestEmailOtp,
      loginWithEmailOtp,
      loginWithSocial,
      logout,
      reload,
    }),
    [user, loading, login, completeMfaLogin, requestEmailOtp, loginWithEmailOtp, loginWithSocial, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
