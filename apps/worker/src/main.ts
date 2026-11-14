import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: process.env.NODE_ENV === 'production' ? new ConsoleLogger({ json: true }) : undefined,
  });
  app.enableShutdownHooks();
  new Logger('Worker').log('Worker started: BullMQ processors + outbox relay running');
}

void bootstrap();
