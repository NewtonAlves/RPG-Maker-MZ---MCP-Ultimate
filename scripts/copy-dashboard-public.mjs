// Copia arquivos estáticos do dashboard (HTML/CSS/JS) de src/ pra dist/.
// Roda como parte do build, já que o TypeScript compiler não copia non-TS.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src', 'dashboard', 'public');
const dstDir = path.join(projectRoot, 'dist', 'dashboard', 'public');

await fs.mkdir(dstDir, { recursive: true });
const files = await fs.readdir(srcDir);
let copied = 0;
for (const f of files) {
  const s = path.join(srcDir, f);
  const d = path.join(dstDir, f);
  const stat = await fs.stat(s);
  if (stat.isFile()) {
    await fs.copyFile(s, d);
    copied += 1;
  }
}
console.log(`[copy-dashboard-public] ${copied} files → ${path.relative(projectRoot, dstDir)}`);
