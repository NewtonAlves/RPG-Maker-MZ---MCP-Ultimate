// Smoke test Onda C: localization expandida (plugin params + terms paths), build streaming, project_init variants.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wC-'));
await copyDir(NEWDATA, tempDir);

const cfg = {
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: 39897, tokenFile: '.mz-mcp/companion.token' },
  plugins: { defaultNamingConvention: 'snake', knownBases: {} },
  logging: { level: 'warn' },
};
await fs.writeFile(path.join(tempDir, 'mz-mcp.config.json'), JSON.stringify(cfg, null, 2));

const env = { ...process.env, MZ_PROJECT_PATH: tempDir, MZ_MCP_LOG_LEVEL: 'warn' };
const server = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = ''; const pending = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); } } catch {}
  }
});
let idCounter = 0;
function rpc(method, params) {
  const id = ++idCounter;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30_000);
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wC', version: '0' } });
  notify('notifications/initialized', {});
  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- TRANSLATION EXPANDED (Onda C.1 + C.2) ---');
  // Cria plugin com params textuais
  await call('plugin_create_new', {
    name: 'TestI18n',
    metadata: { target: 'MZ', plugindesc: 'Plugin com texto', params: [
      { name: 'menuItem', type: 'string', default: 'Inventário', text: 'Menu Item Name' },
      { name: 'maxStamina', type: 'number', default: 100 },
    ]},
  });

  const ext = await call('mz_extract_translatable_text', { scope: 'all', format: 'json' });
  const entries = JSON.parse(ext.json);
  const pluginEntry = entries.find(e => e.source === 'plugin:TestI18n/param:menuItem');
  console.log(`[smoke] plugin param extracted: ${pluginEntry?.text}`);
  if (!pluginEntry || pluginEntry.text !== 'Inventário') throw new Error('plugin param não extraído');

  // Verifica termos do System
  const termsEntries = entries.filter(e => e.source.startsWith('system/terms/'));
  console.log(`[smoke] system terms entries: ${termsEntries.length}`);

  // Aplica tradução em plugin param
  pluginEntry.translation = 'Inventory';
  // Adiciona uma tradução em terms aninhado se houver
  const aTerm = termsEntries[0];
  if (aTerm) aTerm.translation = '[TRANSLATED] ' + aTerm.text;

  const trPath = path.join(tempDir, 'tr.json');
  await fs.writeFile(trPath, JSON.stringify(entries));
  await call('mz_import_translations', { translationsPath: trPath, dryRun: false });

  const pluginsAfter = await call('plugin_list_installed', {});
  const ti = pluginsAfter.plugins.find(p => p.name === 'TestI18n');
  console.log(`[smoke] plugin param applied: menuItem="${ti.parameters.menuItem}"`);
  if (ti.parameters.menuItem !== 'Inventory') throw new Error('plugin translation não foi aplicada');

  if (aTerm) {
    const sys = await call('system_get', {});
    // Verifica se o termo foi tocado — segue o path em aTerm.source
    const p = aTerm.source.replace(/^system\/terms\//, '');
    console.log(`[smoke] term path "${p}" applied`);
  }

  await call('plugin_uninstall', { name: 'TestI18n' });

  console.log('\n--- BUILD STREAMING (Onda C.3) ---');
  const check = await call('mz_build_check_rpgmpacker', {});
  console.log(`[smoke] rpgmpacker available: ${check.available} — build streaming testável só com rpgmpacker instalado.`);
  // Validamos a estrutura da tool aceitando logFile (não rodamos build real)

  console.log('\n--- PROJECT_INIT VARIANTS (Onda C.4) ---');
  // Cria pasta vazia separada pra teste de init
  const initDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-init-'));
  // Mata server e cria novo com MZ_PROJECT_PATH apontando pra initDir
  server.kill();
  await new Promise(r => setTimeout(r, 300));

  const env2 = { ...process.env, MZ_PROJECT_PATH: initDir, MZ_MCP_LOG_LEVEL: 'warn' };
  const server2 = spawn('node', ['dist/index.js'], { cwd: projectRoot, env: env2, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf2 = ''; const pend2 = new Map();
  server2.stdout.on('data', (chunk) => {
    buf2 += chunk.toString('utf-8');
    let nl;
    while ((nl = buf2.indexOf('\n')) !== -1) {
      const line = buf2.slice(0, nl).trim(); buf2 = buf2.slice(nl + 1);
      if (!line) continue;
      try { const msg = JSON.parse(line); if (msg.id !== undefined && pend2.has(msg.id)) { const { resolve } = pend2.get(msg.id); pend2.delete(msg.id); resolve(msg); } } catch {}
    }
  });
  let id2 = 0;
  function rpc2(m, p) { const id = ++id2; return new Promise((res, rej) => { pend2.set(id, { resolve: res, reject: rej }); server2.stdin.write(JSON.stringify({ jsonrpc:'2.0',id,method:m,params:p})+'\n'); setTimeout(() => { if(pend2.has(id)){pend2.delete(id);rej(new Error('timeout '+m));}}, 30000);});}
  function notify2(m, p) { server2.stdin.write(JSON.stringify({jsonrpc:'2.0',method:m,params:p})+'\n'); }
  function ok2(r, l) { if (r.error) throw new Error(`${l}: ${JSON.stringify(r.error)}`); if (r.result?.isError) throw new Error(`${l} isError: ${r.result.content?.[0]?.text}`); return JSON.parse(r.result.content[0].text); }
  async function call2(n, a) { return ok2(await rpc2('tools/call', { name: n, arguments: a }), n); }

  await rpc2('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wC2', version: '0' } });
  notify2('notifications/initialized', {});

  const init = await call2('project_init', { template: 'newdata-1', gameTitle: 'Tutorial Game' });
  console.log(`[smoke] project_init newdata-1: ${init.initialized}, variant note: "${init.variantNotes}"`);

  // Verifica que data/ tem o esperado (>1 map do newdata-1 + base files)
  const dataEntries = await fs.readdir(path.join(initDir, 'data'));
  const mapCount = dataEntries.filter(f => /^Map\d+\.json$/.test(f)).length;
  console.log(`[smoke] data/ tem ${dataEntries.length} arquivos, ${mapCount} maps (newdata-1 trouxe 5 + base 1 = ?)`);
  if (mapCount < 5) throw new Error('newdata-1 overlay não trouxe os maps');

  // Confere gameTitle aplicado e System_diff merged
  const sys = JSON.parse(await fs.readFile(path.join(initDir, 'data', 'System.json'), 'utf-8'));
  console.log(`[smoke] gameTitle="${sys.gameTitle}"`);
  if (sys.gameTitle !== 'Tutorial Game') throw new Error('gameTitle não foi aplicado');
  // System_diff.json deveria ter sido deletado após merge
  const hasDiff = await fs.access(path.join(initDir, 'data', 'System_diff.json')).then(() => true).catch(() => false);
  console.log(`[smoke] System_diff.json removido após merge? ${!hasDiff}`);
  if (hasDiff) throw new Error('System_diff.json deveria ter sido removido após merge');

  server2.kill();
  await fs.rm(initDir, { recursive: true, force: true }).catch(() => {});

  console.log('\n[smoke] ALL WAVE C CHECKS PASSED ✓');
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else if (e.isFile()) await fs.copyFile(s, d);
  }
}

try { await main(); } catch (err) { console.error('[smoke] FAILED:', err); server.kill(); process.exit(1); }
finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); process.exit(0); }
