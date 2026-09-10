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

  it.each(['+14155552671', '+442071838750', '+5511987654321'])(
    'accepts the E.164 number %s',
    async (to) => {
      const errors = await validate(plainToInstance(SendSmsDto, { to, message: 'hello' }));

      expect(errors).toHaveLength(0);
    },
  );

  it.each([
    ['no leading plus', '14155552671'],
    ['too short to be a real number', '+123'],
    ['not a number at all', 'abc'],
    ['formatted for humans', '(415) 555-2671'],
    ['leading zero country code', '+0155552671'],
    ['more than 15 digits', '+1234567890123456'],
    ['contains spaces', '+1 415 555 2671'],
    ['empty', ''],
  ])('rejects %s', async (_label, to) => {
    const errors = await validate(plainToInstance(SendSmsDto, { to, message: 'hello' }));

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('to');
  });

  it('rejects an invalid phone number', async () => {
    const errors = await validatePayload({
      to: '14155552671',
      message: 'Your verification code is 482019',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('to');
  });

  it.each([
    ['empty', ''],
    ['a single space', ' '],
    ['several spaces', '     '],
    ['a tab and a newline', '\t\n'],
    ['mixed whitespace', ' \t \n '],
  ])('rejects a message that is %s', async (_label, message) => {
    const errors = await validate(plainToInstance(SendSmsDto, { to: '+14155552671', message }));

    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('message');
  });

  it('keeps a message whose padding surrounds real content', async () => {
    const errors = await validate(
      plainToInstance(SendSmsDto, { to: '+14155552671', message: '  hello  ' }),
    );

    expect(errors).toHaveLength(0);
  });

  it('does not rewrite the message that was supplied', async () => {
    const dto = plainToInstance(SendSmsDto, { to: '+14155552671', message: '  hello  ' });

    await validate(dto);

    expect(dto.message).toBe('  hello  ');
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
