-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookOutcome" AS ENUM ('APPLIED', 'IGNORED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Centre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticTest" (
    "id" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "centreId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "appointmentAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerTxnId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "eventId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" "WebhookOutcome",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticTest_centreId_name_key" ON "DiagnosticTest"("centreId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticTest_id_centreId_key" ON "DiagnosticTest"("id", "centreId");

-- CreateIndex
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_centreId_idx" ON "Booking"("centreId");

-- CreateIndex
CREATE INDEX "Booking_testId_centreId_idx" ON "Booking"("testId", "centreId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerTxnId_key" ON "Payment"("providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "WebhookEvent_paymentId_idx" ON "WebhookEvent"("paymentId");

-- AddForeignKey
ALTER TABLE "DiagnosticTest" ADD CONSTRAINT "DiagnosticTest_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_testId_centreId_fkey" FOREIGN KEY ("testId", "centreId") REFERENCES "DiagnosticTest"("id", "centreId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex (partial; not expressible in schema.prisma)
CREATE UNIQUE INDEX "Payment_bookingId_active_key" ON "Payment"("bookingId") WHERE "status" IN ('PENDING', 'SUCCESS');
