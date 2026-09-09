import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SmsStatus } from './sms-status.enum';

@Entity({ name: 'sms_messages' })
@Index('UQ_sms_messages_idempotency_key', ['idempotencyKey'], { unique: true })
export class SmsMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey: string;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 32 })
  recipientPhone: string;

  @Column({ name: 'message_body', type: 'text' })
  messageBody: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: SmsStatus, default: SmsStatus.QUEUED })
  status: SmsStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'selected_provider', type: 'varchar', length: 64, nullable: true })
  selectedProvider: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
