import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { RequeueSmsResponseDto } from '../dto/requeue-sms-response.dto';
import { SmsService } from '../services/sms.service';

@ApiTags('admin-sms')
@Controller({
  path: 'admin/sms',
  version: '1',
})
export class AdminSmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post(':messageId/requeue')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Requeue a fatally failed SMS',
    description:
      'Administrative endpoint for explicit SMS recovery. Only FATAL_FAILURE messages are eligible. This endpoint must be protected by admin authentication and authorization in production.',
  })
  @ApiParam({
    name: 'messageId',
    description: 'SMS message id to requeue.',
    example: 'c8d488e9-f308-43e8-8df0cb5134ef',
  })
  @ApiAcceptedResponse({
    description: 'SMS message was requeued.',
    type: RequeueSmsResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'SMS message was not found.',
  })
  @ApiConflictResponse({
    description: 'SMS message is not in FATAL_FAILURE or was requeued concurrently.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected persistence or queue publication failure.',
  })
  async requeue(
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
  ): Promise<RequeueSmsResponseDto> {
    return this.smsService.requeue(messageId);
  }
}
