// Smoke test Fase 4: plugins, assets, system.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-p4-'));
console.log(`[smoke] Temp at ${tempDir}`);
await copyDir(NEWDATA, tempDir);

// Cria um PNG fake (signatures válida + IHDR válido)
const fakePngDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-png-'));
const fakePngPath = path.join(fakePngDir, 'TestChar.png');
const png = createFakePng(576, 384); // dimensão correta pra characters/faces
await fs.writeFile(fakePngPath, png);

// Cria um OGG fake (header mínimo OggS)
const fakeOggPath = path.join(fakePngDir, 'TestBgm.ogg');
await fs.writeFile(fakeOggPath, Buffer.from('OggS\0\0\0\0' + 'x'.repeat(100)));

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });

let buffer = '';
const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg);
      }
    } catch {}
  }
});

let idCounter = 0;
function rpc(method, params) {
  const id = ++idCounter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15_000);
  });
}
function notify(method, params) { server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
function expectOk(resp, label) {
  if (resp.error) throw new Error(`${label}: ${JSON.stringify(resp.error)}`);
  if (resp.result?.isError) throw new Error(`${label} isError: ${resp.result.content?.[0]?.text}`);
  return JSON.parse(resp.result.content[0].text);
}
async function call(name, args) { return expectOk(await rpc('tools/call', { name, arguments: args }), name); }

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p4', version: '0' } });
  notify('notifications/initialized', {});

  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- PLUGINS ---');
  const plugins0 = await call('plugin_list_installed', {});
  console.log(`[smoke] plugin_list_installed: ${plugins0.count} plugins (esperado 0 num projeto novo)`);

  const created = await call('plugin_create_new', {
    name: 'MzMcpTest',
    template: 'command_only',
    metadata: {
      target: 'MZ',
      plugindesc: 'Plugin de teste do mz-mcp',
      author: 'mz-mcp smoke',
      help: 'Plugin de teste\nVárias linhas',
      params: [
        { name: 'maxStamina', type: 'number', text: 'Stamina máxima', desc: 'Stamina cap.', default: 100, min: 1, max: 999 },
        { name: 'showBar', type: 'boolean', text: 'Mostrar barra', default: true },
      ],
      commands: [
        { name: 'setStamina', text: 'Set Stamina', args: [{ name: 'value', type: 'number', default: 100 }] },
      ],
    },
  });
  console.log(`[smoke] plugin_create_new "MzMcpTest" → ${created.created} (params: ${created.paramsRegistered.join(',')}, cmds: ${created.commandsRegistered.join(',')})`);

  // Verifica que o arquivo foi escrito
  const pluginContent = await fs.readFile(path.join(tempDir, 'js', 'plugins', 'MzMcpTest.js'), 'utf-8');
  console.log(`[smoke] plugin file ${pluginContent.length} bytes; tem @command? ${pluginContent.includes('@command setStamina')}`);

  const validate = await call('plugin_validate_metadata', { name: 'MzMcpTest' });
  console.log(`[smoke] validate: syntaxOk=${validate.syntaxOk}, params=${validate.metadata.paramNames.join(',')}, commands=${validate.metadata.commandNames.join(',')}`);
  if (!validate.syntaxOk) throw new Error('plugin gerado tem sintaxe inválida');

  await call('plugin_set_param', { name: 'MzMcpTest', paramName: 'maxStamina', value: 150 });
  await call('plugin_disable', { name: 'MzMcpTest' });
  const after = await call('plugin_list_installed', {});
  const ent = after.plugins.find(p => p.name === 'MzMcpTest');
  console.log(`[smoke] após disable + set_param: status=${ent.status}, maxStamina=${ent.parameters.maxStamina}`);

  await call('plugin_enable', { name: 'MzMcpTest' });
  await call('plugin_uninstall', { name: 'MzMcpTest' });
  const after2 = await call('plugin_list_installed', {});
  console.log(`[smoke] após uninstall: ${after2.count} plugins`);

  console.log('\n--- ASSETS ---');
  const cats = await call('asset_categories_list', {});
  console.log(`[smoke] asset_categories_list: ${Object.keys(cats.image).length} image cats, ${Object.keys(cats.audio).length} audio cats`);

  const valid = await call('asset_validate_format', { sourcePath: fakePngPath, category: 'characters' });
  console.log(`[smoke] asset_validate_format characters 576x384: ok=${valid.ok}, warnings=${valid.warnings.length}`);

  const imported = await call('asset_import', { sourcePath: fakePngPath, category: 'characters', destName: 'TestChar.png' });
  console.log(`[smoke] asset_import → ${imported.destPath}`);

  const chars = await call('asset_list', { category: 'characters' });
  const hasTest = chars.files.includes('TestChar.png');
  console.log(`[smoke] asset_list characters: ${chars.count} files, TestChar.png presente? ${hasTest}`);
  if (!hasTest) throw new Error('TestChar.png não apareceu em characters');

  const info = await call('asset_get_info', { category: 'characters', name: 'TestChar.png' });
  console.log(`[smoke] asset_get_info: ${info.width}x${info.height}`);

  await call('audio_import_bgm', { sourcePath: fakeOggPath, destName: 'TestBgm.ogg' });
  const bgms = await call('audio_list', { category: 'bgm' });
  console.log(`[smoke] audio_list bgm: ${bgms.count} files, TestBgm.ogg presente? ${bgms.files.includes('TestBgm.ogg')}`);

  console.log('\n--- SYSTEM ---');
  const sys0 = await call('system_get', {});
  console.log(`[smoke] system_get: gameTitle="${sys0.gameTitle}", currencyUnit="${sys0.currencyUnit}", startMapId=${sys0.startMapId}`);

  await call('system_update_title', { title: 'Aventura de Aurora' });
  await call('system_update_currency', { unit: 'Cristais' });
  await call('system_update_starting_position', { mapId: 1, x: 10, y: 8 });
  await call('system_update_party', { actorIds: [1, 3, 5] });
  await call('system_update_window_tone', { r: -50, g: 0, b: 100, gray: 0 });

  const sys1 = await call('system_get', {});
  console.log(`[smoke] system depois: gameTitle="${sys1.gameTitle}", currency="${sys1.currencyUnit}", start=(${sys1.startMapId}, ${sys1.startX}, ${sys1.startY}), party=${JSON.stringify(sys1.partyMembers)}, tone=${JSON.stringify(sys1.windowTone)}`);

  if (sys1.gameTitle !== 'Aventura de Aurora') throw new Error('title não atualizou');
  if (sys1.currencyUnit !== 'Cristais') throw new Error('currency não atualizou');
  if (sys1.startX !== 10) throw new Error('startX não atualizou');

  console.log('\n[smoke] ALL PHASE 4 CHECKS PASSED ✓');
  server.kill();
}

function createFakePng(width, height) {
  // PNG signature + IHDR chunk + IEND
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(2, 17); // color type
  ihdr.writeUInt8(0, 18); // compression
  ihdr.writeUInt8(0, 19); // filter
  ihdr.writeUInt8(0, 20); // interlace
  ihdr.writeUInt32BE(0, 21); // crc (fake — png readers de header só usam até byte 24)
  // IEND
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([sig, ihdr, iend]);
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

try { await main(); } catch (err) {
  console.error('[smoke] FAILED:', err); server.kill(); process.exit(1);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(fakePngDir, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
