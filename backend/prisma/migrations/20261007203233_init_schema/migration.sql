-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('PLATFORM_ADMIN', 'MERCHANT_USER');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('EN', 'AM');

-- CreateEnum
CREATE TYPE "merchant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "staff_status" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "role_scope" AS ENUM ('PLATFORM', 'MERCHANT');

-- CreateEnum
CREATE TYPE "program_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "reward_definition_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('LOYALTY_TERMS', 'MARKETING');

-- CreateEnum
CREATE TYPE "consent_action" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "consent_source" AS ENUM ('JOIN_FORM', 'STAFF_ASSISTED', 'PRIVACY_REQUEST', 'IMPORT');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "wallet_provider" AS ENUM ('APPLE', 'GOOGLE', 'WEB');

-- CreateEnum
CREATE TYPE "wallet_pass_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "wallet_sync_status" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "reversal_target" AS ENUM ('STAMP', 'REDEMPTION');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "account_type" "account_type" NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "preferred_language" "language" NOT NULL DEFAULT 'EN',
    "last_login_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "role_scope" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_am" TEXT,
    "status" "merchant_status" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "default_language" "language" NOT NULL DEFAULT 'EN',
    "join_reference" TEXT NOT NULL,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_settings" (
    "merchant_id" UUID NOT NULL,
    "support_email" TEXT,
    "support_phone_e164" TEXT,
    "logo_storage_key" TEXT,
    "logo_content_type" TEXT,
    "default_stamps_required" INTEGER NOT NULL DEFAULT 10,
    "default_cooldown_minutes" INTEGER NOT NULL DEFAULT 0,
    "fraud_thresholds" JSONB NOT NULL DEFAULT '{}',
    "retention_policy" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchant_settings_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_am" TEXT,
    "address_text" TEXT,
    "city" TEXT,
    "phone_e164" TEXT,
    "status" "branch_status" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "staff_status" NOT NULL DEFAULT 'INVITED',
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_branch_assignments" (
    "staff_membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_branch_assignments_pkey" PRIMARY KEY ("staff_membership_id","branch_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "phone_e164" TEXT,
    "first_name" TEXT,
    "preferred_language" "language" NOT NULL DEFAULT 'EN',
    "status" "customer_status" NOT NULL DEFAULT 'ACTIVE',
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "consent_type" NOT NULL,
    "action" "consent_action" NOT NULL,
    "version" TEXT NOT NULL,
    "source" "consent_source" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_am" TEXT,
    "terms_en" TEXT,
    "terms_am" TEXT,
    "stamps_required" INTEGER NOT NULL,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "program_status" NOT NULL DEFAULT 'DRAFT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "brand_color" TEXT,
    "card_display" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_am" TEXT,
    "description_en" TEXT,
    "description_am" TEXT,
    "valid_for_days" INTEGER,
    "status" "reward_definition_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reward_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "token_hash" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_passes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "provider" "wallet_provider" NOT NULL,
    "status" "wallet_pass_status" NOT NULL DEFAULT 'PENDING',
    "provider_pass_id" TEXT,
    "auth_token_hash" TEXT,
    "pass_version" INTEGER NOT NULL DEFAULT 1,
    "sync_status" "wallet_sync_status" NOT NULL DEFAULT 'PENDING',
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallet_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stamp_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "device_metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_unlocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "reward_definition_id" UUID NOT NULL,
    "triggering_stamp_id" UUID NOT NULL,
    "unlocked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "reward_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "reward_unlock_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "device_metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemption_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reversal_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "target_type" "reversal_target" NOT NULL,
    "stamp_event_id" UUID,
    "redemption_event_id" UUID,
    "reversed_by_staff_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reversal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID,
    "branch_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID,
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_slug_key" ON "merchants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_join_reference_key" ON "merchants"("join_reference");

-- CreateIndex
CREATE INDEX "branches_merchant_id_status_idx" ON "branches"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_merchant_id_key" ON "branches"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "staff_memberships_merchant_id_status_idx" ON "staff_memberships"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_memberships_merchant_id_user_id_key" ON "staff_memberships"("merchant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_memberships_id_merchant_id_key" ON "staff_memberships"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "staff_branch_assignments_merchant_id_branch_id_idx" ON "staff_branch_assignments"("merchant_id", "branch_id");

-- CreateIndex
CREATE INDEX "customers_merchant_id_first_name_idx" ON "customers"("merchant_id", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchant_id_phone_e164_key" ON "customers"("merchant_id", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_merchant_id_key" ON "customers"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "customer_consents_merchant_id_customer_id_type_occurred_at_idx" ON "customer_consents"("merchant_id", "customer_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "loyalty_programs_merchant_id_status_idx" ON "loyalty_programs"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_id_merchant_id_key" ON "loyalty_programs"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "reward_definitions_merchant_id_program_id_status_idx" ON "reward_definitions"("merchant_id", "program_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reward_definitions_id_merchant_id_program_id_key" ON "reward_definitions"("id", "merchant_id", "program_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_memberships_token_hash_key" ON "customer_memberships"("token_hash");

-- CreateIndex
CREATE INDEX "customer_memberships_merchant_id_program_id_status_idx" ON "customer_memberships"("merchant_id", "program_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_memberships_customer_id_program_id_key" ON "customer_memberships"("customer_id", "program_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_memberships_id_merchant_id_key" ON "customer_memberships"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_memberships_id_merchant_id_program_id_key" ON "customer_memberships"("id", "merchant_id", "program_id");

-- CreateIndex
CREATE INDEX "wallet_passes_merchant_id_provider_sync_status_idx" ON "wallet_passes"("merchant_id", "provider", "sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_passes_membership_id_provider_key" ON "wallet_passes"("membership_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_passes_provider_provider_pass_id_key" ON "wallet_passes"("provider", "provider_pass_id");

-- CreateIndex
CREATE INDEX "stamp_events_merchant_id_membership_id_occurred_at_idx" ON "stamp_events"("merchant_id", "membership_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stamp_events_merchant_id_branch_id_occurred_at_idx" ON "stamp_events"("merchant_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stamp_events_merchant_id_staff_membership_id_occurred_at_idx" ON "stamp_events"("merchant_id", "staff_membership_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stamp_events_merchant_id_occurred_at_idx" ON "stamp_events"("merchant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "stamp_events_staff_membership_id_idempotency_key_key" ON "stamp_events"("staff_membership_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stamp_events_id_merchant_id_key" ON "stamp_events"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_unlocks_triggering_stamp_id_key" ON "reward_unlocks"("triggering_stamp_id");

-- CreateIndex
CREATE INDEX "reward_unlocks_merchant_id_membership_id_unlocked_at_idx" ON "reward_unlocks"("merchant_id", "membership_id", "unlocked_at");

-- CreateIndex
CREATE UNIQUE INDEX "reward_unlocks_id_merchant_id_key" ON "reward_unlocks"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_unlocks_triggering_stamp_id_merchant_id_key" ON "reward_unlocks"("triggering_stamp_id", "merchant_id");

-- CreateIndex
CREATE INDEX "redemption_events_merchant_id_membership_id_occurred_at_idx" ON "redemption_events"("merchant_id", "membership_id", "occurred_at");

-- CreateIndex
CREATE INDEX "redemption_events_merchant_id_branch_id_occurred_at_idx" ON "redemption_events"("merchant_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "redemption_events_merchant_id_occurred_at_idx" ON "redemption_events"("merchant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_events_reward_unlock_id_attempt_number_key" ON "redemption_events"("reward_unlock_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_events_staff_membership_id_idempotency_key_key" ON "redemption_events"("staff_membership_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_events_id_merchant_id_key" ON "redemption_events"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_events_stamp_event_id_key" ON "reversal_events"("stamp_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_events_redemption_event_id_key" ON "reversal_events"("redemption_event_id");

-- CreateIndex
CREATE INDEX "reversal_events_merchant_id_membership_id_occurred_at_idx" ON "reversal_events"("merchant_id", "membership_id", "occurred_at");

-- CreateIndex
CREATE INDEX "reversal_events_merchant_id_occurred_at_idx" ON "reversal_events"("merchant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_events_reversed_by_staff_id_idempotency_key_key" ON "reversal_events"("reversed_by_staff_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_events_stamp_event_id_merchant_id_key" ON "reversal_events"("stamp_event_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_events_redemption_event_id_merchant_id_key" ON "reversal_events"("redemption_event_id", "merchant_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_staff_membership_id_operation_key_key" ON "idempotency_records"("staff_membership_id", "operation", "key");

-- CreateIndex
CREATE INDEX "audit_events_merchant_id_occurred_at_idx" ON "audit_events"("merchant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_merchant_id_actor_user_id_occurred_at_idx" ON "audit_events"("merchant_id", "actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_merchant_id_action_occurred_at_idx" ON "audit_events"("merchant_id", "action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_merchant_id_branch_id_occurred_at_idx" ON "audit_events"("merchant_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_dedupe_key_key" ON "outbox_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_jobs_status_next_run_at_idx" ON "outbox_jobs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "outbox_jobs_merchant_id_status_idx" ON "outbox_jobs"("merchant_id", "status");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_settings" ADD CONSTRAINT "merchant_settings_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_memberships" ADD CONSTRAINT "staff_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branch_assignments" ADD CONSTRAINT "staff_branch_assignments_staff_membership_id_merchant_id_fkey" FOREIGN KEY ("staff_membership_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_branch_assignments" ADD CONSTRAINT "staff_branch_assignments_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_merchant_id_fkey" FOREIGN KEY ("customer_id", "merchant_id") REFERENCES "customers"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_definitions" ADD CONSTRAINT "reward_definitions_program_id_merchant_id_fkey" FOREIGN KEY ("program_id", "merchant_id") REFERENCES "loyalty_programs"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_customer_id_merchant_id_fkey" FOREIGN KEY ("customer_id", "merchant_id") REFERENCES "customers"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_memberships" ADD CONSTRAINT "customer_memberships_program_id_merchant_id_fkey" FOREIGN KEY ("program_id", "merchant_id") REFERENCES "loyalty_programs"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_passes" ADD CONSTRAINT "wallet_passes_membership_id_merchant_id_fkey" FOREIGN KEY ("membership_id", "merchant_id") REFERENCES "customer_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_membership_id_merchant_id_program_id_fkey" FOREIGN KEY ("membership_id", "merchant_id", "program_id") REFERENCES "customer_memberships"("id", "merchant_id", "program_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stamp_events" ADD CONSTRAINT "stamp_events_staff_membership_id_merchant_id_fkey" FOREIGN KEY ("staff_membership_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_unlocks" ADD CONSTRAINT "reward_unlocks_membership_id_merchant_id_program_id_fkey" FOREIGN KEY ("membership_id", "merchant_id", "program_id") REFERENCES "customer_memberships"("id", "merchant_id", "program_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_unlocks" ADD CONSTRAINT "reward_unlocks_reward_definition_id_merchant_id_program_id_fkey" FOREIGN KEY ("reward_definition_id", "merchant_id", "program_id") REFERENCES "reward_definitions"("id", "merchant_id", "program_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_unlocks" ADD CONSTRAINT "reward_unlocks_triggering_stamp_id_merchant_id_fkey" FOREIGN KEY ("triggering_stamp_id", "merchant_id") REFERENCES "stamp_events"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_events" ADD CONSTRAINT "redemption_events_reward_unlock_id_merchant_id_fkey" FOREIGN KEY ("reward_unlock_id", "merchant_id") REFERENCES "reward_unlocks"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_events" ADD CONSTRAINT "redemption_events_membership_id_merchant_id_fkey" FOREIGN KEY ("membership_id", "merchant_id") REFERENCES "customer_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_events" ADD CONSTRAINT "redemption_events_branch_id_merchant_id_fkey" FOREIGN KEY ("branch_id", "merchant_id") REFERENCES "branches"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_events" ADD CONSTRAINT "redemption_events_staff_membership_id_merchant_id_fkey" FOREIGN KEY ("staff_membership_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal_events" ADD CONSTRAINT "reversal_events_membership_id_merchant_id_fkey" FOREIGN KEY ("membership_id", "merchant_id") REFERENCES "customer_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal_events" ADD CONSTRAINT "reversal_events_stamp_event_id_merchant_id_fkey" FOREIGN KEY ("stamp_event_id", "merchant_id") REFERENCES "stamp_events"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal_events" ADD CONSTRAINT "reversal_events_redemption_event_id_merchant_id_fkey" FOREIGN KEY ("redemption_event_id", "merchant_id") REFERENCES "redemption_events"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal_events" ADD CONSTRAINT "reversal_events_reversed_by_staff_id_merchant_id_fkey" FOREIGN KEY ("reversed_by_staff_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_staff_membership_id_merchant_id_fkey" FOREIGN KEY ("staff_membership_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
