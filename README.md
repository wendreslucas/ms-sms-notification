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

`FATAL_FAILURE` is reserved for that internal send flow and is never produced by a delivery webhook.

## Delivery Status Semantics

The statuses a provider callback can produce:

```text
SENT         provider accepted and forwarded the message
DELIVERED    provider/carrier confirmed delivery to the recipient
UNDELIVERED  a delivery receipt reported non-delivery
REJECTED     the message was refused before or during delivery processing
FAILED       terminal delivery callback that fits no other status better
```

`FAILED` is also still used by the internal flow for non-definitive operational failures, such as a queue publication failure after persistence.

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

There are two independent retry layers, and they never multiply each other.

**Provider retry** lives in `SmsDispatcherService` and covers a provider rejecting a send. Provider SDK retries are explicitly disabled where supported, so this layer is the only one calling a provider more than once.

**Job retry** is BullMQ's own, and covers the job failing for infrastructure reasons: a Redis or PostgreSQL connection dropping mid-dispatch, or a worker dying. A provider that rejects a send is handled inside the dispatcher and never escapes as an error, which is why these attempts cannot multiply provider calls.

```env
SMS_JOB_ATTEMPTS=3
SMS_JOB_BACKOFF_DELAY_MS=1000
```

The job is retried with exponential backoff, delayed by `SMS_JOB_BACKOFF_DELAY_MS * 2^(attempt - 1)`. A redelivered job re-reads the message and skips it unless it is still claimable, so a message that already reached SENT is never sent again by a job retry.

```env
SMS_MAX_RETRIES=3
SMS_RETRY_BASE_DELAY_MS=2000
```

`SMS_MAX_RETRIES` means maximum provider calls per provider, within a single job execution. With two providers and `SMS_MAX_RETRIES=3`, the worst-case call count is:

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

BullMQ is at-least-once. A queue job is ignored when the message already reached `SENT`, `DELIVERED`, `UNDELIVERED`, `REJECTED`, `FAILED` or `FATAL_FAILURE`.

`QUEUED` and `PROCESSING` are both claimable, because a worker that dies mid-dispatch leaves the row on `PROCESSING`. See [Crash Recovery](#crash-recovery).

There is a known crash window:

```text
provider accepts SMS
process crashes
SENT is not persisted yet
```

A later duplicate job could send again because PostgreSQL would still not know the provider accepted the message. Bird provider idempotency reduces this risk for Bird. Twilio sends still have this crash-window limitation in this implementation. Solving it fully requires stronger delivery semantics, provider-side idempotency where available, and/or an outbox/reconciliation design. That is intentionally outside this stage.

Messages in `FATAL_FAILURE` are durable in PostgreSQL even if DLQ publication fails. They can be reconciled or requeued manually through the admin endpoint.

## Crash Recovery

A worker that dies between claiming a message and finishing the dispatch leaves the row on `PROCESSING`. BullMQ notices the stalled job once its lock expires and hands it to another worker.

The claim is a single conditional statement that accepts both states:

```sql
UPDATE sms_messages
   SET status = 'PROCESSING'
 WHERE id = :id
   AND status IN ('QUEUED', 'PROCESSING')
```

Because it is one statement, two workers racing for the same message still cannot both win, and the attempt counter continues from where the interrupted dispatch stopped instead of restarting.

Accepting `PROCESSING` here is deliberate. Refusing it would strand the message permanently: it would never be sent, never reach the DLQ, and never become eligible for the admin requeue endpoint, which only accepts `FATAL_FAILURE`. Losing a message that was already accepted is a worse outcome than the alternative, which is the at-least-once trade-off below.

The trade-off: BullMQ can consider a worker stalled while it is in fact alive but blocked. Two dispatches would then run for the same message and the recipient could receive the SMS twice. This is inherent to at-least-once delivery and is bounded by BullMQ's lock duration.

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

## Delivery Webhooks

Both providers report delivery outcomes through signed callbacks. Every callback follows the same pipeline:

```text
Provider
↓
signature verification
↓
status normalization
↓
PostgreSQL
```

Controllers stay thin. Signature verification, deduplication, status mapping and persistence each live in their own unit:

```text
TwilioWebhookController → TwilioWebhookService ┐
                                                ├→ DeliveryStatusService → SmsService → PostgreSQL
BirdWebhookController   → BirdWebhookService   ┘
```

The update is a single small conditional `UPDATE`, so the request is answered synchronously. No extra queue was introduced for webhooks.

### Responses

```text
204 No Content   accepted, including duplicates, unknown ids and non-actionable statuses
400 Bad Request  the callback is missing the fields needed to identify the message
403 Forbidden    missing, malformed, replayed or invalid signature
```

A webhook that is authentic but references an unknown `provider + providerMessageId` answers `204`, not `404`. Both providers treat a non-2xx response as a delivery failure and retry it, and retrying a callback for a message this service does not know about would never succeed. The event is recorded as `WEBHOOK_MESSAGE_NOT_FOUND` instead.

### Twilio

```http
POST /api/v1/webhooks/twilio
Content-Type: application/x-www-form-urlencoded
X-Twilio-Signature: <signature>
```

`TwilioProvider` sets `statusCallback` on every message it creates, composed from `PUBLIC_BASE_URL`. No domain is hardcoded.

The callback is read field by field rather than validated against a closed DTO, because Twilio may add parameters to callbacks at any time. Only these are used:

```text
MessageSid      external message id, matched against provider_message_id
MessageStatus   external status
ErrorCode       failure diagnostic
```

Signature validation uses `validateRequest` from the official Twilio SDK. Twilio signs the full callback URL plus the sorted POST parameters, so no hand-rolled HMAC is used.

### Twilio Signature and Proxies

This is the usual source of Twilio signature failures:

```text
Twilio calls   https://sms.example.com/api/v1/webhooks/twilio
the app sees   http://internal-service:3000/api/v1/webhooks/twilio
```

Behind a TLS-terminating proxy or load balancer, the URL the application observes is not the URL Twilio signed, and validation fails. The callback URL is therefore rebuilt from `PUBLIC_BASE_URL` rather than from request headers, which also keeps verification off values a caller could forge. Set `PUBLIC_BASE_URL` to the exact public scheme, host and port that Twilio was configured with.

When the auth token is not configured, every Twilio callback is rejected. Verification fails closed.

### Bird

```http
POST /api/v1/webhooks/bird
Content-Type: application/json
webhook-id: <delivery id>
webhook-timestamp: <unix seconds>
webhook-signature: v1,<base64>
```

Bird signs deliveries with [Standard Webhooks](https://www.standardwebhooks.com/): HMAC-SHA256 over

```text
{webhook-id}.{webhook-timestamp}.{raw request body}
```

keyed with the endpoint's own signing secret.

### Bird Raw Body

The signature covers the exact bytes Bird sent. Verifying a payload rebuilt with `JSON.stringify(req.body)` after parsing is the classic webhook bug: re-serialization changes whitespace and key order, and the signature no longer matches.

The application is therefore bootstrapped with `rawBody: true`, which exposes the untouched bytes on `req.rawBody`. Body parsing is unchanged, so existing DTOs, Twilio's form-urlencoded callbacks and Swagger keep working exactly as before.

Verification itself is delegated to `bird.webhooks.unwrap` from the official `@messagebird/sdk`, which is given the raw buffer.

The signing secret comes from `BIRD_WEBHOOK_SECRET`. It is the webhook subscription's own secret, not `BIRD_API_KEY`. While it is empty, every Bird callback is rejected.

### Bird Replay Protection

`webhook-timestamp` is checked against `BIRD_WEBHOOK_TOLERANCE_SECONDS` (default 300) before the signature is verified. Standard Webhooks defines a 5 minute window and the SDK enforces it as well, so configuring a larger value cannot widen the window — only a smaller one takes effect.

### Status Normalization

Twilio:

| MessageStatus                                | Internal status |
| -------------------------------------------- | --------------- |
| `sent`                                       | `SENT`          |
| `delivered`                                  | `DELIVERED`     |
| `undelivered`                                | `UNDELIVERED`   |
| `failed`                                     | `FAILED`        |
| `canceled`                                   | `REJECTED`      |
| `accepted`, `scheduled`, `queued`, `sending` | ignored         |
| `read`, `receiving`, `received`              | ignored         |
| anything else                                | ignored         |

Bird:

| Event type        | Internal status |
| ----------------- | --------------- |
| `sms.sent`        | `SENT`          |
| `sms.delivered`   | `DELIVERED`     |
| `sms.undelivered` | `UNDELIVERED`   |
| `sms.failed`      | `FAILED`        |
| `sms.rejected`    | `REJECTED`      |
| `sms.expired`     | `UNDELIVERED`   |
| `sms.accepted`    | ignored         |
| anything else     | ignored         |

`sms.expired` maps to `UNDELIVERED` because the message was accepted and handed on, and then its validity period elapsed before the carrier could deliver it. That is a delivery failure after acceptance, not a refusal, which is what `UNDELIVERED` means here.

Intermediate statuses are ignored because the send flow already records `SENT` the moment the provider API accepts a message. Applying them again would only risk regressing a message that has moved further along.

An unknown status or event type is never an error. Providers add values over time, so anything unrecognized is logged as `WEBHOOK_STATUS_IGNORED` and answered with `204`.

### Message Identification

A callback is resolved by provider plus external id, never by phone number:

```text
twilio  MessageSid    → provider_message_id
bird    data.sms_id   → provider_message_id
```

The provider is part of the lookup because external ids are only unique per vendor. A Bird id must never resolve a Twilio message. The lookup is backed by an index on `(selected_provider, provider_message_id)`.

### Webhook Idempotency

Bird delivers at-least-once, so the same event can arrive more than once, including concurrently. Deliveries are deduplicated on `webhook-id`:

```text
sms:webhook:bird:{webhookId}
```

claimed in Redis with `SET NX` and a `WEBHOOK_IDEMPOTENCY_TTL_SECONDS` expiry. The claim is released if processing throws, so a Bird retry is not silently dropped.

Twilio has no equivalent delivery id, and Redis deduplication is a fast path rather than a correctness guarantee in either case. Idempotency comes from the database write itself, which is expressed as one conditional statement:

```sql
UPDATE sms_messages
   SET status = :status, ...
 WHERE id = :id
   AND status IN (:allowedPreviousStatuses)
```

Replaying a `delivered` callback finds the message already `DELIVERED`, which is not an allowed previous status, so the statement changes no rows and nothing else happens:

```text
SENT → DELIVERED → (delivered again) → DELIVERED
```

### Out-of-order Events

Neither provider orders its callbacks, so an older event can arrive after a newer one. The progression policy is explicit:

```text
QUEUED < PROCESSING < SENT < terminal delivery status
```

Terminal delivery statuses are `DELIVERED`, `UNDELIVERED`, `REJECTED` and `FAILED`. Because the allowed previous statuses are part of the `UPDATE` itself, a regression cannot happen even when two callbacks are processed concurrently:

```text
DELIVERED + late "sent" callback → stays DELIVERED
```

For two conflicting terminal outcomes the policy is deliberately conservative rather than last-write-wins:

- `DELIVERED` may upgrade a previously recorded `UNDELIVERED`, `REJECTED` or `FAILED`.
- No failure status may ever overwrite `DELIVERED`.
- A different failure status does not replace an already recorded one; the first terminal failure stands.

Every ignored conflict is logged as `WEBHOOK_STATUS_CONFLICT` so the anomaly stays visible. No event history table was added for this stage.

`FATAL_FAILURE` is outside this progression. It belongs to the internal send flow, and a delivery callback never changes a message in that state.

### Persistence

```text
status        the normalized internal status
deliveredAt   set when the status becomes DELIVERED
failedAt      set when delivery ends as UNDELIVERED, REJECTED or FAILED
lastError     short sanitized diagnostic code
```

Timestamps prefer the provider's own event timestamp when it carries one, and fall back to the current time otherwise. Twilio status callbacks carry no event timestamp for this purpose, so they use the current time; Bird events carry `timestamp`.

`sentAt` is never modified by a failure callback. A message really can be accepted and sent and only then fail delivery. A `SENT` callback fills `sentAt` only when the send flow left it empty.

`lastError` stores a short code, never a payload:

```text
TWILIO_ERROR_30003
TWILIO_STATUS_FAILED
BIRD_UNREACHABLE
BIRD_REJECTED
```

The free-form provider description is discarded, because it can contain the recipient's number or message content.

### Logging

```text
WEBHOOK_RECEIVED
WEBHOOK_SIGNATURE_INVALID
WEBHOOK_PAYLOAD_INVALID
WEBHOOK_DUPLICATE
WEBHOOK_MESSAGE_NOT_FOUND
WEBHOOK_STATUS_UPDATED
WEBHOOK_STATUS_IGNORED
WEBHOOK_STATUS_CONFLICT
```

Log fields are limited to `provider`, `messageId`, `providerMessageId`, `webhookId`, `previousStatus`, `newStatus` and `externalStatus`. Request bodies, phone numbers, message bodies, metadata, signatures and secrets are never logged.

### Local Development

Delivery callbacks need a publicly reachable HTTPS URL. On localhost the providers cannot reach the service, so real callbacks do not arrive. Exposing the port through an HTTP tunnel is one way to receive them; the service does not require or bundle any such tool.

Whatever the origin ends up being, set it as `PUBLIC_BASE_URL` before testing Twilio callbacks: the signature is computed over that exact URL, and a mismatch results in `403`.

## Running Locally

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migration:run
npm run start:dev
```

npm is the expected package manager; `package-lock.json` is the lockfile this repository tracks.

The default host ports are `5433` for PostgreSQL and `6380` for Redis to avoid collisions with common local installations. The containers still use their standard internal ports.

The API runs on:

```text
http://localhost:3000/api
```

### Webhook Configuration

```env
PUBLIC_BASE_URL=http://localhost:3000
BIRD_WEBHOOK_SECRET=
BIRD_WEBHOOK_TOLERANCE_SECONDS=300
WEBHOOK_IDEMPOTENCY_TTL_SECONDS=86400
```

`PUBLIC_BASE_URL` is the single source for the public callback origin. It is used both to compose the `statusCallback` URL sent to Twilio and to validate `X-Twilio-Signature`, so there is no separate `TWILIO_STATUS_CALLBACK_URL`. The default only fits local development; in production it must be the real public HTTPS origin.

Values required only for the provider actually in use:

```text
TWILIO_AUTH_TOKEN     required to verify any Twilio callback
BIRD_WEBHOOK_SECRET   required to verify any Bird callback
```

Both fail closed: while the corresponding value is empty, that provider's callbacks are rejected with `403`.

`BIRD_WEBHOOK_TOLERANCE_SECONDS` and `WEBHOOK_IDEMPOTENCY_TTL_SECONDS` have working defaults and only need to be set to override them.

## Swagger

```text
http://localhost:3000/api/docs
```

## Endpoints

```http
GET /api/health
POST /api/v1/sms/send
GET /api/v1/sms/{messageId}
POST /api/v1/admin/sms/{messageId}/requeue
POST /api/v1/webhooks/twilio
POST /api/v1/webhooks/bird
```

`POST /api/v1/sms/send` validates the request, persists the SMS request, enqueues `{ "messageId": "uuid" }`, and returns `202 Accepted`.

The idempotency key must be sent exclusively through:

```text
X-Idempotency-Key
```

`POST /api/v1/admin/sms/{messageId}/requeue` explicitly requeues a `FATAL_FAILURE` message. It returns `202 Accepted` on success, `404 Not Found` for unknown ids, and `409 Conflict` when the message is not eligible.

The two webhook routes are provider callbacks, not endpoints for API consumers. See [Delivery Webhooks](#delivery-webhooks).

`GET /api/v1/sms/{messageId}` reads the current tracking state of a message: status, attempts, selected provider, external id and the lifecycle timestamps. It is a small addition for tracking and demonstration, such as an optional frontend, and is not part of the send flow.

It returns tracking data only. The recipient number, the message body, the metadata and the idempotency key are never exposed. A malformed id returns `400 Bad Request` without touching the database, and an id that matches no message returns `404 Not Found`.

## Tests

```bash
npm run test
npm run test:e2e
```

The e2e suites talk to the real PostgreSQL and Redis from `docker-compose.yml`.

Queue names are global to a Redis instance, so every e2e suite that boots `AppModule` gives BullMQ a key prefix unique to that run (`bull-e2e-<suite>-<pid>-<random>`). Without it, any other consumer pointed at the same Redis — a `npm run start:dev` in another terminal, or a Nest app leaked by an interrupted run — registers a worker on the same `sms` queue, steals the jobs the tests enqueue and writes the results into the shared database.

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
- Twilio and Bird status mappers, including unknown and intermediate statuses
- delivery status progression policy and conflict classification
- diagnostic code sanitization
- Twilio and Bird payload extraction
- Twilio signature verification against the official SDK helper
- Bird Standard Webhooks verification, raw-body integrity and replay tolerance
- webhook deduplication and claim release
- delivery status persistence, including timestamps and sanitized `lastError`
- delivery webhooks e2e for both providers: signature rejection, replay rejection,
  duplicate deliveries, unknown ids, unknown statuses and status-regression protection

## Migrations

```bash
npm run migration:generate
npm run migration:run
npm run migration:revert
```

The initial migration creates `sms_messages`, its SMS status enum, and a unique constraint for `idempotency_key`.

A second migration adds the `(selected_provider, provider_message_id)` index used to resolve delivery callbacks.

## Architectural Decisions

The PRD referenced two possible locations for the idempotency key: request body and request header.

This implementation follows the final API contract:

```text
X-Idempotency-Key
```

The key is rejected from the body by the global whitelist/forbid validation behavior.

PostgreSQL is the source of truth for SMS message state. Redis supports BullMQ and idempotency coordination.

## Known Limitations

These are deliberate boundaries of this implementation, not oversights.

**No Transactional Outbox.** The API commits to PostgreSQL and then publishes to BullMQ. A crash in between leaves a `QUEUED` row with no job, and nothing sweeps for those rows, so such a message is never sent. An enqueue that _fails_ is compensated (marked `FAILED` with `QUEUE_PUBLISH_FAILED`, no `202` returned); an enqueue that never _runs_ is not. Closing this properly means an outbox table written in the same transaction plus a relay process, which changes the write path and adds a component to operate. See [Consistency Note](#consistency-note).

**Twilio sends are not idempotent.** `BirdProvider` passes an idempotency key derived from the message id, so a redelivered job cannot produce a second Bird SMS. Twilio's Programmable Messaging API offers no equivalent, so a crash after Twilio accepted a message but before `SENT` was persisted can result in a duplicate SMS on redelivery.

**DLQ publication is best-effort.** If the process dies after `FATAL_FAILURE` is persisted but before the DLQ job is published, the message is absent from the DLQ. PostgreSQL remains the source of truth and the message is still recoverable through the admin requeue endpoint; the DLQ is a secondary index, not the record.

**The admin requeue endpoint is unauthenticated.** It is documented as requiring administrative authentication and authorization in production, and it must not be exposed publicly as it stands.

**`GET /api/health` is liveness only.** It reports that the process is up; it does not probe PostgreSQL or Redis. A readiness probe that checks both dependencies would be the production evolution.

**Retries occupy the worker.** Retry backoff is an in-worker sleep, so a long provider outage keeps workers busy waiting rather than releasing them back to the queue.

## Not Implemented Yet

- Automatic requeue
- Circuit breaker
- Outbox/reconciliation
