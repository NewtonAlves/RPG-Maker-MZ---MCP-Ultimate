/**
 * Tools de CRUD genérico do database MZ.
 *
 * Operam sobre as 12 categorias array-of-records: actor, class, skill, item,
 * weapon, armor, enemy, troop, state, animation, tileset, common_event.
 *
 * Cada tool valida `category` contra o registry, valida `data` contra o schema
 * Zod da categoria, e usa SafeWriter + atomicidade.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  clearRecordAtId,
  loadDbRaw,
  loadDbRecords,
  nextFreeId,
  saveDbRaw,
  setRecordAtId,
  type DbRecord,
} from '../../core/db-io.js';
import {
  DB_CATEGORY_NAMES,
  getCategoryInfo,
  type DbCategory,
} from '../../schemas/registry.js';
import { MzMcpError, mzError } from '../../utils/errors.js';
import { registerActorCreateHelper } from './helpers/actor-create.js';
import { registerEnemyCreateBalancedHelper } from './helpers/enemy-create-balanced.js';
import { registerSkillCreateDamageHelper } from './helpers/skill-create-damage.js';
import { registerSkillCreateHealingHelper } from './helpers/skill-create-healing.js';

/** Enum Zod com todos os nomes de categoria. */
const CategoryEnum = z.enum(DB_CATEGORY_NAMES as [DbCategory, ...DbCategory[]]);

export function registerDatabaseTools(server: McpServer, config: Config): void {
  server.registerTool(
    'db_list',
    {
      description:
        'Lista records de uma categoria do database MZ (resumo: id, name, hasNote). ' +
        `Categorias válidas: ${DB_CATEGORY_NAMES.join(', ')}.`,
      inputSchema: z.object({
        category: CategoryEnum.describe('Categoria (ex.: "actor", "skill")'),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const records = await loadDbRecords(config, args.category);
        const offset = args.offset ?? 0;
        const sliced = args.limit
          ? records.slice(offset, offset + args.limit)
          : records.slice(offset);
        const info = getCategoryInfo(args.category);
        return {
          category: args.category,
          label: info.labelPlural,
          fileName: info.fileName,
          total: records.length,
          returned: sliced.length,
          offset,
          items: sliced.map((r) => ({
            id: r.id,
            name: (r.name as string | undefined) ?? '',
            hasNote: typeof r.note === 'string' && r.note.length > 0,
          })),
        };
      }),
  );

  server.registerTool(
    'db_get',
    {
      description: 'Retorna o record completo de uma categoria por id.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, args.category);
        const record = raw[args.id];
        if (!record) {
          throw mzError(
            'file_not_found',
            `Nenhum ${getCategoryInfo(args.category).label} com id=${args.id}.`,
          );
        }
        return record;
      }),
  );

  server.registerTool(
    'db_create',
    {
      description:
        'Cria um novo record na categoria. Valida via schema Zod. Se data.id for ' +
        'fornecido e livre, usa esse; senão usa o próximo ID livre.',
      inputSchema: z.object({
        category: CategoryEnum,
        data: z.record(z.unknown()),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const info = getCategoryInfo(args.category);
        const raw = await loadDbRaw(config, args.category);
        let id: number;
        if (typeof args.data.id === 'number' && args.data.id > 0) {
          if (raw[args.data.id]) {
            throw mzError(
              'schema_validation_failed',
              `Já existe um ${info.label} com id=${args.data.id}. Use db_update.`,
            );
          }
          id = args.data.id;
        } else {
          id = nextFreeId(raw);
        }
        const candidate = { ...args.data, id };
        const parsed = info.schema.safeParse(candidate);
        if (!parsed.success) {
          throw mzError(
            'schema_validation_failed',
            `Dados inválidos pra ${info.label}: ${parsed.error.message}`,
            { details: { issues: parsed.error.issues } },
          );
        }
        setRecordAtId(raw, parsed.data as DbRecord);
        await saveDbRaw(config, args.category, raw, { destructive: false });
        return { id, category: args.category, record: parsed.data };
      }),
  );

  server.registerTool(
    'db_update',
    {
      description:
        'Atualiza parcialmente um record (patch shallow). Campos não tocados são preservados, ' +
        'incluindo `note` byte-by-byte.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
        patch: z.record(z.unknown()),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const info = getCategoryInfo(args.category);
        const raw = await loadDbRaw(config, args.category);
        const existing = raw[args.id];
        if (!existing) {
          throw mzError('file_not_found', `Nenhum ${info.label} com id=${args.id}.`);
        }
        const merged = { ...existing, ...args.patch, id: args.id };
        const parsed = info.schema.safeParse(merged);
        if (!parsed.success) {
          throw mzError(
            'schema_validation_failed',
            `Patch inválido pra ${info.label}: ${parsed.error.message}`,
            { details: { issues: parsed.error.issues } },
          );
        }
        setRecordAtId(raw, parsed.data as DbRecord);
        await saveDbRaw(config, args.category, raw, { destructive: false });
        return { id: args.id, category: args.category, record: parsed.data };
      }),
  );

  server.registerTool(
    'db_delete',
    {
      description:
        'Deleta um record (substitui por null). Operação destrutiva — cria snapshot ' +
        'antes se autoBackup ligado (default sim).',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const info = getCategoryInfo(args.category);
        const raw = await loadDbRaw(config, args.category);
        const removed = clearRecordAtId(raw, args.id);
        if (!removed) {
          throw mzError('file_not_found', `Nenhum ${info.label} com id=${args.id} pra deletar.`);
        }
        await saveDbRaw(config, args.category, raw, {
          destructive: true,
          snapshotLabel: `before-delete-${args.category}-${args.id}`,
        });
        return { deleted: true, id: args.id, category: args.category };
      }),
  );

  server.registerTool(
    'db_search',
    {
      description:
        'Busca records por substring em name/note/description (case-insensitive). ' +
        'field="any" busca em todos os campos textuais.',
      inputSchema: z.object({
        category: CategoryEnum,
        query: z.string().min(1),
        field: z.enum(['name', 'note', 'description', 'any']).optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const records = await loadDbRecords(config, args.category);
        const field = args.field ?? 'any';
        const q = args.query.toLowerCase();
        const matches = records.filter((r) => {
          if (field === 'any' || field === 'name') {
            if (typeof r.name === 'string' && r.name.toLowerCase().includes(q)) return true;
          }
          if (field === 'any' || field === 'note') {
            if (typeof r.note === 'string' && r.note.toLowerCase().includes(q)) return true;
          }
          if (field === 'any' || field === 'description') {
            if (typeof r.description === 'string' && r.description.toLowerCase().includes(q))
              return true;
          }
          return false;
        });
        return {
          category: args.category,
          query: args.query,
          field,
          matches: matches.map((r) => ({
            id: r.id,
            name: (r.name as string | undefined) ?? '',
            preview:
              typeof r.description === 'string' && r.description
                ? r.description.slice(0, 80)
                : undefined,
          })),
          count: matches.length,
        };
      }),
  );

  // Helpers especializados
  registerActorCreateHelper(server, config);
  registerSkillCreateDamageHelper(server, config);
  registerSkillCreateHealingHelper(server, config);
  registerEnemyCreateBalancedHelper(server, config);

  // Integrity checker
  server.registerTool(
    'db_check_consistency',
    {
      description:
        'Varredura completa de integridade referencial do database. Detecta: skills/items ' +
        'referenciando states deletados, weapons/armors com wtypeId/atypeId/etypeId fora do range, ' +
        'enemy actions com skillId inexistente, troop members com enemyId inválido, classes com ' +
        'learnings de skills deletados, actor equips inexistentes, traits cross-database. ' +
        'Retorna lista de issues (severity error/warning) + sumário. Não modifica nada — só lê.',
      inputSchema: z.object({
        severity: z.enum(['all', 'error', 'warning']).default('all').describe('Filtra por severity'),
        limit: z.number().int().positive().default(200).describe('Máximo de issues retornadas'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { checkConsistency } = await import('../../core/integrity-checker.js');
        const result = await checkConsistency(config);
        let issues = result.issues;
        if (args.severity !== 'all') {
          issues = issues.filter((i) => i.severity === args.severity);
        }
        return {
          totalChecks: result.totalChecks,
          totalIssues: issues.length,
          summary: result.summary,
          issues: issues.slice(0, args.limit),
          truncated: issues.length > args.limit ? issues.length - args.limit : 0,
        };
      }),
  );
}

/* ============================ helper de retorno MCP ============================ */

export async function mcpReturn(
  fn: () => Promise<unknown>,
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const result = await fn();
    return {
      content: [
        {
          type: 'text' as const,
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof MzMcpError) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(err.toJSON(), null, 2),
          },
        ],
      };
    }
    throw err;
  }
}
