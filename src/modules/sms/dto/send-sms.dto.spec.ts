import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SendSmsDto } from './send-sms.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(SendSmsDto, payload);

  return validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('SendSmsDto', () => {
  it('accepts a valid E.164 phone number', async () => {
    const errors = await validatePayload({
      to: '+14155552671',
      message: 'Your verification code is 482019',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid phone number', async () => {
    const errors = await validatePayload({
      to: '14155552671',
      message: 'Your verification code is 482019',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('to');
  });

  it('rejects an empty message', async () => {
    const errors = await validatePayload({
      to: '+14155552671',
      message: '',
    });

    expect(errors.some((error) => error.property === 'message')).toBe(true);
  });

  it('accepts valid metadata', async () => {
    const errors = await validatePayload({
      to: '+14155552671',
      message: 'Your verification code is 482019',
      metadata: {
        userId: 'usr_123456',
        purpose: 'OTP',
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects unexpected fields', async () => {
    const errors = await validatePayload({
      to: '+14155552671',
      message: 'Your verification code is 482019',
      idempotencyKey: 'must-not-be-in-body',
    });

    expect(errors.some((error) => error.property === 'idempotencyKey')).toBe(true);
  });
});
