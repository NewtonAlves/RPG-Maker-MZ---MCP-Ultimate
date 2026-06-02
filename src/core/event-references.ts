/**
 * Verificador de referências NO CONTEÚDO dos comandos de evento.
 *
 * Completa o quarteto de integridade do projeto:
 *   db_check_consistency        → IDs cruzados no banco
 *   asset_check_missing_references → arquivos de asset no disco
 *   event_validate_structure    → estrutura das command lists
 *   event_check_references (este) → o que os comandos APONTAM
 *
 * Detecta (tudo determinístico — o ID resolve ou não):
 *   - 201 Transfer Player (direto) → mapa de destino não existe
 *   - 117 Call Common Event → common event inexistente/null
 *   - 121 Control Switches → id fora do range do System.switches
 *   - 122 Control Variables → id fora do range do System.variables
 *   - 301 Battle Processing (direto) → troop inexistente
 *   - Escape codes em Show Text (401) / Scroll Text (405):
 *       \V[n] → variável n fora do range
 *       \N[n] → actor n inexistente
 */

import type { Config } from '../config.js';
import {
  forEachCommonEventCommand,
  forEachMapEventCommand,
  forEachTroopEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './analysis/shared.js';

export interface EventRefIssue {
  severity: 'error' | 'warning';
  location:
    | { kind: 'map_event'; mapId: number; mapName: string; eventId: number; pageIndex: number }
    | { kind: 'common_event'; commonEventId: number; commonEventName: string }
    | { kind: 'troop_event'; troopId: number; pageIndex: number };
  commandIndex: number;
  code: number;
  rule: string;
  detail: string;
}

export interface EventReferencesAnalysis {
  totalCommands: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  byRule: Record<string, number>;
  issues: EventRefIssue[];
}

interface RefContext {
  existingMapIds: Set<number>;
  commonEventCount: number; // length de $dataCommonEvents (índices 1..count-1 válidos)
  troopCount: number;
  switchCount: number; // length de System.switches
  variableCount: number;
  actorCount: number;
}

/** Escaneia escape codes \V[n] e \N[n] num texto, validando ranges. */
function scanEscapeCodes(
  text: string,
  ctx: RefContext,
): Array<{ rule: string; detail: string }> {
  const out: Array<{ rule: string; detail: string }> = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  const re = /\\([VNvn])\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1]!.toUpperCase();
    const n = parseInt(m[2]!, 10);
    if (kind === 'V') {
      if (n <= 0 || n >= ctx.variableCount) {
        out.push({
          rule: 'escape_variable_out_of_range',
          detail: `Texto usa \\V[${n}] mas variável ${n} está fora do range (1..${ctx.variableCount - 1}).`,
        });
      }
    } else if (kind === 'N') {
      if (n <= 0 || n >= ctx.actorCount) {
        out.push({
          rule: 'escape_actor_out_of_range',
          detail: `Texto usa \\N[${n}] mas actor ${n} não existe (1..${ctx.actorCount - 1}).`,
        });
      }
    }
  }
  return out;
}

/** Valida um comando isolado. Retorna issues sem location. */
function checkCommand(
  cmd: { code: number; parameters?: unknown[] },
  ctx: RefContext,
): Array<{ severity: 'error' | 'warning'; rule: string; detail: string }> {
  const issues: Array<{ severity: 'error' | 'warning'; rule: string; detail: string }> = [];
  const p = cmd.parameters ?? [];

  switch (cmd.code) {
    case 201: {
      // Transfer Player: [mode, mapId, x, y, dir, fade]. mode 0=direct, 1=variable
      const mode = p[0] as number;
      const mapId = p[1] as number;
      if (mode === 0 && typeof mapId === 'number' && mapId > 0 && !ctx.existingMapIds.has(mapId)) {
        issues.push({
          severity: 'error',
          rule: 'transfer_to_missing_map',
          detail: `Transfer Player pra mapa ${mapId} que não existe (sem Map${String(mapId).padStart(3, '0')}.json). Jogador cai no vazio / crash.`,
        });
      }
      break;
    }
    case 117: {
      // Call Common Event: [commonEventId]
      const ceId = p[0] as number;
      if (typeof ceId === 'number' && ceId > 0 && ceId >= ctx.commonEventCount) {
        issues.push({
          severity: 'error',
          rule: 'call_missing_common_event',
          detail: `Chama Common Event ${ceId} que não existe (max ${ctx.commonEventCount - 1}).`,
        });
      }
      break;
    }
    case 121: {
      // Control Switches: [from, to, value]
      const from = p[0] as number;
      const to = p[1] as number;
      if (typeof from === 'number' && typeof to === 'number') {
        const max = Math.max(from, to);
        if (max > 0 && max >= ctx.switchCount) {
          issues.push({
            severity: 'warning',
            rule: 'switch_out_of_range',
            detail: `Control Switches mexe no switch ${max} fora do range (1..${ctx.switchCount - 1}).`,
          });
        }
      }
      break;
    }
    case 122: {
      // Control Variables: [from, to, ...]
      const from = p[0] as number;
      const to = p[1] as number;
      if (typeof from === 'number' && typeof to === 'number') {
        const max = Math.max(from, to);
        if (max > 0 && max >= ctx.variableCount) {
          issues.push({
            severity: 'warning',
            rule: 'variable_out_of_range',
            detail: `Control Variables mexe na variável ${max} fora do range (1..${ctx.variableCount - 1}).`,
          });
        }
      }
      break;
    }
    case 301: {
      // Battle Processing: [type, troopId, canEscape, canLose]. type 0=direct
      const type = p[0] as number;
      const troopId = p[1] as number;
      if (type === 0 && typeof troopId === 'number' && troopId > 0 && troopId >= ctx.troopCount) {
        issues.push({
          severity: 'error',
          rule: 'battle_missing_troop',
          detail: `Battle Processing com troop ${troopId} que não existe (max ${ctx.troopCount - 1}).`,
        });
      }
      break;
    }
    case 401: // Show Text line
    case 405: {
      // Scroll Text line
      const text = p[0];
      if (typeof text === 'string') {
        for (const e of scanEscapeCodes(text, ctx)) {
          issues.push({ severity: 'warning', ...e });
        }
      }
      break;
    }
    default:
      break;
  }
  return issues;
}

export async function checkEventReferences(config: Config): Promise<EventReferencesAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): EventReferencesAnalysis {
  const sys = snapshot.system as { switches?: string[]; variables?: string[] };
  const ctx: RefContext = {
    existingMapIds: new Set(snapshot.maps.map((m) => m.mapId)),
    commonEventCount: snapshot.commonEvents.length,
    troopCount: snapshot.troops.length,
    switchCount: (sys.switches ?? []).length,
    variableCount: (sys.variables ?? []).length,
    actorCount: snapshot.actors.length,
  };

  const issues: EventRefIssue[] = [];
  let totalCommands = 0;

  // Map events
  for (const map of snapshot.maps) {
    const mapName = mapDisplayName(snapshot, map.mapId);
    forEachMapEventCommand(map, (_mid, eventId, pageIndex, commandIndex, cmd) => {
      totalCommands++;
      for (const f of checkCommand(cmd, ctx)) {
        issues.push({
          ...f,
          code: cmd.code,
          commandIndex,
          location: { kind: 'map_event', mapId: map.mapId, mapName, eventId, pageIndex },
        });
      }
    });
  }

  // Common events
  forEachCommonEventCommand(snapshot.commonEvents, (id, commandIndex, cmd) => {
    totalCommands++;
    const ce = snapshot.commonEvents.find((c) => c && (c.id as number) === id);
    for (const f of checkCommand(cmd, ctx)) {
      issues.push({
        ...f,
        code: cmd.code,
        commandIndex,
        location: {
          kind: 'common_event',
          commonEventId: id,
          commonEventName: ((ce?.name as string) ?? ''),
        },
      });
    }
  });

  // Troop battle events
  forEachTroopEventCommand(snapshot.troops, (troopId, pageIndex, commandIndex, cmd) => {
    totalCommands++;
    for (const f of checkCommand(cmd, ctx)) {
      issues.push({
        ...f,
        code: cmd.code,
        commandIndex,
        location: { kind: 'troop_event', troopId, pageIndex },
      });
    }
  });

  const byRule: Record<string, number> = {};
  for (const i of issues) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    totalCommands,
    totalIssues: issues.length,
    errorCount,
    warningCount,
    byRule,
    issues,
  };
}
