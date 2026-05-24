/**
 * Tools de memória persistente do projeto.
 *
 * Permitem ao agente lembrar e recuperar fatos entre sessões — design decisions,
 * convenções, lore, regras de balance, notas de WIP, handoffs.
 *
 * Storage local em <project>/.mz-mcp/memory/, multi-agent safe.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  categories as listCategories,
  forget,
  list as listEntries,
  MEMORY_CATEGORIES,
  recall,
  remember,
  type MemoryCategory,
} from '../../core/project-memory.js';
import { mcpReturn } from '../database/index.js';

const CategoryEnum = z.enum([...MEMORY_CATEGORIES] as [MemoryCategory, ...MemoryCategory[]]);

export function registerMemoryTools(server: McpServer, config: Config): void {
  server.registerTool(
    'project_memory_remember',
    {
      description:
        'Registra um fato do projeto na memória persistente (sobrevive entre sessões). ' +
        'Use pra design decisions, convenções de naming, lore, regras de balanceamento, ' +
        'notas de WIP, handoffs pra outros agentes. ' +
        `Categorias: ${MEMORY_CATEGORIES.join(', ')}.`,
      inputSchema: z.object({
        category: CategoryEnum.describe('Tipo de memória'),
        key: z.string().min(1).max(200).describe('Identificador único (slug, frase curta)'),
        content: z.string().min(1).describe('Conteúdo livre (markdown recomendado)'),
        tags: z.array(z.string()).optional().describe('Tags pra busca cruzada'),
        author: z.string().optional().describe('Quem está registrando (default: "mcp-agent")'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const entry = await remember(config, {
          category: args.category,
          key: args.key,
          content: args.content,
          tags: args.tags ?? [],
          author: args.author ?? 'mcp-agent',
        });
        return {
          remembered: true,
          key: entry.key,
          category: entry.category,
          updated: entry.updated,
          author: entry.author,
        };
      }),
  );

  server.registerTool(
    'project_memory_recall',
    {
      description:
        'Recupera fatos da memória do projeto. Filtre por categoria, busque por substring ' +
        '(em key/content/tags), ou filtre por tags. Sem filtros, retorna últimos 50 atualizados.',
      inputSchema: z.object({
        category: CategoryEnum.optional(),
        search: z.string().optional().describe('Busca case-insensitive em key/content/tags'),
        tags: z.array(z.string()).optional().describe('Filtra entradas que tenham QUALQUER uma dessas tags'),
        limit: z.number().int().positive().default(50),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => recall(config, args)),
  );

  server.registerTool(
    'project_memory_list',
    {
      description:
        'Lista keys da memória (sem conteúdo, só metadados). Opcionalmente filtra por categoria. ' +
        'Use pra ver "o que está registrado" sem carregar tudo.',
      inputSchema: z.object({
        category: CategoryEnum.optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => listEntries(config, args.category)),
  );

  server.registerTool(
    'project_memory_forget',
    {
      description:
        'Remove uma entrada da memória. Operação destrutiva — confirme com o usuário antes.',
      inputSchema: z.object({
        key: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => forget(config, args.key)),
  );

  server.registerTool(
    'project_memory_categories',
    {
      description:
        'Lista as 7 categorias de memória com contagem de entradas e timestamp da mais recente. ' +
        'Use no início de sessão pra ter overview do que o projeto já tem documentado.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({
        categories: await listCategories(config),
      })),
  );
}
