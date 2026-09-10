import { ArgumentsHost } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppErrorFilter } from './app-error.filter';
import { QueuePublishFailedError } from './queue-publish-failed-error';
import { SmsMessageNotFoundError } from './sms-message-not-found-error';
import { SmsMessageTooLongError } from './sms-message-too-long-error';

function buildHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

function buildLogger(): PinoLogger & { error: jest.Mock } {
  return { setContext: jest.fn(), error: jest.fn() } as unknown as PinoLogger & {
    error: jest.Mock;
  };
}

describe('AppErrorFilter', () => {
  it('responds with the status, code and message from the catalog', () => {
    const { host, status, json } = buildHost();

    new AppErrorFilter(buildLogger()).catch(new SmsMessageNotFoundError(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      code: 'SMS_MESSAGE_NOT_FOUND',
      message: 'SMS message was not found.',
    });
  });

  it('includes the details of the occurrence when there are any', () => {
    const { host, status, json } = buildHost();

    new AppErrorFilter(buildLogger()).catch(new SmsMessageTooLongError(1600), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        code: 'SMS_MESSAGE_TOO_LONG',
        details: { maxLength: 1600 },
      }),
    );
  });

  it('logs failures on the service side', () => {
    const logger = buildLogger();

    new AppErrorFilter(logger).catch(new QueuePublishFailedError(), buildHost().host);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SMS_QUEUE_PUBLISH_FAILED' }),
      'SMS request was persisted, but queue publication failed.',
    );
  });

  it('does not log client errors, which the request log already records', () => {
    const logger = buildLogger();

    new AppErrorFilter(logger).catch(new SmsMessageNotFoundError(), buildHost().host);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
