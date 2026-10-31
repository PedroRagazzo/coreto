import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diskUsage } from '../../src/disk.js';

describe('diskUsage', () => {
  it('lê o total, o livre e o percentual ocupado do disco de uma pasta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'coreto-disk-'));
    try {
      const usage = await diskUsage(dir);
      expect(usage).not.toBeNull();
      expect(usage!.totalBytes).toBeGreaterThan(0);
      expect(usage!.freeBytes).toBeGreaterThanOrEqual(0);
      expect(usage!.freeBytes).toBeLessThanOrEqual(usage!.totalBytes);
      expect(usage!.usedPercent).toBeGreaterThanOrEqual(0);
      expect(usage!.usedPercent).toBeLessThanOrEqual(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pasta que não existe: devolve null, sem lançar erro', async () => {
    expect(await diskUsage(join(tmpdir(), 'coreto-nao-existe-', 'x'))).toBeNull();
  });
});
