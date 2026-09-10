import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { API_GLOBAL_PREFIX } from './config/constants';

async function bootstrap(): Promise<void> {
  // rawBody exposes the untouched request bytes on `req.rawBody`. Bird signs the
  // raw body, so verifying a re-serialized payload would never match.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));
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
  SwaggerModule.setup(`${API_GLOBAL_PREFIX}/docs`, app, document);

  const port = configService.getOrThrow<number>('app.port');
  await app.listen(port);
}

void bootstrap();
