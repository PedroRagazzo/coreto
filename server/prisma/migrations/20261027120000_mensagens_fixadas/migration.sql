-- Mensagens fixadas. Só acrescenta colunas nulas e índices: nada que já existe é alterado ou apagado.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "pinnedAt" TIMESTAMP(3),
ADD COLUMN "pinnedById" TEXT;

-- CreateIndex
CREATE INDEX "Message_channelId_pinnedAt_idx" ON "Message"("channelId", "pinnedAt");

-- CreateIndex
CREATE INDEX "Message_directId_pinnedAt_idx" ON "Message"("directId", "pinnedAt");
