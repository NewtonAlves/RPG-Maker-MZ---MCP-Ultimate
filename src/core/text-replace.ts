/**
 * Busca e substituição de texto project-wide em command lists de evento.
 *
 * Cobre Show Text (401) e Scroll Text (405) em:
 *   - todos os mapas (Map###.json)
 *   - todos os common events (CommonEvents.json)
 *   - todos os battle events de troops (Troops.json)
 *
 * Substring literal (não regex) por segurança. dryRun por padrão. Quando aplica,
 * cria UM snapshot antes de tudo e escreve só os arquivos que mudaram.
 */

import type { Config } from '../config.js';
import { listMapIds, loadMap, saveMap } from './map-io.js';
import { loadDbRaw, saveDbRaw } from './db-io.js';
import { createSnapshot } from './backup.js';

export interface ReplaceOccurrence {
  location:
    | { kind: 'map_event'; mapId: number; eventId: number; pageIndex: number }
    | { kind: 'common_event'; commonEventId: number }
    | { kind: 'troop_event'; troopId: number; pageIndex: number };
  commandIndex: number;
  before: string;
  after: string;
  count: number;
}

export interface TextReplaceResult {
  find: string;
  replace: string;
  caseSensitive: boolean;
  dryRun: boolean;
  totalOccurrences: number;
  filesAffected: number;
  occurrences: ReplaceOccurrence[];
}

/** Conta e substitui ocorrências literais. Retorna [novoTexto, count]. */
function replaceCount(text: string, find: string, replace: string, caseSensitive: boolean): [string, number] {
  if (typeof text !== 'string' || find.length === 0) return [text, 0];
  if (caseSensitive) {
    const parts = text.split(find);
    const count = parts.length - 1;
    return [count > 0 ? parts.join(replace) : text, count];
  }
  // Case-insensitive: varre manualmente preservando o texto original onde não bate
  const lower = text.toLowerCase();
  const flower = find.toLowerCase();
  let idx = 0;
  let count = 0;
  let result = '';
  let last = 0;
  while ((idx = lower.indexOf(flower, idx)) !== -1) {
    result += text.slice(last, idx) + replace;
    idx += flower.length;
    last = idx;
    count++;
  }
  result += text.slice(last);
  return [count > 0 ? result : text, count];
}

export interface TextReplaceOptions {
  find: string;
  replace: string;
  caseSensitive?: boolean;
  dryRun?: boolean;
  limit?: number;
}

const TEXT_CODES = new Set([401, 405]); // Show Text line, Scroll Text line

export async function textReplaceAll(
  config: Config,
  options: TextReplaceOptions,
): Promise<TextReplaceResult> {
  const { find, replace, caseSensitive = true, dryRun = true, limit = 1000 } = options;
  const occurrences: ReplaceOccurrence[] = [];
  let totalOccurrences = 0;

  // Coleta o que mudou pra escrever só esses arquivos
  const changedMaps = new Set<number>();
  let commonEventsChanged = false;
  let troopsChanged = false;

  // ---- Maps ----
  const mapIds = await listMapIds(config);
  const mapCache = new Map<number, Awaited<ReturnType<typeof loadMap>>>();
  for (const mapId of mapIds) {
    let map;
    try {
      map = await loadMap(config, mapId);
    } catch {
      continue;
    }
    let mapChanged = false;
    if (Array.isArray(map.events)) {
      for (const ev of map.events) {
        if (!ev || !ev.pages) continue;
        for (let pageIndex = 0; pageIndex < ev.pages.length; pageIndex++) {
          const list = ev.pages[pageIndex]?.list;
          if (!Array.isArray(list)) continue;
          for (let ci = 0; ci < list.length; ci++) {
            const cmd = list[ci] as { code: number; parameters?: unknown[] };
            if (!cmd || !TEXT_CODES.has(cmd.code)) continue;
            const text = cmd.parameters?.[0];
            if (typeof text !== 'string') continue;
            const [newText, count] = replaceCount(text, find, replace, caseSensitive);
            if (count > 0) {
              totalOccurrences += count;
              if (occurrences.length < limit) {
                occurrences.push({
                  location: { kind: 'map_event', mapId, eventId: ev.id, pageIndex },
                  commandIndex: ci,
                  before: text,
                  after: newText,
                  count,
                });
              }
              if (!dryRun) {
                cmd.parameters![0] = newText;
                mapChanged = true;
              }
            }
          }
        }
      }
    }
    if (mapChanged) {
      changedMaps.add(mapId);
      mapCache.set(mapId, map);
    }
  }

  // ---- Common Events ----
  const ceRaw = await loadDbRaw(config, 'common_event');
  for (const ce of ceRaw) {
    if (!ce) continue;
    const list = ce.list as Array<{ code: number; parameters?: unknown[] }> | undefined;
    if (!Array.isArray(list)) continue;
    for (let ci = 0; ci < list.length; ci++) {
      const cmd = list[ci];
      if (!cmd || !TEXT_CODES.has(cmd.code)) continue;
      const text = cmd.parameters?.[0];
      if (typeof text !== 'string') continue;
      const [newText, count] = replaceCount(text, find, replace, caseSensitive);
      if (count > 0) {
        totalOccurrences += count;
        if (occurrences.length < limit) {
          occurrences.push({
            location: { kind: 'common_event', commonEventId: ce.id as number },
            commandIndex: ci,
            before: text,
            after: newText,
            count,
          });
        }
        if (!dryRun) {
          cmd.parameters![0] = newText;
          commonEventsChanged = true;
        }
      }
    }
  }

  // ---- Troops ----
  const troopRaw = await loadDbRaw(config, 'troop');
  for (const tr of troopRaw) {
    if (!tr) continue;
    const pages = tr.pages as Array<{ list?: Array<{ code: number; parameters?: unknown[] }> }> | undefined;
    if (!Array.isArray(pages)) continue;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const list = pages[pageIndex]?.list;
      if (!Array.isArray(list)) continue;
      for (let ci = 0; ci < list.length; ci++) {
        const cmd = list[ci];
        if (!cmd || !TEXT_CODES.has(cmd.code)) continue;
        const text = cmd.parameters?.[0];
        if (typeof text !== 'string') continue;
        const [newText, count] = replaceCount(text, find, replace, caseSensitive);
        if (count > 0) {
          totalOccurrences += count;
          if (occurrences.length < limit) {
            occurrences.push({
              location: { kind: 'troop_event', troopId: tr.id as number, pageIndex },
              commandIndex: ci,
              before: text,
              after: newText,
              count,
            });
          }
          if (!dryRun) {
            cmd.parameters![0] = newText;
            troopsChanged = true;
          }
        }
      }
    }
  }

  const filesAffected = changedMaps.size + (commonEventsChanged ? 1 : 0) + (troopsChanged ? 1 : 0);

  // ---- Aplica (1 snapshot, depois escreve só o que mudou) ----
  if (!dryRun && filesAffected > 0) {
    if (config.project.autoBackup) {
      await createSnapshot(config.project.path, config.project.backupDir, 'before-text-replace');
    }
    for (const mapId of changedMaps) {
      const map = mapCache.get(mapId)!;
      await saveMap(config, mapId, map, { destructive: false });
    }
    if (commonEventsChanged) {
      await saveDbRaw(config, 'common_event', ceRaw, { destructive: false });
    }
    if (troopsChanged) {
      await saveDbRaw(config, 'troop', troopRaw, { destructive: false });
    }
  }

  return {
    find,
    replace,
    caseSensitive,
    dryRun,
    totalOccurrences,
    filesAffected,
    occurrences,
  };
}
