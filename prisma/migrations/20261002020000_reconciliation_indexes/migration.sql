-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_receivedAt_idx" ON "WebhookEvent"("processedAt", "receivedAt");

