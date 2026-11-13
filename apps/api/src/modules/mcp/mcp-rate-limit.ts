export type McpRateBucket = 'read' | 'create' | 'publish';

export interface McpRateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 60 * 60 * 1000;

export class McpRateLimiter {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limits: Record<McpRateBucket, number> = { read: 300, create: 120, publish: 10 },
  ) {}

  static bucketForTool(toolName: string | undefined): McpRateBucket {
    if (toolName === 'publish_questions') return 'publish';
    return toolName === 'create_question' ||
      toolName === 'create_questions_batch' ||
      toolName === 'create_stimulus_with_questions' ||
      toolName === 'submit_contribution'
      ? 'create'
      : 'read';
  }

  check(userId: string, bucket: McpRateBucket, now = Date.now(), cost = 1): McpRateDecision {
    const key = `${userId}:${bucket}`;
    const limit = this.limits[bucket];
    const units = Math.max(1, Math.floor(cost) || 1);
    this.dropExpiredWindows(now);
    const current = this.windows.get(key);
    if (!current || now - current.windowStart >= WINDOW_MS) {
      this.windows.set(key, { windowStart: now, count: units });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count + units > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.windowStart + WINDOW_MS - now) / 1000)),
      };
    }
    current.count += units;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private dropExpiredWindows(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.windowStart >= WINDOW_MS) {
        this.windows.delete(key);
      }
    }
  }
}
