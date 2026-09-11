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
          'x-api-key': 'api-key-secret',
          authorization: 'Bearer super-secret-token',
          cookie: 'session=abc',
        },
      },
      res: {
        headers: {
          'set-cookie': 'session=def',
        },
      },
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      BIRD_API_KEY: 'bird-api-key',
      authToken: 'generic-auth-token',
      apiKey: 'generic-api-key',
      providerMetadata: {
        authToken: 'metadata-auth-token',
        apiKey: 'metadata-api-key',
      },
    });

    const serialized = JSON.stringify(logged);

    expect(serialized).not.toContain('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(serialized).not.toContain('g0hM9SsE+OTPJTGt/tmIKtSyZlE=');
    expect(serialized).not.toContain('api-key-secret');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('session=abc');
    expect(serialized).not.toContain('session=def');
    expect(serialized).not.toContain('twilio-auth-token');
    expect(serialized).not.toContain('bird-api-key');
    expect(serialized).not.toContain('generic-auth-token');
    expect(serialized).not.toContain('generic-api-key');
    expect(serialized).not.toContain('metadata-auth-token');
    expect(serialized).not.toContain('metadata-api-key');
  });

  it('configures pino-pretty only outside production', () => {
    expect(buildLoggerParams('production').pinoHttp).not.toMatchObject({
      transport: expect.anything(),
    });
    expect(buildLoggerParams('development').pinoHttp).toMatchObject({
      transport: {
        target: 'pino-pretty',
      },
    });
  });

  it('serializes HTTP requests without headers', () => {
    const pinoHttp = buildLoggerParams('production').pinoHttp as {
      serializers: {
        req: (req: {
          id: string;
          method: string;
          url: string;
          headers: Record<string, string>;
        }) => {
          id: string;
          method: string;
          url: string;
        };
      };
    };

    expect(
      pinoHttp.serializers.req({
        id: 'req-1',
        method: 'GET',
        url: '/api/health',
        headers: { host: 'sms.example.com', accept: 'application/json' },
      }),
    ).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/health',
    });
  });
});
