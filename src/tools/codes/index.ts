/**
 * Tools de descoberta de event commands — escondem a tabela de 100+ codes
 * crípticos por trás de busca por categoria/nome.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  findEventCommand,
  listEventCommandCategories,
  searchEventCommands,
} from '../../core/mz-codes-loader.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerCodesTools(server: McpServer, _config: Config): void {
  server.registerTool(
    'event_command_describe',
    {
      description:
        'Retorna info detalhada de um event command pelo code numérico OU pelo nome. ' +
        'Ex.: event_command_describe(101) ou event_command_describe("Show Text"). Inclui categoria, ' +
        'params na ordem correta, bodyCode (códigos filho do bloco), e flag mzOnly.',
      inputSchema: z.object({
        codeOrName: z.union([z.number().int(), z.string()]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = findEventCommand(args.codeOrName);
        if (!spec) {
          throw mzError('file_not_found', `Event command "${args.codeOrName}" não encontrado no catálogo.`);
        }
        return spec;
      }),
  );

  server.registerTool(
    'event_command_search',
    {
      description:
        'Lista event commands filtrados por categoria, substring no nome, ou mzOnly. ' +
        'Categorias: message, branch, label, variable, timing, party, sound, system, movement, ' +
        'character, screen_effect, actor, battle, scene, advanced, control.',
      inputSchema: z.object({
        category: z.string().optional(),
        namePartial: z.string().optional(),
        mzOnly: z.boolean().optional(),
        limit: z.number().int().positive().default(50),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const results = searchEventCommands({
          category: args.category,
          namePartial: args.namePartial,
          mzOnly: args.mzOnly,
        });
        return {
          count: results.length,
          returned: Math.min(results.length, args.limit),
          items: results.slice(0, args.limit).map((c) => ({
            code: c.code,
            name: c.name,
            category: c.category,
            paramCount: c.params.length,
            hasBody: !!c.bodyCode?.length,
            mzOnly: c.mzOnly ?? false,
          })),
        };
      }),
  );

  server.registerTool(
    'event_command_categories',
    {
      description: 'Lista todas as categorias de event commands disponíveis no catálogo.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const cats = listEventCommandCategories();
        return { count: cats.length, categories: cats };
      }),
  );
}
