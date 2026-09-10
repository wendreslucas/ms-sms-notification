import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { FAILED_SMS_JOB_NAME, SEND_SMS_JOB_NAME } from './queue.constants';
import { QueueService } from './queue.service';

const MESSAGE_ID = 'c8d488e9-f308-43e8-8db9-8df0cb5134ef';

function buildConfigService(): ConfigService {
  const values = new Map<string, number>([
    ['sms.jobAttempts', 3],
    ['sms.jobBackoffDelayMs', 1000],
  ]);

  return {
    getOrThrow: (key: string) => {
      const value = values.get(key);

      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }

      return value;
    },
  } as ConfigService;
}

describe('QueueService', () => {
  let smsQueue: { add: jest.Mock };
  let smsDlqQueue: { add: jest.Mock };
  let service: QueueService;

  beforeEach(() => {
    smsQueue = { add: jest.fn(async () => undefined) };
    smsDlqQueue = { add: jest.fn(async () => undefined) };
    service = new QueueService(
      buildConfigService(),
      smsQueue as unknown as Queue,
      smsDlqQueue as unknown as Queue,
    );
  });

  it('publishes a send job keyed by the message id so it cannot be added twice', async () => {
    await service.enqueueSms(MESSAGE_ID);

    expect(smsQueue.add).toHaveBeenCalledWith(
      SEND_SMS_JOB_NAME,
      { messageId: MESSAGE_ID },
      expect.objectContaining({ jobId: MESSAGE_ID }),
    );
  });

  it('asks BullMQ to retry a failed job with exponential backoff', async () => {
    await service.enqueueSms(MESSAGE_ID);

    expect(smsQueue.add).toHaveBeenCalledWith(
      SEND_SMS_JOB_NAME,
      { messageId: MESSAGE_ID },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      }),
    );
  });

  it('keeps completed and failed jobs so the queue stays inspectable', async () => {
    await service.enqueueSms(MESSAGE_ID);

    expect(smsQueue.add).toHaveBeenCalledWith(
      SEND_SMS_JOB_NAME,
      { messageId: MESSAGE_ID },
      expect.objectContaining({ removeOnComplete: false, removeOnFail: false }),
    );
  });

  it('gives a requeued job a unique id so it is not swallowed as a duplicate', async () => {
    await service.requeueSms(MESSAGE_ID);

    const jobId = smsQueue.add.mock.calls[0][2].jobId as string;
    expect(jobId).not.toBe(MESSAGE_ID);
    expect(jobId.startsWith(`requeue-${MESSAGE_ID}-`)).toBe(true);
  });

  it('publishes only the message id to the dead letter queue', async () => {
    await service.enqueueDeadLetter(MESSAGE_ID);

    expect(smsDlqQueue.add).toHaveBeenCalledWith(
      FAILED_SMS_JOB_NAME,
      { messageId: MESSAGE_ID },
      expect.objectContaining({ removeOnComplete: false }),
    );
    expect(smsDlqQueue.add.mock.calls[0][1]).toEqual({ messageId: MESSAGE_ID });
  });
});
