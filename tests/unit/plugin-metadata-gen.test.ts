import { describe, it, expect } from 'vitest';

import {
  PluginMetadataSchema,
  generateMetadataBlock,
  generatePluginSource,
  blankPluginBody,
  commandOnlyPluginBody,
} from '../../src/core/plugin-metadata-gen.js';
import { parseMetadataDeep } from '../../src/core/plugin-metadata-parser.js';

describe('generateMetadataBlock', () => {
  it('inclui @target sempre', () => {
    const meta = PluginMetadataSchema.parse({});
    const block = generateMetadataBlock(meta);
    expect(block).toContain('@target MZ');
  });

  it('inclui @plugindesc, @author, @help quando definidos', () => {
    const meta = PluginMetadataSchema.parse({
      plugindesc: 'Test plugin',
      author: 'Tester',
      help: 'Line 1\nLine 2',
    });
    const block = generateMetadataBlock(meta);
    expect(block).toContain('@plugindesc Test plugin');
    expect(block).toContain('@author Tester');
    expect(block).toContain('@help');
    expect(block).toContain('Line 1');
    expect(block).toContain('Line 2');
  });

  it('gera @param com type, default, min/max', () => {
    const meta = PluginMetadataSchema.parse({
      params: [{ name: 'maxHp', type: 'number', text: 'Max HP', default: 999, min: 1, max: 9999 }],
    });
    const block = generateMetadataBlock(meta);
    expect(block).toContain('@param maxHp');
    expect(block).toContain('@type number');
    expect(block).toContain('@text Max HP');
    expect(block).toContain('@default 999');
    expect(block).toContain('@min 1');
    expect(block).toContain('@max 9999');
  });

  it('gera @command com @arg blocks', () => {
    const meta = PluginMetadataSchema.parse({
      commands: [
        { name: 'doIt', text: 'Do It', args: [{ name: 'val', type: 'number', default: 42 }] },
      ],
    });
    const block = generateMetadataBlock(meta);
    expect(block).toContain('@command doIt');
    expect(block).toContain('@text Do It');
    expect(block).toContain('@arg val');
    expect(block).toContain('@default 42');
  });
});

describe('round-trip: gen → parse', () => {
  it('metadata round-trip preserva params e commands', () => {
    const original = PluginMetadataSchema.parse({
      plugindesc: 'Round trip test',
      author: 'Bot',
      help: 'Help text',
      params: [
        { name: 'p1', type: 'number', default: 1 },
        { name: 'p2', type: 'select', options: ['a', 'b'], default: 'a' },
      ],
      commands: [
        { name: 'cmd1', args: [{ name: 'x', type: 'string', default: 'hi' }] },
      ],
    });
    const source = generatePluginSource(original, blankPluginBody('Test'));
    const parsed = parseMetadataDeep(source);

    expect(parsed.plugindesc).toBe(original.plugindesc);
    expect(parsed.author).toBe(original.author);
    expect(parsed.params).toHaveLength(2);
    expect(parsed.params[0]?.name).toBe('p1');
    expect(parsed.params[1]?.options).toEqual(['a', 'b']);
    expect(parsed.commands).toHaveLength(1);
    expect(parsed.commands[0]?.args[0]?.name).toBe('x');
  });
});

describe('plugin body templates', () => {
  it('blankPluginBody contém pluginName e PluginManager.parameters', () => {
    const body = blankPluginBody('Foo');
    expect(body).toContain("pluginName = 'Foo'");
    expect(body).toContain('PluginManager.parameters');
  });

  it('commandOnlyPluginBody registra cada comando', () => {
    const body = commandOnlyPluginBody('Bar', [
      { name: 'cmd1', args: [] },
      { name: 'cmd2', args: [{ name: 'x', type: 'number' }] },
    ]);
    expect(body).toContain("registerCommand(pluginName, 'cmd1'");
    expect(body).toContain("registerCommand(pluginName, 'cmd2'");
  });
});
