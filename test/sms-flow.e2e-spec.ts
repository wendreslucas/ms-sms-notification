import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';

import { AppModule } from '../src/app.module';
import {
  FAILED_SMS_JOB_NAME,
  SMS_DLQ_QUEUE_NAME,
  SMS_QUEUE_NAME,
} from '../src/modules/queue/queue.constants';
import { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';
import { ISmsProvider } from '../src/modules/providers/interfaces/sms-provider.interface';
import { SmsProviderName } from '../src/modules/providers/sms-provider-name.enum';
import { ProviderRateLimiterService } from '../src/modules/providers/rate-limiting/provider-rate-limiter.service';
import { SmsProcessor } from '../src/modules/queue/processors/sms.processor';
import { SmsMessage } from '../src/modules/sms/entities/sms-message.entity';
import { SmsStatus } from '../src/modules/sms/entities/sms-status.enum';
import {
  buildRedisConnectionOptions,
  buildTestQueuePrefix,
  deleteApplicationKeys,
  deleteQueuePrefix,
  isolateBullQueues,
  resetQueue,
  waitForNoActiveJobs,
} from './helpers/bull-test-isolation';

jest.setTimeout(20_000);

describe('SMS send flow (e2e)', () => {
  let app: INestApplication;
  let repository: Repository<SmsMessage>;
  let smsQueue: Queue;
  let smsDlqQueue: Queue;
  let redis: Redis;
  let smsProcessor: SmsProcessor;
  let twilioProvider: ISmsProvider;
  let birdProvider: ISmsProvider;

  const queuePrefix = buildTestQueuePrefix('sms-flow');

  beforeAll(async () => {
    process.env.SMS_PROVIDER_PRIORITY = 'twilio,bird';
    process.env.SMS_MAX_RETRIES = '3';
    process.env.SMS_RETRY_BASE_DELAY_MS = '1';
    process.env.TWILIO_RATE_LIMIT_MAX = '100';
    process.env.TWILIO_RATE_LIMIT_DURATION_MS = '1000';
    process.env.BIRD_RATE_LIMIT_MAX = '100';
    process.env.BIRD_RATE_LIMIT_DURATION_MS = '1000';

    twilioProvider = {
      providerName: SmsProviderName.TWILIO,
      sendSms: jest.fn(async () => ({
        success: true,
        providerMessageId: 'SM_E2E',
        isRetryable: false,
      })),
    };
    birdProvider = {
      providerName: SmsProviderName.BIRD,
      sendSms: jest.fn(async () => ({
        success: true,
        providerMessageId: 'BIRD_E2E',
        isRetryable: false,
      })),
    };
    const moduleRef = await isolateBullQueues(
      Test.createTestingModule({
        imports: [AppModule],
      }),
      queuePrefix,
    )
      .overrideProvider(ProviderRegistryService)
      .useValue({
        getPrimaryProvider: () => twilioProvider,
        getProviders: () => [twilioProvider, birdProvider],
      })
      .overrideProvider(ProviderRateLimiterService)
      .useValue({
        throttle: jest.fn(async (_providerName: string) => undefined),
      })
      .compile();

    repository = moduleRef.get<Repository<SmsMessage>>(getRepositoryToken(SmsMessage));
    smsQueue = moduleRef.get<Queue>(getQueueToken(SMS_QUEUE_NAME));
    smsDlqQueue = moduleRef.get<Queue>(getQueueToken(SMS_DLQ_QUEUE_NAME));
    smsProcessor = moduleRef.get(SmsProcessor);
    redis = new Redis({
      ...buildRedisConnectionOptions(),
      maxRetriesPerRequest: 3,
    });
    await repository.clear();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // The worker opens its own blocking connection asynchronously. Enqueuing
    // before it is listening leaves the job waiting for the next poll cycle.
    await Promise.all([
      smsQueue.waitUntilReady(),
      smsDlqQueue.waitUntilReady(),
      smsProcessor.worker.waitUntilReady(),
    ]);
  });

  beforeEach(async () => {
    await cleanupState();
    configureFailoverSuccess();
  });

  afterAll(async () => {
    // Close the app first so its workers and Redis connections are gone before
    // the run's queue namespace is removed.
    await app.close();
    await deleteQueuePrefix(redis, queuePrefix);
    await deleteApplicationKeys(redis);
    await redis.quit();
  });

  it('accepts a valid request, persists one message and the worker fails over to Bird', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .set('X-Idempotency-Key', 'e2e-valid-request')
      .send({
        to: '+14155552671',
        message: 'Your verification code is 482019',
        metadata: {
          userId: 'usr_123456',
          purpose: 'OTP',
        },
      })
      .expect(202);

    expect(response.body.status).toBe('success');
    expect(response.body.data.status).toBe(SmsStatus.QUEUED);

    const sentMessage = await waitForMessageStatus(response.body.data.messageId, SmsStatus.SENT);
    const messages = await repository.find();
    expect(messages).toHaveLength(1);
    expect(sentMessage.selectedProvider).toBe(SmsProviderName.BIRD);
    expect(sentMessage.providerMessageId).toBe('BIRD_E2E');
    expect(sentMessage.attempts).toBe(4);
    expect(sentMessage.sentAt).toBeInstanceOf(Date);

    const ttl = await redis.ttl('sms:idempotency:e2e-valid-request');
    expect(ttl).toBeGreaterThan(0);

    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
  });

  it('returns the same message for duplicate idempotency keys without duplicate records or jobs', async () => {
    const payload = {
      to: '+14155552671',
      message: 'Your verification code is 482019',
    };

    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .set('X-Idempotency-Key', 'e2e-duplicate-request')
      .send(payload)
      .expect(202);

    const secondResponse = await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .set('X-Idempotency-Key', 'e2e-duplicate-request')
      .send(payload)
      .expect(202);

    expect(secondResponse.body.data.messageId).toBe(firstResponse.body.data.messageId);
    await expect(repository.count()).resolves.toBe(1);

    await waitForMessageStatus(firstResponse.body.data.messageId, SmsStatus.SENT);
    expect(twilioProvider.sendSms).toHaveBeenCalledTimes(3);
    expect(birdProvider.sendSms).toHaveBeenCalledTimes(1);
  });

  it('moves exhausted messages to DLQ and requeues the same message explicitly', async () => {
    configureAllProvidersFailRetryable();

    const response = await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .set('X-Idempotency-Key', 'e2e-fatal-then-requeue')
      .send({
        to: '+14155552671',
        message: 'Your verification code is 482019',
      })
      .expect(202);

    const messageId = response.body.data.messageId;
    const fatalMessage = await waitForMessageStatus(messageId, SmsStatus.FATAL_FAILURE);

    expect(fatalMessage.attempts).toBe(6);
    expect(fatalMessage.failedAt).toBeInstanceOf(Date);
    expect(fatalMessage.lastError).toBe('bird unavailable');
    expect(fatalMessage.selectedProvider).toBe(SmsProviderName.BIRD);

    const dlqJobs = await smsDlqQueue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const dlqJob = dlqJobs.find((job) => job.data.messageId === messageId);
    expect(dlqJob).toBeDefined();
    expect(dlqJob?.name).toBe(FAILED_SMS_JOB_NAME);
    expect(dlqJob?.data).toEqual({ messageId });
    expect(dlqJob?.data).not.toHaveProperty('recipientPhone');
    expect(dlqJob?.data).not.toHaveProperty('messageBody');
    expect(dlqJob?.data).not.toHaveProperty('metadata');

    configureTwilioSuccess();

    await request(app.getHttpServer()).post(`/api/v1/admin/sms/${messageId}/requeue`).expect(202);

    const sentMessage = await waitForMessageStatus(messageId, SmsStatus.SENT);
    expect(sentMessage.idempotencyKey).toBe('e2e-fatal-then-requeue');
    expect(sentMessage.attempts).toBe(7);
    expect(sentMessage.selectedProvider).toBe(SmsProviderName.TWILIO);
    expect(sentMessage.providerMessageId).toBe('SM_REQUEUED');
    await expect(repository.count()).resolves.toBe(1);
  });

  it('rejects requeue for sent messages', async () => {
    const sentMessage = await createMessage({ status: SmsStatus.SENT });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/sms/${sentMessage.id}/requeue`)
      .expect(409);
  });

  it('returns 404 when requeue message does not exist', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/sms/${randomUUID()}/requeue`)
      .expect(404);
  });

  it('prevents concurrent requeue from creating duplicate jobs', async () => {
    const fatalMessage = await createMessage({
      status: SmsStatus.FATAL_FAILURE,
      selectedProvider: SmsProviderName.BIRD,
      lastError: 'bird unavailable',
      failedAt: new Date(),
      attempts: 6,
    });

    await smsQueue.pause();

    try {
      const responses = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/admin/sms/${fatalMessage.id}/requeue`),
        request(app.getHttpServer()).post(`/api/v1/admin/sms/${fatalMessage.id}/requeue`),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);

      const queuedJobs = await smsQueue.getJobs(['waiting', 'delayed']);
      const messageJobs = queuedJobs.filter((job) => job.data.messageId === fatalMessage.id);
      expect(messageJobs).toHaveLength(1);
    } finally {
      await smsQueue.resume();
    }
  });

  it('rejects an invalid phone number', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .set('X-Idempotency-Key', 'e2e-invalid-phone')
      .send({
        to: '14155552671',
        message: 'Your verification code is 482019',
      })
      .expect(400);
  });

  it('rejects a missing idempotency key header', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sms/send')
      .send({
        to: '+14155552671',
        message: 'Your verification code is 482019',
      })
      .expect(400);
  });

  async function waitForMessageStatus(messageId: string, status: SmsStatus): Promise<SmsMessage> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const message = await repository.findOne({ where: { id: messageId } });

      if (message?.status === status) {
        return message;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }

    throw new Error(`Message ${messageId} did not reach status ${status}.`);
  }

  async function cleanupState(): Promise<void> {
    // A dispatch left running by the previous test would keep writing to
    // sms_messages after the truncate below, so let it finish first.
    await waitForNoActiveJobs(smsQueue);
    await resetQueue(smsQueue);
    await resetQueue(smsDlqQueue);
    await deleteApplicationKeys(redis);
    await repository.clear();
  }

  function configureFailoverSuccess(): void {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'BIRD_E2E',
      isRetryable: false,
    }));
  }

  function configureAllProvidersFailRetryable(): void {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'twilio unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: false,
      error: 'bird unavailable',
      isRetryable: true,
      retryAfterMs: 1,
    }));
  }

  function configureTwilioSuccess(): void {
    twilioProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'SM_REQUEUED',
      isRetryable: false,
    }));
    birdProvider.sendSms = jest.fn(async () => ({
      success: true,
      providerMessageId: 'BIRD_REQUEUED',
      isRetryable: false,
    }));
  }

  async function createMessage(overrides: Partial<SmsMessage> = {}): Promise<SmsMessage> {
    const message = repository.create({
      idempotencyKey: `e2e-${randomUUID()}`,
      recipientPhone: '+14155552671',
      messageBody: 'Your verification code is 482019',
      metadata: null,
      status: SmsStatus.QUEUED,
      attempts: 0,
      selectedProvider: null,
      providerMessageId: null,
      lastError: null,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      ...overrides,
    });

    return repository.save(message);
  }
});
