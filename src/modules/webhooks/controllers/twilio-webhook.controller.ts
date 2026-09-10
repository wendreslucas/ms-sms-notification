import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
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
import { TwilioWebhookService } from '../services/twilio-webhook.service';
import {
  TWILIO_SIGNATURE_HEADER,
  TWILIO_WEBHOOK_ROUTE,
  WEBHOOKS_ROUTE_PATH,
} from '../webhooks.constants';

@ApiTags('webhooks')
@Controller({
  path: WEBHOOKS_ROUTE_PATH,
  version: API_DEFAULT_VERSION,
})
export class TwilioWebhookController {
  constructor(private readonly twilioWebhookService: TwilioWebhookService) {}

  @Post(TWILIO_WEBHOOK_ROUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Twilio delivery status callback',
    description:
      'Provider callback endpoint. It is called by Twilio, not by API consumers, and every request must carry a valid X-Twilio-Signature computed over the exact public callback URL configured in PUBLIC_BASE_URL. The body arrives as application/x-www-form-urlencoded and only MessageSid, MessageStatus and ErrorCode are read, because Twilio may add parameters at any time.',
  })
  @ApiHeader({
    name: TWILIO_SIGNATURE_HEADER,
    required: true,
    description: 'Twilio request signature. Requests without a valid signature are rejected.',
  })
  @ApiNoContentResponse({
    description:
      'Callback accepted. Also returned for unknown provider message ids and for statuses that carry no new delivery information, so the provider does not retry.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Callback is missing MessageSid or MessageStatus.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid X-Twilio-Signature.',
  })
  async handleTwilio(
    @Headers(TWILIO_SIGNATURE_HEADER) signature: string | undefined,
    @Req() request: Request,
  ): Promise<void> {
    await this.twilioWebhookService.handle(signature, request.body as Record<string, unknown>);
  }
}
