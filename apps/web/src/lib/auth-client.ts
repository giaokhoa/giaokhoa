import { createAuthClient } from 'better-auth/react';
import { emailOTPClient, twoFactorClient, usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  basePath: '/api/v1/auth',
  plugins: [usernameClient(), twoFactorClient(), emailOTPClient()],
  fetchOptions: {
    customFetchImpl: (input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input instanceof URL ? input.toString() : input, init),
  },
});

export const { useSession } = authClient;
