-- CreateIndex
CREATE INDEX "customers_merchant_id_created_at_id_idx" ON "customers"("merchant_id", "created_at" DESC, "id" DESC);
