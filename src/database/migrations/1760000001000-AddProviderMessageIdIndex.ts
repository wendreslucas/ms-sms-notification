import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderMessageIdIndex1760000001000 implements MigrationInterface {
  name = 'AddProviderMessageIdIndex1760000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delivery callbacks resolve a message by provider plus external id, never by
    // phone number. External ids are only unique per vendor, so the provider is
    // part of the index.
    await queryRunner.query(
      `CREATE INDEX "IDX_sms_messages_provider_message_id" ON "sms_messages" ("selected_provider", "provider_message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_sms_messages_provider_message_id"`);
  }
}
