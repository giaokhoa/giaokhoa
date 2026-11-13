import { Injectable } from '@nestjs/common';
import type { GuardianDigestFrequency, GuardianDigestPreferenceView } from '@giaokhoa/contracts';
import { UsersService } from '../users/users.service';
import { GuardiansService } from './guardians.service';

export function guardianDigestFrequencyPreferenceName(studentUserId: string): string {
  return `guardian_digest_frequency:${studentUserId}`;
}

@Injectable()
export class GuardianDigestService {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly users: UsersService,
  ) {}

  async getPreference(guardianId: string, studentId: string): Promise<GuardianDigestPreferenceView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    const raw = await this.users.getPreference(guardianId, guardianDigestFrequencyPreferenceName(studentId));
    const frequency: GuardianDigestFrequency = raw === 'daily' || raw === 'off' ? raw : 'weekly';
    return { studentId, frequency };
  }

  async setPreference(guardianId: string, studentId: string, frequency: GuardianDigestFrequency): Promise<GuardianDigestPreferenceView> {
    await this.guardians.requireActiveLinkOr404(guardianId, studentId);
    await this.users.setPreference(guardianId, guardianDigestFrequencyPreferenceName(studentId), frequency);
    return { studentId, frequency };
  }
}
