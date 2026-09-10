import { Writable } from 'node:stream';

import pino from 'pino';

import { buildLoggerParams } from './logger.config';

function captureLogLine(record: Record<string, unknown>): Record<string, unknown> {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  const { redact, level } = buildLoggerParams('production').pinoHttp as {
    redact: string[];
    level: string;
  };

  pino({ level, redact }, destination).info(record, 'request completed');

  return JSON.parse(lines.join('')) as Record<string, unknown>;
}

describe('buildLoggerParams', () => {
  it('logs at info level in production and debug elsewhere', () => {
    expect(buildLoggerParams('production').pinoHttp).toMatchObject({ level: 'info' });
    expect(buildLoggerParams('development').pinoHttp).toMatchObject({ level: 'debug' });
    expect(buildLoggerParams(undefined).pinoHttp).toMatchObject({ level: 'debug' });
  });

  it('redacts provider webhook signatures from request logs', () => {
    const logged = captureLogLine({
      req: {
        headers: {
          host: 'sms.example.com',
          'x-twilio-signature': 'RSOYDt4T1cUTdK1PDd93/VVr8B8=',
          'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE=',
          authorization: 'Bearer super-secret-token',
          cookie: 'session=abc',
        },
      },
    });

    const serialized = JSON.stringify(logged);

    expect(serialized).not.toContain('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(serialized).not.toContain('g0hM9SsE+OTPJTGt/tmIKtSyZlE=');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('session=abc');
  });

  it('keeps non-sensitive request headers readable', () => {
    const logged = captureLogLine({
      req: { headers: { host: 'sms.example.com', 'webhook-id': 'msg_123' } },
    });

    expect(JSON.stringify(logged)).toContain('msg_123');
  });
});
