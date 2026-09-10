import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { QueryFailedError, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { IdempotencyConflictError } from '../../../common/errors/idempotency-conflict-error';
import { QueuePublishFailedError } from '../../../common/errors/queue-publish-failed-error';
import { RequeueConflictError } from '../../../common/errors/requeue-conflict-error';
import { RequeueNotEligibleError } from '../../../common/errors/requeue-not-eligible-error';
import { SmsMessageNotFoundError } from '../../../common/errors/sms-message-not-found-error';
import { SmsMessageTooLongError } from '../../../common/errors/sms-message-too-long-error';
import { maskPhoneNumber } from '../../../common/utils/mask-phone-number';
import { IdempotencyLock, IdempotencyService } from '../../idempotency/idempotency.service';
import { QueueService } from '../../queue/queue.service';
import { SendSmsDto } from '../dto/send-sms.dto';
import { SendSmsResponseDto } from '../dto/send-sms-response.dto';
import { RequeueSmsResponseDto } from '../dto/requeue-sms-response.dto';
import { SmsStatusResponseDto } from '../dto/sms-status-response.dto';
import { SmsMessage } from '../entities/sms-message.entity';
import { SmsStatus } from '../entities/sms-status.enum';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const QUEUE_PUBLISH_FAILED_ERROR = 'QUEUE_PUBLISH_FAILED';
const REQUEUE_PUBLISH_FAILED_ERROR = 'REQUEUE_PUBLISH_FAILED';

interface QueryFailedDriverError {
  code?: string;
}

export interface ApplyDeliveryStatusParams {
  messageId: string;
  status: SmsStatus;
  allowedPreviousStatuses: SmsStatus[];
  lastError: string | null;
  deliveredAt?: Date | null;
  failedAt?: Date | null;
  sentAtWhenMissing?: Date;
}

@Injectable()
export class SmsService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly queueService: QueueService,
    @InjectRepository(SmsMessage)
    private readonly smsMessageRepository: Repository<SmsMessage>,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.logger.setContext(SmsService.name);
  }

  async sendSmsRequest(idempotencyKey: string, dto: SendSmsDto): Promise<SendSmsResponseDto> {
    this.validateMessageLength(dto.message);

    const cachedMessage = await this.findFromIdempotencyCache(idempotencyKey);
    if (cachedMessage) {
      this.logIdempotencyHit(cachedMessage);
      return this.toResponse(cachedMessage);
    }

    const existingMessage = await this.findByIdempotencyKey(idempotencyKey);
    if (existingMessage) {
      await this.idempotencyService.storeMessageId(idempotencyKey, existingMessage.id);
      this.logIdempotencyHit(existingMessage);
      return this.toResponse(existingMessage);
    }

    const lock = await this.idempotencyService.acquireLock(idempotencyKey);
    if (!lock) {
      this.logger.warn({ event: LogEvent.IDEMPOTENCY_CONFLICT, idempotencyKey });
      const messageCreatedByConcurrentRequest =
        await this.waitForMessageCreatedByConcurrentRequest(idempotencyKey);

      if (messageCreatedByConcurrentRequest) {
        this.logIdempotencyHit(messageCreatedByConcurrentRequest);
        return this.toResponse(messageCreatedByConcurrentRequest);
      }

      throw new IdempotencyConflictError();
    }

    this.logger.info({ event: LogEvent.IDEMPOTENCY_LOCK_ACQUIRED, idempotencyKey });

    try {
      const messageAfterLock = await this.findByIdempotencyKey(idempotencyKey);
      if (messageAfterLock) {
        await this.idempotencyService.storeMessageId(idempotencyKey, messageAfterLock.id);
        this.logIdempotencyHit(messageAfterLock);
        return this.toResponse(messageAfterLock);
      }

      const message = await this.createQueuedMessage(idempotencyKey, dto);

      try {
        await this.queueService.enqueueSms(message.id);
      } catch (error) {
        await this.markQueuePublishFailed(message.id);
        this.logger.error(
          {
            event: LogEvent.QUEUE_PUBLISH_FAILED,
            messageId: message.id,
            err: this.toErrorMessage(error),
          },
          'Failed to publish SMS job to BullMQ',
        );
        throw new QueuePublishFailedError();
      }

      await this.idempotencyService.storeMessageId(idempotencyKey, message.id);
      this.logger.info(
        {
          event: LogEvent.MESSAGE_QUEUED,
          messageId: message.id,
          phone: maskPhoneNumber(message.recipientPhone),
        },
        'SMS message queued',
      );

      return this.toResponse(message);
    } catch (error) {
      const existingAfterUniqueViolation = await this.findExistingAfterUniqueViolation(
        idempotencyKey,
        error,
      );

      if (existingAfterUniqueViolation) {
        await this.idempotencyService.storeMessageId(
          idempotencyKey,
          existingAfterUniqueViolation.id,
        );
        this.logIdempotencyHit(existingAfterUniqueViolation);
        return this.toResponse(existingAfterUniqueViolation);
      }

      throw error;
    } finally {
      await this.releaseLock(lock);
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SmsMessage | null> {
    return this.smsMessageRepository.findOne({
      where: {
        idempotencyKey,
      },
    });
  }

  async createQueuedMessage(idempotencyKey: string, dto: SendSmsDto): Promise<SmsMessage> {
    const message = this.smsMessageRepository.create({
      idempotencyKey,
      recipientPhone: dto.to,
      messageBody: dto.message,
      metadata: dto.metadata ?? null,
      status: SmsStatus.QUEUED,
      attempts: 0,
    });

    return this.smsMessageRepository.save(message);
  }

  /**
   * Locates a message from a provider delivery callback.
   *
   * The provider is part of the lookup on purpose: external message ids are only
   * unique per vendor, so a Bird id must never resolve a Twilio message. Delivery
   * callbacks are never resolved by phone number.
   */
  async findByProviderMessageId(
    provider: string,
    providerMessageId: string,
  ): Promise<SmsMessage | null> {
    return this.smsMessageRepository.findOne({
      where: {
        selectedProvider: provider,
        providerMessageId,
      },
    });
  }

  /**
   * Applies a delivery status coming from a provider webhook as a single
   * conditional UPDATE.
   *
   * The caller supplies the statuses the message is allowed to be in before the
   * transition, which makes duplicate and out-of-order callbacks no-ops at the
   * database level instead of relying on a read-then-write race. Returns whether
   * a row was actually changed.
   */
  async applyDeliveryStatus(params: ApplyDeliveryStatusParams): Promise<boolean> {
    const updateValues: QueryDeepPartialEntity<SmsMessage> = {
      status: params.status,
      lastError: params.lastError,
    };

    if (params.deliveredAt !== undefined) {
      updateValues.deliveredAt = params.deliveredAt;
    }

    if (params.failedAt !== undefined) {
      updateValues.failedAt = params.failedAt;
    }

    const queryBuilder = this.smsMessageRepository
      .createQueryBuilder()
      .update(SmsMessage)
      .set(updateValues)
      .where('id = :messageId', { messageId: params.messageId })
      .andWhere('status IN (:...allowedPreviousStatuses)', {
        allowedPreviousStatuses: params.allowedPreviousStatuses,
      });

    if (params.sentAtWhenMissing) {
      // A message accepted by the provider keeps its original sentAt; the
      // fallback only fills the column when the send flow never set it.
      queryBuilder
        .set({
          ...updateValues,
          sentAt: () => 'COALESCE("sent_at", :sentAtFallback)',
        })
        .setParameter('sentAtFallback', params.sentAtWhenMissing);
    }

    const updateResult = await queryBuilder.execute();

    return (updateResult.affected ?? 0) > 0;
  }

  /**
   * Tracking view of a single message, reusing the existing lookup.
   *
   * Only status fields are exposed; the recipient, the body, the metadata and
   * the idempotency key never leave the service.
   */
  async getMessageStatus(messageId: string): Promise<SmsStatusResponseDto> {
    const message = await this.findById(messageId);

    if (!message) {
      throw new SmsMessageNotFoundError();
    }

    return {
      status: 'success',
      data: {
        messageId: message.id,
        status: message.status,
        attempts: message.attempts,
        selectedProvider: message.selectedProvider,
        providerMessageId: message.providerMessageId,
        createdAt: message.createdAt.toISOString(),
        sentAt: message.sentAt?.toISOString() ?? null,
        deliveredAt: message.deliveredAt?.toISOString() ?? null,
        failedAt: message.failedAt?.toISOString() ?? null,
      },
    };
  }

  async findById(messageId: string): Promise<SmsMessage | null> {
    return this.smsMessageRepository.findOne({
      where: {
        id: messageId,
      },
    });
  }

  /**
   * Claims a message for dispatch as a single conditional UPDATE.
   *
   * PROCESSING is claimable as well as QUEUED. A worker that dies mid-dispatch
   * leaves the row on PROCESSING; BullMQ then detects the stalled job and hands
   * it to another worker, and refusing the claim at that point would strand the
   * message forever with no send, no DLQ entry and no requeue path. BullMQ only
   * redelivers a job once its lock has expired, so it is the authority on the
   * previous worker being gone.
   *
   * The trade-off is at-least-once: a worker wrongly considered stalled can
   * cause the same SMS to be sent twice. Losing an accepted message is the worse
   * outcome of the two.
   */
  async markProcessing(messageId: string): Promise<boolean> {
    const updateResult = await this.smsMessageRepository
      .createQueryBuilder()
      .update(SmsMessage)
      .set({
        status: SmsStatus.PROCESSING,
        lastError: null,
      })
      .where('id = :messageId', { messageId })
      .andWhere('status IN (:...claimableStatuses)', {
        claimableStatuses: [SmsStatus.QUEUED, SmsStatus.PROCESSING],
      })
      .execute();

    return (updateResult.affected ?? 0) > 0;
  }

  async incrementAttempts(messageId: string): Promise<void> {
    await this.smsMessageRepository
      .createQueryBuilder()
      .update(SmsMessage)
      .set({
        attempts: () => '"attempts" + 1',
      })
      .where('id = :messageId', { messageId })
      .execute();
  }

  async markSent(
    messageId: string,
    selectedProvider: string,
    providerMessageId: string | null,
  ): Promise<void> {
    await this.smsMessageRepository.update(
      { id: messageId },
      {
        status: SmsStatus.SENT,
        selectedProvider,
        providerMessageId,
        lastError: null,
        sentAt: new Date(),
        failedAt: null,
      },
    );
  }

  async markFatalFailure(
    messageId: string,
    selectedProvider: string,
    lastError: string,
  ): Promise<void> {
    await this.smsMessageRepository.update(
      { id: messageId },
      {
        status: SmsStatus.FATAL_FAILURE,
        selectedProvider,
        providerMessageId: null,
        lastError,
        sentAt: null,
        failedAt: new Date(),
      },
    );
  }

  async requeue(messageId: string): Promise<RequeueSmsResponseDto> {
    this.logger.info({ event: LogEvent.MESSAGE_REQUEUE_REQUESTED, messageId });

    const message = await this.findById(messageId);

    if (!message) {
      this.logger.warn({ event: LogEvent.REQUEUE_REJECTED, messageId }, 'SMS requeue not found');
      throw new SmsMessageNotFoundError();
    }

    if (message.status !== SmsStatus.FATAL_FAILURE) {
      this.logger.warn(
        {
          event: LogEvent.REQUEUE_REJECTED,
          messageId,
          status: message.status,
        },
        'SMS requeue rejected because message is not eligible',
      );
      throw new RequeueNotEligibleError();
    }

    const transitioned = await this.transitionFatalFailureToQueued(messageId);

    if (!transitioned) {
      this.logger.warn(
        {
          event: LogEvent.REQUEUE_REJECTED,
          messageId,
        },
        'SMS requeue rejected because another request already changed the message state',
      );
      throw new RequeueConflictError();
    }

    try {
      await this.queueService.requeueSms(messageId);
    } catch (error) {
      await this.restoreFatalFailureAfterRequeueFailure(message, this.toErrorMessage(error));
      this.logger.error(
        {
          event: LogEvent.REQUEUE_FAILED,
          messageId,
          err: this.toErrorMessage(error),
        },
        'Failed to publish requeued SMS job',
      );
      throw new QueuePublishFailedError();
    }

    this.logger.info(
      {
        event: LogEvent.MESSAGE_REQUEUED,
        messageId,
        status: SmsStatus.QUEUED,
        attempts: message.attempts,
      },
      'SMS message requeued',
    );

    return {
      status: 'success',
      data: {
        messageId: message.id,
        status: SmsStatus.QUEUED,
        createdAt: message.createdAt.toISOString(),
      },
    };
  }

  private validateMessageLength(message: string): void {
    const maxMessageLength = this.configService.getOrThrow<number>('sms.maxMessageLength');

    if (message.length > maxMessageLength) {
      throw new SmsMessageTooLongError(maxMessageLength);
    }
  }

  private async findFromIdempotencyCache(idempotencyKey: string): Promise<SmsMessage | null> {
    const cachedMessageId = await this.idempotencyService.getMessageId(idempotencyKey);

    if (!cachedMessageId) {
      return null;
    }

    const message = await this.findById(cachedMessageId);

    if (!message) {
      await this.idempotencyService.deleteMessageId(idempotencyKey);
    }

    return message;
  }

  private async waitForMessageCreatedByConcurrentRequest(
    idempotencyKey: string,
  ): Promise<SmsMessage | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await this.sleep(50);
      const message = await this.findByIdempotencyKey(idempotencyKey);

      if (message) {
        await this.idempotencyService.storeMessageId(idempotencyKey, message.id);
        return message;
      }
    }

    return null;
  }

  private async findExistingAfterUniqueViolation(
    idempotencyKey: string,
    error: unknown,
  ): Promise<SmsMessage | null> {
    if (!this.isUniqueViolation(error)) {
      return null;
    }

    const existingMessage = await this.findByIdempotencyKey(idempotencyKey);

    if (existingMessage) {
      return existingMessage;
    }

    throw error;
  }

  private async markQueuePublishFailed(messageId: string): Promise<void> {
    await this.smsMessageRepository.update(
      { id: messageId },
      {
        status: SmsStatus.FAILED,
        lastError: QUEUE_PUBLISH_FAILED_ERROR,
        failedAt: new Date(),
      },
    );
  }

  private async transitionFatalFailureToQueued(messageId: string): Promise<boolean> {
    const updateResult = await this.smsMessageRepository.update(
      { id: messageId, status: SmsStatus.FATAL_FAILURE },
      {
        status: SmsStatus.QUEUED,
        selectedProvider: null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        failedAt: null,
      },
    );

    return (updateResult.affected ?? 0) > 0;
  }

  private async restoreFatalFailureAfterRequeueFailure(
    message: SmsMessage,
    enqueueError: string,
  ): Promise<void> {
    await this.smsMessageRepository.update(
      { id: message.id },
      {
        status: SmsStatus.FATAL_FAILURE,
        selectedProvider: message.selectedProvider,
        providerMessageId: null,
        lastError: `${REQUEUE_PUBLISH_FAILED_ERROR}: ${enqueueError}`,
        sentAt: null,
        failedAt: message.failedAt ?? new Date(),
      },
    );
  }

  private async releaseLock(lock: IdempotencyLock): Promise<void> {
    try {
      await this.idempotencyService.releaseLock(lock);
    } catch (error) {
      this.logger.warn(
        {
          idempotencyLockKey: lock.key,
          err: this.toErrorMessage(error),
        },
        'Failed to release idempotency lock',
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as QueryFailedDriverError;

    return driverError.code === POSTGRES_UNIQUE_VIOLATION;
  }

  private logIdempotencyHit(message: SmsMessage): void {
    this.logger.info(
      {
        event: LogEvent.IDEMPOTENCY_HIT,
        messageId: message.id,
        status: message.status,
      },
      'SMS idempotency hit',
    );
  }

  private toResponse(message: SmsMessage): SendSmsResponseDto {
    return {
      status: 'success',
      data: {
        messageId: message.id,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
      },
    };
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
