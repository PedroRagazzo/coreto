-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginName" VARCHAR(32),
ADD COLUMN     "pinHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_loginName_key" ON "User"("loginName");


-- O robô dos espaços de demonstração reserva o próprio nome: ninguém entra como "Coreto".
UPDATE "User" SET "loginName" = lower("displayName") WHERE "isBot";
