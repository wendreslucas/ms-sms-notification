import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../src/app.module';
import { SMS_QUEUE_NAME } from '../src/modules/queue/queue.constants';
import { ProviderRegistryService } from '../src/modules/providers/provider-registry.service';
import { ISmsProvider } from '../src/modules/providers/interfaces/sms-provider.interface';
import { SmsProviderName } from '../src/modules/providers/sms-provider-name.enum';
import { SmsMessage } from '../src/modules/sms/entities/sms-message.entity';
import { SmsStatus } from '../src/modules/sms/entities/sms-status.enum';

describe('SMS send flow (e2e)', () => {
  let app: INestApplication;
  let repository: Repository<SmsMessage>;
  let smsQueue: Queue;
  let redis: Redis;
  let provider: ISmsProvider;

  beforeAll(async () => {
    provider = {
      providerName: SmsProviderName.TWILIO,
      sendSms: jest.fn(async () => ({
        success: true,
        providerMessageId: 'SM_E2E',
        isRetryable: false,
      })),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderRegistryService)
      .useValue({
        getPrimaryProvider: () => provider,
        getProviders: () => [provider],
      })
      .compile();

    repository = moduleRef.get<Repository<SmsMessage>>(getRepositoryToken(SmsMessage));
    smsQueue = moduleRef.get<Queue>(getQueueToken(SMS_QUEUE_NAME));
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6380),
      maxRetriesPerRequest: 3,
    });
    await cleanupStateBeforeWorkerStart();

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
  });

  beforeEach(async () => {
    await cleanupState();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
  });

  it('accepts a valid request, persists one message and the worker sends it', async () => {
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
    expect(sentMessage.selectedProvider).toBe(SmsProviderName.TWILIO);
    expect(sentMessage.providerMessageId).toBe('SM_E2E');
    expect(sentMessage.attempts).toBe(1);
    expect(sentMessage.sentAt).toBeInstanceOf(Date);

    const ttl = await redis.ttl('sms:idempotency:e2e-valid-request');
    expect(ttl).toBeGreaterThan(0);

    expect(provider.sendSms).toHaveBeenCalledTimes(1);
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
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
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
    for (let attempt = 0; attempt < 40; attempt += 1) {
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
    await smsQueue.drain(true);
    await smsQueue.clean(0, 1000, 'completed');
    await smsQueue.clean(0, 1000, 'failed');
    await deleteIdempotencyKeys();
    await repository.clear();
  }

  async function cleanupStateBeforeWorkerStart(): Promise<void> {
    await redis.flushdb();
    await repository.clear();
  }

  async function deleteIdempotencyKeys(): Promise<void> {
    const keys = await redis.keys('sms:idempotency*');

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
});
