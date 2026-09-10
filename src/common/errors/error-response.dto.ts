import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ErrorCode } from './error-catalog';

/** Body returned for every AppError. */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ example: 'Not Found' })
  error: string;

  @ApiProperty({
    enum: ErrorCode,
    example: ErrorCode.SMS_MESSAGE_NOT_FOUND,
    description: 'Stable, machine-readable error code. Prefer it over the message when branching.',
  })
  code: ErrorCode;

  @ApiProperty({ example: 'SMS message was not found.' })
  message: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { maxLength: 1600 },
    description: 'Values specific to this occurrence, such as the limit that was exceeded.',
  })
  details?: Record<string, string | number | boolean>;
}
