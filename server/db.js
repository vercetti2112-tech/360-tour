// Lớp dữ liệu: SQLite tích hợp sẵn trong Node 22 (node:sqlite) — không cần build native.
// Mọi nội dung đa ngôn ngữ lưu dạng JSON {"vi": "...", "en": "..."} => một nguồn dữ liệu duy nhất.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'tour.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  name TEXT, role TEXT NOT NULL DEFAULT 'editor', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,            -- json i18n
  description TEXT,              -- json i18n
  settings TEXT NOT NULL DEFAULT '{}', -- json: theme, liên hệ, tính năng bật/tắt, tracking, webhook
  start_scene_id INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- pano | image | pdf | video | audio
  category TEXT,                 -- gallery | document | legal | floorplan | plan | facility | ...
  file TEXT,                     -- đường dẫn tương đối trong /media
  url TEXT,                      -- link ngoài (YouTube...)
  title TEXT,                    -- json i18n
  meta TEXT NOT NULL DEFAULT '{}', -- json: kích thước, thông tin tile, thumb...
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'overview', -- overview | unit
  icon TEXT, floorplan_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  pano_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  sound_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  yaw REAL NOT NULL DEFAULT 0, pitch REAL NOT NULL DEFAULT 0, zoom REAL NOT NULL DEFAULT 40,
  north_offset REAL NOT NULL DEFAULT 0,   -- độ lệch hướng Bắc cho la bàn
  pair_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL, -- cảnh "đôi" ngày/đêm
  pair_role TEXT,                          -- day | night
  in_menu INTEGER NOT NULL DEFAULT 1,
  floorplan_x REAL, floorplan_y REAL,      -- vị trí điểm trên mặt bằng căn (0..1)
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'published', -- draft | published
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, slug)
);
CREATE TABLE IF NOT EXISTS hotspots (
  id INTEGER PRIMARY KEY, scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- link | poi | info | video | image
  yaw REAL NOT NULL, pitch REAL NOT NULL,
  target_scene_id INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
  label TEXT,                    -- json i18n
  meta TEXT NOT NULL DEFAULT '{}' -- json: travel (phút), line (px), url, media_id, body i18n
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- masterplan | facility | floor
  name TEXT NOT NULL, image_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plan_areas (
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  shape TEXT NOT NULL,           -- polygon | point
  points TEXT NOT NULL,          -- json [[x,y],...] toạ độ chuẩn hoá 0..1 (không phụ thuộc kích thước ảnh)
  label TEXT, description TEXT,  -- json i18n
  action TEXT NOT NULL DEFAULT '{}', -- json {type: scene|plan|image|none, target}
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, interest TEXT, note TEXT,
  scene_id INTEGER, source TEXT, utm TEXT, ip TEXT,
  status TEXT NOT NULL DEFAULT 'new',  -- new | contacted | qualified | closed
  webhook_status TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, scene_id INTEGER,
  type TEXT NOT NULL, ref TEXT, session TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_p ON events(project_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_scenes_p ON scenes(project_id, sort);
CREATE INDEX IF NOT EXISTS idx_hot_s ON hotspots(scene_id);
`);

// ---- helpers ----
const JSON_COLS = new Set(['name', 'description', 'settings', 'title', 'meta', 'label', 'points', 'action']);

export function parseRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (JSON_COLS.has(k) && typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch { /* chuỗi thường */ }
    }
  }
  return out;
}

export const all = (sql, ...p) => db.prepare(sql).all(...p).map(parseRow);
export const get = (sql, ...p) => parseRow(db.prepare(sql).get(...p));
export const run = (sql, ...p) => db.prepare(sql).run(...p);

const enc = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** INSERT với các cột được whitelist. */
export function insert(table, data, cols) {
  const keys = cols.filter((c) => data[c] !== undefined);
  const r = run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => enc(data[k]) ?? null)
  );
  return Number(r.lastInsertRowid);
}

/** UPDATE theo id với các cột được whitelist. */
export function update(table, id, data, cols) {
  const keys = cols.filter((c) => data[c] !== undefined);
  if (!keys.length) return 0;
  return run(
    `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`,
    ...keys.map((k) => enc(data[k]) ?? null), id
  ).changes;
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const COLS = {
  projects: ['slug', 'name', 'description', 'settings', 'start_scene_id'],
  media: ['project_id', 'kind', 'category', 'file', 'url', 'title', 'meta', 'sort'],
  groups: ['project_id', 'name', 'kind', 'icon', 'floorplan_media_id', 'sort'],
  scenes: ['project_id', 'group_id', 'slug', 'title', 'description', 'pano_media_id', 'sound_media_id',
    'yaw', 'pitch', 'zoom', 'north_offset', 'pair_scene_id', 'pair_role', 'in_menu',
    'floorplan_x', 'floorplan_y', 'lat', 'lng', 'status', 'sort'],
  hotspots: ['scene_id', 'type', 'yaw', 'pitch', 'target_scene_id', 'label', 'meta'],
  plans: ['project_id', 'kind', 'name', 'image_media_id', 'sort'],
  plan_areas: ['plan_id', 'shape', 'points', 'label', 'description', 'action', 'media_id', 'sort'],
};
