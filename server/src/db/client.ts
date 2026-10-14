import { PrismaPg } from '@prisma/adapter-pg';
import { createHash } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;

export function createDb(url = process.env.DATABASE_URL): Db {
  if (!url) {
    throw new Error('DATABASE_URL não definida. Copie server/.env.example para server/.env e ajuste a conexão.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** O banco guarda só o hash do token de sessão, nunca o token. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
