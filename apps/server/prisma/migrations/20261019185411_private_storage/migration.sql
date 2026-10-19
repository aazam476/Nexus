-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sealedBody" BYTEA,
ADD COLUMN     "sealedSummary" BYTEA;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "storageKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "privateStorage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storagePrivateKey" TEXT,
ADD COLUMN     "storagePublicKey" TEXT;

