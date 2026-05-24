/**
 * Parser detalhado de blocos JSDoc de metadata MZ.
 *
 * Reconhece:
 *   - Top-level tags: @target, @author, @plugindesc, @url, @help, @base,
 *     @orderAfter, @orderBefore
 *   - Per-param: @param, @text, @desc, @type, @default, @parent, @on, @off,
 *     @min, @max, @decimals, @dir, @option (múltiplos)
 *   - Per-command: @command, @text, @desc, @arg (que tem mesma estrutura que @param)
 *
 * Retorna estrutura PluginMetadata completa (mesmo shape do plugin-metadata-gen).
 */

export interface ParsedParam {
  name: string;
  type?: string;
  text?: string;
  desc?: string;
  default?: string;
  parent?: string;
  on?: string;
  off?: string;
  min?: number;
  max?: number;
  decimals?: number;
  dir?: string;
  options?: string[];
}

export interface ParsedCommand {
  name: string;
  text?: string;
  desc?: string;
  args: ParsedParam[];
}

export interface ParsedMetadata {
  target?: string;
  author?: string;
  plugindesc?: string;
  url?: string;
  help?: string;
  base: string[];
  orderAfter: string[];
  orderBefore: string[];
  params: ParsedParam[];
  commands: ParsedCommand[];
}

/** Extrai o bloco `/*: ... *\/` da fonte. */
export function extractMetadataBlock(source: string): string | null {
  const m = /\/\*:([\s\S]*?)\*\//.exec(source);
  return m?.[1] ?? null;
}

/** Parser linha-a-linha. */
export function parseMetadataDeep(source: string): ParsedMetadata {
  const result: ParsedMetadata = {
    base: [],
    orderAfter: [],
    orderBefore: [],
    params: [],
    commands: [],
  };
  const block = extractMetadataBlock(source);
  if (!block) return result;

  // Normaliza linhas (remove " * " prefix do JSDoc)
  const lines = block.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd());

  // Modo: 'top' | 'help' | 'param' | 'command' | 'arg'
  type Mode = 'top' | 'help' | 'param' | 'arg';
  let mode: Mode = 'top';
  let helpLines: string[] = [];
  let currentParam: ParsedParam | null = null;
  let currentCommand: ParsedCommand | null = null;
  let currentArg: ParsedParam | null = null;

  const flushParam = () => {
    if (currentParam) {
      if (currentCommand) currentCommand.args.push(currentArg ?? currentParam);
      else result.params.push(currentParam);
    }
    currentParam = null;
    currentArg = null;
  };
  const flushCommand = () => {
    flushParam();
    if (currentCommand) result.commands.push(currentCommand);
    currentCommand = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const tagMatch = /^@(\w+)(?:\s+(.*))?$/.exec(line);
    if (!tagMatch) {
      // Linha sem tag: continua help ou ignora
      if (mode === 'help') helpLines.push(line);
      continue;
    }
    const tag = tagMatch[1]!;
    const value = (tagMatch[2] ?? '').trim();

    switch (tag) {
      case 'target': result.target = value; mode = 'top'; break;
      case 'author': result.author = value; mode = 'top'; break;
      case 'plugindesc': result.plugindesc = value; mode = 'top'; break;
      case 'url': result.url = value; mode = 'top'; break;
      case 'help':
        flushParam(); flushCommand();
        mode = 'help'; helpLines = value ? [value] : []; break;
      case 'base': result.base.push(value); break;
      case 'orderAfter': result.orderAfter.push(value); break;
      case 'orderBefore': result.orderBefore.push(value); break;

      case 'param':
        if (mode === 'help') { result.help = helpLines.join('\n').trim(); helpLines = []; }
        flushParam();
        mode = 'param';
        currentParam = { name: value };
        if (currentCommand) currentArg = currentParam;
        break;

      case 'arg':
        if (mode === 'help') { result.help = helpLines.join('\n').trim(); helpLines = []; }
        flushParam();
        mode = 'arg';
        currentArg = { name: value };
        currentParam = currentArg;
        break;

      case 'command':
        if (mode === 'help') { result.help = helpLines.join('\n').trim(); helpLines = []; }
        flushParam(); flushCommand();
        currentCommand = { name: value, args: [] };
        mode = 'top';
        break;

      // Per-param fields (também aplicam pra @command pré-arg)
      case 'text':
        if (currentParam) currentParam.text = value;
        else if (currentCommand) currentCommand.text = value;
        break;
      case 'desc':
        if (currentParam) currentParam.desc = value;
        else if (currentCommand) currentCommand.desc = value;
        break;
      case 'type':
        if (currentParam) currentParam.type = value;
        break;
      case 'default':
        if (currentParam) currentParam.default = value;
        break;
      case 'parent':
        if (currentParam) currentParam.parent = value;
        break;
      case 'on':
        if (currentParam) currentParam.on = value;
        break;
      case 'off':
        if (currentParam) currentParam.off = value;
        break;
      case 'min':
        if (currentParam) currentParam.min = Number(value);
        break;
      case 'max':
        if (currentParam) currentParam.max = Number(value);
        break;
      case 'decimals':
        if (currentParam) currentParam.decimals = Number(value);
        break;
      case 'dir':
        if (currentParam) currentParam.dir = value;
        break;
      case 'option':
        if (currentParam) {
          currentParam.options ??= [];
          currentParam.options.push(value);
        }
        break;
    }
  }

  // Flush final
  if (mode === 'help' && helpLines.length > 0) result.help = helpLines.join('\n').trim();
  flushParam();
  flushCommand();

  return result;
}
