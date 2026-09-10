import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { API_GLOBAL_PREFIX, SWAGGER_DOCS_PATH } from './config/constants';
import { buildStartupSummary, formatStartupSummary } from './config/startup-summary';

async function bootstrap(): Promise<void> {
  // rawBody exposes the untouched request bytes on `req.rawBody`. Bird signs the
  // raw body, so verifying a re-serialized payload would never match.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SMS Notification Microservice')
    .setDescription('Foundation API for a standalone SMS notification microservice.')
    .setVersion('0.1.0')
    .addTag('sms')
    .addTag('admin-sms')
    .addTag('webhooks')
    .addTag('health')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_GLOBAL_PREFIX}/${SWAGGER_DOCS_PATH}`, app, document);

  const port = configService.getOrThrow<number>('app.port');
  await app.listen(port);

  const environment = configService.getOrThrow<string>('app.nodeEnv');
  const summary = buildStartupSummary({
    environment,
    // Reported by Nest only once the server is actually accepting connections.
    applicationUrl: await app.getUrl(),
    publicBaseUrl: configService.get<string>('webhooks.publicBaseUrl'),
  });

  if (environment === 'production') {
    // Keep production on one structured record so log processors still get
    // queryable fields instead of a pre-rendered block.
    logger.log({ event: 'APPLICATION_STARTED', ...summary }, 'Bootstrap');
    return;
  }

  // pino serializes every record as JSON, which would turn the summary into one
  // escaped line. Development gets the rendered block written once instead.
  process.stdout.write(`${formatStartupSummary(summary)}\n`);
}

void bootstrap();
