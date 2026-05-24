/**
 * Análise: NPC dialogue map.
 *
 * Varre todos os mapas, identifica eventos com Show Text (code 401),
 * agrupa por mapa com preview do diálogo. Útil pra:
 *  - Encontrar todos os NPCs com diálogo no jogo
 *  - Ver "que personagem fala sobre tópico X" (com search)
 *  - Identificar mapas sem NPCs falantes (vazios)
 *  - Mapear lore por região
 */

import type { Config } from '../../config.js';
import {
  forEachMapEventCommand,
  loadProjectSnapshot,
  mapDisplayName,
  type ProjectSnapshot,
} from './shared.js';

export interface DialogueLine {
  eventId: number;
  eventName: string;
  pageIndex: number;
  text: string;
  faceName?: string;
  faceIndex?: number;
}

export interface MapDialogueGroup {
  mapId: number;
  mapName: string;
  totalEvents: number;
  npcsWithDialogue: number;
  dialogues: DialogueLine[];
}

export interface NpcDialogueAnalysis {
  totalMaps: number;
  totalNpcsWithDialogue: number;
  totalDialogueLines: number;
  emptyMapsCount: number;
  byMap: MapDialogueGroup[];
}

/**
 * Code 401 = Show Text (next line of dialogue).
 * Code 101 = Show Text (header — face + name + position + background).
 *
 * Pra extrair o diálogo completo de um NPC, agrupamos sequências contíguas de
 * (101, 401, 401, ...) na mesma página.
 */
export async function analyzeNpcDialogue(config: Config): Promise<NpcDialogueAnalysis> {
  const snapshot = await loadProjectSnapshot(config, { maps: true, database: true });
  return computeFromSnapshot(snapshot);
}

export function computeFromSnapshot(snapshot: ProjectSnapshot): NpcDialogueAnalysis {
  const byMap: MapDialogueGroup[] = [];
  let totalNpcsWithDialogue = 0;
  let totalDialogueLines = 0;
  let emptyMapsCount = 0;

  for (const map of snapshot.maps) {
    if (!map.events) continue;
    const totalEvents = map.events.filter((e) => e !== null && e !== undefined).length;
    const dialogues: DialogueLine[] = [];
    const npcsWithDialogueOnMap = new Set<number>();

    // Agrupa: pra cada (eventId, pageIndex), coleta sequência de Show Text
    // Estado: faceName/Index do último 101, texto acumulado
    const buffers = new Map<string, {
      eventId: number;
      eventName: string;
      pageIndex: number;
      faceName?: string;
      faceIndex?: number;
      lines: string[];
      flushed: boolean;
    }>();

    const flushAllForMap = () => {
      for (const buf of buffers.values()) {
        if (buf.lines.length > 0 && !buf.flushed) {
          dialogues.push({
            eventId: buf.eventId,
            eventName: buf.eventName,
            pageIndex: buf.pageIndex,
            text: buf.lines.join(' ').trim(),
            faceName: buf.faceName,
            faceIndex: buf.faceIndex,
          });
          npcsWithDialogueOnMap.add(buf.eventId);
          buf.flushed = true;
        }
      }
      buffers.clear();
    };

    forEachMapEventCommand(map, (_mapId, eventId, pageIndex, _cmdIndex, cmd) => {
      const key = `${eventId}:${pageIndex}`;
      const eventName = (map.events?.find((e) => e?.id === eventId)?.name as string) ?? `Event ${eventId}`;
      const code = cmd.code;
      const params = cmd.parameters as unknown[];

      if (code === 101) {
        // Header — flush anterior (se houver) e inicia novo
        if (buffers.has(key)) {
          const old = buffers.get(key)!;
          if (old.lines.length > 0) {
            dialogues.push({
              eventId,
              eventName,
              pageIndex,
              text: old.lines.join(' ').trim(),
              faceName: old.faceName,
              faceIndex: old.faceIndex,
            });
            npcsWithDialogueOnMap.add(eventId);
          }
        }
        buffers.set(key, {
          eventId,
          eventName,
          pageIndex,
          faceName: (params[0] as string) || undefined,
          faceIndex: typeof params[1] === 'number' ? (params[1] as number) : undefined,
          lines: [],
          flushed: false,
        });
      } else if (code === 401) {
        // Continuação — anexa
        let buf = buffers.get(key);
        if (!buf) {
          // 401 sem 101 anterior — cria sem face
          buf = { eventId, eventName, pageIndex, lines: [], flushed: false };
          buffers.set(key, buf);
        }
        const line = (params[0] as string) ?? '';
        buf.lines.push(line);
      } else {
        // Qualquer outro comando dentro da página — não interrompe necessariamente,
        // mas se for um command que muda contexto (ex.: Show Choices 102), pode flushar.
        // Pra simplicidade, deixamos o flush por página no final.
      }
    });

    // Flush remanescentes do mapa
    flushAllForMap();

    totalNpcsWithDialogue += npcsWithDialogueOnMap.size;
    totalDialogueLines += dialogues.length;

    if (totalEvents === 0) emptyMapsCount++;

    byMap.push({
      mapId: map.mapId,
      mapName: mapDisplayName(snapshot, map.mapId),
      totalEvents,
      npcsWithDialogue: npcsWithDialogueOnMap.size,
      dialogues,
    });
  }

  // Sort: mapas com mais diálogo primeiro
  byMap.sort((a, b) => b.npcsWithDialogue - a.npcsWithDialogue);

  return {
    totalMaps: snapshot.maps.length,
    totalNpcsWithDialogue,
    totalDialogueLines,
    emptyMapsCount,
    byMap,
  };
}
