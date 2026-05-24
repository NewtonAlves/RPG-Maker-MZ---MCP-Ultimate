/**
 * Tools de damage formula presets. Permite browse e detalhamento.
 *
 * Também são USADOS por skill_create_damage/healing via parâmetro formulaPreset
 * (esses ficam em ../database/helpers/, esses tools aqui são pra DISCOVERY).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { DAMAGE_FORMULAS, searchDamageFormulas } from '../../core/mz-codes-loader.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerDamageFormulaTools(server: McpServer, _config: Config): void {
  server.registerTool(
    'damage_formula_list_presets',
    {
      description:
        'Lista presets de damage formula filtrados por tags (ex.: ["physical"], ["healing"]) ' +
        'ou type (1=HP Damage, 2=MP Damage, 3=HP Recover, 4=MP Recover, 5=HP Drain, 6=MP Drain).',
      inputSchema: z.object({
        tags: z.array(z.string()).optional(),
        type: z.number().int().min(0).max(6).optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const presets = searchDamageFormulas({ tags: args.tags, type: args.type });
        return {
          count: presets.length,
          presets: presets.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            formula: p.formula,
            type: p.type,
            tags: p.tags,
            skillExample: p.skillExample,
          })),
        };
      }),
  );

  server.registerTool(
    'damage_formula_get_preset',
    {
      description: 'Retorna detalhes completos de um preset por id.',
      inputSchema: z.object({
        id: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const preset = DAMAGE_FORMULAS[args.id];
        if (!preset) throw mzError('file_not_found', `Preset "${args.id}" não existe.`);
        return preset;
      }),
  );

  server.registerTool(
    'damage_formula_list_all',
    {
      description: 'Lista todos os presets sem filtro.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({
        count: Object.keys(DAMAGE_FORMULAS).length,
        presetIds: Object.keys(DAMAGE_FORMULAS),
        presets: Object.values(DAMAGE_FORMULAS),
      })),
  );
}
