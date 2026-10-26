-- Quadro de som: sons curtos de um espaço. Só acrescenta uma tabela: nada que já existe é alterado ou apagado.

-- CreateTable
CREATE TABLE "SoundClip" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "emoji" VARCHAR(16),
    "uploaderId" TEXT NOT NULL,
    "contentType" VARCHAR(30) NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SoundClip_spaceId_createdAt_idx" ON "SoundClip"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "SoundClip" ADD CONSTRAINT "SoundClip_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
