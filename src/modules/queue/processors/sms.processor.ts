import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { SEND_SMS_JOB_NAME, SMS_QUEUE_NAME } from '../queue.constants';
import { SendSmsJobPayload } from '../queue.types';
import { SmsDispatcherService } from '../../sms/services/sms-dispatcher.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Processor(SMS_QUEUE_NAME)
export class SmsProcessor extends WorkerHost {
  constructor(private readonly smsDispatcherService: SmsDispatcherService) {
    super();
  }

  async process(job: Job<SendSmsJobPayload>): Promise<void> {
    if (job.name !== SEND_SMS_JOB_NAME) {
      throw new Error(`Unsupported SMS job name: ${job.name}`);
    }

    if (!UUID_PATTERN.test(job.data.messageId)) {
      throw new Error('SMS job payload must contain a valid messageId UUID.');
    }

    await this.smsDispatcherService.dispatch(job.data.messageId);
  }
}
