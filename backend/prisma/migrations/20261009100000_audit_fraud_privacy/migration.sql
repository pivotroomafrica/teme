-- CreateEnum
CREATE TYPE "fraud_indicator" AS ENUM ('EXCESSIVE_STAMPS_BY_STAFF', 'REPEATED_SCANS_FOR_MEMBERSHIP', 'UNUSUAL_BRANCH_ACTIVITY', 'HIGH_REVERSAL_RATE', 'REPEATED_COOLDOWN_REJECTIONS', 'EXCESSIVE_REDEMPTIONS');

-- CreateEnum
CREATE TYPE "fraud_subject_type" AS ENUM ('STAFF', 'MEMBERSHIP', 'BRANCH');

-- CreateEnum
CREATE TYPE "fraud_flag_status" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "idempotency_records" ADD COLUMN     "membership_id" UUID;

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "indicator" "fraud_indicator" NOT NULL,
    "subject_type" "fraud_subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "observed" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" "fraud_flag_status" NOT NULL DEFAULT 'OPEN',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fraud_flags_merchant_id_status_created_at_idx" ON "fraud_flags"("merchant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fraud_flags_merchant_id_subject_type_subject_id_idx" ON "fraud_flags"("merchant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_flags_merchant_id_indicator_subject_type_subject_id_w_key" ON "fraud_flags"("merchant_id", "indicator", "subject_type", "subject_id", "window_start");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_id_idx" ON "audit_events"("occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idempotency_records_merchant_id_membership_id_idx" ON "idempotency_records"("merchant_id", "membership_id");

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A flag is a signal, not a verdict: reviewed flags record who reviewed and when; open ones do not.
ALTER TABLE "fraud_flags"
  ADD CONSTRAINT "fraud_flags_window_order" CHECK (window_end > window_start),
  ADD CONSTRAINT "fraud_flags_review_consistent" CHECK (
    (status = 'OPEN' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (status <> 'OPEN' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  ADD CONSTRAINT "fraud_flags_note_length" CHECK (review_note IS NULL OR char_length(review_note) <= 500);
