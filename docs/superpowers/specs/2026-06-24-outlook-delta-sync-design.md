# Outlook Delta Sync and Webhook Design

## Goal

Replace Outlook's bounded recent-message rescan with a durable, incremental Microsoft Graph synchronization path that is safe under manual, cron, and webhook-triggered concurrency.

## Verified Current State

- `lib/microsoft.ts` owns OAuth, token refresh, Graph requests, a full-recent sync, and send/reply behavior.
- `syncOutlookChannel` reads the 50 newest Inbox messages, discovers at most 25 conversation IDs, then refetches up to 50 messages for every conversation.
- OAuth callback and manual sync call that function directly.
- Imported messages are normalized into `Conversation`, `Contact`, and `Message`; `syncConversationWorkItems` classifies affected conversations.
- Outlook has no cursor, lease, subscription, webhook, retry event, fallback cron, or renewal worker.
- Gmail already demonstrates atomic `updateMany` leases, durable push events, bounded cron processing, health metadata, and `CRON_SECRET` authorization.

## Architecture

### Graph and OAuth boundary

`lib/microsoft.ts` remains responsible for OAuth, token refresh, basic Microsoft Graph requests, profile lookup, and sending. Reusable Graph request helpers and message types will be exported. Sync orchestration moves to `lib/outlook-sync.ts`; subscription management moves to `lib/outlook-subscriptions.ts`; durable notification validation/queueing and worker orchestration use focused modules rather than extending the existing monolith.

### Credential state

`OutlookCredential` gains:

- `deltaLinkEncrypted`: the current Graph `nextLink` or final `deltaLink`, encrypted because it contains an opaque mailbox cursor.
- `subscriptionId` and `subscriptionExpiresAt`.
- `subscriptionClientStateEncrypted`.
- `subscriptionLastRenewalAttempt` and `subscriptionError`.
- `lastSyncMode`, `lastSyncStatus`, `lastSyncError`, and existing `lastSyncedAt`.
- `syncLeaseId` and `syncLockExpiresAt`.

The lease uses a random owner ID. Acquisition is one atomic `updateMany` constrained to an absent or expired lease. Completion and release also require the same lease ID, so a stale worker cannot clear a newer worker's lock.

### Delta engine

The initial request uses `/me/mailFolders('inbox')/messages/delta` with a minimal `$select`. Later requests use the encrypted cursor URL supplied by Graph. Each invocation processes at most a fixed number of pages. It persists every `@odata.nextLink` after that page is applied and persists the final `@odata.deltaLink` when the round completes. This bounds request duration while allowing subsequent worker runs to finish large initial mailboxes without restarting.

Created and updated messages use provider IDs and existing tenant/channel/thread unique constraints for idempotent upserts. Message updates refresh sender, recipients, body, subject, read state, timestamp, conversation participant, and conversation `lastMessageAt` without overriding user-owned conversation state. Removed messages are deleted by provider ID; their conversation timestamp is recalculated from remaining messages and an empty conversation is closed instead of being destructively removed. Work-item classification runs once for each affected conversation after the processed pages.

An HTTP 410/invalid delta cursor clears the saved cursor and reports a retryable cursor-reset result; a later bounded run starts a new initial round. Cursor URLs and message content are never logged.

### Durable notification intake

`POST /api/connectors/outlook/webhook` has two paths:

1. A `validationToken` query receives an immediate URL-decoded `text/plain` 200 response.
2. Notification batches are schema-checked, matched by `subscriptionId`, and constant-time compared against decrypted `clientState` values. The entire batch is rejected if any notification cannot be authenticated.

Authenticated notifications are inserted into `OutlookSyncEvent`. When Microsoft omits a notification ID, a stable hash of non-secret routing fields coalesces equivalent hints; duplicate deliveries use `createMany({ skipDuplicates: true })`. The route returns 202 without performing Graph synchronization.

`OutlookSyncEvent` stores only routing metadata: tenant, channel, notification ID, subscription ID, resource identifier, change type, status, attempts, next attempt time, error summary, and timestamps. It never stores message content, tokens, or client state.

### Subscription lifecycle

`ensureOutlookSubscription` creates or renews an Inbox message subscription. New subscriptions use a random client state encrypted at rest and the HTTPS URL `${NEXTAUTH_URL}/api/connectors/outlook/webhook`. Existing subscriptions are renewed before expiry. A missing/expired remote subscription falls back to creation. Local HTTP development skips creation with an explicit result; delta polling remains functional.

Disconnect attempts to delete the remote subscription before deleting the channel, but local disconnect continues if Microsoft rejects cleanup. Logs contain channel IDs and sanitized error summaries only.

### Bounded worker

`GET /api/cron/outlook-sync` requires `Authorization: Bearer ${CRON_SECRET}` and performs three bounded phases:

- Claim and process at most 25 due `OutlookSyncEvent` rows.
- Run fallback delta sync for at most 25 Outlook credentials whose last successful sync is stale, excluding channels already handled in this invocation.
- Renew at most 25 missing or soon-expiring subscriptions.

Events use atomic status claims. A busy credential returns the event to pending with a short delay. A partial delta round also remains pending so the next cron invocation continues its saved `nextLink`. Failures use bounded retry delay and retain a sanitized error. Completed duplicate notifications remain no-ops.

### Entry points

- OAuth callback performs a bounded initial delta run and best-effort subscription setup.
- Manual sync calls the same leased delta runner and returns 202 when another worker owns the lease.
- Webhooks only enqueue durable hints.
- Cron drains hints, provides missed-notification fallback, and renews subscriptions.

## Security

- OAuth tokens, delta cursor URLs, and subscription client state are encrypted using `lib/crypto.ts`.
- The webhook accepts only matching subscription IDs and constant-time matching client state.
- No sensitive URL, token, client state, or message content is logged or written to audit payloads.
- Remote subscription setup requires an HTTPS `NEXTAUTH_URL` outside localhost development.
- Graph access continues to use delegated `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `offline_access`, and user profile scopes.

## Testing

- Delta pagination, bounded continuation, and final cursor persistence.
- Created/updated idempotent message upserts and removed message handling.
- Atomic lease rejection and expired-lease reclamation.
- Cursor reset behavior.
- Webhook validation handshake, strict client-state validation, and duplicate notification idempotency.
- Manual route delegation and busy response.
- Worker event draining, fallback bounds, and subscription renewal selection.
- Subscription create/renew behavior and local HTTP skip.
- Migration validation, full tests, typecheck, lint, and production build.

## Operations and Local Limitations

Production must expose the webhook over public HTTPS, configure Microsoft OAuth redirect URLs, schedule `/api/cron/outlook-sync` at least every five minutes with `CRON_SECRET`, and alert on non-2xx cron results or stored subscription/sync errors. Local HTTP development can exercise OAuth, manual delta sync, tests, and cron fallback but cannot complete Microsoft webhook validation or create a live subscription without an HTTPS tunnel.

## Non-Goals

- Rich notifications containing encrypted message payloads.
- Tracking every Outlook folder; this slice tracks Inbox messages.
- Replacing the existing send/reply implementation.
- An unbounded initial mailbox import in one request.
