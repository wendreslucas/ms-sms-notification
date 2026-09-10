import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdempotencyModule } from '../idempotency/idempotency.module';
import { QueueModule } from '../queue/queue.module';
import { ProvidersModule } from '../providers/providers.module';
import { SmsProcessor } from '../queue/processors/sms.processor';
import { AdminSmsController } from './controllers/admin-sms.controller';
import { SmsController } from './controllers/sms.controller';
import { SmsMessage } from './entities/sms-message.entity';
import { SmsDispatcherService } from './services/sms-dispatcher.service';
import { SmsService } from './services/sms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SmsMessage]),
    IdempotencyModule,
    QueueModule,
    ProvidersModule,
  ],
  controllers: [SmsController, AdminSmsController],
  providers: [SmsService, SmsDispatcherService, SmsProcessor],
  exports: [SmsService],
})
export class SmsModule {}
