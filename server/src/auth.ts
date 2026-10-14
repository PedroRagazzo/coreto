// Login por nome + PIN de 4 dígitos. Depois do login a sessão não expira:
// o navegador guarda o token e fica sempre conectado.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (pin: string, salt: Buffer, length: number) => Promise<Buffer>;

/** "sal:hash" em hex. Com só 10 mil PINs possíveis, o sal impede tabelas prontas. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(pin, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const newSessionToken = (): string => randomBytes(32).toString('base64url');

/**
 * Freio contra adivinhar o PIN: depois de `maxFailures` erros seguidos num
 * nome, ele fica bloqueado por `lockMs`. Fica em memória; reiniciar o servidor zera.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, { failures: number; lockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly lockMs = 60_000,
  ) {}

  /** Milissegundos que ainda faltam de bloqueio (0 = liberado). */
  remainingLock(key: string): number {
    return Math.max(0, (this.entries.get(key)?.lockedUntil ?? 0) - Date.now());
  }

  recordFailure(key: string): void {
    const entry = this.entries.get(key) ?? { failures: 0, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      entry.failures = 0;
      entry.lockedUntil = Date.now() + this.lockMs;
    }
    this.entries.set(key, entry);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }
}
