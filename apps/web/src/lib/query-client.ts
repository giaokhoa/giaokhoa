import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '#lib/api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && [401, 403, 404].includes(error.problem.status)) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

export const queryClient = createQueryClient();
