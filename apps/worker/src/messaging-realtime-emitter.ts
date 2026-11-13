import { createAdapter } from '@socket.io/redis-adapter';
import type { RealtimeEmitter, RealtimeRemoteSocket } from '@giaokhoa/messaging';
import Redis from 'ioredis';
import { Server } from 'socket.io';

export const MESSAGING_NAMESPACE = '/messaging';

const PUBLISH_CONFIRM_TIMEOUT_MS = 10_000;

async function confirmBroadcastPublish(publish: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      publish,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Redis publish of a realtime broadcast was not confirmed within ${PUBLISH_CONFIRM_TIMEOUT_MS}ms`));
        }, PUBLISH_CONFIRM_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface MessagingRealtimeEmitterHandle {
  emitter: RealtimeEmitter;
  close(): Promise<void>;
}

export function createMessagingRealtimeEmitter(redisUrl: string, redisOptions: Record<string, unknown> = {}): MessagingRealtimeEmitterHandle {
  const pub = new Redis(redisUrl, { maxRetriesPerRequest: null, ...redisOptions });
  const sub = pub.duplicate();
  let broadcastPublishes: Promise<number>[] | null = null;
  const publishThroughAdapter = pub.publish.bind(pub);
  pub.publish = (channel: string, message: string | Buffer) => {
    const publish = publishThroughAdapter(channel, message);
    broadcastPublishes?.push(publish);
    return publish;
  };
  const server = new Server();
  server.adapter(createAdapter(pub, sub) as never);
  const namespace = server.of(MESSAGING_NAMESPACE);
  const emitter: RealtimeEmitter = {
    emitToRoom: async (room, event, payload) => {
      const publishes: Promise<number>[] = [];
      broadcastPublishes = publishes;
      try {
        namespace.to(room).emit(event, payload);
      } finally {
        broadcastPublishes = null;
      }
      await Promise.all(publishes.map((publish) => confirmBroadcastPublish(publish)));
    },
    fetchSocketsInRoom: async (room): Promise<RealtimeRemoteSocket[]> => {
      const sockets = await namespace.in(room).fetchSockets();
      return sockets.map((socket) => ({
        data: socket.data as { userId?: unknown },
        leave: (target: string) => socket.leave(target),
      }));
    },
  };
  return {
    emitter,
    close: async () => {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}
