-- CreateTable
CREATE TABLE "ServerPlugin" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServerPlugin_pkey" PRIMARY KEY ("id")
);
