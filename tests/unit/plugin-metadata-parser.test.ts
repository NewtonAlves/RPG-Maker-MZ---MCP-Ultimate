import { describe, it, expect } from 'vitest';

import { parseMetadataDeep, extractMetadataBlock } from '../../src/core/plugin-metadata-parser.js';

const sample = `/*:
 * @target MZ
 * @author John Doe
 * @plugindesc Sample plugin description
 * @url https://example.com
 * @help
 * This is the help text.
 * Multi-line.
 *
 * @base CoreEngine
 * @orderAfter Other
 *
 * @param maxStamina
 * @text Max Stamina
 * @desc The maximum stamina value
 * @type number
 * @min 1
 * @max 999
 * @default 100
 *
 * @param barColor
 * @text Bar Color
 * @type select
 * @option red
 * @option blue
 * @option green
 * @default red
 *
 * @command setStamina
 * @text Set Stamina
 * @desc Sets stamina to a value
 *
 * @arg value
 * @type number
 * @default 100
 *
 * @arg actorId
 * @type actor
 * @default 1
 */
(() => {})();`;

describe('extractMetadataBlock', () => {
  it('extrai o bloco entre /*: e */', () => {
    const block = extractMetadataBlock(sample);
    expect(block).toContain('@target MZ');
    expect(block).toContain('@command setStamina');
  });

  it('retorna null se não tem bloco', () => {
    expect(extractMetadataBlock('// só comentário normal')).toBeNull();
  });
});

describe('parseMetadataDeep', () => {
  const parsed = parseMetadataDeep(sample);

  it('extrai top-level tags', () => {
    expect(parsed.target).toBe('MZ');
    expect(parsed.author).toBe('John Doe');
    expect(parsed.plugindesc).toBe('Sample plugin description');
    expect(parsed.url).toBe('https://example.com');
  });

  it('extrai help multi-line', () => {
    expect(parsed.help).toContain('This is the help text');
    expect(parsed.help).toContain('Multi-line');
  });

  it('extrai @base e @orderAfter', () => {
    expect(parsed.base).toEqual(['CoreEngine']);
    expect(parsed.orderAfter).toEqual(['Other']);
  });

  it('parseia 2 params com tipos diferentes', () => {
    expect(parsed.params).toHaveLength(2);
    const max = parsed.params.find((p) => p.name === 'maxStamina');
    expect(max?.type).toBe('number');
    expect(max?.text).toBe('Max Stamina');
    expect(max?.min).toBe(1);
    expect(max?.max).toBe(999);
    expect(max?.default).toBe('100');
  });

  it('parseia @option em params select', () => {
    const color = parsed.params.find((p) => p.name === 'barColor');
    expect(color?.options).toEqual(['red', 'blue', 'green']);
  });

  it('parseia commands com args', () => {
    expect(parsed.commands).toHaveLength(1);
    const cmd = parsed.commands[0]!;
    expect(cmd.name).toBe('setStamina');
    expect(cmd.text).toBe('Set Stamina');
    expect(cmd.args).toHaveLength(2);
    expect(cmd.args[0]?.name).toBe('value');
    expect(cmd.args[0]?.type).toBe('number');
    expect(cmd.args[1]?.name).toBe('actorId');
    expect(cmd.args[1]?.type).toBe('actor');
  });

  it('plugin sem bloco retorna estrutura vazia', () => {
    const empty = parseMetadataDeep('// sem block');
    expect(empty.params).toEqual([]);
    expect(empty.commands).toEqual([]);
    expect(empty.base).toEqual([]);
  });
});
