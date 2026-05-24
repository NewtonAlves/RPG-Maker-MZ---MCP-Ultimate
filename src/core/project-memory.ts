/**
 * Sistema de memória persistente do projeto.
 *
 * Mantém um índice estruturado de fatos do projeto entre sessões — design
 * decisions, convenções, lore, regras de balanceamento, notas de WIP e
 * handoffs entre agentes. Storage local em .mz-mcp/memory/.
 *
 * Estrutura:
 *   .mz-mcp/memory/
 *     index.json                    # { key: { category, created, updated, author, tags, preview } }
 *     entries/<sha1-of-key>.md      # conteúdo livre (markdown)
 *
 * Atomicidade: writes vão via SafeWriter pattern (tmp + rename).
 * Concurrency: índice é re-lido antes de cada write pra evitar perda em multi-agent.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import type { Config } from '../config.js';
import { mzError } from '../utils/errors.js';

/* ============================ Tipos ============================ */

export const MEMORY_CATEGORIES = [
  'design_decisions',
  'conventions',
  'lore',
  'balance_rules',
  'wip_notes',
  'agent_handoff',
  'custom',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface MemoryEntry {
  /** Chave única — pode ser slug, frase, ID de design, etc. */
  key: string;
  category: MemoryCategory;
  /** Conteúdo livre (markdown recomendado mas qualquer texto). */
  content: string;
  /** Tags opcionais pra busca cruzada (ex: ['boss', 'fire', 'level10']). */
  tags: string[];
  /** Timestamp ISO 8601 de criação. */
  created: string;
  /** Timestamp ISO 8601 de última atualização. */
  updated: string;
  /** Nome do agente/sessão que criou ou modificou (informativo). */
  author: string;
  /** Preview (primeiros 120 chars) — pra listagens sem ler arquivo cheio. */
  preview: string;
}

export interface MemoryIndex {
  version: 1;
  entries: Record<string, Omit<MemoryEntry, 'content'>>;
}

/* ============================ Paths ============================ */

function memoryDir(config: Config): string {
  return path.join(config.project.path, '.mz-mcp', 'memory');
}

function indexPath(config: Config): string {
  return path.join(memoryDir(config), 'index.json');
}

function entriesDir(config: Config): string {
  return path.join(memoryDir(config), 'entries');
}

function entryFileName(key: string): string {
  // SHA1 pra ter nome de arquivo válido independente de chars do key
  const hash = crypto.createHash('sha1').update(key, 'utf-8').digest('hex');
  return `${hash}.md`;
}

function entryPath(config: Config, key: string): string {
  return path.join(entriesDir(config), entryFileName(key));
}

/* ============================ I/O ============================ */

async function ensureDirs(config: Config): Promise<void> {
  await fs.mkdir(entriesDir(config), { recursive: true });
}

async function loadIndex(config: Config): Promise<MemoryIndex> {
  try {
    const raw = await fs.readFile(indexPath(config), 'utf-8');
    const parsed = JSON.parse(raw) as MemoryIndex;
    if (!parsed.entries) return { version: 1, entries: {} };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, entries: {} };
    }
    throw err;
  }
}

async function saveIndex(config: Config, index: MemoryIndex): Promise<void> {
  await ensureDirs(config);
  const file = indexPath(config);
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

async function saveEntryContent(config: Config, key: string, content: string): Promise<void> {
  await ensureDirs(config);
  const file = entryPath(config, key);
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, file);
}

async function loadEntryContent(config: Config, key: string): Promise<string | null> {
  try {
    return await fs.readFile(entryPath(config, key), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function deleteEntryFile(config: Config, key: string): Promise<void> {
  try {
    await fs.unlink(entryPath(config, key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/* ============================ Public API ============================ */

function makePreview(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
}

export interface RememberOptions {
  category: MemoryCategory;
  key: string;
  content: string;
  tags?: string[];
  author?: string;
}

export async function remember(
  config: Config,
  options: RememberOptions,
): Promise<MemoryEntry> {
  const { category, key, content, tags = [], author = 'mcp-agent' } = options;

  if (!key || key.trim().length === 0) {
    throw mzError('schema_validation_failed', 'key não pode ser vazio');
  }
  if (key.length > 200) {
    throw mzError('schema_validation_failed', 'key tem máximo 200 chars');
  }
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw mzError(
      'schema_validation_failed',
      `category inválida: ${category}. Use: ${MEMORY_CATEGORIES.join(', ')}`,
    );
  }
  if (!content || content.trim().length === 0) {
    throw mzError('schema_validation_failed', 'content não pode ser vazio');
  }

  // Re-lê o índice imediatamente antes de modificar (multi-agent safety)
  const index = await loadIndex(config);
  const existing = index.entries[key];
  const now = new Date().toISOString();

  const entry: MemoryEntry = {
    key,
    category,
    content,
    tags,
    created: existing?.created ?? now,
    updated: now,
    author,
    preview: makePreview(content),
  };

  // Persiste conteúdo primeiro (se falhar, índice fica consistente)
  await saveEntryContent(config, key, content);

  // Atualiza índice
  const { content: _omit, ...metadata } = entry;
  index.entries[key] = metadata;
  await saveIndex(config, index);

  return entry;
}

export interface RecallOptions {
  /** Filtra por categoria. */
  category?: MemoryCategory;
  /** Busca por substring em key, content ou tags (case-insensitive). */
  search?: string;
  /** Filtra por tags (ANY match). */
  tags?: string[];
  /** Limite de resultados (default: 50). */
  limit?: number;
}

export interface RecallResult {
  count: number;
  entries: MemoryEntry[];
  totalInProject: number;
}

export async function recall(config: Config, options: RecallOptions = {}): Promise<RecallResult> {
  const { category, search, tags, limit = 50 } = options;
  const index = await loadIndex(config);
  const keys = Object.keys(index.entries);
  const total = keys.length;

  let filtered = keys
    .map((k) => index.entries[k]!)
    .filter((m) => !category || m.category === category)
    .filter((m) => {
      if (!tags || tags.length === 0) return true;
      return tags.some((t) => m.tags.includes(t));
    });

  // Search precisa carregar content; só faz pra subset filtered
  if (search && search.trim().length > 0) {
    const q = search.toLowerCase();
    const matches: typeof filtered = [];
    for (const m of filtered) {
      if (
        m.key.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        matches.push(m);
        continue;
      }
      // Match em content cheio (mais caro)
      const content = await loadEntryContent(config, m.key);
      if (content && content.toLowerCase().includes(q)) {
        matches.push(m);
      }
    }
    filtered = matches;
  }

  // Sort: updated desc
  filtered.sort((a, b) => (a.updated > b.updated ? -1 : 1));

  // Trunca + hidrata content
  const taken = filtered.slice(0, limit);
  const entries: MemoryEntry[] = [];
  for (const m of taken) {
    const content = (await loadEntryContent(config, m.key)) ?? '';
    entries.push({ ...m, content });
  }

  return { count: entries.length, entries, totalInProject: total };
}

export async function forget(config: Config, key: string): Promise<{ deleted: boolean; key: string }> {
  const index = await loadIndex(config);
  if (!index.entries[key]) {
    return { deleted: false, key };
  }
  delete index.entries[key];
  await saveIndex(config, index);
  await deleteEntryFile(config, key);
  return { deleted: true, key };
}

export interface CategoryInfo {
  category: MemoryCategory;
  count: number;
  mostRecent?: string;
}

export async function categories(config: Config): Promise<CategoryInfo[]> {
  const index = await loadIndex(config);
  const grouped = new Map<MemoryCategory, MemoryEntry[]>();
  for (const cat of MEMORY_CATEGORIES) grouped.set(cat, []);
  for (const m of Object.values(index.entries)) {
    const list = grouped.get(m.category) ?? [];
    list.push(m as MemoryEntry);
    grouped.set(m.category, list);
  }
  const result: CategoryInfo[] = [];
  for (const cat of MEMORY_CATEGORIES) {
    const list = grouped.get(cat) ?? [];
    list.sort((a, b) => (a.updated > b.updated ? -1 : 1));
    result.push({
      category: cat,
      count: list.length,
      mostRecent: list[0]?.updated,
    });
  }
  return result;
}

export async function list(
  config: Config,
  category?: MemoryCategory,
): Promise<{ count: number; keys: Array<{ key: string; category: MemoryCategory; updated: string; preview: string }> }> {
  const index = await loadIndex(config);
  let entries = Object.values(index.entries);
  if (category) entries = entries.filter((e) => e.category === category);
  entries.sort((a, b) => (a.updated > b.updated ? -1 : 1));
  return {
    count: entries.length,
    keys: entries.map((e) => ({
      key: e.key,
      category: e.category,
      updated: e.updated,
      preview: e.preview,
    })),
  };
}
