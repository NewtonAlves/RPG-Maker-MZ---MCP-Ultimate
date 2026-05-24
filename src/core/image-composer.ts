/**
 * Composição de imagens (alpha overlay) usando jimp.
 *
 * Usado pelo generator pra montar sprites de personagem a partir de partes
 * separadas (Body + Eyes + Hair + Clothes + ...).
 */

import fs from 'node:fs/promises';
import { Jimp } from 'jimp';

import { mzError } from '../utils/errors.js';

/**
 * Compõe múltiplas camadas PNG em uma única imagem. Cada camada é overlayed
 * na ordem fornecida (primeira é o fundo, última é o topo).
 *
 * Todas as camadas precisam ter o mesmo tamanho. Se diferir, a primeira camada
 * define o tamanho e camadas maiores são cropadas.
 */
export async function composeLayers(layerPaths: string[], outputPath: string): Promise<{
  width: number;
  height: number;
  layers: number;
  output: string;
}> {
  if (layerPaths.length === 0) {
    throw mzError('schema_validation_failed', 'Pelo menos uma camada é necessária.');
  }

  // Verifica que todos os arquivos existem antes de carregar
  for (const p of layerPaths) {
    try {
      await fs.access(p);
    } catch {
      throw mzError('file_not_found', `Camada não encontrada: ${p}`);
    }
  }

  // Lê a primeira camada como base
  const base = await Jimp.read(layerPaths[0]!);
  const width = base.bitmap.width;
  const height = base.bitmap.height;

  // Compõe as demais por cima
  for (let i = 1; i < layerPaths.length; i++) {
    const top = await Jimp.read(layerPaths[i]!);
    base.composite(top, 0, 0);
  }

  await base.write(outputPath as `${string}.png`);

  return { width, height, layers: layerPaths.length, output: outputPath };
}

/**
 * Aplica um tint simples (multiply por uma cor) numa imagem.
 * tintRgba: [r, g, b, alpha] em 0-255.
 */
export async function applyTint(imagePath: string, tintRgba: [number, number, number, number], outputPath: string): Promise<void> {
  const img = await Jimp.read(imagePath);
  const [tr, tg, tb, ta] = tintRgba;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (this: typeof img, _x, _y, idx) {
    this.bitmap.data[idx] = (this.bitmap.data[idx]! * tr) >> 8;
    this.bitmap.data[idx + 1] = (this.bitmap.data[idx + 1]! * tg) >> 8;
    this.bitmap.data[idx + 2] = (this.bitmap.data[idx + 2]! * tb) >> 8;
    this.bitmap.data[idx + 3] = (this.bitmap.data[idx + 3]! * ta) >> 8;
  });
  await img.write(outputPath as `${string}.png`);
}

/** Retorna info básica (width, height) de um PNG via jimp. */
export async function readImageInfo(imagePath: string): Promise<{ width: number; height: number }> {
  const img = await Jimp.read(imagePath);
  return { width: img.bitmap.width, height: img.bitmap.height };
}
