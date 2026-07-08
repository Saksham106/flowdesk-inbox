-- Composite index for status-filtered, recency-sorted conversation lists.
-- The inbox list, the needs-reply count, and the mobile list all query
-- WHERE tenantId = ? AND status = ? ORDER BY lastMessageAt DESC. The existing
-- [tenantId, lastMessageAt] index can't satisfy the status filter and the sort
-- together, so Postgres scans the recency index and filters status in memory.
-- CONCURRENTLY would avoid a write lock, but Prisma migrations run in a
-- transaction where CONCURRENTLY is not allowed; these tables are small enough
-- that a brief lock at deploy time is acceptable.
CREATE INDEX "Conversation_tenantId_status_lastMessageAt_idx"
  ON "Conversation" ("tenantId", "status", "lastMessageAt");
