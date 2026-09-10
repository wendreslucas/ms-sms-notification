import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { IDEMPOTENCY_KEY_HEADER } from '../../../config/constants';
import { IdempotencyKey } from '../decorators/idempotency-key.decorator';
import { SendSmsDto } from '../dto/send-sms.dto';
import { SendSmsResponseDto } from '../dto/send-sms-response.dto';
import { SmsStatusResponseDto } from '../dto/sms-status-response.dto';
import { SmsService } from '../services/sms.service';

@ApiTags('sms')
@Controller({
  path: 'sms',
  version: '1',
})
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @ApiOperation({
    summary: 'Request an SMS send',
    description:
      'Validates the request, applies idempotency, persists the message, publishes a BullMQ job and returns the queued message tracking data. Duplicate idempotency keys return the existing message without creating a new job.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: 'Idempotency key for this SMS request. It must be sent only as a header.',
    example: 'sms_req_01HZY7K8B3H4F2W6A2RXWZ8M9Q',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description:
      'SMS request accepted. Duplicate idempotency keys return the existing message with the same response shape.',
    type: SendSmsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid header or body payload.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected persistence or queue publication failure.',
  })
  async send(
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: SendSmsDto,
  ): Promise<SendSmsResponseDto> {
    return this.smsService.sendSmsRequest(idempotencyKey, dto);
  }

  @Get(':messageId')
  @ApiOperation({
    summary: 'Read the tracking status of an SMS',
    description:
      'Returns the current delivery state of a message. It reports tracking fields only: the recipient, the message body, the metadata and the idempotency key are never exposed. This endpoint is an addition for tracking and demonstration purposes and is not part of the send flow.',
  })
  @ApiParam({
    name: 'messageId',
    description: 'SMS message id returned when the request was accepted.',
    example: 'c8d488e9-f308-43e8-8db9-8df0cb5134ef',
  })
  @ApiOkResponse({
    description: 'Current tracking state of the message.',
    type: SmsStatusResponseDto,
  })
  @ApiBadRequestResponse({ description: 'messageId is not a valid UUID.' })
  @ApiNotFoundResponse({ description: 'SMS message was not found.' })
  async getStatus(
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
  ): Promise<SmsStatusResponseDto> {
    return this.smsService.getMessageStatus(messageId);
  }
}
