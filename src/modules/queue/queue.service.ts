import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';

import {
  FAILED_SMS_JOB_NAME,
  SEND_SMS_JOB_NAME,
  SMS_DLQ_QUEUE_NAME,
  SMS_QUEUE_NAME,
} from './queue.constants';
import { FailedSmsJobPayload, SendSmsJobPayload } from './queue.types';

interface EnqueueSmsOptions {
  jobId?: string;
}

@Injectable()
export class QueueService {
  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(SMS_QUEUE_NAME) private readonly smsQueue: Queue,
    @InjectQueue(SMS_DLQ_QUEUE_NAME) private readonly smsDlqQueue: Queue,
  ) {}

  /**
   * Retry policy for the job itself, distinct from the per-provider retry the
   * dispatcher runs.
   *
   * A provider that rejects a send is handled inside the dispatcher and never
   * escapes as an error, so these attempts do not multiply provider calls.
   * They cover the job failing for infrastructure reasons instead: a Redis or
   * PostgreSQL connection dropping mid-dispatch, or a worker dying, which
   * BullMQ retries with exponential backoff.
   */
  private buildJobRetryOptions(): { attempts: number; backoff: { type: string; delay: number } } {
    return {
      attempts: this.configService.getOrThrow<number>('sms.jobAttempts'),
      backoff: {
        type: 'exponential',
        delay: this.configService.getOrThrow<number>('sms.jobBackoffDelayMs'),
      },
    };
  }

  async enqueueSms(messageId: string, options: EnqueueSmsOptions = {}): Promise<void> {
    const payload: SendSmsJobPayload = { messageId };

    await this.smsQueue.add(SEND_SMS_JOB_NAME, payload, {
      jobId: options.jobId ?? messageId,
      removeOnComplete: false,
      removeOnFail: false,
      ...this.buildJobRetryOptions(),
    });
  }

  async requeueSms(messageId: string): Promise<void> {
    await this.enqueueSms(messageId, {
      jobId: `requeue-${messageId}-${Date.now()}-${randomUUID()}`,
    });
  }

  async enqueueDeadLetter(messageId: string): Promise<void> {
    const payload: FailedSmsJobPayload = { messageId };

    await this.smsDlqQueue.add(FAILED_SMS_JOB_NAME, payload, {
      jobId: `dlq-${messageId}-${Date.now()}-${randomUUID()}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }
}
