-- Supports the analytics queries: members by join date (new members, cohorts), unlocks by date, wallet jobs by type and date.
CREATE INDEX "customer_memberships_merchant_id_joined_at_idx" ON "customer_memberships"("merchant_id", "joined_at");

CREATE INDEX "reward_unlocks_merchant_id_unlocked_at_idx" ON "reward_unlocks"("merchant_id", "unlocked_at");

CREATE INDEX "outbox_jobs_merchant_id_type_created_at_idx" ON "outbox_jobs"("merchant_id", "type", "created_at");
