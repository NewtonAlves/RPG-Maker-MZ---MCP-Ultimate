/**
 * Análise: map flow (Connection Graph).
 *
 * Varre todos os mapas, identifica comandos Transfer Player (code 201) e monta
 * um grafo dirigido do mundo do jogo:
 *
 *   nodes = mapas
 *   edges = transferências (de qual evento, posição, direção)
 *
 * Identifica:
 *  - Orphan maps: mapas sem entrada (ninguém transfere pra lá) — exceto starting map
 *  - Dead-end maps: mapas sem saída (nenhum evento transfere pra fora)
 *  - Unreachable maps: mapas inacessíveis a partir do starting position (BFS)
 *  - Hot spots: mapas com mais entradas/saídas
 *
 * Code 201 = Transfer Player params:
 *   [direct(0)/variable(1), mapId, x, y, direction, fadeType]
 *   - Se direct: mapId é o destino real
 *   - Se variable: mapId é o ID da variable que CONTÉM o destino (não resolvemos)
 */

import type { Config } from '../../config.js';
import {
  forEachCommonEventCommand,
  forEachMapEventCommand,
  forEachTroopEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './shared.js';

export interface TransferEdge {
  /** Mapa de origem da transferência. */
  fromMapId: number;
  fromMapName: string;
  /** Mapa de destino. Pode ser null se foi via variable (dynamic). */
  toMapId: number | null;
  toMapName: string | null;
  /** True se o destino foi via variable (não resolvido). */
  dynamic: boolean;
  /** Origem do comando Transfer. */
  source:
    | { kind: 'map_event'; eventId: number; pageIndex: number }
    | { kind: 'common_event'; commonEventId: number }
    | { kind: 'troop_event'; troopId: number; pageIndex: number };
  /** Coordenadas de destino (se direct). */
  destX?: number;
  destY?: number;
}

export interface MapNode {
  mapId: number;
  mapName: string;
  parentId: number;
  /** Quantas edges chegam aqui (including dynamic counts as "?"). */
  incomingCount: number;
  /** Quantas edges saem daqui. */
  outgoingCount: number;
  /** True se nenhuma edge chega nesse mapa (e não é o starting map). */
  orphan: boolean;
  /** True se nenhuma edge sai desse mapa. */
  deadEnd: boolean;
  /** True se não há caminho do starting map até aqui (BFS). */
  unreachable: boolean;
}

export interface MapFlowAnalysis {
  startingMapId: number;
  startingMapName: string;
  totalMaps: number;
  totalEdges: number;
  dynamicEdges: number;
  orphanCount: number;
  deadEndCount: number;
  unreachableCount: number;
  nodes: MapNode[];
  edges: TransferEdge[];
}

export async function analyzeMapFlow(config: Config): Promise<MapFlowAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): MapFlowAnalysis {
  // Starting map vem do System.json
  const sys = snapshot.system as { startMapId?: number };
  const startingMapId = sys.startMapId ?? 1;
  const startingMapName = mapDisplayName(snapshot, startingMapId);

  // Coleta todas as edges
  const edges: TransferEdge[] = [];

  const handleTransferCmd = (
    cmd: { code: number; parameters: unknown[] },
    fromMapId: number,
    fromMapName: string,
    source: TransferEdge['source'],
  ) => {
    if (cmd.code !== 201) return;
    const p = cmd.parameters;
    const mode = (p[0] as number) ?? 0; // 0=direct, 1=variable
    const mapIdParam = (p[1] as number) ?? 0;
    const x = (p[2] as number) ?? 0;
    const y = (p[3] as number) ?? 0;
    const dynamic = mode !== 0;
    const toMapId = dynamic ? null : mapIdParam;
    const toMapName = dynamic
      ? null
      : (toMapId !== null && toMapId > 0 ? mapDisplayName(snapshot, toMapId) : null);
    edges.push({
      fromMapId,
      fromMapName,
      toMapId,
      toMapName,
      dynamic,
      source,
      destX: dynamic ? undefined : x,
      destY: dynamic ? undefined : y,
    });
  };

  // Map events
  for (const map of snapshot.maps) {
    const mapId = map.mapId;
    const mapName = mapDisplayName(snapshot, mapId);
    forEachMapEventCommand(map, (_mid, eventId, pageIndex, _cmdIndex, cmd) => {
      handleTransferCmd(cmd, mapId, mapName, { kind: 'map_event', eventId, pageIndex });
    });
  }

  // Common events (também podem chamar Transfer)
  // Pra common events não temos "fromMapId" (eles podem ser chamados de qualquer lugar);
  // marcamos fromMapId = 0 e tratamos como "ambient" — não conta em grafo de mapas
  forEachCommonEventCommand(snapshot.commonEvents, (id, _i, cmd) => {
    if (cmd.code !== 201) return;
    handleTransferCmd(cmd, 0, '<common-event>', { kind: 'common_event', commonEventId: id });
  });

  // Troop events (raro mas possível)
  forEachTroopEventCommand(snapshot.troops, (troopId, pageIndex, _i, cmd) => {
    if (cmd.code !== 201) return;
    handleTransferCmd(cmd, 0, '<troop-event>', { kind: 'troop_event', troopId, pageIndex });
  });

  // Conta in/out por mapa
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, number>();
  // Grafo de adjacência pra BFS (só edges não-dinâmicas com from > 0)
  const adj = new Map<number, Set<number>>();

  for (const e of edges) {
    if (e.fromMapId > 0) {
      outgoing.set(e.fromMapId, (outgoing.get(e.fromMapId) ?? 0) + 1);
    }
    if (e.toMapId !== null && e.toMapId > 0) {
      incoming.set(e.toMapId, (incoming.get(e.toMapId) ?? 0) + 1);
      if (e.fromMapId > 0) {
        const set = adj.get(e.fromMapId) ?? new Set();
        set.add(e.toMapId);
        adj.set(e.fromMapId, set);
      }
    }
  }

  // BFS a partir do startingMapId pra achar unreachable
  const reachable = new Set<number>();
  if (startingMapId > 0) {
    const queue: number[] = [startingMapId];
    reachable.add(startingMapId);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = adj.get(cur);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!reachable.has(n)) {
          reachable.add(n);
          queue.push(n);
        }
      }
    }
  }

  // Constrói nodes
  const nodes: MapNode[] = [];
  let orphanCount = 0;
  let deadEndCount = 0;
  let unreachableCount = 0;

  for (const map of snapshot.maps) {
    const mapId = map.mapId;
    const mapName = mapDisplayName(snapshot, mapId);
    const inCount = incoming.get(mapId) ?? 0;
    const outCount = outgoing.get(mapId) ?? 0;
    const isStart = mapId === startingMapId;
    const orphan = inCount === 0 && !isStart;
    const deadEnd = outCount === 0;
    const unreachable = !reachable.has(mapId);

    if (orphan) orphanCount++;
    if (deadEnd) deadEndCount++;
    if (unreachable) unreachableCount++;

    nodes.push({
      mapId,
      mapName,
      parentId: snapshot.mapInfos[mapId]?.parentId ?? 0,
      incomingCount: inCount,
      outgoingCount: outCount,
      orphan,
      deadEnd,
      unreachable,
    });
  }

  // Sort: mais movimentados primeiro
  nodes.sort((a, b) => (b.incomingCount + b.outgoingCount) - (a.incomingCount + a.outgoingCount));

  const dynamicEdges = edges.filter((e) => e.dynamic).length;

  return {
    startingMapId,
    startingMapName,
    totalMaps: nodes.length,
    totalEdges: edges.length,
    dynamicEdges,
    orphanCount,
    deadEndCount,
    unreachableCount,
    nodes,
    edges,
  };
}
