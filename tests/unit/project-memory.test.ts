import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  categories,
  forget,
  list,
  MEMORY_CATEGORIES,
  recall,
  remember,
} from '../../src/core/project-memory.js';
import type { Config } from '../../src/config.js';

async function freshConfig(): Promise<Config> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mem-'));
  return {
    project: {
      path: dir,
      autoBackup: false,
      backupRetention: 5,
      backupDir: '.mz-mcp/backups',
    },
    editor: { onLock: 'ignore' },
    mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
    runtime: { enableEvalJs: false, companionPort: 0, tokenFile: '.mz-mcp/companion.token' },
    plugins: { defaultNamingConvention: 'snake', knownBases: {} },
    logging: { level: 'error' },
    dashboard: { enabled: false, port: 0 },
  } as Config;
}

describe('project-memory', () => {
  let config: Config;

  beforeEach(async () => {
    config = await freshConfig();
  });

  it('remembers and recalls a single entry', async () => {
    const entry = await remember(config, {
      category: 'design_decisions',
      key: 'reid_starts_weak',
      content: 'O protagonista Reid começa fraco propositalmente, pra o jogador sentir o crescimento.',
      tags: ['protagonist', 'design'],
    });

    expect(entry.key).toBe('reid_starts_weak');
    expect(entry.category).toBe('design_decisions');
    expect(entry.created).toBeTruthy();
    expect(entry.tags).toEqual(['protagonist', 'design']);

    const result = await recall(config);
    expect(result.count).toBe(1);
    expect(result.entries[0]!.content).toContain('protagonista Reid');
  });

  it('filters recall by category', async () => {
    await remember(config, { category: 'lore', key: 'kim_origin', content: 'Kim veio de outra dimensão.' });
    await remember(config, { category: 'balance_rules', key: 'boss_xp', content: 'Bosses dão 5x XP de mob comum.' });

    const lore = await recall(config, { category: 'lore' });
    expect(lore.count).toBe(1);
    expect(lore.entries[0]!.key).toBe('kim_origin');

    const balance = await recall(config, { category: 'balance_rules' });
    expect(balance.count).toBe(1);
    expect(balance.entries[0]!.key).toBe('boss_xp');
  });

  it('searches by substring in content', async () => {
    await remember(config, {
      category: 'conventions',
      key: 'naming_npcs',
      content: 'NPCs sempre em português brasileiro, primeira letra maiúscula.',
    });
    await remember(config, {
      category: 'conventions',
      key: 'naming_skills',
      content: 'Skills usam verbos no infinitivo.',
    });

    const found = await recall(config, { search: 'português' });
    expect(found.count).toBe(1);
    expect(found.entries[0]!.key).toBe('naming_npcs');
  });

  it('filters by tags (ANY match)', async () => {
    await remember(config, {
      category: 'design_decisions',
      key: 'fire_boss',
      content: 'Boss de fogo da Caverna 1 deve ser vulnerável a água.',
      tags: ['boss', 'fire', 'caverna1'],
    });
    await remember(config, {
      category: 'design_decisions',
      key: 'ice_boss',
      content: 'Boss de gelo deve ser tank.',
      tags: ['boss', 'ice'],
    });

    const bossEntries = await recall(config, { tags: ['boss'] });
    expect(bossEntries.count).toBe(2);

    const fireOnly = await recall(config, { tags: ['fire'] });
    expect(fireOnly.count).toBe(1);
    expect(fireOnly.entries[0]!.key).toBe('fire_boss');
  });

  it('updates entry (preserves created, bumps updated)', async () => {
    const first = await remember(config, {
      category: 'wip_notes',
      key: 'fix_npc_5',
      content: 'NPC do mapa 5 tem diálogo quebrado.',
    });

    await new Promise((r) => setTimeout(r, 10));

    const second = await remember(config, {
      category: 'wip_notes',
      key: 'fix_npc_5',
      content: 'NPC do mapa 5 — RESOLVIDO. Diálogo corrigido.',
    });

    expect(second.created).toBe(first.created);
    expect(second.updated).not.toBe(first.created);
    expect(second.content).toContain('RESOLVIDO');
  });

  it('forgets an entry', async () => {
    await remember(config, { category: 'wip_notes', key: 'temp', content: 'temporário' });
    let result = await recall(config);
    expect(result.count).toBe(1);

    const forgotten = await forget(config, 'temp');
    expect(forgotten.deleted).toBe(true);

    result = await recall(config);
    expect(result.count).toBe(0);

    const second = await forget(config, 'temp');
    expect(second.deleted).toBe(false);
  });

  it('lists with metadata only (no content)', async () => {
    await remember(config, { category: 'lore', key: 'a', content: 'aaaa' });
    await remember(config, { category: 'lore', key: 'b', content: 'bbbb' });

    const listed = await list(config, 'lore');
    expect(listed.count).toBe(2);
    expect(listed.keys.map((k) => k.key).sort()).toEqual(['a', 'b']);
    expect(listed.keys[0]).toHaveProperty('updated');
    expect(listed.keys[0]).toHaveProperty('preview');
  });

  it('categories() returns count per category', async () => {
    await remember(config, { category: 'lore', key: 'a', content: 'x' });
    await remember(config, { category: 'lore', key: 'b', content: 'y' });
    await remember(config, { category: 'wip_notes', key: 'c', content: 'z' });

    const cats = await categories(config);
    expect(cats).toHaveLength(MEMORY_CATEGORIES.length);
    expect(cats.find((c) => c.category === 'lore')!.count).toBe(2);
    expect(cats.find((c) => c.category === 'wip_notes')!.count).toBe(1);
    expect(cats.find((c) => c.category === 'design_decisions')!.count).toBe(0);
  });

  it('rejects empty key', async () => {
    await expect(
      remember(config, { category: 'lore', key: '', content: 'x' }),
    ).rejects.toThrow(/key/);
  });

  it('rejects invalid category', async () => {
    await expect(
      remember(config, { category: 'invalid' as never, key: 'x', content: 'y' }),
    ).rejects.toThrow(/category/);
  });

  it('rejects empty content', async () => {
    await expect(
      remember(config, { category: 'lore', key: 'x', content: '' }),
    ).rejects.toThrow(/content/);
  });
});
