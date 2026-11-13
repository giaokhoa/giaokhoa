import { MCP_TOOL_REGISTRY } from './mcp-tool-registry';

/**
 * Rate limit tối thiểu của MCP-0 (hồ sơ research Phần 3.3): đếm theo
 * (giáo viên, nhóm tool) trong cửa sổ một giờ, giữ trong tiến trình
 * (stateless theo request nên không cần kho dùng chung ở lát này;
 * MCP-1 khi mở cho giáo viên thật sẽ xét lại theo AS/token family). Đọc: 300 req/giờ; create_question: 120 câu/giờ — cấu hình qua env MCP_RATE_READ_PER_HOUR / MCP_RATE_CREATE_PER_HOUR.
 */
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

  /**
   * Xô rate-limit của một tool theo đăng ký duy nhất (`MCP_TOOL_REGISTRY`):
   * publish đổi trạng thái phát hành (draft → ready) nên có xô riêng siết
   * nhất (hồ sơ 3.3: 10 lần/giờ); mọi tool ghi còn lại dùng xô 'create';
   * tool không có trong đăng ký — kể cả tên lạ — rơi về xô 'read'.
   */
  static bucketForTool(toolName: string | undefined): McpRateBucket {
    return (toolName ? MCP_TOOL_REGISTRY[toolName]?.bucket : undefined) ?? 'read';
  }

  /**
   * `cost` = số đơn vị tính vào hạn mức của lượt gọi này (mặc định 1; batch truyền số item để hạn mức 120 câu/giờ tính theo câu thật như hồ sơ 3.3, không theo số request).
   */
  check(userId: string, bucket: McpRateBucket, now = Date.now(), cost = 1): McpRateDecision {
    const key = `${userId}:${bucket}`;
    const limit = this.limits[bucket];
    // Ít nhất 1 đơn vị cho mỗi lượt gọi; cost không phải số hữu hạn
    // (NaN) thì tính 1 — `Math.max` một mình không chặn được NaN
    // (`Math.max(1, NaN)` ra NaN, làm hỏng mọi phép so sánh sau đó).
    const units = Number.isFinite(cost) ? Math.max(1, Math.floor(cost)) : 1;
    // Dọn entry hết hạn trước khi quyết định: Map chỉ còn giữ các khoá
    // đang trong cửa sổ hiệu lực, không phình theo tổng số client từng
    // gọi tới (issue #485). Việc dọn không đổi bất kỳ quyết định nào —
    // entry hết hạn nếu chính là khoá đang kiểm tra thì vốn cũng bị
    // nhánh đặt lại cửa sổ ở dưới ghi đè như thể chưa từng tồn tại.
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

  /**
   * Xoá mọi entry mà cửa sổ đã hết hạn tại thời điểm `now`. Điều kiện
   * hết hạn ở đây trùng khớp điều kiện đặt lại cửa sổ trong `check`
   * (`now - windowStart >= WINDOW_MS`) nên entry còn hiệu lực không
   * bao giờ bị xoá nhầm, và `retryAfterSeconds` của các khoá còn hiệu
   * lực giữ nguyên. Xoá phần tử trong lúc duyệt `Map` là thao tác an
   * toàn theo ngữ nghĩa của `Map` trong JavaScript.
   */
  private dropExpiredWindows(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.windowStart >= WINDOW_MS) {
        this.windows.delete(key);
      }
    }
  }
}
