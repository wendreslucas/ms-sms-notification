import { randomUUID } from 'node:crypto';

import { getQueueOptionsToken } from '@nestjs/bullmq';
import { TestingModuleBuilder } from '@nestjs/testing';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { SMS_DLQ_QUEUE_NAME, SMS_QUEUE_NAME } from '../../src/modules/queue/queue.constants';

const E2E_QUEUE_NAMES = [SMS_QUEUE_NAME, SMS_DLQ_QUEUE_NAME];

export function buildRedisConnectionOptions(): { host: string; port: number } {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6380),
  };
}

/**
 * A BullMQ key prefix that belongs to this test run alone.
 *
 * Queue names are global to a Redis instance, so anything else pointed at the
 * same Redis — a `npm run start:dev` in another terminal, or a Nest app leaked
 * by an earlier interrupted run — registers a worker on the very same `sms`
 * queue and competes for the jobs these tests enqueue. A foreign worker that
 * wins the race dispatches the message through its own container, without the
 * provider overrides configured here, and writes the result straight into the
 * shared database.
 *
 * Giving each run its own prefix makes the run's queues invisible to any other
 * consumer, and vice versa.
 */
export function buildTestQueuePrefix(label: string): string {
  return `bull-e2e-${label}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/**
 * Redirects both application queues, and therefore the workers the Bull
 * explorer creates for them, to a prefix owned by this test run.
 *
 * The worker options come from the queue instance itself (`queueRef.opts`), so
 * overriding the queue options token moves producer and consumer together.
 */
export function isolateBullQueues(
  builder: TestingModuleBuilder,
  prefix: string,
): TestingModuleBuilder {
  return E2E_QUEUE_NAMES.reduce(
    (currentBuilder, name) =>
      currentBuilder.overrideProvider(getQueueOptionsToken(name)).useValue({
        name,
        prefix,
        connection: buildRedisConnectionOptions(),
      }),
    builder,
  );
}

/**
 * Removes every job left behind by the previous test without touching BullMQ
 * metadata that the live queues and workers depend on.
 *
 * `FLUSHDB` is deliberately not used: the Queue and Worker instances are
 * already connected by the time tests run, and deleting their metadata
 * underneath them is what makes queue behaviour unpredictable.
 */
export async function resetQueue(queue: Queue): Promise<void> {
  await queue.drain(true);
  await queue.clean(0, 1000, 'completed');
  await queue.clean(0, 1000, 'failed');
}

/**
 * Waits until no job is being processed any more.
 *
 * A dispatch that is still running would keep writing to `sms_messages` after
 * the table was truncated for the next test, so tests must not start while one
 * is in flight.
 */
export async function waitForNoActiveJobs(queue: Queue, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const activeCount = await queue.getActiveCount();

    if (activeCount === 0) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Queue "${queue.name}" still had ${activeCount} active job(s) after ${timeoutMs}ms.`,
      );
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

/**
 * Deletes the run's own BullMQ namespace. Safe to call unconditionally because
 * the prefix is unique to this run.
 */
export async function deleteQueuePrefix(redis: Redis, prefix: string): Promise<void> {
  const keys = await redis.keys(`${prefix}:*`);

  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/**
 * Deletes the Redis keys owned by the application, leaving BullMQ metadata
 * alone.
 */
export async function deleteApplicationKeys(redis: Redis): Promise<void> {
  const keyGroups = await Promise.all([
    redis.keys('sms:idempotency*'),
    redis.keys('sms:rate-limit*'),
    redis.keys('sms:webhook:*'),
  ]);
  const keys = keyGroups.flat();

  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
