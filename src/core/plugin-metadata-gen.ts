/**
 * Geração de bloco JSDoc canônico de metadados de plugin MZ.
 *
 * Spec baseada em comuns-rpgmaker/plugin-metadata.
 *
 * Bloco gerado:
 *   /*:
 *    * @target MZ
 *    * @plugindesc ...
 *    * @author ...
 *    * @url ...
 *    * @help
 *    * ...
 *    *
 *    * @param paramName
 *    * @type string
 *    * @text Display Name
 *    * @desc Description
 *    * @default value
 *    *
 *    * @command commandName
 *    * @text Command Display
 *    * @desc Command description
 *    *   @arg argName ...
 *    /
 */

import { z } from 'zod';

export const PluginParamSchema = z
  .object({
    name: z.string().min(1),
    type: z
      .enum([
        'string',
        'multiline_string',
        'note',
        'number',
        'boolean',
        'select',
        'combo',
        'file',
        'animation',
        'actor',
        'class',
        'skill',
        'item',
        'weapon',
        'armor',
        'enemy',
        'troop',
        'state',
        'tileset',
        'common_event',
        'switch',
        'variable',
      ])
      .default('string'),
    text: z.string().optional(),
    desc: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    parent: z.string().optional(),
    on: z.string().optional(),
    off: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.number().int().nonnegative().optional(),
    options: z.array(z.string()).optional(),
    dir: z.string().optional(),
  })
  .passthrough();

export const PluginCommandArgSchema = PluginParamSchema; // mesmo shape

export const PluginCommandSchema = z
  .object({
    name: z.string().min(1),
    text: z.string().optional(),
    desc: z.string().optional(),
    args: z.array(PluginCommandArgSchema).default([]),
  })
  .passthrough();

export const PluginMetadataSchema = z
  .object({
    target: z.string().default('MZ'),
    plugindesc: z.string().default(''),
    author: z.string().default(''),
    url: z.string().optional(),
    help: z.string().default(''),
    base: z.array(z.string()).default([]),
    orderAfter: z.array(z.string()).default([]),
    orderBefore: z.array(z.string()).default([]),
    params: z.array(PluginParamSchema).default([]),
    commands: z.array(PluginCommandSchema).default([]),
  })
  .passthrough();

export type PluginMetadata = z.infer<typeof PluginMetadataSchema>;
export type PluginParam = z.infer<typeof PluginParamSchema>;
export type PluginCommand = z.infer<typeof PluginCommandSchema>;

export function generateMetadataBlock(meta: PluginMetadata): string {
  const lines: string[] = [];
  lines.push('/*:');
  lines.push(` * @target ${meta.target}`);
  if (meta.plugindesc) lines.push(` * @plugindesc ${meta.plugindesc}`);
  if (meta.author) lines.push(` * @author ${meta.author}`);
  if (meta.url) lines.push(` * @url ${meta.url}`);
  for (const base of meta.base) lines.push(` * @base ${base}`);
  for (const after of meta.orderAfter) lines.push(` * @orderAfter ${after}`);
  for (const before of meta.orderBefore) lines.push(` * @orderBefore ${before}`);
  if (meta.help) {
    lines.push(' * @help');
    for (const line of meta.help.split('\n')) lines.push(` * ${line}`);
  }

  // Params
  for (const p of meta.params) {
    lines.push(' *');
    lines.push(` * @param ${p.name}`);
    if (p.text !== undefined) lines.push(` * @text ${p.text}`);
    if (p.desc !== undefined) lines.push(` * @desc ${p.desc}`);
    if (p.type) lines.push(` * @type ${p.type}`);
    if (p.parent) lines.push(` * @parent ${p.parent}`);
    if (p.default !== undefined) lines.push(` * @default ${p.default}`);
    if (p.min !== undefined) lines.push(` * @min ${p.min}`);
    if (p.max !== undefined) lines.push(` * @max ${p.max}`);
    if (p.decimals !== undefined) lines.push(` * @decimals ${p.decimals}`);
    if (p.on !== undefined) lines.push(` * @on ${p.on}`);
    if (p.off !== undefined) lines.push(` * @off ${p.off}`);
    if (p.dir !== undefined) lines.push(` * @dir ${p.dir}`);
    if (p.options) {
      for (const opt of p.options) lines.push(` * @option ${opt}`);
    }
  }

  // Commands
  for (const c of meta.commands) {
    lines.push(' *');
    lines.push(` * @command ${c.name}`);
    if (c.text !== undefined) lines.push(` * @text ${c.text}`);
    if (c.desc !== undefined) lines.push(` * @desc ${c.desc}`);
    for (const a of c.args) {
      lines.push(' *');
      lines.push(` * @arg ${a.name}`);
      if (a.text !== undefined) lines.push(` * @text ${a.text}`);
      if (a.desc !== undefined) lines.push(` * @desc ${a.desc}`);
      if (a.type) lines.push(` * @type ${a.type}`);
      if (a.default !== undefined) lines.push(` * @default ${a.default}`);
      if (a.min !== undefined) lines.push(` * @min ${a.min}`);
      if (a.max !== undefined) lines.push(` * @max ${a.max}`);
    }
  }

  lines.push(' */');
  return lines.join('\n');
}

/**
 * Cria o source completo de um plugin: metadata block + corpo de código.
 * O `body` pode usar PluginManager.registerCommand etc.
 */
export function generatePluginSource(meta: PluginMetadata, body: string): string {
  return `${generateMetadataBlock(meta)}\n\n${body}\n`;
}

/** Template de plugin "blank" — IIFE com PluginManager.parameters. */
export function blankPluginBody(pluginName: string): string {
  return `(() => {
  'use strict';
  const pluginName = '${pluginName}';
  const parameters = PluginManager.parameters(pluginName);

  // TODO: implementação
  void parameters;
})();`;
}

/**
 * Template "command-only": registra plugin commands com handlers stub.
 */
export function commandOnlyPluginBody(pluginName: string, commands: PluginCommand[]): string {
  const registrations = commands
    .map((c) => {
      const args = c.args.map((a) => `args.${a.name}`).join(', ');
      return `  PluginManager.registerCommand(pluginName, '${c.name}', (args) => {
    // TODO: ${c.desc ?? c.name}
    void ${args || 'args'};
  });`;
    })
    .join('\n');
  return `(() => {
  'use strict';
  const pluginName = '${pluginName}';
  const parameters = PluginManager.parameters(pluginName);
  void parameters;
${registrations}
})();`;
}
