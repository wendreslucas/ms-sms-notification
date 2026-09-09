import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSmsMessages1760000000000 implements MigrationInterface {
  name = 'CreateSmsMessages1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(
      `CREATE TYPE "public"."sms_messages_status_enum" AS ENUM('QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'REJECTED', 'FAILED', 'FATAL_FAILURE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "sms_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "idempotency_key" character varying(255) NOT NULL,
        "recipient_phone" character varying(32) NOT NULL,
        "message_body" text NOT NULL,
        "metadata" jsonb,
        "status" "public"."sms_messages_status_enum" NOT NULL DEFAULT 'QUEUED',
        "attempts" integer NOT NULL DEFAULT 0,
        "selected_provider" character varying(64),
        "provider_message_id" character varying(255),
        "last_error" text,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        "failed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sms_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sms_messages_idempotency_key" UNIQUE ("idempotency_key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "sms_messages"');
    await queryRunner.query('DROP TYPE "public"."sms_messages_status_enum"');
  }
}
