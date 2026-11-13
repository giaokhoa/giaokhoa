import { Injectable, Logger } from '@nestjs/common';
import { SpaceDatabaseService } from './db/routing/space-database.service';

@Injectable()
export class TaskLogService {
  private readonly logger = new Logger(TaskLogService.name);

  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async run<T>(taskName: string, fn: () => Promise<T>, summarize?: (result: T) => string): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await fn();
      await this.recordRun(taskName, startedAt, 'success', summarize?.(result));
      return result;
    } catch (err) {
      await this.recordRun(taskName, startedAt, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async recordRun(taskName: string, startedAt: Date, status: 'success' | 'failed', message?: string): Promise<void> {
    try {
      await this.spaceDb.routedKysely
        .insertInto('task_log')
        .values({
          task_name: taskName, status, message: message ?? null, started_at: startedAt, finished_at: new Date(),
        })
        .execute();
    } catch (err) {
      this.logger.warn(`Could not write task_log for ${taskName}: ${String(err)}`);
    }
  }
}
