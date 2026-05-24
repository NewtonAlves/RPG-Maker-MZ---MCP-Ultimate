/**
 * Lê width/height de um arquivo PNG sem dependências externas.
 *
 * PNG layout: 8 bytes assinatura + IHDR chunk começando byte 8.
 *   - bytes 8-11: tamanho do chunk (4 bytes BE)
 *   - bytes 12-15: tipo "IHDR"
 *   - bytes 16-19: width (4 bytes BE)
 *   - bytes 20-23: height (4 bytes BE)
 */

import fs from 'node:fs/promises';

import { mzError } from '../utils/errors.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngInfo {
  width: number;
  height: number;
}

export async function readPngInfo(filePath: string): Promise<PngInfo> {
  // Lê só os primeiros 24 bytes
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buf, 0, 24, 0);
    if (bytesRead < 24) {
      throw mzError('asset_format_invalid', `Arquivo muito pequeno pra ser PNG válido (${filePath}).`);
    }
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
      throw mzError('asset_format_invalid', `Não é PNG válido: assinatura errada (${filePath}).`);
    }
    if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw mzError('asset_format_invalid', `PNG sem IHDR (${filePath}).`);
    }
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  } finally {
    await handle.close();
  }
}
