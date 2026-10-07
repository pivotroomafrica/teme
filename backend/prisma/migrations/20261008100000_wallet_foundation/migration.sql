-- AlterTable
ALTER TABLE "wallet_passes" ADD COLUMN     "barcode_hash" TEXT,
ADD COLUMN     "barcode_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "last_synced_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "apple_device_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "wallet_pass_id" UUID NOT NULL,
    "device_library_identifier" TEXT NOT NULL,
    "push_token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "apple_device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apple_device_registrations_device_library_identifier_idx" ON "apple_device_registrations"("device_library_identifier");

-- CreateIndex
CREATE UNIQUE INDEX "apple_device_registrations_wallet_pass_id_device_library_id_key" ON "apple_device_registrations"("wallet_pass_id", "device_library_identifier");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_passes_barcode_hash_key" ON "wallet_passes"("barcode_hash");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_passes_id_merchant_id_key" ON "wallet_passes"("id", "merchant_id");

-- AddForeignKey
ALTER TABLE "apple_device_registrations" ADD CONSTRAINT "apple_device_registrations_wallet_pass_id_merchant_id_fkey" FOREIGN KEY ("wallet_pass_id", "merchant_id") REFERENCES "wallet_passes"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

