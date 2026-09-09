import { ApiProperty } from '@nestjs/swagger';

import { SmsStatus } from '../entities/sms-status.enum';

export class SendSmsResponseDataDto {
  @ApiProperty({
    example: 'c8d488e9-f308-43e8-8df0cb5134ef',
  })
  messageId: string;

  @ApiProperty({
    enum: SmsStatus,
    example: SmsStatus.QUEUED,
  })
  status: SmsStatus;

  @ApiProperty({
    example: '2026-08-05T21:30:00.000Z',
  })
  createdAt: string;
}

export class SendSmsResponseDto {
  @ApiProperty({
    example: 'success',
  })
  status: 'success';

  @ApiProperty({
    type: SendSmsResponseDataDto,
  })
  data: SendSmsResponseDataDto;
}
