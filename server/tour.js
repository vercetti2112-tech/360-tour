// Dựng "tour JSON" công khai từ DB — một nguồn dữ liệu duy nhất cho menu, cảnh, hotspot, mặt bằng, thư viện, i18n.
// Có cache trong bộ nhớ + ETag; mọi thao tác ghi ở admin gọi invalidate().
import crypto from 'node:crypto';
import { all, get } from './db.js';

const cache = new Map(); // slug -> { json, etag }

export function invalidate() { cache.clear(); }

const mediaUrl = (m) => (m?.file ? `/media/${m.file}` : null);

function panoInfo(m) {
  if (!m) return null;
  if (m.meta?.tiled) {
    return {
      tiled: true, width: m.meta.width, cols: m.meta.cols, rows: m.meta.rows,
      base: `/media/${m.file}/base.jpg`, tiles: `/media/${m.file}/t/`,
      thumb: `/media/${m.file}/thumb.jpg`, og: `/media/${m.file}/og.jpg`,
    };
  }
  return { tiled: false, url: mediaUrl(m), thumb: m.meta?.thumb ? `/media/${m.meta.thumb}` : mediaUrl(m), og: mediaUrl(m) };
}

/** Thông tin công khai tối thiểu (không lộ webhook/khoá bí mật). */
function publicSettings(s = {}) {
  const { webhook, weather_api_key, ...rest } = s; // các khoá bí mật chỉ dùng phía server
  return rest;
}

export function buildTour(slug, { includeDrafts = false } = {}) {
  const p = get('SELECT * FROM projects WHERE slug=?', slug);
  if (!p) return null;
  const media = new Map(all('SELECT * FROM media WHERE project_id=?', p.id).map((m) => [m.id, m]));
  const scenes = all(
    `SELECT * FROM scenes WHERE project_id=? ${includeDrafts ? '' : "AND status='published'"} ORDER BY sort, id`, p.id);
  const sceneIds = new Set(scenes.map((s) => s.id));
  const hotspots = all(
    `SELECT h.* FROM hotspots h JOIN scenes s ON s.id=h.scene_id WHERE s.project_id=? ORDER BY h.id`, p.id);
  const groups = all('SELECT * FROM groups WHERE project_id=? ORDER BY sort, id', p.id);
  const plans = all('SELECT * FROM plans WHERE project_id=? ORDER BY sort, id', p.id);
  const areas = all(
    `SELECT a.* FROM plan_areas a JOIN plans pl ON pl.id=a.plan_id WHERE pl.project_id=? ORDER BY a.sort, a.id`, p.id);

  const start = scenes.find((s) => s.id === p.start_scene_id) || scenes[0];
  const settings = publicSettings(p.settings);
  settings.bg_sound = mediaUrl(media.get(p.settings?.bg_sound_media_id)) || null;
  settings.logo_url = mediaUrl(media.get(p.settings?.logo_media_id)) || null;
  return {
    id: p.id, slug: p.slug, name: p.name, description: p.description,
    settings,
    startScene: start?.slug || null,
    groups: groups.map((g) => ({
      id: g.id, name: g.name, kind: g.kind, icon: g.icon,
      floorplan: mediaUrl(media.get(g.floorplan_media_id)),
      scenes: scenes.filter((s) => s.group_id === g.id && s.in_menu).map((s) => s.slug),
    })),
    scenes: scenes.map((s) => {
      const pair = scenes.find((x) => x.id === s.pair_scene_id);
      return {
        id: s.id, slug: s.slug, title: s.title, description: s.description, group: s.group_id,
        pano: panoInfo(media.get(s.pano_media_id)),
        sound: mediaUrl(media.get(s.sound_media_id)),
        view: { yaw: s.yaw, pitch: s.pitch, zoom: s.zoom }, north: s.north_offset,
        pair: pair ? { slug: pair.slug, role: s.pair_role } : null,
        floorplan: s.floorplan_x != null ? { x: s.floorplan_x, y: s.floorplan_y } : null,
        hotspots: hotspots.filter((h) => h.scene_id === s.id && (!h.target_scene_id || sceneIds.has(h.target_scene_id)))
          .map((h) => ({
            id: h.id, type: h.type, yaw: h.yaw, pitch: h.pitch, label: h.label, meta: h.meta,
            target: h.target_scene_id ? scenes.find((x) => x.id === h.target_scene_id)?.slug : null,
            media: h.meta?.media_id ? mediaUrl(media.get(h.meta.media_id)) : null,
          })),
      };
    }),
    plans: plans.map((pl) => {
      const img = media.get(pl.image_media_id);
      return {
        id: pl.id, kind: pl.kind, name: pl.name, image: mediaUrl(img),
        width: img?.meta?.width, height: img?.meta?.height,
        areas: areas.filter((a) => a.plan_id === pl.id).map((a) => ({
          id: a.id, shape: a.shape, points: a.points, label: a.label, description: a.description,
          action: a.action, image: mediaUrl(media.get(a.media_id)),
        })),
      };
    }),
    library: [...media.values()]
      .filter((m) => ['gallery', 'video', 'document', 'legal'].includes(m.category))
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((m) => ({
        id: m.id, kind: m.kind, category: m.category, title: m.title, url: m.url || mediaUrl(m),
        thumb: m.meta?.thumb ? `/media/${m.meta.thumb}` : (m.url && youtubeThumb(m.url)) || null,
      })),
  };
}

export function youtubeId(url = '') {
  return (url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/) || [])[1] || null;
}
function youtubeThumb(url) { const id = youtubeId(url); return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null; }

export function getTourCached(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const json = buildTour(slug);
  if (!json) return null;
  const body = JSON.stringify(json);
  const entry = { json, body, etag: `"${crypto.createHash('sha1').update(body).digest('base64url')}"` };
  cache.set(slug, entry);
  return entry;
}
