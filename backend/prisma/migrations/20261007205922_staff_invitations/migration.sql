-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invitations_merchant_id_staff_membership_id_idx" ON "staff_invitations"("merchant_id", "staff_membership_id");

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_staff_membership_id_merchant_id_fkey" FOREIGN KEY ("staff_membership_id", "merchant_id") REFERENCES "staff_memberships"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
