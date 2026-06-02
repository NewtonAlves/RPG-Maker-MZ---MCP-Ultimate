// Smoke test Onda F: multi-port, map_render, runtime structured queries, integrity checker.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const NEWDATA = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata';
const SAMPLEMAP = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\samplemaps\\Map001.json';

// Cria DOIS projetos temp pra testar multi-port
const tempA = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wF-A-'));
const tempB = await fs.mkdtemp(path.join(os.tmpdir(), 'mz-mcp-wF-B-'));
await copyDir(NEWDATA, tempA);
await copyDir(NEWDATA, tempB);

// Sobrescreve Map001 do projeto A com um sample map real pra ter dados pra renderizar
try {
  const sample = await fs.readFile(SAMPLEMAP, 'utf-8');
  await fs.writeFile(path.join(tempA, 'data', 'Map001.json'), sample, 'utf-8');
  console.log('[smoke] Map001 do projeto A trocado por samplemap real');
} catch {
  console.log('[smoke] samplemap não disponível, usando newdata default');
}

// Copia img/tilesets pra projeto A pra render funcionar
try {
  const tilesetSrc = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata\\img\\tilesets';
  await copyDir(tilesetSrc, path.join(tempA, 'img', 'tilesets'));
} catch {}

const cfgBase = (port) => ({
  project: { path: 'auto', autoBackup: true, backupRetention: 20, backupDir: '.mz-mcp/backups' },
  editor: { onLock: 'warn' },
  mz: { installPath: 'auto', corescriptVersion: 'v1.6.0' },
  runtime: { enableEvalJs: false, companionPort: port, tokenFile: '.mz-mcp/companion.token' },
  plugins: { defaultNamingConvention: 'snake', knownBases: {} },
  logging: { level: 'warn' },
});

await fs.writeFile(path.join(tempA, 'mz-mcp.config.json'), JSON.stringify(cfgBase(39872), null, 2));
await fs.writeFile(path.join(tempB, 'mz-mcp.config.json'), JSON.stringify(cfgBase(39872), null, 2));

// Função pra startar servidor MCP por stdio
function startServer(projectPath, label) {
  const env = { ...process.env, MZ_PROJECT_PATH: projectPath, MZ_MCP_LOG_LEVEL: 'warn' };
  const proc = spawn('node', ['dist/index.js'], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
  let buffer = '';
  const pending = new Map();
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { const { resolve } = pending.get(msg.id); pending.delete(msg.id); resolve(msg); } } catch {}
    }
  });
  let idCounter = 0;
  const rpc = (method, params) => {
    const id = ++idCounter;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method} (${label})`)); } }, 30_000);
    });
  };
  const notify = (method, params) => { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); };
  const call = async (name, args) => {
    const resp = await rpc('tools/call', { name, arguments: args });
    if (resp.error) throw new Error(`${name} (${label}): ${JSON.stringify(resp.error)}`);
    if (resp.result?.isError) throw new Error(`${name} (${label}) isError: ${resp.result.content?.[0]?.text}`);
    return resp.result;
  };
  const getStderr = () => stderr;
  return { proc, rpc, notify, call, getStderr };
}

async function readPortFile(projectPath, name) {
  try {
    return (await fs.readFile(path.join(projectPath, '.mz-mcp', name), 'utf-8')).trim();
  } catch { return null; }
}

let serverA, serverB;
async function main() {
  console.log('\n--- F.1 MULTI-PORT HANDLING ---');
  serverA = startServer(tempA, 'A');
  await serverA.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wF-A', version: '0' } });
  serverA.notify('notifications/initialized', {});
  // Espera arquivos de porta serem escritos
  await new Promise(r => setTimeout(r, 600));
  const portA = await readPortFile(tempA, 'companion.port');
  console.log(`[smoke] Server A — companion: ${portA}`);

  serverB = startServer(tempB, 'B');
  await serverB.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wF-B', version: '0' } });
  serverB.notify('notifications/initialized', {});
  await new Promise(r => setTimeout(r, 600));
  const portB = await readPortFile(tempB, 'companion.port');
  console.log(`[smoke] Server B — companion: ${portB}`);

  if (!portA || !portB) throw new Error(`port files missing: A=${portA} B=${portB}`);
  if (portA === portB) throw new Error(`servidores B deveria ter outra porta companion, ambos em ${portA}`);
  console.log(`[smoke] multi-port OK: companion A=${portA} B=${portB}`);

  // Mata o B pra liberar a porta secundária e simplificar testes restantes
  serverB.proc.kill();
  serverB = null;
  await new Promise(r => setTimeout(r, 400));

  console.log('\n--- F.2 MAP RENDER ---');
  const toolsList = await serverA.rpc('tools/list', {});
  const totalTools = toolsList.result.tools.length;
  console.log(`[smoke] ${totalTools} tools registradas`);
  const hasMapRender = toolsList.result.tools.find(t => t.name === 'map_render');
  if (!hasMapRender) throw new Error('map_render não registrada');
  const renderResp = await serverA.call('map_render', { id: 1, scale: 1 });
  const renderContent = renderResp.content[0];
  if (renderContent.type !== 'image') throw new Error(`map_render retornou type=${renderContent.type}, esperava image`);
  if (!renderContent.data) throw new Error('map_render sem data');
  const sizeBytes = Buffer.from(renderContent.data, 'base64').length;
  console.log(`[smoke] map_render OK: ${renderContent.mimeType}, ${sizeBytes} bytes (base64)`);

  console.log('\n--- F.4 RUNTIME STRUCTURED QUERIES (smoke: tools registradas + erro consistente sem companion) ---');
  const runtimeTools = ['runtime_get_scene_state', 'runtime_get_window_state', 'runtime_get_battle_state', 'runtime_get_message_state', 'runtime_inspect'];
  for (const n of runtimeTools) {
    const t = toolsList.result.tools.find(x => x.name === n);
    if (!t) throw new Error(`${n} não registrada`);
  }
  console.log(`[smoke] todas as 5 tools de runtime estruturado registradas`);
  // Sem companion conectado, devem retornar isError com mensagem clara
  const noCompanion = await serverA.rpc('tools/call', { name: 'runtime_get_scene_state', arguments: {} });
  if (!noCompanion.result?.isError) throw new Error('esperava isError quando companion não conectado');
  const errText = noCompanion.result.content[0].text;
  console.log(`[smoke] runtime sem companion: isError=true, msg curta="${JSON.parse(errText).code}"`);

  console.log('\n--- F.5 DATABASE INTEGRITY CHECKER ---');
  const checker = toolsList.result.tools.find(t => t.name === 'db_check_consistency');
  if (!checker) throw new Error('db_check_consistency não registrada');
  const consistency = await serverA.call('db_check_consistency', { severity: 'all', limit: 200 });
  const c = JSON.parse(consistency.content[0].text);
  console.log(`[smoke] integrity: totalChecks=${c.totalChecks}, issues=${c.totalIssues}, summary=${JSON.stringify(c.summary)}`);
  if (typeof c.totalChecks !== 'number') throw new Error('totalChecks ausente');
  if (!Array.isArray(c.issues)) throw new Error('issues não é array');
  // newdata é base limpa do MZ — deve ter ZERO issues
  if (c.totalIssues !== 0) {
    console.log(`[smoke] WARN: newdata supostamente limpo retornou ${c.totalIssues} issues (primeiras: ${JSON.stringify(c.issues.slice(0, 3))})`);
  } else {
    console.log(`[smoke] newdata limpo (0 issues) — checker funcional`);
  }

  // Inserir issue artificial: actor com classId inválido + re-rodar
  const actorRecord = JSON.parse((await serverA.call('db_get', { category: 'actor', id: 1 })).content[0].text);
  await serverA.call('db_update', { category: 'actor', id: 1, patch: { classId: 9999 } });
  const consistency2 = await serverA.call('db_check_consistency', { severity: 'error', limit: 200 });
  const c2 = JSON.parse(consistency2.content[0].text);
  console.log(`[smoke] após corromper classId: errors=${c2.totalIssues}`);
  if (c2.totalIssues === 0) throw new Error('checker não detectou classId inválido');
  const found = c2.issues.find(i => i.category === 'actor' && i.field === 'classId');
  if (!found) throw new Error(`esperava issue actor.classId, recebi: ${JSON.stringify(c2.issues.slice(0, 3))}`);
  console.log(`[smoke] checker pegou: "${found.detail}"`);
  // Restaura
  await serverA.call('db_update', { category: 'actor', id: 1, patch: { classId: actorRecord.classId } });

  console.log('\n[smoke] ALL WAVE F CHECKS PASSED ✓');
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else if (e.isFile()) await fs.copyFile(s, d);
  }
}

async function cleanup() {
  try { serverA?.proc.kill(); } catch {}
  try { serverB?.proc.kill(); } catch {}
  await new Promise(r => setTimeout(r, 200));
  await fs.rm(tempA, { recursive: true, force: true }).catch(() => {});
  await fs.rm(tempB, { recursive: true, force: true }).catch(() => {});
}

try {
  await main();
  await cleanup();
  process.exit(0);
} catch (err) {
  console.error('[smoke] FAILED:', err);
  if (serverA) console.error('[smoke] server A stderr:\n', serverA.getStderr().slice(-2000));
  if (serverB) console.error('[smoke] server B stderr:\n', serverB.getStderr().slice(-2000));
  await cleanup();
  process.exit(1);
}
