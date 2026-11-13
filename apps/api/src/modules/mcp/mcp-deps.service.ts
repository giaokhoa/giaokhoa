import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxService } from '../../infra/events/outbox.service';
import { BETTER_AUTH_BASE_PATH } from '../auth/better-auth/better-auth.instance';
import { BetterAuthService } from '../auth/better-auth/better-auth.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { ExamsService } from '../exams/exams.service';
import { QuestionBanksService } from '../questions/question-banks.service';
import { MatrixBanksService } from '../quiz/matrix-banks.service';
import { TenantsService } from '../tenants/tenants.service';
import { QuestionsService } from '../questions/questions.service';
import { UsersService } from '../users/users.service';
import { McpBridgeAuth } from './mcp-bridge-auth';
import { McpIdempotencyRepository } from '@giaokhoa/db/repositories/mcp-idempotency';
import type { McpMountDeps } from './mcp.mount';
import { McpOAuthVerifier } from './mcp-oauth-verifier';
import { McpRateLimiter } from './mcp-rate-limit';
import type { McpToolDeps } from './mcp.tools';

/**
 * Facade dựng deps cho tầng mount MCP (issue #138, mục 8.1 của #134).
 *
 * Trước đây deps của mount được dựng trong mcp.mount.ts bằng cách lấy provider nới phạm vi khỏi container — vòng qua hệ module, lấy thẳng repository câu hỏi vốn không được QuestionsModule export và dựng repository idempotency tay từ handle DB của repository đó. Nay mọi dependency đều là service/repository ĐÃ ĐƯỢC module sở hữu
 * export và được Nest inject như mọi module khác: QuestionsService +
 * QuestionBanksService (facade của QuestionsModule), UsersService, OutboxService, và McpIdempotencyRepository của chính McpModule
 * (inject bộ máy cũ trực tiếp). Bootstrap chỉ còn `app.get(McpDepsService)`
 * như tiền lệ BetterAuthService.
 *
 * Lát MCP-1 (issue #163) thêm đường RS OAuth: khi BetterAuthService báo AS đã bật (`mcpAsEnabled`), facade dựng McpOAuthVerifier trỏ đúng issuer/JWKS của instance BA vừa compose + hàm resolveActor kiểm tra tài khoản còn hoạt động; PRM khi đó quảng bá issuer của AS. AS tắt thì deps giữ nguyên hình MCP-0 (cầu bridge là đường auth duy nhất).
 */
@Injectable()
export class McpDepsService {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly questions: QuestionsService,
    private readonly banks: QuestionBanksService,
    private readonly exams: ExamsService,
    private readonly matrixBanks: MatrixBanksService,
    private readonly curriculum: CurriculumService,
    private readonly idempotency: McpIdempotencyRepository,
    private readonly outbox: OutboxService,
    private readonly betterAuth: BetterAuthService,
    private readonly tenants: TenantsService,
  ) {}

  /** Dựng deps của mount từ các provider đã inject (gọi trong main.ts sau NestFactory.create, như mountBetterAuth). */
  createMountDeps(): McpMountDeps {
    // Phần chung của hai nhánh AS bật/tắt: cầu bridge, rate limit và
    // các service của tools — chỉ rẽ nhánh ở issuer/verifier và ở
    // publicBaseUrl (AS dùng origin đã chuẩn hoá, MCP-0 dùng đúng giá
    // trị cấu hình, rỗng khi chưa cấu hình).
    const bridgeAuth = new McpBridgeAuth(this.config.getOrThrow<string>('JWT_SECRET'), this.users);
    const rateLimiter = new McpRateLimiter({
      read: this.positiveRateLimit('MCP_RATE_READ_PER_HOUR', 300),
      create: this.positiveRateLimit('MCP_RATE_CREATE_PER_HOUR', 120),
      publish: this.positiveRateLimit('MCP_RATE_PUBLISH_PER_HOUR', 10),
    });
    // Origin công khai theo đúng thứ tự ưu tiên mà BetterAuthService dùng để chốt `resource` của AS — hai nơi PHẢI ra cùng một gốc, nếu không `aud` của token và audience RS kỳ vọng sẽ lệch nhau.
    const publicBaseUrl =
      this.config.get<string>('MCP_PUBLIC_BASE_URL') ??
      this.config.get<string>('BETTER_AUTH_URL') ??
      null;
    const toolDeps = (base: string): McpToolDeps => ({
      questions: this.questions,
      banks: this.banks,
      exams: this.exams,
      matrixBanks: this.matrixBanks,
      curriculum: this.curriculum,
      idempotency: this.idempotency,
      outbox: this.outbox,
      publicBaseUrl: base,
    });

    const asEnabled = this.betterAuth.mcpAsEnabled && this.betterAuth.mcpAs !== null;
    if (asEnabled) {
      const port = this.config.get<number>('PORT') ?? 3000;
      const origin = (publicBaseUrl ?? `http://localhost:${port}`).replace(/\/+$/, '');
      const issuer = `${origin}${BETTER_AUTH_BASE_PATH}`;
      return {
        bridgeAuth,
        rateLimiter,
        publicBaseUrl: origin,
        issuer,
        oauthVerifier: new McpOAuthVerifier({
          issuer,
          audience: this.betterAuth.mcpAs!.resource,
          jwksUrl: `${issuer}/jwks`,
        }),
        resolveActor: async (userId: string) => {
          const user = await this.users.getByIdOrUndefined(userId);
          if (!user || user.deleted || user.suspended) return null;
          // TENANT-1 (#196): tenant của phiên OAuth = tenant mặc định
          // của user theo membership (khi token AS không mang `tid`).
          const tenant = await this.tenants.resolveDefaultTenant(userId).catch(() => null);
          return { username: user.username, tenantId: tenant?.id ?? null };
        },
        toolDeps: toolDeps(origin),
      };
    }

    return {
      bridgeAuth,
      rateLimiter,
      publicBaseUrl,
      issuer: this.config.get<string>('MCP_AUTH_ISSUER') ?? null,
      toolDeps: toolDeps(publicBaseUrl ?? ''),
    };
  }

  /**
   * Trần rate-limit MCP: số nguyên dương từ cấu hình, fallback về default
   * của schema env khi giá trị thiếu/không hợp lệ (Zod default đã áp nên
   * fallback này chỉ là phòng thủ cho môi trường test không validate).
   */
  private positiveRateLimit(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key) ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
