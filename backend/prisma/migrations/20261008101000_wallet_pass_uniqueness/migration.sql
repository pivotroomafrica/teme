-- One live (non-invalidated) pass per membership and provider. An invalidated pass keeps its row for
-- history, and a replacement gets a new row (and a new Apple serial number), so a revoked phone can
-- never pull a refreshed, valid pass.
DROP INDEX IF EXISTS "wallet_passes_membership_id_provider_key";
CREATE UNIQUE INDEX "wallet_passes_one_live_per_provider"
  ON "wallet_passes" ("membership_id", "provider") WHERE "status" <> 'INVALIDATED';
CREATE INDEX "wallet_passes_membership_id_provider_idx" ON "wallet_passes" ("membership_id", "provider");
