/**
 * Tools de export/import de database em CSV. Útil pra balanceamento em Excel.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  loadDbRaw,
  loadDbRecords,
  saveDbRaw,
  setRecordAtId,
  type DbRecord,
} from '../../core/db-io.js';
import {
  DB_CATEGORY_NAMES,
  getCategoryInfo,
  type DbCategory,
} from '../../schemas/registry.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const CategoryEnum = z.enum(DB_CATEGORY_NAMES as [DbCategory, ...DbCategory[]]);

/** Campos exportados por categoria — incluindo nested (serializados como JSON na célula). */
const EXPORT_FIELDS: Partial<Record<DbCategory, string[]>> = {
  actor: ['id', 'name', 'nickname', 'classId', 'initialLevel', 'maxLevel', 'characterName', 'characterIndex', 'faceName', 'faceIndex', 'battlerName', 'equips', 'traits', 'profile', 'note'],
  class: ['id', 'name', 'expParams', 'params', 'learnings', 'traits', 'note'],
  skill: ['id', 'name', 'description', 'mpCost', 'tpCost', 'tpGain', 'scope', 'occasion', 'speed', 'successRate', 'repeats', 'hitType', 'iconIndex', 'stypeId', 'animationId', 'damage', 'effects', 'traits', 'message1', 'message2', 'note'],
  item: ['id', 'name', 'description', 'price', 'consumable', 'iconIndex', 'scope', 'occasion', 'itypeId', 'damage', 'effects', 'traits', 'note'],
  weapon: ['id', 'name', 'description', 'price', 'iconIndex', 'wtypeId', 'etypeId', 'animationId', 'params', 'traits', 'note'],
  armor: ['id', 'name', 'description', 'price', 'iconIndex', 'atypeId', 'etypeId', 'params', 'traits', 'note'],
  enemy: ['id', 'name', 'exp', 'gold', 'battlerName', 'battlerHue', 'params', 'dropItems', 'actions', 'traits', 'note'],
  troop: ['id', 'name', 'members'],
  state: ['id', 'name', 'iconIndex', 'restriction', 'priority', 'autoRemovalTiming', 'minTurns', 'maxTurns', 'traits', 'message1', 'message2', 'message3', 'message4', 'note'],
  animation: ['id', 'name', 'effectName', 'displayType'],
  tileset: ['id', 'name', 'mode', 'tilesetNames', 'note'],
  common_event: ['id', 'name', 'trigger', 'switchId'],
};

/** Campos que são objetos/arrays — serializados como JSON na célula CSV. */
const NESTED_FIELDS = new Set([
  'equips', 'traits', 'expParams', 'params', 'learnings', 'damage',
  'effects', 'members', 'dropItems', 'actions', 'tilesetNames',
]);

function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (NESTED_FIELDS.size && (Array.isArray(value) || (typeof value === 'object' && value !== null))) {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Sentinel: campo deve ser ignorado no merge (não atualizar existente). */
const UNSET = Symbol('unset');

function parseCell(field: string, raw: string): unknown {
  if (NESTED_FIELDS.has(field)) {
    if (raw === '') return UNSET;  // Não sobrescreve nested existente com vazio
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw === '') return '';
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return raw;
}

export function registerCsvTools(server: McpServer, config: Config): void {
  server.registerTool(
    'db_export_csv',
    {
      description:
        'Exporta uma categoria de database como CSV (campos comuns só). Salva em ' +
        '<project>/mz-mcp-export-<category>.csv ou retorna inline se outputPath omitido.',
      inputSchema: z.object({
        category: CategoryEnum,
        outputPath: z.string().optional(),
        fields: z.array(z.string()).optional().describe('Sobrescreve os campos default'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const records = await loadDbRecords(config, args.category);
        const fields = args.fields ?? EXPORT_FIELDS[args.category] ?? ['id', 'name', 'note'];
        const rows = records.map((r) => {
          const row: Record<string, unknown> = {};
          for (const f of fields) row[f] = serializeCell(r[f]);
          return row;
        });
        const csv = Papa.unparse({ fields, data: rows.map((r) => fields.map((f) => r[f])) });

        if (args.outputPath) {
          await fs.writeFile(args.outputPath, csv, 'utf-8');
          return { exported: true, file: args.outputPath, rowCount: rows.length, fields };
        }
        return { exported: true, csv, rowCount: rows.length, fields };
      }),
  );

  server.registerTool(
    'db_import_csv',
    {
      description:
        'Importa CSV pra uma categoria. Para cada linha, faz UPDATE no record com id correspondente ' +
        '(se id existir) ou CREATE (se id estiver vazio/não existir). Use dryRun pra ver diff antes.',
      inputSchema: z.object({
        category: CategoryEnum,
        csvPath: z.string().optional(),
        csvText: z.string().optional(),
        dryRun: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let csvText = args.csvText;
        if (!csvText && args.csvPath) {
          csvText = await fs.readFile(args.csvPath, 'utf-8');
        }
        if (!csvText) {
          throw mzError('schema_validation_failed', 'Forneça csvPath ou csvText.');
        }

        const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
        const rows = parsed.data as Record<string, string>[];
        if (parsed.errors.length > 0) {
          throw mzError('schema_validation_failed', `CSV parse errors: ${parsed.errors[0]?.message}`);
        }

        const info = getCategoryInfo(args.category);
        const raw = await loadDbRaw(config, args.category);
        const changes: { id: number; action: 'create' | 'update' }[] = [];

        for (const row of rows) {
          const id = parseInt(row.id ?? '', 10);
          if (!Number.isFinite(id) || id <= 0) continue;

          const existing = raw[id];
          // Converte campos via parseCell — lida com nested JSON em arrays/objects
          const fieldData: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (k === '') continue;
            const parsed = parseCell(k, v ?? '');
            if (parsed === UNSET) continue;  // Skip nested vazios pra preservar existente
            fieldData[k] = parsed;
          }
          fieldData.id = id;

          if (existing) {
            // Merge shallow
            const merged = { ...existing, ...fieldData };
            const parsed = info.schema.safeParse(merged);
            if (!parsed.success) {
              throw mzError(
                'schema_validation_failed',
                `Linha id=${id} inválida: ${parsed.error.message}`,
              );
            }
            if (!args.dryRun) {
              setRecordAtId(raw, parsed.data as DbRecord);
            }
            changes.push({ id, action: 'update' });
          } else {
            // Create — vai precisar de mais campos default
            const parsed = info.schema.safeParse(fieldData);
            if (!parsed.success) {
              // Sem todos os campos requeridos pra create — pula
              continue;
            }
            if (!args.dryRun) {
              setRecordAtId(raw, parsed.data as DbRecord);
            }
            changes.push({ id, action: 'create' });
          }
        }

        if (!args.dryRun && changes.length > 0) {
          await saveDbRaw(config, args.category, raw, {
            destructive: true,
            snapshotLabel: `before-csv-import-${args.category}`,
          });
        }

        return {
          dryRun: args.dryRun,
          changes,
          totalChanges: changes.length,
          creates: changes.filter((c) => c.action === 'create').length,
          updates: changes.filter((c) => c.action === 'update').length,
        };
      }),
  );

  server.registerTool(
    'db_diff_csv',
    {
      description: 'Compara CSV com o estado atual, sem aplicar. Alias pra db_import_csv com dryRun=true.',
      inputSchema: z.object({
        category: CategoryEnum,
        csvPath: z.string().optional(),
        csvText: z.string().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let csvText = args.csvText;
        if (!csvText && args.csvPath) {
          csvText = await fs.readFile(args.csvPath, 'utf-8');
        }
        if (!csvText) {
          throw mzError('schema_validation_failed', 'Forneça csvPath ou csvText.');
        }
        const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
        const rows = (parsed.data as Record<string, string>[]).filter((r) => r.id);
        const raw = await loadDbRaw(config, args.category);
        const diffs: { id: number; field: string; old: unknown; new: unknown }[] = [];
        for (const row of rows) {
          const id = parseInt(row.id ?? '', 10);
          if (!Number.isFinite(id) || id <= 0) continue;
          const existing = raw[id];
          if (!existing) {
            diffs.push({ id, field: '(new record)', old: null, new: row });
            continue;
          }
          for (const [k, v] of Object.entries(row)) {
            if (k === 'id' || k === '') continue;
            const oldVal = existing[k];
            if (String(oldVal ?? '') !== v) {
              diffs.push({ id, field: k, old: oldVal, new: v });
            }
          }
        }
        return { diffs, totalDiffs: diffs.length };
      }),
  );
}

void path;
