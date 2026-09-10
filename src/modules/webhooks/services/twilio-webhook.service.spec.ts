import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEvent } from '../../../common/enums/log-event.enum';
import { SmsProviderName } from '../../providers/sms-provider-name.enum';
import { SmsStatus } from '../../sms/entities/sms-status.enum';
import { TwilioSignatureVerifier } from '../signature/twilio-signature.verifier';
import { DeliveryStatusService } from './delivery-status.service';
import { TwilioWebhookService } from './twilio-webhook.service';

const VALID_SIGNATURE = 'valid-signature';

function buildLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

describe('TwilioWebhookService', () => {
  let signatureVerifier: jest.Mocked<Pick<TwilioSignatureVerifier, 'verify'>>;
  let deliveryStatusService: jest.Mocked<Pick<DeliveryStatusService, 'apply'>>;
  let logger: PinoLogger;
  let service: TwilioWebhookService;

  beforeEach(() => {
    signatureVerifier = {
      verify: jest.fn(
        (signature: string | undefined, _params: Record<string, unknown>) =>
          signature === VALID_SIGNATURE,
      ),
    };
    deliveryStatusService = { apply: jest.fn().mockResolvedValue('UPDATED') };
    logger = buildLogger();
    service = new TwilioWebhookService(
      signatureVerifier as unknown as TwilioSignatureVerifier,
      deliveryStatusService as unknown as DeliveryStatusService,
      logger,
    );
    service.onModuleInit();
  });

  describe('signature verification', () => {
    it('rejects an invalid signature without touching the message', async () => {
      await expect(
        service.handle('tampered', { MessageSid: 'SM123', MessageStatus: 'delivered' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(deliveryStatusService.apply).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: LogEvent.WEBHOOK_SIGNATURE_INVALID }),
        expect.any(String),
      );
    });

    it('rejects a callback that carries no signature header', async () => {
      await expect(
        service.handle(undefined, { MessageSid: 'SM123', MessageStatus: 'delivered' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(deliveryStatusService.apply).not.toHaveBeenCalled();
    });

    it('validates the signature against the received parameters', async () => {
      const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };

      await service.handle(VALID_SIGNATURE, body);

      expect(signatureVerifier.verify).toHaveBeenCalledWith(VALID_SIGNATURE, body);
    });

    it('never logs the signature itself', async () => {
      await expect(service.handle('tampered', { MessageSid: 'SM123' })).rejects.toThrow();

      expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('tampered');
    });
  });

  describe('payload validation', () => {
    it.each([
      ['a missing MessageStatus', { MessageSid: 'SM123' }],
      ['a missing MessageSid', { MessageStatus: 'delivered' }],
      ['an empty body', {}],
    ])('rejects %s with 400', async (_label, body) => {
      await expect(service.handle(VALID_SIGNATURE, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(deliveryStatusService.apply).not.toHaveBeenCalled();
    });

    it('accepts unknown extra Twilio parameters', async () => {
      await service.handle(VALID_SIGNATURE, {
        MessageSid: 'SM123',
        MessageStatus: 'delivered',
        SomeFutureTwilioParameter: 'value',
      });

      expect(deliveryStatusService.apply).toHaveBeenCalled();
    });
  });

  describe('status mapping', () => {
    it.each([
      ['delivered', SmsStatus.DELIVERED],
      ['undelivered', SmsStatus.UNDELIVERED],
      ['failed', SmsStatus.FAILED],
      ['sent', SmsStatus.SENT],
    ])('applies MessageStatus=%s as %s', async (messageStatus, expectedStatus) => {
      await service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: messageStatus });

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: SmsProviderName.TWILIO,
          providerMessageId: 'SM123',
          status: expectedStatus,
          externalStatus: messageStatus,
        }),
      );
    });

    it.each(['queued', 'sending', 'accepted', 'some_future_status'])(
      'safely ignores MessageStatus=%s',
      async (messageStatus) => {
        await expect(
          service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: messageStatus }),
        ).resolves.toBeUndefined();

        expect(deliveryStatusService.apply).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ event: LogEvent.WEBHOOK_STATUS_IGNORED }),
          expect.any(String),
        );
      },
    );

    it('lets the delivery status service absorb a repeated delivered callback', async () => {
      deliveryStatusService.apply.mockResolvedValue('DUPLICATE');

      await expect(
        service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: 'delivered' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('lastError', () => {
    it('stores a sanitized Twilio error code on failure', async () => {
      await service.handle(VALID_SIGNATURE, {
        MessageSid: 'SM123',
        MessageStatus: 'undelivered',
        ErrorCode: '30003',
      });

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: 'TWILIO_ERROR_30003' }),
      );
    });

    it('falls back to the external status when Twilio sends no error code', async () => {
      await service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: 'failed' });

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: 'TWILIO_STATUS_FAILED' }),
      );
    });

    it('clears lastError on a successful delivery', async () => {
      await service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: 'delivered' });

      expect(deliveryStatusService.apply).toHaveBeenCalledWith(
        expect.objectContaining({ lastError: null }),
      );
    });
  });

  it('leaves the delivery timestamp to the delivery status service', async () => {
    await service.handle(VALID_SIGNATURE, { MessageSid: 'SM123', MessageStatus: 'delivered' });

    expect(deliveryStatusService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ eventAt: null }),
    );
  });
});
