import 'dotenv/config';

import { DataSource } from 'typeorm';

import { SmsMessage } from '../modules/sms/entities/sms-message.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5433),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'sms_service',
  entities: [SmsMessage],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: false,
});
