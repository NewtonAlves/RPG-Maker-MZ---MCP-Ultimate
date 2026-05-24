/**
 * Snapshot/restore de projeto pra rollback após operações destrutivas.
 *
 * Conteúdo do snapshot:
 *   - data/
 *   - js/plugins/
 *   - js/plugins.js
 *   - mz-mcp.config.json (se existir)
 *
 * Localização: <project>/.mz-mcp/backups/<ISO timestamp>/
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { mzError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const BACKUP_TARGETS = [
  { src: 'data', kind: 'dir' as const },
  { src: 'js/plugins', kind: 'dir' as const },
  { src: 'js/plugins.js', kind: 'file' as const },
  { src: 'mz-mcp.config.json', kind: 'file' as const },
];

export interface Snapshot {
  id: string;
  timestamp: string;
  label?: string;
  path: string;
  sizeBytes: number;
}

export async function createSnapshot(
  projectPath: string,
  backupDir: string,
  label?: string,
): Promise<Snapshot> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = label ? `${timestamp}--${label}` : timestamp;
  const snapshotPath = path.resolve(projectPath, backupDir, id);

  await fs.mkdir(snapshotPath, { recursive: true });

  let totalSize = 0;
  for (const target of BACKUP_TARGETS) {
    const srcPath = path.join(projectPath, target.src);
    const dstPath = path.join(snapshotPath, target.src);

    try {
      if (target.kind === 'dir') {
        totalSize += await copyDir(srcPath, dstPath);
      } else {
        const size = await copyFile(srcPath, dstPath);
        totalSize += size;
      }
    } catch (err) {
      // Source pode não existir (ex.: mz-mcp.config.json ainda não criado) — ok
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw mzError(
          'backup_failed',
          `Falha copiando ${srcPath} pra snapshot: ${(err as Error).message}`,
        );
      }
    }
  }

  // Manifest
  const manifest = {
    id,
    timestamp,
    label,
    targets: BACKUP_TARGETS.map((t) => t.src),
    sizeBytes: totalSize,
  };
  await fs.writeFile(path.join(snapshotPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

  logger.info(`Snapshot criado: ${id} (${formatBytes(totalSize)})`);

  return {
    id,
    timestamp,
    label,
    path: snapshotPath,
    sizeBytes: totalSize,
  };
}

export async function listSnapshots(projectPath: string, backupDir: string): Promise<Snapshot[]> {
  const dir = path.resolve(projectPath, backupDir);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const snapshots: Snapshot[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifestPath = path.join(dir, e.name, 'manifest.json');
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        const m = JSON.parse(raw);
        snapshots.push({
          id: m.id ?? e.name,
          timestamp: m.timestamp ?? e.name,
          label: m.label,
          path: path.join(dir, e.name),
          sizeBytes: m.sizeBytes ?? 0,
        });
      } catch {
        // Skip — snapshot quebrado
      }
    }
    return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}

/** Mantém apenas os N snapshots mais recentes; remove o resto. */
export async function pruneSnapshots(
  projectPath: string,
  backupDir: string,
  retention: number,
): Promise<number> {
  const snapshots = await listSnapshots(projectPath, backupDir);
  const toRemove = snapshots.slice(retention);
  for (const s of toRemove) {
    await fs.rm(s.path, { recursive: true, force: true });
  }
  return toRemove.length;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

async function copyDir(src: string, dst: string): Promise<number> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  let total = 0;
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      total += await copyDir(s, d);
    } else if (e.isFile()) {
      total += await copyFile(s, d);
    }
  }
  return total;
}

async function copyFile(src: string, dst: string): Promise<number> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  const stat = await fs.stat(dst);
  return stat.size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
