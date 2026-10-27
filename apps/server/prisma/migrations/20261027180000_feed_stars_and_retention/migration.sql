-- AlterTable
ALTER TABLE "FeedItem" ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Preference" ADD COLUMN     "feedRetentionDays" INTEGER;

