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
-> primary ISmsProvider
-> SENT or FAILED
```

The worker handles `send-sms` jobs with payload `{ "messageId": "uuid" }`, loads the message from PostgreSQL, and only dispatches messages currently in `QUEUED`.

Before calling a provider, the worker transitions:

```text
QUEUED -> PROCESSING
```

and increments `attempts`. In this implementation, `attempts` means total provider calls attempted.

On provider success:

```text
PROCESSING -> SENT
```

The service persists `selected_provider`, `provider_message_id`, and `sent_at`.

On provider failure in this stage:

```text
PROCESSING -> FAILED
```

The service persists `selected_provider`, `last_error`, and `failed_at`. `FATAL_FAILURE` is reserved for future retry/failover exhaustion.

## Providers

Providers implement:

```ts
ISmsProvider
```

The domain does not depend on Twilio or Bird SDK objects.

- `TwilioProvider` uses the official Twilio Node SDK and maps `messages.create()` to `SendSmsResult`.
- `BirdProvider` uses Bird's official TypeScript SDK `@messagebird/sdk` and sends free-text SMS with `bird.sms.send({ to, from, text, category: "transactional" })`.

Required environment variables:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

BIRD_API_KEY=
BIRD_ORIGINATOR=
```

## Provider Priority

Provider order is controlled by:

```env
SMS_PROVIDER_PRIORITY=twilio,bird
```

The worker uses only the first provider in this stage. For example:

- `twilio,bird` uses Twilio.
- `bird,twilio` uses Bird.

Unknown or empty provider configuration fails with a clear startup error.

## Error Classification

Provider errors are normalized into:

```ts
{
  success: false,
  error: string,
  isRetryable: boolean
}
```

Retryable examples include timeouts, network failures, `429`, and `5xx`.

Non-retryable examples include invalid payloads, authentication/configuration errors, unsupported recipients, and permanent `400`-class errors.

No provider SDK response object is exposed to the domain.

## Current Limitation

This stage intentionally executes only the primary provider. It does not implement automatic retries, exponential backoff, or provider failover yet.

BullMQ is at-least-once. The worker skips messages already in `SENT`, `DELIVERED`, `UNDELIVERED`, `REJECTED`, `FATAL_FAILURE`, or otherwise not `QUEUED`.

There is a known crash window:

```text
provider accepts SMS
process crashes
SENT is not persisted yet
```

A later duplicate job could send again because PostgreSQL would still not know the provider accepted the message. Solving that requires stronger delivery semantics, provider-side idempotency where available, and/or an outbox/reconciliation design. That is intentionally outside this stage.

## Idempotency

Idempotency uses two layers:

- Redis is the fast path and coordination layer. It stores `sms:idempotency:{idempotencyKey}` with the `messageId` value and uses an atomic lock key to avoid concurrent create races.
- PostgreSQL remains the final guarantee through the unique constraint on `sms_messages.idempotency_key`.

Duplicate requests with the same `X-Idempotency-Key` return the existing message and do not publish another BullMQ job. This behavior currently returns `202 Accepted` for both new and duplicate requests to keep the API contract uniform.

## Queue Payload

The `sms` queue receives one job:

```text
name: send-sms
jobId: messageId
payload: { "messageId": "uuid" }
```

The queue payload intentionally excludes the message body, full phone number, and metadata. Future workers will load message details from PostgreSQL by `messageId`.

## Consistency Note

This step does not implement a full Transactional Outbox pattern. There is still a production-grade consistency concern between:

```text
DB commit
```

and:

```text
queue publish
```

The current strategy is simple and explicit: if PostgreSQL persistence succeeds but BullMQ enqueue fails, the message is marked `FAILED`, `last_error` is set to `QUEUE_PUBLISH_FAILED`, a structured error is logged, and the API does not return `202`.

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
```

`POST /api/v1/sms/send` validates the request, persists the SMS request, enqueues `{ "messageId": "uuid" }`, and returns `202 Accepted`.

The idempotency key must be sent exclusively through:

```text
X-Idempotency-Key
```

## Tests

```bash
npm run test
npm run test:e2e
```

Current coverage focuses on:

- `SendSmsDto` validation
- `maskPhoneNumber`
- `GET /api/health`
- `SmsService` request orchestration
- `TwilioProvider`
- `BirdProvider`
- `ProviderRegistry`
- `SmsDispatcherService`
- SMS send flow e2e with PostgreSQL, Redis, BullMQ, worker, and provider mock

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

- Provider failover
- Provider retries
- Twilio webhooks
- Bird webhooks
- Webhook signature verification
- DLQ processing
- DLQ requeue
- Automatic requeue
- Rate limiting
- Circuit breaker
