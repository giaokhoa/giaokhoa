import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { queryKeys } from '#lib/query-keys';

const unreadCountEventSchema = z.object({ unread: z.number().int().nonnegative() });

const STREAM_URL = '/api/v1/notifications/unread-count/stream';

export function useNotificationUnreadStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(STREAM_URL);
    source.addEventListener('unread-count', (event) => {
      try {
        const parsed = unreadCountEventSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
        if (parsed.success) {
          queryClient.setQueryData(queryKeys.notificationUnreadCount, { unread: parsed.data.unread });
        }
      } catch {
      }
    });
    return () => {
      source.close();
    };
  }, [queryClient]);
}
