import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';

import { QueuePublishException } from '../../../common/exceptions/queue-publish.exception';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import { QueueService } from '../../queue/queue.service';
import { SendSmsDto } from '../dto/send-sms.dto';
import { SmsMessage } from '../entities/sms-message.entity';
import { SmsStatus } from '../entities/sms-status.enum';
import { SmsService } from './sms.service';

type SmsRepositoryMock = {
  findOne: jest.Mock<Promise<SmsMessage | null>, [unknown]>;
  create: jest.Mock<SmsMessage, [Partial<SmsMessage>]>;
  save: jest.Mock<Promise<SmsMessage>, [SmsMessage]>;
  update: jest.Mock<Promise<unknown>, [unknown, unknown]>;
};

type IdempotencyServiceMock = {
  getMessageId: jest.Mock<Promise<string | null>, [string]>;
  storeMessageId: jest.Mock<Promise<void>, [string, string]>;
  deleteMessageId: jest.Mock<Promise<void>, [string]>;
  acquireLock: jest.Mock<Promise<{ key: string; token: string } | null>, [string]>;
  releaseLock: jest.Mock<Promise<void>, [{ key: string; token: string }]>;
};

type QueueServiceMock = {
  enqueueSms: jest.Mock<Promise<void>, [string]>;
};

const dto: SendSmsDto = {
  to: '+14155552671',
  message: 'Your verification code is 482019',
  metadata: {
    userId: 'usr_123456',
    purpose: 'OTP',
  },
};

function buildMessage(overrides: Partial<SmsMessage> = {}): SmsMessage {
  const now = new Date('2026-08-05T21:30:00.000Z');

  return {
    id: 'c8d488e9-f308-43e8-8df0cb5134ef',
    idempotencyKey: 'idem-key',
    recipientPhone: '+14155552671',
    messageBody: 'Your verification code is 482019',
    metadata: {
      userId: 'usr_123456',
      purpose: 'OTP',
    },
    status: SmsStatus.QUEUED,
    attempts: 0,
    selectedProvider: null,
    providerMessageId: null,
    lastError: null,
    sentAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SmsService', () => {
  let service: SmsService;
  let repository: SmsRepositoryMock;
  let idempotencyService: IdempotencyServiceMock;
  let queueService: QueueServiceMock;

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn((message) => buildMessage(message)),
      save: jest.fn(async (message) => message),
      update: jest.fn(async (_criteria: unknown, _partialEntity: unknown) => ({ affected: 1 })),
    };

    idempotencyService = {
      getMessageId: jest.fn(async (_idempotencyKey: string) => null),
      storeMessageId: jest.fn(async (_idempotencyKey: string, _messageId: string) => undefined),
      deleteMessageId: jest.fn(async (_idempotencyKey: string) => undefined),
      acquireLock: jest.fn(async (_idempotencyKey: string) => ({
        key: 'sms:idempotency-lock:idem-key',
        token: 'token',
      })),
      releaseLock: jest.fn(async (_lock: { key: string; token: string }) => undefined),
    };

    queueService = {
      enqueueSms: jest.fn(async (_messageId: string) => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(() => 1600),
          },
        },
        {
          provide: IdempotencyService,
          useValue: idempotencyService,
        },
        {
          provide: QueueService,
          useValue: queueService,
        },
        {
          provide: getRepositoryToken(SmsMessage),
          useValue: repository,
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(SmsService);
  });

  it('creates a queued message, publishes a job and returns tracking data', async () => {
    repository.findOne.mockResolvedValue(null);

    const response = await service.sendSmsRequest('idem-key', dto);

    expect(repository.create).toHaveBeenCalledWith({
      idempotencyKey: 'idem-key',
      recipientPhone: dto.to,
      messageBody: dto.message,
      metadata: dto.metadata,
      status: SmsStatus.QUEUED,
      attempts: 0,
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(queueService.enqueueSms).toHaveBeenCalledWith('c8d488e9-f308-43e8-8df0cb5134ef');
    expect(idempotencyService.storeMessageId).toHaveBeenCalledWith(
      'idem-key',
      'c8d488e9-f308-43e8-8df0cb5134ef',
    );
    expect(response).toEqual({
      status: 'success',
      data: {
        messageId: 'c8d488e9-f308-43e8-8df0cb5134ef',
        status: SmsStatus.QUEUED,
        createdAt: '2026-08-05T21:30:00.000Z',
      },
    });
  });

  it('returns an existing message for duplicate idempotency keys without creating or enqueueing', async () => {
    const existingMessage = buildMessage();
    repository.findOne.mockResolvedValue(existingMessage);

    const response = await service.sendSmsRequest('idem-key', dto);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(queueService.enqueueSms).not.toHaveBeenCalled();
    expect(response.data.messageId).toBe(existingMessage.id);
  });

  it('marks the message failed and throws when enqueue fails', async () => {
    repository.findOne.mockResolvedValue(null);
    queueService.enqueueSms.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.sendSmsRequest('idem-key', dto)).rejects.toBeInstanceOf(
      QueuePublishException,
    );

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'c8d488e9-f308-43e8-8df0cb5134ef' },
      expect.objectContaining({
        status: SmsStatus.FAILED,
        lastError: 'QUEUE_PUBLISH_FAILED',
      }),
    );
  });

  it('recovers the existing message when PostgreSQL reports a unique constraint conflict', async () => {
    const existingMessage = buildMessage({ id: 'existing-id' });
    const driverError = Object.assign(new Error('unique violation'), { code: '23505' });
    const uniqueViolation = new QueryFailedError('INSERT INTO sms_messages', [], driverError);

    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingMessage);
    repository.save.mockRejectedValue(uniqueViolation);

    const response = await service.sendSmsRequest('idem-key', dto);

    expect(queueService.enqueueSms).not.toHaveBeenCalled();
    expect(response.data.messageId).toBe('existing-id');
  });
});
