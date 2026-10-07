-- Integrity layer that Prisma cannot express: CHECK constraints, partial unique indexes,
-- cross-row invariants, and append-only protection for ledger/audit tables.

-- ───────────── Format & range checks ─────────────
ALTER TABLE merchants
  ADD CONSTRAINT merchants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  ADD CONSTRAINT merchants_deactivation_consistent
    CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL));

ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_email_lowercase CHECK (email = lower(email)),
  ADD CONSTRAINT platform_users_deactivation_consistent
    CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL));

ALTER TABLE merchant_settings
  ADD CONSTRAINT merchant_settings_support_phone_e164
    CHECK (support_phone_e164 IS NULL OR support_phone_e164 ~ '^\+251[0-9]{9}$'),
  ADD CONSTRAINT merchant_settings_defaults_valid
    CHECK (default_stamps_required BETWEEN 1 AND 1000 AND default_cooldown_minutes >= 0);

ALTER TABLE branches
  ADD CONSTRAINT branches_phone_e164
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+251[0-9]{9}$'),
  ADD CONSTRAINT branches_deactivation_consistent
    CHECK ((status = 'INACTIVE') = (deactivated_at IS NOT NULL));

ALTER TABLE staff_memberships
  ADD CONSTRAINT staff_memberships_deactivation_consistent
    CHECK ((status = 'DEACTIVATED') = (deactivated_at IS NOT NULL));

-- Ethiopian numbers in E.164: +251 followed by 9 digits.
ALTER TABLE customers
  ADD CONSTRAINT customers_phone_e164
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+251[0-9]{9}$'),
  ADD CONSTRAINT customers_anonymized_has_no_pii
    CHECK ((status = 'ANONYMIZED') = (anonymized_at IS NOT NULL)
           AND (status = 'ACTIVE' OR (phone_e164 IS NULL AND first_name IS NULL)));

ALTER TABLE loyalty_programs
  ADD CONSTRAINT loyalty_programs_stamps_required CHECK (stamps_required BETWEEN 1 AND 1000),
  ADD CONSTRAINT loyalty_programs_cooldown CHECK (cooldown_minutes >= 0),
  ADD CONSTRAINT loyalty_programs_brand_color
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE reward_definitions
  ADD CONSTRAINT reward_definitions_valid_for_days CHECK (valid_for_days IS NULL OR valid_for_days > 0);

ALTER TABLE customer_memberships
  ADD CONSTRAINT customer_memberships_deactivation_consistent
    CHECK ((status = 'INACTIVE') = (deactivated_at IS NOT NULL));

ALTER TABLE wallet_passes
  ADD CONSTRAINT wallet_passes_version CHECK (pass_version >= 1);

ALTER TABLE redemption_events
  ADD CONSTRAINT redemption_events_attempt CHECK (attempt_number >= 1);

ALTER TABLE reversal_events
  ADD CONSTRAINT reversal_events_one_target CHECK (
    (target_type = 'STAMP' AND stamp_event_id IS NOT NULL AND redemption_event_id IS NULL) OR
    (target_type = 'REDEMPTION' AND redemption_event_id IS NOT NULL AND stamp_event_id IS NULL)),
  ADD CONSTRAINT reversal_events_reason_required CHECK (char_length(btrim(reason)) >= 3);

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_expiry CHECK (expires_at > created_at);

ALTER TABLE outbox_jobs
  ADD CONSTRAINT outbox_jobs_attempts CHECK (attempts >= 0 AND max_attempts > 0);

-- ───────────── Partial unique indexes ─────────────
-- MVP: one default ACTIVE program per merchant.
CREATE UNIQUE INDEX loyalty_programs_one_default_active
  ON loyalty_programs (merchant_id) WHERE is_default AND status = 'ACTIVE';

-- MVP: one ACTIVE reward definition per program.
CREATE UNIQUE INDEX reward_definitions_one_active_per_program
  ON reward_definitions (program_id) WHERE status = 'ACTIVE';

-- Queue scan path for the outbox worker.
CREATE INDEX outbox_jobs_due ON outbox_jobs (next_run_at) WHERE status IN ('PENDING', 'FAILED');

-- ───────────── Cross-row invariants ─────────────
CREATE FUNCTION enforce_staff_membership_scopes() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_users WHERE id = NEW.user_id AND account_type = 'MERCHANT_USER') THEN
    RAISE EXCEPTION 'staff memberships may only belong to MERCHANT_USER accounts'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND scope = 'MERCHANT') THEN
    RAISE EXCEPTION 'staff memberships require a MERCHANT-scoped role'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER staff_memberships_scopes
  BEFORE INSERT OR UPDATE OF user_id, role_id ON staff_memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_membership_scopes();

-- A reversal must target an event of the same membership.
CREATE FUNCTION enforce_reversal_target() RETURNS trigger AS $$
DECLARE target_membership uuid;
BEGIN
  IF NEW.target_type = 'STAMP' THEN
    SELECT membership_id INTO target_membership FROM stamp_events WHERE id = NEW.stamp_event_id;
  ELSE
    SELECT membership_id INTO target_membership FROM redemption_events WHERE id = NEW.redemption_event_id;
  END IF;
  IF target_membership IS DISTINCT FROM NEW.membership_id THEN
    RAISE EXCEPTION 'reversal membership does not match the reversed event'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER reversal_events_target
  BEFORE INSERT ON reversal_events
  FOR EACH ROW EXECUTE FUNCTION enforce_reversal_target();

-- A redemption must belong to the same membership as the reward unlock.
CREATE FUNCTION enforce_redemption_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reward_unlocks WHERE id = NEW.reward_unlock_id AND membership_id = NEW.membership_id) THEN
    RAISE EXCEPTION 'redemption membership does not match the reward unlock'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER redemption_events_membership
  BEFORE INSERT ON redemption_events
  FOR EACH ROW EXECUTE FUNCTION enforce_redemption_membership();

-- A reward unlock must be triggered by a stamp of the same membership.
CREATE FUNCTION enforce_unlock_stamp_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stamp_events WHERE id = NEW.triggering_stamp_id AND membership_id = NEW.membership_id) THEN
    RAISE EXCEPTION 'reward unlock stamp does not belong to the membership'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER reward_unlocks_stamp_membership
  BEFORE INSERT ON reward_unlocks
  FOR EACH ROW EXECUTE FUNCTION enforce_unlock_stamp_membership();

-- ───────────── Append-only protection ─────────────
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'object_not_in_prerequisite_state';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stamp_events_append_only BEFORE UPDATE OR DELETE ON stamp_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reward_unlocks_append_only BEFORE UPDATE OR DELETE ON reward_unlocks
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER redemption_events_append_only BEFORE UPDATE OR DELETE ON redemption_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reversal_events_append_only BEFORE UPDATE OR DELETE ON reversal_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER customer_consents_append_only BEFORE UPDATE OR DELETE ON customer_consents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER stamp_events_no_truncate BEFORE TRUNCATE ON stamp_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reward_unlocks_no_truncate BEFORE TRUNCATE ON reward_unlocks
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER redemption_events_no_truncate BEFORE TRUNCATE ON redemption_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER reversal_events_no_truncate BEFORE TRUNCATE ON reversal_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER customer_consents_no_truncate BEFORE TRUNCATE ON customer_consents
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
