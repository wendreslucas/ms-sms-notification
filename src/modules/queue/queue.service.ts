import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { SEND_SMS_JOB_NAME, SMS_DLQ_QUEUE_NAME, SMS_QUEUE_NAME } from './queue.constants';
import { SendSmsJobPayload } from './queue.types';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(SMS_QUEUE_NAME) private readonly smsQueue: Queue,
    @InjectQueue(SMS_DLQ_QUEUE_NAME) private readonly smsDlqQueue: Queue,
  ) {}

  getQueueNames(): string[] {
    return [this.smsQueue.name, this.smsDlqQueue.name];
  }

  async enqueueSms(messageId: string): Promise<void> {
    const payload: SendSmsJobPayload = { messageId };

    await this.smsQueue.add(SEND_SMS_JOB_NAME, payload, {
      jobId: messageId,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }
}
