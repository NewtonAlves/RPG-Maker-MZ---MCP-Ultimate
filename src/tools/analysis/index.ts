/**
 * Tools de análise semântica do projeto.
 *
 * Cada análise lê o projeto e retorna um relatório estruturado pronto pra
 * uso do agente. Cacheia resultados baseado em mtime do data/ pra acelerar
 * chamadas repetidas.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { clearAllCaches, withCache } from '../../core/analysis/cache.js';
import { analyzeNpcDialogue } from '../../core/analysis/npc-dialogue.js';
import { analyzeSwitchVariableGraph } from '../../core/analysis/switch-variable-graph.js';
import { analyzeItemEconomy } from '../../core/analysis/item-economy.js';
import { analyzeMapFlow } from '../../core/analysis/map-flow.js';
import { analyzeSkillDistribution } from '../../core/analysis/skill-distribution.js';
import {
  analyzeEnemyAppearances,
  analyzeTilesetUsage,
} from '../../core/analysis/enemy-tileset-usage.js';
import { mcpReturn } from '../database/index.js';

export function registerAnalysisTools(server: McpServer, config: Config): void {
  server.registerTool(
    'analysis_npc_dialogue_map',
    {
      description:
        'Varre todos os mapas e identifica eventos com diálogo (Show Text — code 101/401). ' +
        'Agrupa por mapa com preview de cada linha. Útil pra mapear lore, achar NPCs falantes, ' +
        'identificar mapas vazios.',
      inputSchema: z.object({
        force: z.boolean().default(false).describe('Ignora cache e re-executa'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'npc_dialogue_map',
          () => analyzeNpcDialogue(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_switch_variable_graph',
    {
      description:
        'Mapeia o grafo de uso de switches e variables: quem seta, quem lê. ' +
        'Identifica switches/vars MORTOS (registrados mas nunca usados) e ÓRFÃOS (lidos ' +
        'mas nunca setados — bug provável). Hot spots no topo.',
      inputSchema: z.object({
        force: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'switch_variable_graph',
          () => analyzeSwitchVariableGraph(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_item_economy',
    {
      description:
        'Pra cada item/arma/armadura: drops (enemies + probability), shops (eventos de loja ' +
        'com preço), tesouros (eventos que dão como reward). Identifica items INALCANÇÁVEIS ' +
        '(sem nenhuma fonte). Ordenado por availabilityScore.',
      inputSchema: z.object({
        force: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'item_economy',
          () => analyzeItemEconomy(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_skill_distribution',
    {
      description:
        'Pra cada skill: quem aprende (classes via learnings + actors via traits + states ' +
        'com Add Skill), em qual nível, custo médio, stat principal usado na fórmula. ' +
        'Identifica skills INACESSÍVEIS (ninguém aprende).',
      inputSchema: z.object({
        force: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'skill_distribution',
          () => analyzeSkillDistribution(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_enemy_appearances',
    {
      description:
        'Pra cada enemy: em que troops aparece, e essas troops em que map events são chamadas ' +
        '(direct ref via code 301) + encounterList de mapas. Total de encounters. ' +
        'Identifica enemies INALCANÇÁVEIS (sem batalha real).',
      inputSchema: z.object({
        force: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'enemy_appearances',
          () => analyzeEnemyAppearances(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_tileset_usage',
    {
      description:
        'Pra cada tileset: que mapas usam (via map.tilesetId), com dimensões. ' +
        'Identifica tilesets NÃO USADOS.',
      inputSchema: z.object({
        force: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'tileset_usage',
          () => analyzeTilesetUsage(config),
          args.force,
        );
        return { ...result, _cache: { fromCache, cachedAt } };
      }),
  );

  server.registerTool(
    'analysis_map_flow',
    {
      description:
        'Monta grafo dirigido do fluxo de mapas: pra cada mapa identifica transferências ' +
        '(Transfer Player — code 201) com destino. Identifica mapas órfãos (sem entrada), ' +
        'dead-end (sem saída) e unreachable (sem caminho a partir do starting map via BFS). ' +
        'Útil pra entender estrutura narrativa, achar mapas inacessíveis e validar progressão. ' +
        'Por padrão retorna view COMPACTA (sumário + mapas problemáticos + top hotspots). ' +
        'Use verbose:true pra o grafo completo (edges + todos os nodes) — cuidado em projetos grandes.',
      inputSchema: z.object({
        force: z.boolean().default(false).describe('Ignora cache e re-executa'),
        verbose: z
          .boolean()
          .default(false)
          .describe('Retorna grafo completo (edges + todos nodes). Pode estourar limite de tokens em projetos grandes.'),
        limit: z
          .number()
          .int()
          .positive()
          .default(40)
          .describe('Máximo de mapas problemáticos/hotspots por lista no modo compacto'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { result, fromCache, cachedAt } = await withCache(
          config,
          'map_flow',
          () => analyzeMapFlow(config),
          args.force,
        );
        if (args.verbose) {
          return { ...result, _cache: { fromCache, cachedAt } };
        }
        // View compacta: sumário + só os mapas acionáveis + hotspots
        const lim = args.limit;
        const orphans = result.nodes.filter((n) => n.orphan).slice(0, lim);
        const deadEnds = result.nodes.filter((n) => n.deadEnd).slice(0, lim);
        const unreachable = result.nodes.filter((n) => n.unreachable).slice(0, lim);
        const hotspots = result.nodes.slice(0, Math.min(10, lim)); // nodes já vêm ordenados por movimento
        return {
          startingMapId: result.startingMapId,
          startingMapName: result.startingMapName,
          totalMaps: result.totalMaps,
          totalEdges: result.totalEdges,
          dynamicEdges: result.dynamicEdges,
          orphanCount: result.orphanCount,
          deadEndCount: result.deadEndCount,
          unreachableCount: result.unreachableCount,
          orphanMaps: orphans.map((n) => ({ mapId: n.mapId, mapName: n.mapName })),
          deadEndMaps: deadEnds.map((n) => ({ mapId: n.mapId, mapName: n.mapName })),
          unreachableMaps: unreachable.map((n) => ({ mapId: n.mapId, mapName: n.mapName })),
          hotspots: hotspots.map((n) => ({
            mapId: n.mapId,
            mapName: n.mapName,
            incoming: n.incomingCount,
            outgoing: n.outgoingCount,
          })),
          note:
            'View compacta. Listas limitadas a `limit` itens. Use verbose:true pro grafo completo (edges+nodes).',
          _cache: { fromCache, cachedAt },
        };
      }),
  );

  server.registerTool(
    'analysis_clear_cache',
    {
      description: 'Limpa todos os caches de análise. Use se algo parecer desatualizado.',
      inputSchema: z.object({}).shape,
    },
    async () => mcpReturn(async () => clearAllCaches(config)),
  );
}
