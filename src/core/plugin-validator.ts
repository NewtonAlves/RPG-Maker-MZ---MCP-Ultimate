/**
 * Validador de plugin: parsing AST com acorn pra checar sintaxe + extração de
 * metadata via regex do bloco JSDoc.
 */

import { parse as acornParse } from 'acorn';

import { mzError } from '../utils/errors.js';

export interface PluginSyntaxCheckResult {
  ok: boolean;
  error?: string;
}

export function checkPluginSyntax(source: string): PluginSyntaxCheckResult {
  try {
    acornParse(source, { ecmaVersion: 2022, sourceType: 'script' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function assertPluginSyntax(source: string, pluginName: string): void {
  const r = checkPluginSyntax(source);
  if (!r.ok) {
    throw mzError(
      'plugin_invalid',
      `Sintaxe inválida no plugin "${pluginName}": ${r.error}`,
    );
  }
}

export interface ExtractedMetadata {
  target?: string;
  author?: string;
  plugindesc?: string;
  url?: string;
  help?: string;
  paramNames: string[];
  commandNames: string[];
  base: string[];
}

/** Extração rasa do bloco /*:...*\/ do topo de um plugin (sem parsing JSDoc completo). */
export function extractMetadata(source: string): ExtractedMetadata {
  const blockMatch = /\/\*:([\s\S]*?)\*\//.exec(source);
  const result: ExtractedMetadata = { paramNames: [], commandNames: [], base: [] };
  if (!blockMatch) return result;
  const block = blockMatch[1]!;

  const tag = (name: string, multi = false): string | undefined => {
    if (multi) {
      const m = new RegExp(`@${name}\\s+([^\\n]*)`, 'g');
      const all: string[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = m.exec(block)) !== null) all.push(mm[1]!.trim());
      return all.join('\n');
    }
    const m = new RegExp(`@${name}\\s+([^\\n]+)`).exec(block);
    return m?.[1]?.trim();
  };

  result.target = tag('target');
  result.author = tag('author');
  result.plugindesc = tag('plugindesc');
  result.url = tag('url');
  result.help = tag('help');

  for (const m of block.matchAll(/@param\s+(\S+)/g)) {
    result.paramNames.push(m[1]!);
  }
  for (const m of block.matchAll(/@command\s+(\S+)/g)) {
    result.commandNames.push(m[1]!);
  }
  for (const m of block.matchAll(/@base\s+(\S+)/g)) {
    result.base.push(m[1]!);
  }
  return result;
}
