/**
 * Tools de plugin compatibility — usa o catálogo plugin-compat.json pra avisar
 * sobre conflitos conhecidos.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { compatIssuesForPlugin, PLUGIN_COMPAT, PLUGIN_LOAD_ORDER } from '../../core/mz-codes-loader.js';
import { loadPluginsJs } from '../../core/plugins-js.js';
import { mcpReturn } from '../database/index.js';

export function registerCompatTools(server: McpServer, config: Config): void {
  server.registerTool(
    'plugin_check_compatibility',
    {
      description:
        'Verifica problemas conhecidos de compatibilidade pra um plugin específico. Retorna warnings ' +
        'baseados no catálogo (load order, conflitos, dependências, YEP-MV legacy).',
      inputSchema: z.object({
        name: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const issues = compatIssuesForPlugin(args.name);
        return {
          plugin: args.name,
          issueCount: issues.length,
          issues,
        };
      }),
  );

  server.registerTool(
    'plugin_recommend_load_order',
    {
      description:
        'Sugere ordem ideal de plugins.js baseada no catálogo de compatibility. Compara com ' +
        'a ordem ATUAL do projeto e indica plugins desalinhados.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const current = await loadPluginsJs(config);
        const currentOrder = current.map((p) => p.name);

        // Compute desired position by recommended order; unknown plugins go at end
        const desiredIndex = (name: string): number => {
          for (let i = 0; i < PLUGIN_LOAD_ORDER.length; i++) {
            const expected = PLUGIN_LOAD_ORDER[i]!;
            if (expected === name) return i;
            if (expected.endsWith('*') && name.startsWith(expected.slice(0, -1))) return i;
          }
          return PLUGIN_LOAD_ORDER.length;
        };

        const misorderedPlugins: Array<{ name: string; currentIdx: number; recommendedIdx: number }> = [];
        for (let i = 0; i < current.length - 1; i++) {
          const aIdx = desiredIndex(current[i]!.name);
          for (let j = i + 1; j < current.length; j++) {
            const bIdx = desiredIndex(current[j]!.name);
            if (aIdx > bIdx) {
              misorderedPlugins.push({
                name: current[i]!.name,
                currentIdx: i,
                recommendedIdx: aIdx,
              });
              break;
            }
          }
        }

        return {
          currentOrder,
          recommendedOrder: PLUGIN_LOAD_ORDER,
          misordered: misorderedPlugins,
          notes:
            misorderedPlugins.length === 0
              ? 'Ordem do projeto está consistente com recomendações.'
              : `${misorderedPlugins.length} plugins fora da ordem recomendada.`,
        };
      }),
  );

  server.registerTool(
    'plugin_compat_list_all',
    {
      description: 'Lista TODOS os compat issues conhecidos no catálogo.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({ count: PLUGIN_COMPAT.length, issues: PLUGIN_COMPAT })),
  );
}
