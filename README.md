# SMS Notification Microservice

## Project Overview

Standalone SMS notification microservice built with NestJS. The service persists SMS requests, publishes jobs to BullMQ, and processes queued messages through provider strategies for Twilio and Bird.

## Stack

- Node.js
- NestJS
- TypeScript
- PostgreSQL
- TypeORM migrations
- Redis
- BullMQ
- class-validator and class-transformer
- Swagger/OpenAPI
- Jest
- ESLint and Prettier
- Pino via nestjs-pino
- Docker Compose

## Architecture

- NestJS provides the HTTP API, validation pipeline, modular structure, and Swagger documentation.
- PostgreSQL is the source of truth for SMS message records.
- TypeORM manages database access and schema migrations. `synchronize` is disabled.
- Redis supports BullMQ queues.
- BullMQ registers the main `sms` queue and `sms-dlq` dead-letter queue.
- Provider Strategy isolates Twilio and Bird behind `ISmsProvider`.
- Webhook Layer is reserved as a module for future provider delivery callbacks.

## Request Flow

```text
HTTP Request
-> validation
-> X-Idempotency-Key validation
-> idempotency cache / lock
-> PostgreSQL persistence
-> BullMQ enqueue
-> 202 Accepted
```

`POST /api/v1/sms/send` persists a `QUEUED` SMS message and publishes a BullMQ job. The worker then processes the job asynchronously.

## SMS Processing

```text
POST /api/v1/sms/send
-> PostgreSQL
-> BullMQ sms queue
-> SMS worker
-> ProviderRegistry
-> ordered ISmsProvider list
-> retry/failover dispatcher
-> SENT or FATAL_FAILURE
```

The worker handles `send-sms` jobs with payload `{ "messageId": "uuid" }`, loads the message from PostgreSQL, and only dispatches messages currently in `QUEUED`.

Before calling a provider, the worker transitions:

```text
QUEUED -> PROCESSING
```

`attempts` means total external provider calls attempted across all configured providers. The value is incremented immediately before each provider call, not when the message enters `PROCESSING`.

On provider success:

```text
PROCESSING -> SENT
```

The service persists `selected_provider`, `provider_message_id`, and `sent_at`.

On automatic retries exhausted:

```text
PROCESSING -> FATAL_FAILURE -> sms-dlq
```

The service persists `selected_provider`, `last_error`, and `failed_at`, then publishes a minimal DLQ job.

## FAILED vs FATAL_FAILURE

`FAILED` represents non-definitive operational failures outside provider exhaustion, such as a failure to publish the initial `sms` queue job after database persistence.

`FATAL_FAILURE` represents the terminal automatic-send state:

```text
no configured provider accepted the SMS
+
no automatic attempts remain
```

Only `FATAL_FAILURE` is eligible for explicit administrative requeue.

## Providers

Providers implement:

```ts
ISmsProvider;
```

The domain does not depend on Twilio or Bird SDK objects.

- `TwilioProvider` uses the official Twilio Node SDK and maps `messages.create()` to `SendSmsResult`.
- `BirdProvider` uses Bird's official TypeScript SDK `@messagebird/sdk` and sends free-text SMS with `bird.sms.send({ to, from, text, category: "transactional" })`.

Required environment variables:

```env
SMS_PROVIDER_PRIORITY=twilio,bird
SMS_MAX_RETRIES=3
SMS_RETRY_BASE_DELAY_MS=2000

TWILIO_RATE_LIMIT_MAX=10
TWILIO_RATE_LIMIT_DURATION_MS=1000
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

BIRD_RATE_LIMIT_MAX=10
BIRD_RATE_LIMIT_DURATION_MS=1000
BIRD_API_KEY=
BIRD_ORIGINATOR=
```

## Provider Priority

Provider order is controlled by:

```env
SMS_PROVIDER_PRIORITY=twilio,bird
```

The dispatcher tries providers in this exact order. For example:

- `twilio,bird` tries Twilio first, then Bird.
- `bird,twilio` tries Bird first, then Twilio.

Unknown or empty provider configuration fails with a clear startup error.

## Retry Policy

Retries are controlled only by `SmsDispatcherService`. BullMQ jobs are not configured with retry attempts, and provider SDK retries are explicitly disabled where supported.

```env
SMS_MAX_RETRIES=3
SMS_RETRY_BASE_DELAY_MS=2000
```

`SMS_MAX_RETRIES` means maximum provider calls per provider. With two providers and `SMS_MAX_RETRIES=3`, the worst-case call count is:

```text
twilio attempt 1
twilio attempt 2
twilio attempt 3
bird attempt 1
bird attempt 2
bird attempt 3
```

The final `attempts` column value would be `6`.

Retryable failures include transient transport errors, rate limits, and `5xx` responses. Non-retryable failures skip remaining attempts for the current provider and immediately fail over to the next configured provider.

## Exponential Backoff

Retry delay uses exponential backoff:

```text
delay = SMS_RETRY_BASE_DELAY_MS * 2 ^ (providerAttempt - 1)
```

With `SMS_RETRY_BASE_DELAY_MS=2000`:

```text
after attempt 1 -> 2000ms
after attempt 2 -> 4000ms
```

If a provider returns `retryAfterMs`, the dispatcher waits the greater value between provider `retryAfterMs` and the local exponential backoff.

## Provider Failover

Failover happens after:

- all retryable attempts for the current provider are exhausted
- a non-retryable failure is returned by the current provider
- a provider throws unexpectedly

The dispatcher emits structured logs for:

- `PROVIDER_ATTEMPT`
- `PROVIDER_RETRY`
- `PROVIDER_FAILOVER`
- `MESSAGE_SENT`
- `MESSAGE_FAILED`
- `MESSAGE_DLQ`
- `DLQ_PUBLISH_FAILED`

`selected_provider` is the provider that successfully sent the message, or the last provider attempted when all providers fail.

## Dead Letter Queue

When all providers and attempts are exhausted, the dispatcher performs:

```text
FATAL_FAILURE persisted in PostgreSQL
-> failed-sms job published to sms-dlq
```

DLQ job:

```text
queue: sms-dlq
name: failed-sms
payload: { "messageId": "uuid" }
```

The DLQ payload intentionally excludes phone number, message body, metadata, and full error details. PostgreSQL remains the source of truth for message state and failure context.

There is no automatic DLQ replay processor. Recovery is explicit through the administrative requeue endpoint.

If DLQ publication fails after PostgreSQL is already `FATAL_FAILURE`, the service keeps `FATAL_FAILURE`, logs `DLQ_PUBLISH_FAILED`, and lets the worker job fail. The record remains recoverable from PostgreSQL.

## Requeue

Administrative requeue endpoint:

```http
POST /api/v1/admin/sms/{messageId}/requeue
```

This endpoint reprocesses the same `sms_messages` row. It does not create a new message and does not issue a new idempotency key.

Production deployments must protect this endpoint with administrative authentication and authorization.

## Requeue Eligibility

Only this status can be requeued:

```text
FATAL_FAILURE
```

Requeue rejects `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `UNDELIVERED`, `REJECTED`, and `FAILED` with `409 Conflict`. Missing messages return `404 Not Found`.

Requeue flow:

```text
FATAL_FAILURE
-> atomic status transition to QUEUED
-> clear selected_provider, provider_message_id, last_error, sent_at, failed_at
-> publish a new send-sms job
```

`attempts` remains accumulated as audit history. A requeued send continues incrementing from the previous total.

The initial public send uses `jobId = messageId`. Requeue uses a unique job id:

```text
requeue-{messageId}-{timestamp}-{uuid}
```

This avoids BullMQ conflicts with retained completed/failed jobs while the atomic `FATAL_FAILURE -> QUEUED` transition prevents concurrent requeue calls from creating duplicate new jobs.

If requeue job publication fails after the status was changed to `QUEUED`, the service restores `FATAL_FAILURE`, sets `last_error` to `REQUEUE_PUBLISH_FAILED: ...`, logs `REQUEUE_FAILED`, and returns an error.

## Rate Limiting

Provider calls pass through a Redis-backed provider throttle before the external SDK call:

```env
TWILIO_RATE_LIMIT_MAX=10
TWILIO_RATE_LIMIT_DURATION_MS=1000
BIRD_RATE_LIMIT_MAX=10
BIRD_RATE_LIMIT_DURATION_MS=1000
```

The limits are local service-side limits. They are configurable guardrails and intentionally do not hardcode Twilio or Bird commercial account limits.

## SDK Retry Policy

The service avoids multiple retry layers:

- Dispatcher owns retries, backoff, and failover.
- BullMQ job retries are not configured.
- Twilio SDK client is created with `autoRetry: false` and `maxRetries: 0`.
- Bird SDK client is created with `maxRetries: 0`.

Bird sends a deterministic provider idempotency key per message/provider:

```text
sms:{messageId}:bird
```

Twilio `messages.create()` is used with the documented `to`, `from`, and `body` request fields. No Twilio provider idempotency key is implemented because this flow does not expose an equivalent documented idempotency parameter for SMS message creation.

## Error Classification

Provider errors are normalized into:

```ts
{
  success: false,
  error: string,
  isRetryable: boolean,
  retryAfterMs?: number
}
```

Retryable examples include timeouts, network failures, `429`, and `5xx`.

Non-retryable examples include invalid payloads, authentication/configuration errors, unsupported recipients, and permanent `400`-class errors.

No provider SDK response object is exposed to the domain.

## Current Limitation

This stage implements synchronous in-worker retries and failover. A worker handling a long provider outage remains busy while sleeping for retry backoff. A future production evolution could move delayed retries back into a durable scheduler or workflow engine.

BullMQ is at-least-once. The worker skips messages already in `SENT`, `DELIVERED`, `UNDELIVERED`, `REJECTED`, `FATAL_FAILURE`, or otherwise not `QUEUED`.

There is a known crash window:

```text
provider accepts SMS
process crashes
SENT is not persisted yet
```

A later duplicate job could send again because PostgreSQL would still not know the provider accepted the message. Bird provider idempotency reduces this risk for Bird. Twilio sends still have this crash-window limitation in this implementation. Solving it fully requires stronger delivery semantics, provider-side idempotency where available, and/or an outbox/reconciliation design. That is intentionally outside this stage.

Messages in `FATAL_FAILURE` are durable in PostgreSQL even if DLQ publication fails. They can be reconciled or requeued manually through the admin endpoint.

## Idempotency

Idempotency uses two layers:

- Redis is the fast path and coordination layer. It stores `sms:idempotency:{idempotencyKey}` with the `messageId` value and uses an atomic lock key to avoid concurrent create races.
- PostgreSQL remains the final guarantee through the unique constraint on `sms_messages.idempotency_key`.

Duplicate requests with the same `X-Idempotency-Key` return the existing message and do not publish another BullMQ job. This behavior currently returns `202 Accepted` for both new and duplicate requests to keep the API contract uniform.

## Queue Payload

The `sms` queue receives send jobs:

```text
name: send-sms
jobId: messageId
payload: { "messageId": "uuid" }
```

Requeue send jobs use the same payload with a unique `requeue-{messageId}-{timestamp}-{uuid}` job id.

The `sms-dlq` queue receives retention jobs:

```text
name: failed-sms
payload: { "messageId": "uuid" }
```

Queue payloads intentionally exclude the message body, full phone number, metadata, and full error details. Workers and operators load message details from PostgreSQL by `messageId`.

## Consistency Note

This step does not implement a full Transactional Outbox pattern. There is still a production-grade consistency concern between:

```text
DB commit
```

and:

```text
queue publish
```

The current strategy is simple and explicit:

- if initial PostgreSQL persistence succeeds but BullMQ enqueue fails, the message is marked `FAILED`, `last_error` is set to `QUEUE_PUBLISH_FAILED`, a structured error is logged, and the API does not return `202`
- if provider exhaustion persists `FATAL_FAILURE` but DLQ publication fails, the message remains `FATAL_FAILURE`, `DLQ_PUBLISH_FAILED` is logged, and the worker job fails visibly
- if requeue changes the message back to `QUEUED` but send-job publication fails, the message is restored to `FATAL_FAILURE`, `last_error` is set to `REQUEUE_PUBLISH_FAILED: ...`, and `REQUEUE_FAILED` is logged

For strict zero-loss guarantees in production, the recommended evolution is Transactional Outbox with a reliable relay process.

## Running Locally

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migration:run
npm run start:dev
```

The default host ports are `5433` for PostgreSQL and `6380` for Redis to avoid collisions with common local installations. The containers still use their standard internal ports.

The API runs on:

```text
http://localhost:3000/api
```

## Swagger

```text
http://localhost:3000/api/docs
```

## Endpoints

```http
GET /api/health
POST /api/v1/sms/send
POST /api/v1/admin/sms/{messageId}/requeue
```

`POST /api/v1/sms/send` validates the request, persists the SMS request, enqueues `{ "messageId": "uuid" }`, and returns `202 Accepted`.

The idempotency key must be sent exclusively through:

```text
X-Idempotency-Key
```

`POST /api/v1/admin/sms/{messageId}/requeue` explicitly requeues a `FATAL_FAILURE` message. It returns `202 Accepted` on success, `404 Not Found` for unknown ids, and `409 Conflict` when the message is not eligible.

## Tests

```bash
npm run test
npm run test:e2e
```

The e2e suites talk to the real PostgreSQL and Redis from `docker-compose.yml`.

Queue names are global to a Redis instance, so every e2e suite that boots `AppModule` gives BullMQ a key prefix unique to that run (`bull-e2e-<suite>-<pid>-<random>`). Without it, any other consumer pointed at the same Redis - a `npm run start:dev` in another terminal, or a Nest app leaked by an interrupted run - registers a worker on the same `sms` queue, steals the jobs the tests enqueue and writes the results into the shared database.

Two related rules keep the suites deterministic:

- never call `FLUSHDB` once the queues and workers are connected; delete only the run's own keys
- wait for `worker.waitUntilReady()` before enqueuing, and for the active job count to reach zero before truncating `sms_messages`

`--runInBand` is required because the suites share one PostgreSQL database and each truncates `sms_messages`.

Current coverage focuses on:

- `SendSmsDto` validation
- `maskPhoneNumber`
- `GET /api/health`
- `SmsService` request orchestration
- `TwilioProvider`
- `BirdProvider`
- `ProviderRegistry`
- `SmsDispatcherService`
- retry/backoff/failover behavior
- fatal failure and DLQ publication
- DLQ payload safety
- admin requeue
- requeue conflict/not-found behavior
- concurrent requeue protection
- requeue enqueue-failure restore
- provider rate-limit configuration
- SMS send flow e2e with PostgreSQL, Redis, BullMQ, worker, and provider mocks

## Migrations

```bash
npm run migration:generate
npm run migration:run
npm run migration:revert
```

The initial migration creates `sms_messages`, its SMS status enum, and a unique constraint for `idempotency_key`.

## Architectural Decisions

The PRD referenced two possible locations for the idempotency key: request body and request header.

This implementation follows the final API contract:

```text
X-Idempotency-Key
```

The key is rejected from the body by the global whitelist/forbid validation behavior.

PostgreSQL is the source of truth for SMS message state. Redis supports BullMQ and idempotency coordination.

## Not Implemented Yet

- Twilio webhooks
- Bird webhooks
- Webhook signature verification
- Automatic requeue
- Circuit breaker
- Outbox/reconciliation
