import { ApiProperty } from '@nestjs/swagger';

import { SmsStatus } from '../entities/sms-status.enum';

/**
 * Tracking view of a message.
 *
 * It deliberately carries no recipient, body, metadata or idempotency key: the
 * endpoint exists to follow a message's status, not to inspect its content.
 */
export class SmsStatusResponseDataDto {
  @ApiProperty({ example: 'c8d488e9-f308-43e8-8db9-8df0cb5134ef' })
  messageId: string;

  @ApiProperty({ enum: SmsStatus, example: SmsStatus.SENT })
  status: SmsStatus;

  @ApiProperty({ example: 4, description: 'Provider calls made across all configured providers.' })
  attempts: number;

  @ApiProperty({ example: 'bird', nullable: true, type: String })
  selectedProvider: string | null;

  @ApiProperty({ example: 'external-id', nullable: true, type: String })
  providerMessageId: string | null;

  @ApiProperty({ example: '2026-08-05T21:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-08-05T21:30:02.000Z', nullable: true, type: String })
  sentAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  deliveredAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  failedAt: string | null;
}

export class SmsStatusResponseDto {
  @ApiProperty({ example: 'success' })
  status: 'success';

  @ApiProperty({ type: SmsStatusResponseDataDto })
  data: SmsStatusResponseDataDto;
}
