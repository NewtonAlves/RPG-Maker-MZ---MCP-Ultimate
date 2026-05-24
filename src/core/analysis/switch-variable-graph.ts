/**
 * Análise: switch_graph + variable_graph.
 *
 * Pra cada switch/variable, mapeia QUEM seta e QUEM lê (em maps, common events,
 * battle events, e auto-triggers de page).
 *
 * Identifica:
 *  - Switches/vars MORTOS (definidos no $dataSystem mas nunca referenciados)
 *  - Switches/vars ÓRFÃOS (lidos mas nunca setados — bug provável)
 *  - Switches/vars com mais uso (hot spots)
 */

import type { Config } from '../../config.js';
import {
  forEachCommonEventCommand,
  forEachTroopEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './shared.js';

export interface UsageLocation {
  kind: 'map_event' | 'common_event' | 'troop_event' | 'event_page_trigger';
  /** ID de mapa (se kind=map_event ou event_page_trigger). */
  mapId?: number;
  mapName?: string;
  eventId?: number;
  pageIndex?: number;
  commonEventId?: number;
  troopId?: number;
}

export interface GraphEntry {
  id: number;
  name: string;
  setBy: UsageLocation[];
  readBy: UsageLocation[];
}

export interface GraphAnalysis {
  total: number;
  dead: GraphEntry[]; // criado no $dataSystem mas nunca usado
  orphan: GraphEntry[]; // lido mas nunca setado
  entries: GraphEntry[]; // todos com pelo menos 1 uso
}

/* ============================ Switch codes ============================ */
// 121 = Control Switches (setRange [from, to], value 0=ON 1=OFF 2=TOGGLE)
// 111 com subCode 0 = Conditional Branch (switch) — leitura
// 111 com subCode 12 = Conditional Branch (script) — não cobrimos parse de script
// Page condition: switchValid/switch1Id/switch2Id

/* ============================ Variable codes ============================ */
// 122 = Control Variables (setRange [from, to], operation, operandType, ...)
// 111 com subCode 1 = Conditional Branch (variable)

/* ============================ ============================ */

interface CollectorState {
  switchSets: globalThis.Map<number, UsageLocation[]>;
  switchReads: globalThis.Map<number, UsageLocation[]>;
  variableSets: globalThis.Map<number, UsageLocation[]>;
  variableReads: globalThis.Map<number, UsageLocation[]>;
}

function newState(): CollectorState {
  return {
    switchSets: new Map(),
    switchReads: new Map(),
    variableSets: new Map(),
    variableReads: new Map(),
  };
}

function push<K, V>(m: globalThis.Map<K, V[]>, key: K, value: V): void {
  const list = m.get(key) ?? [];
  list.push(value);
  m.set(key, list);
}

function processCommand(
  state: CollectorState,
  cmd: { code: number; parameters: unknown[] },
  loc: UsageLocation,
): void {
  const { code, parameters: p } = cmd;

  if (code === 121) {
    // Control Switches: [fromId, toId, value]
    const from = (p[0] as number) ?? 0;
    const to = (p[1] as number) ?? from;
    for (let id = from; id <= to; id++) {
      push(state.switchSets, id, loc);
    }
  } else if (code === 122) {
    // Control Variables: [fromId, toId, operation, operandType, operand...]
    const from = (p[0] as number) ?? 0;
    const to = (p[1] as number) ?? from;
    const operandType = (p[3] as number) ?? 0;
    const operandValue = p[4] as number | undefined;
    for (let id = from; id <= to; id++) {
      push(state.variableSets, id, loc);
    }
    // operandType=1 significa "use VARIABLE" — leitura
    if (operandType === 1 && typeof operandValue === 'number') {
      push(state.variableReads, operandValue, loc);
    }
  } else if (code === 111) {
    // Conditional Branch
    const subCode = (p[0] as number) ?? -1;
    if (subCode === 0) {
      // Switch
      const switchId = (p[1] as number) ?? 0;
      push(state.switchReads, switchId, loc);
    } else if (subCode === 1) {
      // Variable
      const varId = (p[1] as number) ?? 0;
      push(state.variableReads, varId, loc);
      // Pode comparar com OUTRA variable (p[2]=0 valor, p[2]=1 variable)
      const operandType = (p[2] as number) ?? 0;
      const operandValue = p[3];
      if (operandType === 1 && typeof operandValue === 'number') {
        push(state.variableReads, operandValue, loc);
      }
    }
  }
}

function processEventPageConditions(
  state: CollectorState,
  page: { conditions?: { switch1Valid?: boolean; switch1Id?: number; switch2Valid?: boolean; switch2Id?: number; variableValid?: boolean; variableId?: number; variableValue?: number } | undefined },
  loc: UsageLocation,
): void {
  const c = page.conditions;
  if (!c) return;
  if (c.switch1Valid && typeof c.switch1Id === 'number' && c.switch1Id > 0) {
    push(state.switchReads, c.switch1Id, loc);
  }
  if (c.switch2Valid && typeof c.switch2Id === 'number' && c.switch2Id > 0) {
    push(state.switchReads, c.switch2Id, loc);
  }
  if (c.variableValid && typeof c.variableId === 'number' && c.variableId > 0) {
    push(state.variableReads, c.variableId, loc);
  }
}

function collectAll(snapshot: ProjectSnapshot): CollectorState {
  const state = newState();

  // Maps: events + page commands + page conditions
  for (const map of snapshot.maps) {
    const mapId = map.mapId;
    const mapName = mapDisplayName(snapshot, mapId);
    if (!map.events) continue;
    for (const event of map.events) {
      if (!event || !event.pages) continue;
      for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
        const page = event.pages[pageIndex];
        if (!page) continue;
        const loc: UsageLocation = {
          kind: 'event_page_trigger',
          mapId,
          mapName,
          eventId: event.id,
          pageIndex,
        };
        processEventPageConditions(state, page, loc);
        if (page.list) {
          for (const cmd of page.list) {
            if (!cmd) continue;
            processCommand(state, cmd as { code: number; parameters: unknown[] }, {
              kind: 'map_event',
              mapId,
              mapName,
              eventId: event.id,
              pageIndex,
            });
          }
        }
      }
    }
  }

  // Common events
  forEachCommonEventCommand(snapshot.commonEvents, (id, _i, cmd) => {
    processCommand(state, cmd, {
      kind: 'common_event',
      commonEventId: id,
    });
  });

  // Troop battle events
  forEachTroopEventCommand(snapshot.troops, (troopId, pageIndex, _i, cmd) => {
    processCommand(state, cmd, {
      kind: 'troop_event',
      troopId,
      pageIndex,
    });
  });

  return state;
}

function buildGraph(
  sets: globalThis.Map<number, UsageLocation[]>,
  reads: globalThis.Map<number, UsageLocation[]>,
  names: string[],
): GraphAnalysis {
  const total = names.length > 0 ? names.length - 1 : 0; // index 0 reservado
  const entries: GraphEntry[] = [];
  const dead: GraphEntry[] = [];
  const orphan: GraphEntry[] = [];

  for (let id = 1; id < names.length; id++) {
    const name = names[id] ?? '';
    const setList = sets.get(id) ?? [];
    const readList = reads.get(id) ?? [];
    const entry: GraphEntry = { id, name, setBy: setList, readBy: readList };

    if (setList.length === 0 && readList.length === 0) {
      // Dead — registrado mas nunca usado. Inclui apenas se TIVER nome (id válido).
      if (name.trim().length > 0) {
        dead.push(entry);
      }
    } else {
      entries.push(entry);
      if (readList.length > 0 && setList.length === 0) {
        // Orphan: lido mas nunca setado (provável bug, exceto switches que começam OFF)
        orphan.push(entry);
      }
    }
  }

  // Sort entries por uso total desc
  entries.sort((a, b) => b.setBy.length + b.readBy.length - (a.setBy.length + a.readBy.length));

  return { total, dead, orphan, entries };
}

export interface SwitchVariableGraphResult {
  switches: GraphAnalysis;
  variables: GraphAnalysis;
}

export async function analyzeSwitchVariableGraph(config: Config): Promise<SwitchVariableGraphResult> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): SwitchVariableGraphResult {
  const state = collectAll(snapshot);
  const sys = snapshot.system as { switches?: string[]; variables?: string[] };
  const switchNames = sys.switches ?? [];
  const variableNames = sys.variables ?? [];

  return {
    switches: buildGraph(state.switchSets, state.switchReads, switchNames),
    variables: buildGraph(state.variableSets, state.variableReads, variableNames),
  };
}
