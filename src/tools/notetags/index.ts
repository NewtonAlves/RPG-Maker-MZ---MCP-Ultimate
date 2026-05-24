/**
 * Tools pra notetags da comunidade (VisuStella, Galv, SRDude, etc.).
 *
 * - note_list_known_tags: catálogo filtrado por categoria
 * - note_add_tag: append `<tag:value>` ao campo `note` (preserva o resto)
 * - note_parse_tags: extrai tags de um record
 *
 * REGRA INVIOLÁVEL: o campo `note` original NÃO é reformatado. Sempre append.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadDbRaw, saveDbRaw, setRecordAtId, type DbRecord } from '../../core/db-io.js';
import { notetagsForCategory, NOTETAGS } from '../../core/mz-codes-loader.js';
import { DB_CATEGORY_NAMES, type DbCategory } from '../../schemas/registry.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const CategoryEnum = z.enum(DB_CATEGORY_NAMES as [DbCategory, ...DbCategory[]]);

export function registerNotetagTools(server: McpServer, _config: Config): void {
  server.registerTool(
    'note_list_known_tags',
    {
      description:
        'Lista notetags conhecidos da comunidade (VisuStella, Galv, SRDude) filtrados ' +
        'por categoria de record. Categoria string livre — comuns: skill, weapon, armor, item, ' +
        'actor, enemy, state, map, event.',
      inputSchema: z.object({
        category: z.string().min(1).describe('Categoria do record (skill, weapon, etc.)'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const tags = notetagsForCategory(args.category);
        return { category: args.category, count: tags.length, tags };
      }),
  );

  server.registerTool(
    'note_list_all_tags',
    {
      description: 'Lista TODOS os notetags conhecidos no catálogo, sem filtro.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({ count: NOTETAGS.length, tags: NOTETAGS })),
  );

  registerNoteAddTag(server, _config);
  registerNoteParseTags(server, _config);
}

function registerNoteAddTag(server: McpServer, config: Config): void {
  server.registerTool(
    'note_add_tag',
    {
      description:
        'Adiciona uma tag `<tag:value>` ao final do campo `note` de um record. PRESERVA todo o conteúdo ' +
        'existente do note (apenas append na próxima linha). value opcional pra tags booleanos como <immortal>.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
        tag: z.string().min(1).describe('Nome do tag (sem < >). Ex.: "element"'),
        value: z.string().optional().describe('Valor após :, se aplicável. Ex.: "fire"'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, args.category);
        const record = raw[args.id];
        if (!record) throw mzError('file_not_found', `${args.category} ${args.id} não existe.`);
        const tagStr = args.value !== undefined ? `<${args.tag}:${args.value}>` : `<${args.tag}>`;
        const currentNote = (record.note as string) ?? '';
        const newNote = currentNote.length > 0 ? `${currentNote}\n${tagStr}` : tagStr;
        const updated = { ...record, note: newNote };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, args.category, raw);
        return { category: args.category, id: args.id, addedTag: tagStr, newNoteLength: newNote.length };
      }),
  );
}

function registerNoteParseTags(server: McpServer, config: Config): void {
  server.registerTool(
    'note_parse_tags',
    {
      description:
        'Extrai todas as tags do campo `note` de um record. Suporta `<tag>`, `<tag:value>`, e ' +
        '`<tag>multi-line content</tag>`. Retorna array de objects com tag/value/raw.',
      inputSchema: z.object({
        category: CategoryEnum,
        id: z.number().int().positive(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, args.category);
        const record = raw[args.id];
        if (!record) throw mzError('file_not_found', `${args.category} ${args.id} não existe.`);
        const note = (record.note as string) ?? '';
        const tags = parseNoteTags(note);
        return { category: args.category, id: args.id, count: tags.length, tags, rawNote: note };
      }),
  );
}

function parseNoteTags(note: string): Array<{ tag: string; value?: string; raw: string; block?: string }> {
  const result: Array<{ tag: string; value?: string; raw: string; block?: string }> = [];
  // Match <tag>...</tag> first (block tags)
  const blockRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  const consumed = new Set<number>();
  while ((m = blockRe.exec(note)) !== null) {
    result.push({ tag: m[1]!, block: m[2]!.trim(), raw: m[0]! });
    for (let i = m.index; i < m.index + m[0]!.length; i++) consumed.add(i);
  }
  // Match <tag:value> or <tag> single (skipping consumed positions)
  const singleRe = /<(\w+)(?::([^>]*))?>/g;
  while ((m = singleRe.exec(note)) !== null) {
    if (consumed.has(m.index)) continue;
    result.push({ tag: m[1]!, value: m[2], raw: m[0]! });
  }
  return result;
}
