import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ImagesModule } from './images/images.module.js';
import { AuthModule } from './auth/auth.module.js';
import { envSchema, type Env } from './config/env.js';
import { CurriculumModule } from './curriculum/curriculum.module.js';
import * as schema from '@giaokhoa/database/schema';
import { QuestionsModule } from './questions/questions.module.js';
import { ClientErrorFilter } from './common/client-error.filter.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { AssignmentsModule } from './assignments/assignments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
        schema,
      }),
    }),
    AuthModule,
    AuthorizationModule,
    ClassesModule,
    ExamsModule,
    AssignmentsModule,
    ImagesModule,
    CurriculumModule,
    QuestionsModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    { provide: APP_FILTER, useClass: ClientErrorFilter },
  ],
})
export class AppModule {}
