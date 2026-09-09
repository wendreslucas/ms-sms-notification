import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
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
    @InjectQueue(SMS_QUEUE_NAME) private readonly smsQueue: Queue,
    @InjectQueue(SMS_DLQ_QUEUE_NAME) private readonly smsDlqQueue: Queue,
  ) {}

  getQueueNames(): string[] {
    return [this.smsQueue.name, this.smsDlqQueue.name];
  }

  async enqueueSms(messageId: string, options: EnqueueSmsOptions = {}): Promise<void> {
    const payload: SendSmsJobPayload = { messageId };

    await this.smsQueue.add(SEND_SMS_JOB_NAME, payload, {
      jobId: options.jobId ?? messageId,
      removeOnComplete: false,
      removeOnFail: false,
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
