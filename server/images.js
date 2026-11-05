// Pipeline xử lý ảnh: thay cho bước "export từ Panotour" thủ công.
// Upload ảnh equirectangular (2:1) -> tự sinh: ảnh nền mờ, lưới tile 512px, thumbnail, ảnh OG chia sẻ.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR } from './db.js';

const TILE = 512;

export function newDir(prefix) {
  const id = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(MEDIA_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

/**
 * Cắt tile panorama. Trả về meta dùng cho EquirectangularTilesAdapter của Photo Sphere Viewer.
 * Chiều rộng được làm tròn về bội số của TILE*2 để lưới tile đều (tối đa 8192px).
 */
export async function processPanorama(input) {
  const { id, dir } = newDir('pano');
  const img = sharp(input, { limitInputPixels: 1e9 });
  const m = await img.metadata();
  if (!m.width || !m.height) throw new Error('Ảnh không hợp lệ');
  const ratio = m.width / m.height;
  if (Math.abs(ratio - 2) > 0.05) throw new Error(`Ảnh 360 phải có tỉ lệ 2:1 (ảnh này ${m.width}x${m.height})`);

  const width = Math.min(8192, Math.max(TILE * 4, Math.round(m.width / (TILE * 2)) * TILE * 2));
  const height = width / 2;
  const cols = width / TILE, rows = height / TILE;
  const full = await sharp(input, { limitInputPixels: 1e9 }).resize(width, height).jpeg({ quality: 88 }).toBuffer();

  fs.mkdirSync(path.join(dir, 't'));
  const jobs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      jobs.push(sharp(full).extract({ left: c * TILE, top: r * TILE, width: TILE, height: TILE })
        .jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(dir, 't', `${c}_${r}.jpg`)));
    }
  }
  await Promise.all(jobs);
  await sharp(full).resize(2048, 1024).jpeg({ quality: 70 }).toFile(path.join(dir, 'base.jpg'));
  await sharp(full).resize(480, 240).jpeg({ quality: 75 }).toFile(path.join(dir, 'thumb.jpg'));
  // Ảnh OG 1200x630: cắt vùng quanh đường chân trời — đẹp khi chia sẻ Facebook/Zalo
  await sharp(full).extract({ left: Math.round(width * 0.3), top: Math.round(height * 0.3), width: Math.round(width * 0.4), height: Math.round(width * 0.4 * 630 / 1200) })
    .resize(1200, 630).jpeg({ quality: 80 }).toFile(path.join(dir, 'og.jpg'));

  return { file: id, meta: { width, height, cols, rows, tile: TILE, tiled: true } };
}

/** Ảnh thường (gallery, mặt bằng, tiện ích): bản tối ưu + thumbnail, giữ kích thước gốc để toạ độ vùng chính xác. */
export async function processImage(input, ext = '.jpg') {
  const { id, dir } = newDir('img');
  const m = await sharp(input).metadata();
  const isPng = (m.format === 'png' || ext === '.png') && m.hasAlpha;
  const main = isPng ? 'main.png' : 'main.jpg';
  const pipeline = sharp(input).resize({ width: Math.min(m.width, 3200), withoutEnlargement: true });
  await (isPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 85, mozjpeg: true })).toFile(path.join(dir, main));
  await sharp(input).resize(480, 320, { fit: 'cover' }).jpeg({ quality: 72 }).toFile(path.join(dir, 'thumb.jpg'));
  const out = await sharp(path.join(dir, main)).metadata();
  return { file: `${id}/${main}`, meta: { width: out.width, height: out.height, thumb: `${id}/thumb.jpg` } };
}

/** File không phải ảnh (PDF, âm thanh): lưu nguyên. */
export function storeFile(input, originalName) {
  const { id, dir } = newDir('file');
  const safe = path.basename(originalName).replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  fs.writeFileSync(path.join(dir, safe), input);
  return { file: `${id}/${safe}`, meta: { size: input.length } };
}

export function removeMediaFiles(file) {
  if (!file) return;
  const top = file.split('/')[0];
  if (!/^(pano|img|file)-[\w-]+$/.test(top)) return;
  fs.rmSync(path.join(MEDIA_DIR, top), { recursive: true, force: true });
}
