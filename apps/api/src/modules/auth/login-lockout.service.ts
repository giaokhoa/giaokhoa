import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuthRepository } from '@giaokhoa/db/repositories/auth';

export const AUTH_LOCKED_OUT_CODE = 'auth.locked_out';
export const AUTH_LOCKED_OUT_MESSAGE = 'Account is locked out due to failed login attempts';

export interface LoginIdentifier {
  username?: string;
  email?: string;
}

export interface LockoutGuardPort {
  isLoginLocked(identifier: LoginIdentifier): Promise<boolean>;
  recordLoginAttempt(identifier: LoginIdentifier, success: boolean, ip?: string): Promise<void>;
}

@Injectable()
export class LoginLockoutService implements LockoutGuardPort {
  constructor(
    private readonly repo: AuthRepository,
    @Inject(forwardRef(() => UsersService))
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async isLockedOut(userId: string): Promise<boolean> {
    const threshold = this.config.get<number>('LOCKOUT_THRESHOLD') ?? 5;
    if (threshold <= 0) return false;
    const windowMin = this.config.get<number>('LOCKOUT_WINDOW_MINUTES') ?? 20;
    const durationMin = this.config.get<number>('LOCKOUT_DURATION_MINUTES') ?? 30;
    const since = new Date(Date.now() - windowMin * 60_000);
    const failures = await this.repo.recentFailedAttempts(userId, since);
    if (failures.length < threshold) return false;
    const lastSuccess = await this.repo.lastSuccessfulAttemptAt(userId);
    const relevant = lastSuccess ? failures.filter((f) => f.attemptedAt > lastSuccess) : failures;
    if (relevant.length < threshold) return false;
    const thresholdHitAt = relevant[threshold - 1]!.attemptedAt.getTime();
    return Date.now() < thresholdHitAt + durationMin * 60_000;
  }

  async recordAttempt(v: { userId: string; username: string; success: boolean; ip?: string }): Promise<void> {
    await this.repo.recordAttempt(v);
  }

  private async resolveUser(identifier: LoginIdentifier) {
    if (identifier.username) return this.users.getByUsername(identifier.username);
    if (identifier.email) return this.users.getByEmail(identifier.email);
    return undefined;
  }

  async isLoginLocked(identifier: LoginIdentifier): Promise<boolean> {
    const user = await this.resolveUser(identifier);
    if (!user || user.deleted) return false;
    return this.isLockedOut(user.id);
  }

  async recordLoginAttempt(identifier: LoginIdentifier, success: boolean, ip?: string): Promise<void> {
    const user = await this.resolveUser(identifier);
    if (!user) return;
    await this.repo.recordAttempt({ userId: user.id, username: user.username, success, ip });
  }
}
