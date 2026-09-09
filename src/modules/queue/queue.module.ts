import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SMS_DLQ_QUEUE_NAME, SMS_QUEUE_NAME } from './queue.constants';
import { QueueService } from './queue.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('redis.host'),
          port: configService.getOrThrow<number>('redis.port'),
        },
      }),
    }),
    BullModule.registerQueue({ name: SMS_QUEUE_NAME }, { name: SMS_DLQ_QUEUE_NAME }),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
