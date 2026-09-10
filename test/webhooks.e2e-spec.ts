import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import Twilio from 'twilio';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { SmsProviderName } from '../src/modules/providers/sms-provider-name.enum';
import { SmsMessage } from '../src/modules/sms/entities/sms-message.entity';
import { SmsStatus } from '../src/modules/sms/entities/sms-status.enum';
import { BIRD_WEBHOOK_CLIENT_FACTORY } from '../src/modules/webhooks/signature/bird-webhook-client.tokens';
import { testBirdWebhookClientFactory } from './helpers/bird-webhook-unwrapper';
import {
  buildRedisConnectionOptions,
  buildTestQueuePrefix,
  deleteQueuePrefix,
  isolateBullQueues,
} from './helpers/bull-test-isolation';
import { buildWebhookSecret, signStandardWebhook } from './helpers/standard-webhooks.signer';

jest.setTimeout(20_000);

const PUBLIC_BASE_URL = 'https://sms.example.com';
const TWILIO_AUTH_TOKEN = 'twilio-auth-token-for-e2e';
const TWILIO_WEBHOOK_URL = `${PUBLIC_BASE_URL}/api/v1/webhooks/twilio`;
const TWILIO_WEBHOOK_PATH = '/api/v1/webhooks/twilio';
const BIRD_WEBHOOK_PATH = '/api/v1/webhooks/bird';
const BIRD_WEBHOOK_SECRET = buildWebhookSecret('bird-e2e-webhook-secret-32-bytes');

describe('Delivery webhooks (e2e)', () => {
  let app: INestApplication;
  let repository: Repository<SmsMessage>;
  let redis: Redis;

  // This suite does not enqueue anything, but booting AppModule still registers
  // a worker on the SMS queue. Isolating it keeps that worker from competing
  // with any other consumer on the same Redis.
  const queuePrefix = buildTestQueuePrefix('webhooks');

  beforeAll(async () => {
    process.env.PUBLIC_BASE_URL = PUBLIC_BASE_URL;
    process.env.TWILIO_AUTH_TOKEN = TWILIO_AUTH_TOKEN;
    process.env.BIRD_WEBHOOK_SECRET = BIRD_WEBHOOK_SECRET;
    process.env.BIRD_WEBHOOK_TOLERANCE_SECONDS = '300';
    process.env.WEBHOOK_IDEMPOTENCY_TTL_SECONDS = '86400';

    const moduleRef = await isolateBullQueues(
      Test.createTestingModule({
        imports: [AppModule],
      }),
      queuePrefix,
    )
      // The official Bird SDK is ESM-only and Jest's module runtime cannot load
      // it. The replacement still performs real Standard Webhooks verification.
      .overrideProvider(BIRD_WEBHOOK_CLIENT_FACTORY)
      .useValue(testBirdWebhookClientFactory)
      .compile();

    repository = moduleRef.get<Repository<SmsMessage>>(getRepositoryToken(SmsMessage));
    redis = new Redis({
      ...buildRedisConnectionOptions(),
      maxRetriesPerRequest: 3,
    });

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    await app.init();
  });

  beforeEach(async () => {
    await repository.clear();
    await deleteWebhookIdempotencyKeys();
  });

  afterAll(async () => {
    await app.close();
    await deleteQueuePrefix(redis, queuePrefix);
    await deleteWebhookIdempotencyKeys();
    await redis.quit();
  });

  describe('Twilio status callback', () => {
    it('marks a sent message as DELIVERED and records deliveredAt', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        sentAt: new Date('2026-09-09T10:00:00.000Z'),
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.deliveredAt).toBeInstanceOf(Date);
      expect(updated.failedAt).toBeNull();
      expect(updated.lastError).toBeNull();
      expect(updated.sentAt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
    });

    it.each([
      ['undelivered', SmsStatus.UNDELIVERED, '30003', 'TWILIO_ERROR_30003'],
      ['failed', SmsStatus.FAILED, undefined, 'TWILIO_STATUS_FAILED'],
    ])(
      'maps MessageStatus=%s to %s and records a sanitized lastError',
      async (messageStatus, expectedStatus, errorCode, expectedLastError) => {
        const message = await createMessage({
          status: SmsStatus.SENT,
          selectedProvider: SmsProviderName.TWILIO,
          providerMessageId: 'SM123',
          sentAt: new Date('2026-09-09T10:00:00.000Z'),
        });

        await postTwilioCallback({
          MessageSid: 'SM123',
          MessageStatus: messageStatus,
          ...(errorCode ? { ErrorCode: errorCode } : {}),
        }).expect(204);

        const updated = await findMessage(message.id);
        expect(updated.status).toBe(expectedStatus);
        expect(updated.failedAt).toBeInstanceOf(Date);
        expect(updated.deliveredAt).toBeNull();
        expect(updated.lastError).toBe(expectedLastError);
        expect(updated.sentAt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
      },
    );

    it('treats MessageStatus=sent as a no-op for a message already SENT', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        sentAt: new Date('2026-09-09T10:00:00.000Z'),
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'sent' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.SENT);
      expect(updated.sentAt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
    });

    it('rejects an invalid signature with 403 and leaves the message untouched', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
      });

      const response = await request(app.getHttpServer())
        .post(TWILIO_WEBHOOK_PATH)
        .type('form')
        .set('X-Twilio-Signature', 'not-the-right-signature')
        .send({ MessageSid: 'SM123', MessageStatus: 'delivered' })
        .expect(403);

      expect(response.body.code).toBe('WEBHOOK_TWILIO_SIGNATURE_INVALID');

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects a callback without a signature header with 403', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
      });

      await request(app.getHttpServer())
        .post(TWILIO_WEBHOOK_PATH)
        .type('form')
        .send({ MessageSid: 'SM123', MessageStatus: 'delivered' })
        .expect(403);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects a signature computed for tampered parameters with 403', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
      });
      const signature = Twilio.getExpectedTwilioSignature(TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_URL, {
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
      });

      await request(app.getHttpServer())
        .post(TWILIO_WEBHOOK_PATH)
        .type('form')
        .set('X-Twilio-Signature', signature)
        .send({ MessageSid: 'SM123', MessageStatus: 'failed' })
        .expect(403);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects a callback without MessageSid or MessageStatus with 400', async () => {
      await postTwilioCallback({ MessageSid: 'SM123' }).expect(400);
    });

    it('answers 204 for an unknown provider message id so Twilio does not retry', async () => {
      await postTwilioCallback({ MessageSid: 'SM_UNKNOWN', MessageStatus: 'delivered' }).expect(
        204,
      );

      await expect(repository.count()).resolves.toBe(0);
    });

    it('answers 204 and changes nothing for an unknown MessageStatus', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
      });

      await postTwilioCallback({
        MessageSid: 'SM123',
        MessageStatus: 'some_future_status',
      }).expect(204);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('is idempotent when the same delivered callback arrives twice', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);
      const afterFirst = await findMessage(message.id);

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);
      const afterSecond = await findMessage(message.id);

      expect(afterSecond.status).toBe(SmsStatus.DELIVERED);
      expect(afterSecond.deliveredAt).toEqual(afterFirst.deliveredAt);
    });

    it('never resolves a message that belongs to another provider', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'SM123',
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });
  });

  describe('Bird delivery events', () => {
    it('marks a sent message as DELIVERED and records deliveredAt from the event', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
        sentAt: new Date('2026-09-09T10:00:00.000Z'),
      });

      await postBirdEvent(buildBirdEvent('sms.delivered')).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.deliveredAt).toEqual(new Date('2026-09-09T10:15:30.000Z'));
      expect(updated.failedAt).toBeNull();
      expect(updated.lastError).toBeNull();
      expect(updated.sentAt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
    });

    it.each([
      ['sms.undelivered', SmsStatus.UNDELIVERED, 'BIRD_UNREACHABLE'],
      ['sms.failed', SmsStatus.FAILED, 'BIRD_UNREACHABLE'],
      ['sms.rejected', SmsStatus.REJECTED, 'BIRD_UNREACHABLE'],
      ['sms.expired', SmsStatus.UNDELIVERED, 'BIRD_UNREACHABLE'],
    ])('maps %s to %s', async (eventType, expectedStatus, expectedLastError) => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
        sentAt: new Date('2026-09-09T10:00:00.000Z'),
      });

      await postBirdEvent(
        buildBirdEvent(eventType, {
          error: {
            code: 'unreachable',
            description: 'Handset out of coverage',
            carrier_error_code: '21',
          },
        }),
      ).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(expectedStatus);
      expect(updated.failedAt).toEqual(new Date('2026-09-09T10:15:30.000Z'));
      expect(updated.lastError).toBe(expectedLastError);
      expect(updated.sentAt).toEqual(new Date('2026-09-09T10:00:00.000Z'));
    });

    it('applies sms.sent to a message that has not been marked sent yet', async () => {
      const message = await createMessage({
        status: SmsStatus.PROCESSING,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });

      await postBirdEvent(buildBirdEvent('sms.sent')).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.SENT);
      expect(updated.sentAt).toEqual(new Date('2026-09-09T10:15:30.000Z'));
    });

    it('rejects an invalid signature with 403 and leaves the message untouched', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });
      const payload = JSON.stringify(buildBirdEvent('sms.delivered'));
      const headers = signStandardWebhook({
        secret: buildWebhookSecret('some-other-secret-value-32-bytes'),
        payload,
      });

      await sendBirdRequest(payload, headers).expect(403);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects a delivery whose body was altered after signing with 403', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });
      const signedPayload = JSON.stringify(buildBirdEvent('sms.delivered'));
      const headers = signStandardWebhook({ secret: BIRD_WEBHOOK_SECRET, payload: signedPayload });
      const tamperedPayload = JSON.stringify(buildBirdEvent('sms.failed'));

      await sendBirdRequest(tamperedPayload, headers).expect(403);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects a replayed delivery whose timestamp is outside the tolerance with 403', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });
      const payload = JSON.stringify(buildBirdEvent('sms.delivered'));
      const headers = signStandardWebhook({
        secret: BIRD_WEBHOOK_SECRET,
        payload,
        timestampSeconds: Math.floor(Date.now() / 1000) - 3600,
      });

      await sendBirdRequest(payload, headers).expect(403);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
      'rejects a delivery without the %s header with 403',
      async (headerName) => {
        const payload = JSON.stringify(buildBirdEvent('sms.delivered'));
        const headers: Record<string, string> = signStandardWebhook({
          secret: BIRD_WEBHOOK_SECRET,
          payload,
        });
        delete headers[headerName];

        await sendBirdRequest(payload, headers).expect(403);
      },
    );

    it('processes a duplicated webhook-id only once', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });
      const payload = JSON.stringify(buildBirdEvent('sms.delivered'));
      const headers = signStandardWebhook({
        secret: BIRD_WEBHOOK_SECRET,
        payload,
        webhookId: 'msg_duplicate_abc',
      });

      await sendBirdRequest(payload, headers).expect(204);
      const afterFirst = await findMessage(message.id);

      await sendBirdRequest(payload, headers).expect(204);
      const afterSecond = await findMessage(message.id);

      expect(afterFirst.status).toBe(SmsStatus.DELIVERED);
      expect(afterSecond.status).toBe(SmsStatus.DELIVERED);
      expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
      await expect(redis.exists('sms:webhook:bird:msg_duplicate_abc')).resolves.toBe(1);
    });

    it('stays consistent when the same event is redelivered under a new webhook-id', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });
      const payload = JSON.stringify(buildBirdEvent('sms.delivered'));

      await postBirdEvent(buildBirdEvent('sms.delivered')).expect(204);
      const afterFirst = await findMessage(message.id);

      await sendBirdRequest(
        payload,
        signStandardWebhook({ secret: BIRD_WEBHOOK_SECRET, payload, webhookId: 'msg_other_id' }),
      ).expect(204);

      const afterSecond = await findMessage(message.id);
      expect(afterSecond.status).toBe(SmsStatus.DELIVERED);
      expect(afterSecond.deliveredAt).toEqual(afterFirst.deliveredAt);
    });

    it('answers 204 for an unknown sms id so Bird does not retry', async () => {
      await postBirdEvent(buildBirdEvent('sms.delivered', { sms_id: 'sms_unknown' })).expect(204);

      await expect(repository.count()).resolves.toBe(0);
    });

    it('answers 204 and changes nothing for an unknown event type', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
      });

      await postBirdEvent(buildBirdEvent('sms.some_future_event')).expect(204);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });

    it('rejects an event without an sms id with 400', async () => {
      await postBirdEvent({
        type: 'sms.delivered',
        timestamp: '2026-09-09T10:15:30.000Z',
        data: {},
      }).expect(400);
    });

    it('never resolves a message that belongs to another provider', async () => {
      const message = await createMessage({
        status: SmsStatus.SENT,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'sms_123',
      });

      await postBirdEvent(buildBirdEvent('sms.delivered')).expect(204);

      expect((await findMessage(message.id)).status).toBe(SmsStatus.SENT);
    });
  });

  describe('out-of-order callbacks', () => {
    it('does not let a late Twilio sent callback regress DELIVERED', async () => {
      const message = await createMessage({
        status: SmsStatus.DELIVERED,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        deliveredAt: new Date('2026-09-09T10:15:30.000Z'),
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'sent' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.deliveredAt).toEqual(new Date('2026-09-09T10:15:30.000Z'));
    });

    it('does not let a late Bird sms.sent event regress DELIVERED', async () => {
      const message = await createMessage({
        status: SmsStatus.DELIVERED,
        selectedProvider: SmsProviderName.BIRD,
        providerMessageId: 'sms_123',
        deliveredAt: new Date('2026-09-09T10:15:30.000Z'),
      });

      await postBirdEvent(buildBirdEvent('sms.sent')).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.deliveredAt).toEqual(new Date('2026-09-09T10:15:30.000Z'));
    });

    it('does not let a conflicting failure callback overwrite DELIVERED', async () => {
      const message = await createMessage({
        status: SmsStatus.DELIVERED,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        deliveredAt: new Date('2026-09-09T10:15:30.000Z'),
      });

      await postTwilioCallback({
        MessageSid: 'SM123',
        MessageStatus: 'failed',
        ErrorCode: '30008',
      }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.failedAt).toBeNull();
      expect(updated.lastError).toBeNull();
    });

    it('lets DELIVERED upgrade a previously recorded non-delivery', async () => {
      const message = await createMessage({
        status: SmsStatus.UNDELIVERED,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        failedAt: new Date('2026-09-09T10:10:00.000Z'),
        lastError: 'TWILIO_ERROR_30003',
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.DELIVERED);
      expect(updated.failedAt).toBeNull();
      expect(updated.lastError).toBeNull();
    });

    it('keeps the first terminal failure when a different one arrives later', async () => {
      const message = await createMessage({
        status: SmsStatus.UNDELIVERED,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        lastError: 'TWILIO_ERROR_30003',
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'failed' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.UNDELIVERED);
      expect(updated.lastError).toBe('TWILIO_ERROR_30003');
    });

    it('never lets a delivery callback change a FATAL_FAILURE message', async () => {
      const message = await createMessage({
        status: SmsStatus.FATAL_FAILURE,
        selectedProvider: SmsProviderName.TWILIO,
        providerMessageId: 'SM123',
        lastError: 'twilio unavailable',
      });

      await postTwilioCallback({ MessageSid: 'SM123', MessageStatus: 'delivered' }).expect(204);

      const updated = await findMessage(message.id);
      expect(updated.status).toBe(SmsStatus.FATAL_FAILURE);
      expect(updated.deliveredAt).toBeNull();
    });
  });

  function postTwilioCallback(params: Record<string, string>): request.Test {
    const signature = Twilio.getExpectedTwilioSignature(
      TWILIO_AUTH_TOKEN,
      TWILIO_WEBHOOK_URL,
      params,
    );

    return request(app.getHttpServer())
      .post(TWILIO_WEBHOOK_PATH)
      .type('form')
      .set('X-Twilio-Signature', signature)
      .send(params);
  }

  function buildBirdEvent(
    type: string,
    data: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type,
      timestamp: '2026-09-09T10:15:30.000Z',
      data: {
        sms_id: 'sms_123',
        workspace_id: 'wrk_1',
        to: '+14155552671',
        from: '+14155550100',
        ...data,
      },
    };
  }

  function postBirdEvent(event: Record<string, unknown>): request.Test {
    const payload = JSON.stringify(event);

    return sendBirdRequest(payload, signStandardWebhook({ secret: BIRD_WEBHOOK_SECRET, payload }));
  }

  function sendBirdRequest(payload: string, headers: Record<string, string>): request.Test {
    const pending = request(app.getHttpServer())
      .post(BIRD_WEBHOOK_PATH)
      .set('Content-Type', 'application/json');

    for (const [name, value] of Object.entries(headers)) {
      pending.set(name, value);
    }

    return pending.send(payload);
  }

  async function findMessage(messageId: string): Promise<SmsMessage> {
    const message = await repository.findOne({ where: { id: messageId } });

    if (!message) {
      throw new Error(`SMS message ${messageId} was not found.`);
    }

    return message;
  }

  async function createMessage(overrides: Partial<SmsMessage> = {}): Promise<SmsMessage> {
    return repository.save(
      repository.create({
        idempotencyKey: `webhook-e2e-${randomUUID()}`,
        recipientPhone: '+14155552671',
        messageBody: 'Your verification code is 482019',
        metadata: null,
        status: SmsStatus.QUEUED,
        attempts: 1,
        selectedProvider: null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        deliveredAt: null,
        failedAt: null,
        ...overrides,
      }),
    );
  }

  async function deleteWebhookIdempotencyKeys(): Promise<void> {
    const keys = await redis.keys('sms:webhook:*');

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
});
