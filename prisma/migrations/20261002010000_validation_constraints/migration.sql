-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- AlterTable: emails compare case-insensitively, so the unique index rejects case variants
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- AddCheckConstraints (not expressible in schema.prisma)
ALTER TABLE "DiagnosticTest" ADD CONSTRAINT "DiagnosticTest_price_positive" CHECK ("price" > 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
