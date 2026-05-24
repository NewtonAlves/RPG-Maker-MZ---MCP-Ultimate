/**
 * Bump do `versionId` em data/System.json.
 *
 * O editor RPG Maker MZ usa esse número pra detectar mudanças externas no
 * projeto. Quando bumpamos, o editor recarrega automaticamente o data/ na
 * próxima vez que ler. Padrão inspirado no MCP-Maker.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { inProject, safeWrite } from './safe-writer.js';

/** Lê System.json, incrementa versionId, salva. Retorna o novo valor. */
export async function bumpSystemVersionId(projectPath: string): Promise<number> {
  const systemPath = inProject(projectPath, 'data', 'System.json');
  const raw = await fs.readFile(systemPath, 'utf-8');
  const system = JSON.parse(raw);

  const current = typeof system.versionId === 'number' ? system.versionId : 0;
  const next = current + 1;
  system.versionId = next;

  // System.json sem indentação (formato canônico do MZ)
  await safeWrite(systemPath, JSON.stringify(system) + '\n');
  return next;
}

/** Leitura simples do versionId atual sem mutação. */
export async function readSystemVersionId(projectPath: string): Promise<number | undefined> {
  const systemPath = path.join(projectPath, 'data', 'System.json');
  try {
    const raw = await fs.readFile(systemPath, 'utf-8');
    const system = JSON.parse(raw);
    return typeof system.versionId === 'number' ? system.versionId : undefined;
  } catch {
    return undefined;
  }
}
