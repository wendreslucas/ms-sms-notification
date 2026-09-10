import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppErrorFilter } from './common/errors/app-error.filter';
import { configuration } from './config/configuration';
import { buildLoggerParams } from './config/logger.config';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { QueueModule } from './modules/queue/queue.module';
import { SmsModule } from './modules/sms/sms.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    LoggerModule.forRoot(buildLoggerParams(process.env.NODE_ENV)),
    DatabaseModule,
    IdempotencyModule,
    QueueModule,
    ProvidersModule,
    SmsModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AppErrorFilter }],
})
export class AppModule {}
