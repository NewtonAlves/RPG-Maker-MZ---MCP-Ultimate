/**
 * Tools de Localização — extração e import de strings traduzíveis.
 *
 * Strings vêm de:
 *   - Show Text commands (101 + 401) em Map events e Common Events
 *   - Show Choices (102) opções
 *   - System.json terms, currencyUnit
 *   - Actor names, nicknames, profiles
 *   - Skill/Item/Weapon/Armor/Enemy/State names, descriptions
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { listMapIds, loadMap, saveMap } from '../../core/map-io.js';
import { loadDbRaw, loadDbRecords, saveDbRaw, setRecordAtId, type DbRecord } from '../../core/db-io.js';
import { loadPluginsJs, savePluginsJs } from '../../core/plugins-js.js';
import { DB_CATEGORY_NAMES } from '../../schemas/registry.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

interface ExtractedString {
  source: string; // ex: "map:5/event:3/page:0/cmd:7" ou "skill:42/name"
  field: string;
  text: string;
}

export function registerLocalizationTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mz_extract_translatable_text',
    {
      description:
        'Extrai todas as strings traduzíveis do projeto. Categorias: events (Show Text, Choices), ' +
        'database (names, descriptions), system (terms). Salva como JSON ou CSV (formato Translator++ compatível).',
      inputSchema: z.object({
        outputPath: z.string().optional(),
        format: z.enum(['json', 'csv']).default('json'),
        scope: z
          .enum(['events', 'database', 'system', 'all'])
          .default('all')
          .describe('Limita escopo de extração'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const strings: ExtractedString[] = [];

        if (args.scope === 'events' || args.scope === 'all') {
          const mapIds = await listMapIds(config);
          for (const mapId of mapIds) {
            const map = await loadMap(config, mapId);
            for (const event of map.events) {
              if (!event) continue;
              for (let p = 0; p < event.pages.length; p++) {
                const page = event.pages[p]!;
                for (let i = 0; i < page.list.length; i++) {
                  const cmd = page.list[i]!;
                  // 101: Show Text params [face, faceIdx, bg, pos, speakerName] — params[4] é speaker
                  if (cmd.code === 101 && typeof cmd.parameters[4] === 'string' && cmd.parameters[4]) {
                    strings.push({
                      source: `map:${mapId}/event:${event.id}/page:${p}/cmd:${i}/101`,
                      field: 'speakerName',
                      text: cmd.parameters[4] as string,
                    });
                  }
                  // 401: Text continuation params [text]
                  if (cmd.code === 401 && typeof cmd.parameters[0] === 'string') {
                    strings.push({
                      source: `map:${mapId}/event:${event.id}/page:${p}/cmd:${i}/401`,
                      field: 'text',
                      text: cmd.parameters[0] as string,
                    });
                  }
                  // 102: Show Choices params [choicesArr, ...]
                  if (cmd.code === 102 && Array.isArray(cmd.parameters[0])) {
                    const choices = cmd.parameters[0] as string[];
                    for (let c = 0; c < choices.length; c++) {
                      strings.push({
                        source: `map:${mapId}/event:${event.id}/page:${p}/cmd:${i}/102/choice:${c}`,
                        field: 'choice',
                        text: choices[c]!,
                      });
                    }
                  }
                }
              }
            }
          }
          // Common events também
          const ces = await loadDbRecords(config, 'common_event');
          for (const ce of ces) {
            const list = (ce.list as { code: number; parameters: unknown[] }[]) ?? [];
            for (let i = 0; i < list.length; i++) {
              const cmd = list[i]!;
              if (cmd.code === 401 && typeof cmd.parameters[0] === 'string') {
                strings.push({
                  source: `common_event:${ce.id}/cmd:${i}/401`,
                  field: 'text',
                  text: cmd.parameters[0] as string,
                });
              }
            }
          }
        }

        if (args.scope === 'database' || args.scope === 'all') {
          const dbCats = DB_CATEGORY_NAMES.filter((c) => c !== 'animation' && c !== 'tileset');
          for (const cat of dbCats) {
            const records = await loadDbRecords(config, cat);
            for (const r of records) {
              for (const f of ['name', 'description', 'nickname', 'profile', 'message1', 'message2', 'message3', 'message4']) {
                const v = r[f];
                if (typeof v === 'string' && v.length > 0) {
                  strings.push({ source: `${cat}:${r.id}/${f}`, field: f, text: v });
                }
              }
            }
          }
        }

        if (args.scope === 'system' || args.scope === 'all') {
          const sysRaw = await fs.readFile(
            path.join(config.project.path, 'data', 'System.json'),
            'utf-8',
          );
          const sys = JSON.parse(sysRaw);
          for (const f of ['gameTitle', 'currencyUnit']) {
            if (typeof sys[f] === 'string') {
              strings.push({ source: `system/${f}`, field: f, text: sys[f] });
            }
          }
          // terms é objeto com sub-arrays
          if (sys.terms && typeof sys.terms === 'object') {
            const flatten = (prefix: string, val: unknown) => {
              if (typeof val === 'string') {
                if (val.length > 0) {
                  strings.push({ source: `system/terms/${prefix}`, field: 'term', text: val });
                }
              } else if (Array.isArray(val)) {
                for (let i = 0; i < val.length; i++) flatten(`${prefix}[${i}]`, val[i]);
              } else if (val && typeof val === 'object') {
                for (const [k, v] of Object.entries(val)) flatten(`${prefix}.${k}`, v);
              }
            };
            for (const [k, v] of Object.entries(sys.terms)) flatten(k, v);
          }
        }

        if (args.scope === 'all') {
          // Plugin params — strings em plugins.js parameters
          try {
            const entries = await loadPluginsJs(config);
            for (const entry of entries) {
              for (const [paramName, paramValue] of Object.entries(entry.parameters)) {
                if (typeof paramValue === 'string' && paramValue.length > 0 && !/^\d+$/.test(paramValue) && !/^(true|false)$/.test(paramValue)) {
                  strings.push({
                    source: `plugin:${entry.name}/param:${paramName}`,
                    field: 'plugin_param',
                    text: paramValue,
                  });
                }
              }
            }
          } catch {}
        }

        // Output
        let out: string;
        if (args.format === 'csv') {
          const Papa = (await import('papaparse')).default;
          out = Papa.unparse({
            fields: ['source', 'field', 'text', 'translation'],
            data: strings.map((s) => [s.source, s.field, s.text, '']),
          });
        } else {
          out = JSON.stringify(strings, null, 2);
        }

        if (args.outputPath) {
          await fs.writeFile(args.outputPath, out, 'utf-8');
          return { extracted: strings.length, file: args.outputPath, format: args.format };
        }
        return {
          extracted: strings.length,
          format: args.format,
          [args.format === 'json' ? 'json' : 'csv']: out,
          sample: strings.slice(0, 10),
        };
      }),
  );

  server.registerTool(
    'mz_import_translations',
    {
      description:
        'Importa traduções a partir de JSON ou CSV (formato gerado por mz_extract_translatable_text). ' +
        'Aplica de volta às fontes originais (events, database, system). Use dryRun pra preview.',
      inputSchema: z.object({
        translationsPath: z.string().min(1),
        format: z.enum(['json', 'csv']).default('json'),
        dryRun: z.boolean().default(false),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await fs.readFile(args.translationsPath, 'utf-8');
        let entries: { source: string; field: string; text: string; translation?: string }[];

        if (args.format === 'csv') {
          const Papa = (await import('papaparse')).default;
          const parsed = Papa.parse<Record<string, string>>(raw.trim(), {
            header: true,
            skipEmptyLines: true,
          });
          entries = parsed.data.map((r) => ({
            source: r.source ?? '',
            field: r.field ?? '',
            text: r.text ?? '',
            translation: r.translation,
          }));
        } else {
          entries = JSON.parse(raw);
        }

        const applied: { source: string; ok: boolean; error?: string }[] = [];
        for (const e of entries) {
          if (!e.translation || e.translation === e.text) continue;
          try {
            await applyTranslation(config, e, args.dryRun);
            applied.push({ source: e.source, ok: true });
          } catch (err) {
            applied.push({ source: e.source, ok: false, error: (err as Error).message });
          }
        }
        return {
          dryRun: args.dryRun,
          totalEntries: entries.length,
          applied: applied.filter((a) => a.ok).length,
          errors: applied.filter((a) => !a.ok),
        };
      }),
  );

  server.registerTool(
    'mz_localization_coverage',
    {
      description:
        'Conta strings traduzíveis vs traduzidas em um arquivo de traduções. Retorna % coverage.',
      inputSchema: z.object({
        translationsPath: z.string().min(1),
        format: z.enum(['json', 'csv']).default('json'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await fs.readFile(args.translationsPath, 'utf-8');
        let entries: { translation?: string }[];
        if (args.format === 'csv') {
          const Papa = (await import('papaparse')).default;
          entries = (Papa.parse<Record<string, string>>(raw.trim(), {
            header: true,
            skipEmptyLines: true,
          }).data as Record<string, string>[]).map((r) => ({ translation: r.translation }));
        } else {
          entries = JSON.parse(raw);
        }
        const total = entries.length;
        const translated = entries.filter((e) => e.translation && e.translation.length > 0).length;
        return { total, translated, untranslated: total - translated, coverage: total > 0 ? translated / total : 0 };
      }),
  );
}

async function applyTranslation(
  config: Config,
  entry: { source: string; field: string; text: string; translation?: string },
  dryRun: boolean,
): Promise<void> {
  if (!entry.translation) return;

  // Parse source like "map:5/event:3/page:0/cmd:7/401" or "skill:42/name"
  const tr = entry.translation;
  if (entry.source.startsWith('map:')) {
    const m = /^map:(\d+)\/event:(\d+)\/page:(\d+)\/cmd:(\d+)\/(\d+)(?:\/choice:(\d+))?/.exec(entry.source);
    if (!m) throw new Error(`source format desconhecido: ${entry.source}`);
    const mapId = +m[1]!;
    const evId = +m[2]!;
    const pageIdx = +m[3]!;
    const cmdIdx = +m[4]!;
    const code = +m[5]!;
    const choiceIdx = m[6] ? +m[6] : undefined;
    if (dryRun) return;
    const map = await loadMap(config, mapId);
    const ev = map.events[evId];
    if (!ev) throw new Error(`event ${evId} não existe`);
    const page = ev.pages[pageIdx];
    if (!page) throw new Error(`page ${pageIdx} não existe`);
    const cmd = page.list[cmdIdx];
    if (!cmd) throw new Error(`cmd ${cmdIdx} não existe`);
    if (code === 101) cmd.parameters[4] = tr;
    else if (code === 401) cmd.parameters[0] = tr;
    else if (code === 102 && choiceIdx !== undefined && Array.isArray(cmd.parameters[0])) {
      (cmd.parameters[0] as string[])[choiceIdx] = tr;
    }
    await saveMap(config, mapId, map);
  } else if (entry.source.startsWith('common_event:')) {
    const m = /^common_event:(\d+)\/cmd:(\d+)\/(\d+)/.exec(entry.source);
    if (!m) throw new Error(`source format: ${entry.source}`);
    if (dryRun) return;
    const ceId = +m[1]!;
    const cmdIdx = +m[2]!;
    const code = +m[3]!;
    const raw = await loadDbRaw(config, 'common_event');
    const ce = raw[ceId];
    if (!ce) throw new Error(`common_event ${ceId} não existe`);
    const list = ce.list as { code: number; parameters: unknown[] }[];
    const cmd = list[cmdIdx];
    if (!cmd) throw new Error(`cmd ${cmdIdx} não existe`);
    if (code === 401) cmd.parameters[0] = tr;
    setRecordAtId(raw, ce as DbRecord);
    await saveDbRaw(config, 'common_event', raw);
  } else if (entry.source.startsWith('plugin:')) {
    // plugin:<name>/param:<paramName>
    const m = /^plugin:([^/]+)\/param:(.+)$/.exec(entry.source);
    if (!m) throw new Error(`source format desconhecido: ${entry.source}`);
    if (dryRun) return;
    const pluginName = m[1]!;
    const paramName = m[2]!;
    const entries = await loadPluginsJs(config);
    const e = entries.find((x) => x.name === pluginName);
    if (!e) throw new Error(`plugin "${pluginName}" não está registrado`);
    e.parameters = { ...e.parameters, [paramName]: tr };
    await savePluginsJs(config, entries);
  } else if (entry.source.startsWith('system/')) {
    if (dryRun) return;
    const sysRaw = await fs.readFile(
      path.join(config.project.path, 'data', 'System.json'),
      'utf-8',
    );
    const sys = JSON.parse(sysRaw);
    if (entry.source === 'system/gameTitle') sys.gameTitle = tr;
    else if (entry.source === 'system/currencyUnit') sys.currencyUnit = tr;
    else if (entry.source.startsWith('system/terms/')) {
      // Path: system/terms/<rootKey>[<idx>] ou system/terms/<rootKey>.<subkey>
      // Aplica recursivamente
      const pathStr = entry.source.replace(/^system\/terms\//, '');
      applyToPath(sys.terms ?? {}, pathStr, tr);
      sys.terms = sys.terms ?? {};
    }
    sys.versionId = (sys.versionId ?? 0) + 1;
    const { safeWrite } = await import('../../core/safe-writer.js');
    await safeWrite(path.join(config.project.path, 'data', 'System.json'), JSON.stringify(sys));
  } else {
    // database: cat:id/field
    const m = /^([a-z_]+):(\d+)\/(\w+)/.exec(entry.source);
    if (!m) throw new Error(`source desconhecido: ${entry.source}`);
    if (dryRun) return;
    const cat = m[1]! as never;
    if (!DB_CATEGORY_NAMES.includes(cat)) {
      throw mzError('schema_validation_failed', `categoria ${cat} não suportada pra translation`);
    }
    const recId = +m[2]!;
    const field = m[3]!;
    const raw = await loadDbRaw(config, cat);
    const rec = raw[recId];
    if (!rec) throw new Error(`record ${recId} não existe em ${cat}`);
    (rec as Record<string, unknown>)[field] = tr;
    await saveDbRaw(config, cat, raw);
  }
}

/**
 * Aplica `value` a um path tipo "commands[3]" ou "basic[0]" ou "messages.victory"
 * dentro de um objeto target.
 */
function applyToPath(target: Record<string, unknown>, path: string, value: string): void {
  // Tokeniza: "commands[3]" → ['commands', 3]; "basic[0].name" → ['basic', 0, 'name']
  const tokens: (string | number)[] = [];
  const regex = /([a-zA-Z_$][\w$]*)|\[(\d+)\]|\.([a-zA-Z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(path)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else if (m[2]) tokens.push(parseInt(m[2], 10));
    else if (m[3]) tokens.push(m[3]);
  }
  if (tokens.length === 0) return;
  // Navega até o pai do alvo
  let curr: unknown = target;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tk = tokens[i]!;
    if (curr && typeof curr === 'object') {
      const c = curr as Record<string | number, unknown>;
      if (c[tk] === undefined) {
        const next = tokens[i + 1];
        c[tk] = typeof next === 'number' ? [] : {};
      }
      curr = c[tk];
    }
  }
  const last = tokens[tokens.length - 1]!;
  if (curr && typeof curr === 'object') {
    (curr as Record<string | number, unknown>)[last] = value;
  }
}
