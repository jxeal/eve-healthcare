-- CreateTable
CREATE TABLE "SimulatedCharge" (
    "reference" TEXT NOT NULL,
    "providerTxnId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulatedCharge_pkey" PRIMARY KEY ("reference")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedCharge_providerTxnId_key" ON "SimulatedCharge"("providerTxnId");

