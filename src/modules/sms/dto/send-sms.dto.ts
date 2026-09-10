import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({
    example: '+14155552671',
    description: 'Recipient phone number in E.164 format.',
  })
  @IsString()
  @IsNotEmpty()
  // E.164 allows at most 15 digits. The lower bound of 7 rejects values that
  // are structurally shaped like a number but cannot be one, such as "+123",
  // while still accepting the shortest real national numbers.
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'to must be a valid E.164 phone number.',
  })
  to: string;

  @ApiProperty({
    example: 'Your verification code is 482019',
    description: 'SMS message body. The maximum length is configured by SMS_MAX_MESSAGE_LENGTH.',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({
    example: {
      userId: 'usr_123456',
      purpose: 'OTP',
    },
    description: 'Optional metadata associated with the SMS request.',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
