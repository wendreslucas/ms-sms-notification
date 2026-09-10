import { Controller, HttpCode, HttpStatus, Post, Req, RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { ErrorResponseDto } from '../../../common/errors/error-response.dto';
import { API_DEFAULT_VERSION } from '../../../config/constants';
import { BirdWebhookService } from '../services/bird-webhook.service';
import {
  BIRD_WEBHOOK_ID_HEADER,
  BIRD_WEBHOOK_ROUTE,
  BIRD_WEBHOOK_SIGNATURE_HEADER,
  BIRD_WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOKS_ROUTE_PATH,
} from '../webhooks.constants';

@ApiTags('webhooks')
@Controller({
  path: WEBHOOKS_ROUTE_PATH,
  version: API_DEFAULT_VERSION,
})
export class BirdWebhookController {
  constructor(private readonly birdWebhookService: BirdWebhookService) {}

  @Post(BIRD_WEBHOOK_ROUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Bird delivery event webhook',
    description:
      'Provider callback endpoint. It is called by Bird, not by API consumers. Deliveries are signed with Standard Webhooks and verified over the raw request body, so the payload must be sent exactly as Bird produced it. Bird delivers at-least-once and deliveries are deduplicated on webhook-id.',
  })
  @ApiHeader({
    name: BIRD_WEBHOOK_ID_HEADER,
    required: true,
    description: 'Delivery id, stable across retries of the same event. Used for deduplication.',
  })
  @ApiHeader({
    name: BIRD_WEBHOOK_TIMESTAMP_HEADER,
    required: true,
    description:
      'Unix timestamp in seconds. Deliveries outside BIRD_WEBHOOK_TOLERANCE_SECONDS are rejected as replays.',
  })
  @ApiHeader({
    name: BIRD_WEBHOOK_SIGNATURE_HEADER,
    required: true,
    description:
      'Standard Webhooks signature over "{webhook-id}.{webhook-timestamp}.{raw body}". During secret rotation it carries both signatures, space delimited.',
  })
  @ApiNoContentResponse({
    description:
      'Event accepted. Also returned for duplicates, unknown sms ids and event types that carry no new delivery information, so Bird does not retry.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Event is missing its type or sms id.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Missing, malformed, replayed or invalid Standard Webhooks signature.',
  })
  async handleBird(@Req() request: RawBodyRequest<Request>): Promise<void> {
    await this.birdWebhookService.handle(
      request.rawBody,
      request.headers as Record<string, unknown>,
    );
  }
}
