import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '#lib/auth';
import { PermissionsProvider } from '#lib/permissions';
import { createQueryClient } from '#lib/query-client';

export function TestProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const created = createQueryClient();
    created.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
    return created;
  });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <PermissionsProvider>{children}</PermissionsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
