// Smoke test Fase 5: switches/vars, csv, build (check), localization, saves.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-p5-'));
await copyDir(NEWDATA, tempDir);

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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p5', version: '0' } });
  notify('notifications/initialized', {});

  const list = await rpc('tools/list', {});
  console.log(`[smoke] ${list.result.tools.length} tools total`);

  console.log('\n--- SWITCHES & VARIABLES ---');
  await call('switch_resize', { total: 50 });
  await call('switch_rename', { id: 5, name: 'Quest1: Iniciada' });
  await call('switch_rename', { id: 10, name: 'Quest1: Completa' });
  const sl = await call('switch_list', {});
  console.log(`[smoke] switch_list: total=${sl.total}, com nome=${sl.returned}`);
  if (sl.returned < 2) throw new Error('switches não foram renomeadas');

  await call('variable_resize', { total: 30 });
  await call('variable_rename', { id: 3, name: 'Quest1: NPCs ajudados' });
  const vl = await call('variable_list', {});
  console.log(`[smoke] variable_list: total=${vl.total}, com nome=${vl.returned}`);

  const sUses = await call('switch_search_uses', { id: 5 });
  console.log(`[smoke] switch_search_uses(5): ${sUses.count} uses em CommonEvents`);

  console.log('\n--- CSV ---');
  const csvOut = await call('db_export_csv', { category: 'actor' });
  const csvLines = csvOut.csv.split('\n');
  console.log(`[smoke] db_export_csv actor: ${csvOut.rowCount} linhas, ${csvLines[0].split(',').length} colunas`);
  console.log(`[smoke] header: ${csvLines[0].slice(0, 100)}...`);

  // Modifica uma linha e re-importa
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse(csvOut.csv.trim(), { header: true, skipEmptyLines: true });
  parsed.data[0].name = 'Reid Edited';
  parsed.data[0].nickname = 'Modificado via CSV';
  const newCsv = Papa.unparse(parsed.data);
  const diff = await call('db_diff_csv', { category: 'actor', csvText: newCsv });
  console.log(`[smoke] db_diff_csv: ${diff.totalDiffs} diffs detectados`);
  const imp = await call('db_import_csv', { category: 'actor', csvText: newCsv, dryRun: false });
  console.log(`[smoke] db_import_csv: ${imp.totalChanges} mudanças aplicadas`);

  const got = await call('db_get', { category: 'actor', id: 1 });
  if (got.name !== 'Reid Edited') throw new Error('CSV import não atualizou name');
  console.log(`[smoke] actor 1 agora: name="${got.name}", nickname="${got.nickname}" ✓`);

  console.log('\n--- BUILD CHECK ---');
  const buildCheck = await call('mz_build_check_rpgmpacker', {});
  console.log(`[smoke] rpgmpacker disponível? ${buildCheck.available}` + (buildCheck.error ? ` (${buildCheck.error.slice(0,80)})` : ''));

  const validate = await call('mz_validate_project', {});
  console.log(`[smoke] mz_validate_project: valid=${validate.valid}, issues=${validate.issues.length}`);

  console.log('\n--- LOCALIZATION ---');
  const extracted = await call('mz_extract_translatable_text', { scope: 'database', format: 'json' });
  console.log(`[smoke] mz_extract_translatable_text database: ${extracted.extracted} strings`);
  console.log(`[smoke] sample:`, JSON.stringify(extracted.sample[0]));

  // Salva, simula tradução, e importa
  const trPath = path.join(tempDir, 'translations.json');
  const entries = JSON.parse(extracted.json);
  // "traduz" só a primeira entrada
  if (entries.length > 0) {
    entries[0].translation = '[PT-BR] ' + entries[0].text;
  }
  await fs.writeFile(trPath, JSON.stringify(entries));
  const cov = await call('mz_localization_coverage', { translationsPath: trPath });
  console.log(`[smoke] coverage: ${cov.translated}/${cov.total} = ${(cov.coverage * 100).toFixed(1)}%`);

  await call('mz_import_translations', { translationsPath: trPath, dryRun: false });
  // Verifica que a tradução foi aplicada
  const firstEntry = entries[0];
  // source ex: "actor:1/name"
  const m = /^([a-z_]+):(\d+)\/(\w+)/.exec(firstEntry.source);
  if (m) {
    const cat = m[1]; const id = +m[2]; const field = m[3];
    const r = await call('db_get', { category: cat, id });
    console.log(`[smoke] translation applied to ${firstEntry.source}: "${r[field]}" (esperado começa com [PT-BR])`);
    if (typeof r[field] === 'string' && !r[field].startsWith('[PT-BR]')) {
      throw new Error(`translation não foi aplicada: ${r[field]}`);
    }
  }

  console.log('\n--- SAVES ---');
  const savePath = path.join(tempDir, 'save01.rmmzsave');
  await call('save_create_test_state', { path: savePath, switchesOn: [1, 5, 10], variableValues: { 3: 42 } });
  console.log(`[smoke] save_create_test_state criado`);

  const saveData = await call('save_read', { path: savePath });
  console.log(`[smoke] save_read: switches[5]=${saveData.switches._data[5]}, var[3]=${saveData.variables._data[3]}`);
  if (!saveData.switches._data[5] || saveData.variables._data[3] !== 42) {
    throw new Error('save state não foi preservado');
  }

  await call('save_edit', { path: savePath, patch: { gold: 9999, customMark: 'edited' } });
  const edited = await call('save_read', { path: savePath });
  console.log(`[smoke] save_edit: gold=${edited.gold}, customMark="${edited.customMark}"`);

  console.log('\n[smoke] ALL PHASE 5 CHECKS PASSED ✓');
  server.kill();
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
