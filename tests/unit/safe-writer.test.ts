import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { safeWrite, safeWriteJson } from '../../src/core/safe-writer.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-test-safe-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

describe('safeWrite', () => {
  it('escreve conteúdo no arquivo final atomicamente', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await safeWrite(filePath, 'hello world');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('cria .bak do conteúdo anterior na segunda escrita', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await safeWrite(filePath, 'version 1');
    await safeWrite(filePath, 'version 2');
    const current = await fs.readFile(filePath, 'utf-8');
    const bak = await fs.readFile(filePath + '.bak', 'utf-8');
    expect(current).toBe('version 2');
    expect(bak).toBe('version 1');
  });

  it('rotaciona .bak.1, .bak.2 em escritas sucessivas', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await safeWrite(filePath, 'v1');
    await safeWrite(filePath, 'v2');
    await safeWrite(filePath, 'v3');
    // Após v3: file=v3, .bak=v2, .bak.1=v1
    expect(await fs.readFile(filePath, 'utf-8')).toBe('v3');
    expect(await fs.readFile(filePath + '.bak', 'utf-8')).toBe('v2');
    expect(await fs.readFile(filePath + '.bak.1', 'utf-8')).toBe('v1');
  });

  it('skipBackup=true não cria .bak', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await safeWrite(filePath, 'v1');
    await safeWrite(filePath, 'v2', { skipBackup: true });
    const bakExists = await fs.access(filePath + '.bak').then(() => true).catch(() => false);
    expect(bakExists).toBe(false);
  });

  it('não deixa .tmp órfão em sucesso', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await safeWrite(filePath, 'hello');
    const tmpExists = await fs.access(filePath + '.tmp').then(() => true).catch(() => false);
    expect(tmpExists).toBe(false);
  });
});

describe('safeWriteJson', () => {
  it('serializa objeto e escreve', async () => {
    const filePath = path.join(tempDir, 'data.json');
    await safeWriteJson(filePath, { id: 1, name: 'test' });
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe('test');
  });

  it('default sem indent (single-line JSON compatível com MZ)', async () => {
    const filePath = path.join(tempDir, 'data.json');
    await safeWriteJson(filePath, { a: 1, b: 2 });
    const content = (await fs.readFile(filePath, 'utf-8')).trim();
    expect(content).toBe('{"a":1,"b":2}');
  });

  it('aceita indent customizado', async () => {
    const filePath = path.join(tempDir, 'data.json');
    await safeWriteJson(filePath, { a: 1 }, { indent: 2 });
    const content = (await fs.readFile(filePath, 'utf-8')).trim();
    expect(content).toBe('{\n  "a": 1\n}');
  });
});
