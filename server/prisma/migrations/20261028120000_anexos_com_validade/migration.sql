-- Validade dos anexos. Só acrescenta uma coluna nula e um índice: nada que já existe é alterado ou apagado.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "expiredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Attachment_createdAt_expiredAt_idx" ON "Attachment"("createdAt", "expiredAt");
