/**
 * Validador de estrutura de command lists de eventos.
 *
 * Verifica invariantes PROVADAMENTE corretas de qualquer command list válida do
 * RPG Maker MZ — sem heurística, sem falso positivo:
 *
 *  1. A lista termina com um comando code 0 (terminador do interpretador).
 *  2. O `indent` do primeiro comando é 0.
 *  3. `indent` nunca é negativo.
 *  4. `indent` sobe no MÁXIMO +1 entre comandos consecutivos (só se abre 1 bloco
 *     por vez). Descidas podem ser de vários níveis (fechar blocos aninhados).
 *  5. O indent volta a 0 no terminador (todos os blocos fecharam).
 *
 * Além disso, checagem SOFT (warning) de continuação órfã: comandos de
 * continuação (401 texto, 405 scroll text, 505 move route, 655 script) devem
 * seguir seu header. Órfãos indicam corrupção.
 *
 * Listas malformadas travam o Game_Interpreter ou causam comportamento errado.
 */

import type { Config } from '../config.js';
import { loadProjectSnapshot, mapDisplayName, type ProjectSnapshot } from './analysis/shared.js';

export interface StructureIssue {
  severity: 'error' | 'warning';
  /** Onde está. */
  location:
    | { kind: 'map_event'; mapId: number; mapName: string; eventId: number; pageIndex: number }
    | { kind: 'common_event'; commonEventId: number; commonEventName: string }
    | { kind: 'troop_event'; troopId: number; pageIndex: number };
  commandIndex: number;
  code: number;
  rule: string;
  detail: string;
}

/** Headers válidos pra cada código de continuação. */
const CONTINUATION_HEADERS: Record<number, number[]> = {
  401: [101, 401], // Show Text line → após Show Text (101) ou outra linha (401)
  405: [105, 405], // Scroll Text line
  505: [205, 505], // Movement Route sub-command
  655: [355, 655], // Script line
  408: [108, 408], // Comment continuation
};

/**
 * Valida uma única command list. Retorna issues SEM location (o caller injeta).
 */
export function validateCommandList(
  list: Array<{ code: number; indent?: number; parameters?: unknown[] }>,
): Array<Omit<StructureIssue, 'location'>> {
  const issues: Array<Omit<StructureIssue, 'location'>> = [];
  if (!Array.isArray(list) || list.length === 0) {
    issues.push({
      severity: 'error',
      commandIndex: 0,
      code: -1,
      rule: 'empty_list',
      detail: 'Command list vazia ou ausente.',
    });
    return issues;
  }

  // Regra 1: terminador code 0
  const last = list[list.length - 1]!;
  if (last.code !== 0) {
    issues.push({
      severity: 'error',
      commandIndex: list.length - 1,
      code: last.code,
      rule: 'missing_terminator',
      detail: `Lista não termina com comando code 0 (termina com ${last.code}). Interpretador pode não parar corretamente.`,
    });
  }

  let prevIndent = 0;
  let prevCode = -1;
  for (let i = 0; i < list.length; i++) {
    const cmd = list[i]!;
    const indent = typeof cmd.indent === 'number' ? cmd.indent : 0;

    // Regra 3: indent não-negativo
    if (indent < 0) {
      issues.push({
        severity: 'error',
        commandIndex: i,
        code: cmd.code,
        rule: 'negative_indent',
        detail: `Indent negativo (${indent}).`,
      });
    }

    // Regra 2: primeiro comando indent 0
    if (i === 0 && indent !== 0) {
      issues.push({
        severity: 'error',
        commandIndex: 0,
        code: cmd.code,
        rule: 'first_indent_nonzero',
        detail: `Primeiro comando tem indent ${indent}, esperado 0.`,
      });
    }

    // Regra 4: indent sobe no máximo +1
    if (i > 0 && indent > prevIndent + 1) {
      issues.push({
        severity: 'error',
        commandIndex: i,
        code: cmd.code,
        rule: 'indent_jump',
        detail: `Indent saltou de ${prevIndent} pra ${indent} (só pode subir +1 por vez). Lista provavelmente corrompida.`,
      });
    }

    // Continuação órfã (soft)
    const validHeaders = CONTINUATION_HEADERS[cmd.code];
    if (validHeaders && i > 0 && !validHeaders.includes(prevCode)) {
      issues.push({
        severity: 'warning',
        commandIndex: i,
        code: cmd.code,
        rule: 'orphan_continuation',
        detail: `Comando de continuação ${cmd.code} segue code ${prevCode} (esperado um de ${validHeaders.join('/')}).`,
      });
    }

    prevIndent = indent;
    prevCode = cmd.code;
  }

  // Regra 5: terminador deve estar em indent 0
  if (last.code === 0) {
    const lastIndent = typeof last.indent === 'number' ? last.indent : 0;
    if (lastIndent !== 0) {
      issues.push({
        severity: 'error',
        commandIndex: list.length - 1,
        code: 0,
        rule: 'unclosed_blocks',
        detail: `Terminador em indent ${lastIndent} (esperado 0). Há blocos não fechados (conditional/loop/choices sem End).`,
      });
    }
  }

  return issues;
}

export interface EventStructureAnalysis {
  totalLists: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  issues: StructureIssue[];
}

export async function validateEventStructure(config: Config): Promise<EventStructureAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): EventStructureAnalysis {
  const issues: StructureIssue[] = [];
  let totalLists = 0;

  // Map events: cada página tem uma lista
  for (const map of snapshot.maps) {
    if (!map.events) continue;
    const mapName = mapDisplayName(snapshot, map.mapId);
    for (const event of map.events) {
      if (!event || !event.pages) continue;
      for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
        const page = event.pages[pageIndex];
        if (!page || !page.list) continue;
        totalLists++;
        const found = validateCommandList(page.list as Array<{ code: number; indent?: number }>);
        for (const f of found) {
          issues.push({
            ...f,
            location: { kind: 'map_event', mapId: map.mapId, mapName, eventId: event.id, pageIndex },
          });
        }
      }
    }
  }

  // Common events: uma lista cada
  for (const ce of snapshot.commonEvents) {
    if (!ce || typeof ce.id !== 'number') continue;
    const list = ce.list as Array<{ code: number; indent?: number }> | undefined;
    if (!Array.isArray(list)) continue;
    totalLists++;
    const found = validateCommandList(list);
    for (const f of found) {
      issues.push({
        ...f,
        location: {
          kind: 'common_event',
          commonEventId: ce.id as number,
          commonEventName: (ce.name as string) ?? '',
        },
      });
    }
  }

  // Troop battle event pages
  for (const tr of snapshot.troops) {
    if (!tr || typeof tr.id !== 'number') continue;
    const pages = tr.pages as Array<{ list?: Array<{ code: number; indent?: number }> }> | undefined;
    if (!Array.isArray(pages)) continue;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const list = pages[pageIndex]?.list;
      if (!Array.isArray(list)) continue;
      totalLists++;
      const found = validateCommandList(list);
      for (const f of found) {
        issues.push({
          ...f,
          location: { kind: 'troop_event', troopId: tr.id as number, pageIndex },
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  return { totalLists, totalIssues: issues.length, errorCount, warningCount, issues };
}
