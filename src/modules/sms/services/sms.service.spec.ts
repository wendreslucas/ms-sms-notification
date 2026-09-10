import { ConflictException, NotFoundException } from '@nestjs/common';
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
  requeueSms: jest.Mock<Promise<void>, [string]>;
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
      requeueSms: jest.fn(async (_messageId: string) => undefined),
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

  it('requeues a fatal failure without resetting attempts or creating a new message', async () => {
    const fatalMessage = buildMessage({
      status: SmsStatus.FATAL_FAILURE,
      attempts: 6,
      selectedProvider: 'bird',
      lastError: 'bird unavailable',
      failedAt: new Date('2026-08-05T21:35:00.000Z'),
    });
    repository.findOne.mockResolvedValue(fatalMessage);
    repository.update.mockResolvedValue({ affected: 1 });

    const response = await service.requeue(fatalMessage.id);

    expect(repository.update).toHaveBeenCalledWith(
      { id: fatalMessage.id, status: SmsStatus.FATAL_FAILURE },
      expect.objectContaining({
        status: SmsStatus.QUEUED,
        selectedProvider: null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        failedAt: null,
      }),
    );
    expect(queueService.requeueSms).toHaveBeenCalledWith(fatalMessage.id);
    expect(repository.create).not.toHaveBeenCalled();
    expect(response).toEqual({
      status: 'success',
      data: {
        messageId: fatalMessage.id,
        status: SmsStatus.QUEUED,
        createdAt: '2026-08-05T21:30:00.000Z',
      },
    });
  });

  it('returns only tracking fields for an existing message', async () => {
    repository.findOne.mockResolvedValue(
      buildMessage({
        status: SmsStatus.SENT,
        attempts: 4,
        selectedProvider: 'bird',
        providerMessageId: 'external-id',
        sentAt: new Date('2026-08-05T21:30:02.000Z'),
      }),
    );

    const response = await service.getMessageStatus('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(response).toEqual({
      status: 'success',
      data: {
        messageId: 'c8d488e9-f308-43e8-8df0cb5134ef',
        status: SmsStatus.SENT,
        attempts: 4,
        selectedProvider: 'bird',
        providerMessageId: 'external-id',
        createdAt: '2026-08-05T21:30:00.000Z',
        sentAt: '2026-08-05T21:30:02.000Z',
        deliveredAt: null,
        failedAt: null,
      },
    });
  });

  it('never exposes the recipient, the body, the metadata or the idempotency key', async () => {
    repository.findOne.mockResolvedValue(buildMessage({ status: SmsStatus.DELIVERED }));

    const response = await service.getMessageStatus('c8d488e9-f308-43e8-8df0cb5134ef');
    const serialized = JSON.stringify(response);

    for (const field of ['recipientPhone', 'messageBody', 'metadata', 'idempotencyKey']) {
      expect(response.data).not.toHaveProperty(field);
    }
    expect(serialized).not.toContain('+14155552671');
    expect(serialized).not.toContain('Your verification code is 482019');
    expect(serialized).not.toContain('idem-key');
    expect(serialized).not.toContain('usr_123456');
  });

  it('reports unset timestamps as null rather than omitting them', async () => {
    repository.findOne.mockResolvedValue(buildMessage({ status: SmsStatus.QUEUED }));

    const response = await service.getMessageStatus('c8d488e9-f308-43e8-8df0cb5134ef');

    expect(response.data).toMatchObject({
      status: SmsStatus.QUEUED,
      selectedProvider: null,
      providerMessageId: null,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
    });
  });

  it('rejects a status lookup when the message does not exist', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.getMessageStatus('c8d488e9-f308-43e8-8df0cb5134ef'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects requeue when the message does not exist', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.requeue('missing-id')).rejects.toBeInstanceOf(NotFoundException);

    expect(queueService.requeueSms).not.toHaveBeenCalled();
  });

  it('rejects requeue when the message is not in fatal failure', async () => {
    repository.findOne.mockResolvedValue(buildMessage({ status: SmsStatus.SENT }));

    await expect(service.requeue('c8d488e9-f308-43e8-8df0cb5134ef')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(queueService.requeueSms).not.toHaveBeenCalled();
  });

  it('rejects concurrent requeue when the atomic transition loses the race', async () => {
    repository.findOne.mockResolvedValue(buildMessage({ status: SmsStatus.FATAL_FAILURE }));
    repository.update.mockResolvedValue({ affected: 0 });

    await expect(service.requeue('c8d488e9-f308-43e8-8df0cb5134ef')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(queueService.requeueSms).not.toHaveBeenCalled();
  });

  it('restores fatal failure when requeue job publication fails', async () => {
    const fatalMessage = buildMessage({
      status: SmsStatus.FATAL_FAILURE,
      selectedProvider: 'bird',
      lastError: 'bird unavailable',
      failedAt: new Date('2026-08-05T21:35:00.000Z'),
    });
    repository.findOne.mockResolvedValue(fatalMessage);
    repository.update.mockResolvedValue({ affected: 1 });
    queueService.requeueSms.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.requeue(fatalMessage.id)).rejects.toBeInstanceOf(QueuePublishException);

    expect(repository.update).toHaveBeenNthCalledWith(
      2,
      { id: fatalMessage.id },
      expect.objectContaining({
        status: SmsStatus.FATAL_FAILURE,
        selectedProvider: 'bird',
        lastError: 'REQUEUE_PUBLISH_FAILED: redis unavailable',
      }),
    );
  });
});
