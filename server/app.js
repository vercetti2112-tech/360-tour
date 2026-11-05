import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MEDIA_DIR, all, get, run, insert, update, tx, COLS } from './db.js';
import { getTourCached, buildTour, invalidate, youtubeId } from './tour.js';
import { requireAuth, verifyPassword, hashPassword, createSession, destroySession, cookieOpts, loginThrottle } from './auth.js';
import { processPanorama, processImage, storeFile, removeMediaFiles } from './images.js';

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Header bảo mật cơ bản
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

const PUB = path.join(ROOT, 'public');
const NM = path.join(ROOT, 'node_modules');
const long = { maxAge: '365d', immutable: true };

// Tài nguyên tĩnh. Media có tên thư mục duy nhất (đổi khi upload lại) => cache vĩnh viễn được.
app.use('/media', express.static(MEDIA_DIR, long));
app.use('/assets', express.static(path.join(PUB, 'assets'), { maxAge: '1h' }));
app.use('/admin-assets', express.static(path.join(PUB, 'admin'), { maxAge: 0 }));
app.use('/vendor/three', express.static(path.join(NM, 'three/build'), long));
app.use('/vendor/psv', express.static(path.join(NM, '@photo-sphere-viewer'), long));

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (v, lang = 'vi') => (v && typeof v === 'object' ? v[lang] || v.vi || Object.values(v)[0] || '' : v || '');
const origin = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// ======================= TRANG CÔNG KHAI (SSR meta) =======================
const shell = () => fs.readFileSync(path.join(PUB, 'viewer.html'), 'utf8'); // đọc mỗi lần: dev-friendly, file nhỏ

const VIEWS = { 'vi-tri': 'location', 'mat-bang': 'plan', 'tien-ich': 'facilities', 'thu-vien': 'gallery',
  location: 'location', plan: 'plan', facilities: 'facilities', gallery: 'gallery' };

function renderShell(req, res, slug, sub) {
  const entry = getTourCached(slug);
  if (!entry) return res.status(404).send('Không tìm thấy dự án');
  const tour = entry.json;
  const lang = req.query.lang === 'en' ? 'en' : 'vi';
  const scene = tour.scenes.find((s) => s.slug === sub) || null;
  const view = VIEWS[sub] || null;
  if (sub && !scene && !view) return res.redirect(302, `/${slug}`);

  const pname = t(tour.name, lang);
  const title = scene ? `${t(scene.title, lang)} – ${pname}` : view ? `${viewTitle(view, lang)} – ${pname}` : `${pname} – Tour 360°`;
  const desc = t(scene?.description, lang) || t(tour.description, lang);
  const canonical = `${origin(req)}/${slug}${sub ? '/' + sub : ''}${lang === 'en' ? '?lang=en' : ''}`;
  const startSc = scene || tour.scenes.find((s) => s.slug === tour.startScene);
  const ogImg = startSc?.pano?.og ? origin(req) + startSc.pano.og : '';
  const s = tour.settings || {};
  const ga = s.ga4_id && /^G-[A-Z0-9]+$/.test(s.ga4_id) ? s.ga4_id : null;

  const head = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="vi" href="${esc(canonical.replace('?lang=en', ''))}">
<link rel="alternate" hreflang="en" href="${esc(canonical.replace('?lang=en', '') + '?lang=en')}">
<meta name="theme-color" content="${esc(s.theme_color || '#0b2a40')}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ''}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Place', name: pname, description: t(tour.description, lang), url: `${origin(req)}/${slug}` }).replace(/</g, '\\u003c')}</script>
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');</script>` : ''}`;

  // Nhúng sẵn dữ liệu tour => không cần request thứ hai khi tải trang đầu
  const boot = `<script>window.__TOUR__=${entry.body.replace(/</g, '\\u003c')};window.__ROUTE__=${JSON.stringify({ scene: scene?.slug || null, view, lang })};</script>`;
  // Nội dung cho bot không chạy JS (SEO): danh sách cảnh dạng link thật
  const seo = `<nav class="seo-links">${tour.scenes.map((x) => `<a href="/${slug}/${x.slug}">${esc(t(x.title, lang))}</a>`).join('')}</nav>`;

  res.set('Cache-Control', 'public, max-age=60');
  res.type('html').send(shell()
    .replace('<!--HEAD-->', head)
    .replace('<!--BOOT-->', boot)
    .replace('<!--SEO-->', seo)
    .replace('<html lang="vi">', `<html lang="${lang}">`));
}

function viewTitle(v, lang) {
  const m = { location: ['Vị trí', 'Location'], plan: ['Mặt bằng', 'Masterplan'], facilities: ['Tiện ích', 'Facilities'], gallery: ['Thư viện', 'Gallery'] };
  return m[v][lang === 'en' ? 1 : 0];
}

app.get('/', (req, res) => {
  const p = get('SELECT slug FROM projects ORDER BY id LIMIT 1');
  if (!p) return res.redirect('/admin');
  res.redirect(302, `/${p.slug}`);
});

app.get('/robots.txt', (req, res) => {
  res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin(req)}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const o = origin(req);
  const urls = [];
  for (const p of all('SELECT slug FROM projects')) {
    const tour = getTourCached(p.slug)?.json;
    if (!tour) continue;
    urls.push(`/${p.slug}`, ...['vi-tri', 'mat-bang', 'tien-ich', 'thu-vien'].map((v) => `/${p.slug}/${v}`),
      ...tour.scenes.map((s) => `/${p.slug}/${s.slug}`));
  }
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(o + u)}</loc></url>`).join('\n')}\n</urlset>`);
});

// ======================= API CÔNG KHAI =======================
app.get('/api/tour/:slug', (req, res) => {
  const e = getTourCached(req.params.slug);
  if (!e) return res.status(404).json({ error: 'not found' });
  res.set({ ETag: e.etag, 'Cache-Control': 'public, max-age=30' });
  if (req.get('if-none-match') === e.etag) return res.status(304).end();
  res.type('json').send(e.body);
});

// Giới hạn tần suất đơn giản theo IP cho form & tracking
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), k = req.ip;
    const arr = (hits.get(k) || []).filter((x) => now - x < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Quá nhiều yêu cầu, thử lại sau' });
    arr.push(now); hits.set(k, arr); next();
  };
}

const PHONE_RE = /^(\+?84|0)(3|5|7|8|9)\d{8}$/;
app.post('/api/tour/:slug/leads', rateLimit(5, 10 * 60e3), async (req, res) => {
  const p = get('SELECT id, settings FROM projects WHERE slug=?', req.params.slug);
  if (!p) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot chống bot
  const name = String(b.name || '').trim().slice(0, 100);
  const phone = String(b.phone || '').replace(/[\s.\-()]/g, '');
  const email = String(b.email || '').trim().slice(0, 120);
  if (name.length < 2) return res.status(400).json({ error: 'Vui lòng nhập họ tên' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
  const scene = b.scene ? get('SELECT id FROM scenes WHERE project_id=? AND slug=?', p.id, String(b.scene)) : null;
  const id = insert('leads', {
    project_id: p.id, name, phone, email: email || null,
    interest: String(b.interest || '').slice(0, 100), note: String(b.note || '').slice(0, 1000),
    scene_id: scene?.id ?? null, source: String(b.source || 'form').slice(0, 40),
    utm: JSON.stringify(b.utm || {}).slice(0, 500), ip: req.ip,
  }, ['project_id', 'name', 'phone', 'email', 'interest', 'note', 'scene_id', 'source', 'utm', 'ip']);
  insert('events', { project_id: p.id, scene_id: scene?.id ?? null, type: 'lead', ref: String(id) }, ['project_id', 'scene_id', 'type', 'ref']);
  res.json({ ok: true });
  forwardLead(p, id); // gửi CRM sau khi đã trả lời người dùng
});

async function forwardLead(project, leadId) {
  const url = project.settings?.webhook;
  if (!url || !/^https:\/\//.test(url)) return;
  const lead = get('SELECT * FROM leads WHERE id=?', leadId);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'lead.created', project: project.id, lead }), signal: AbortSignal.timeout(8000),
    });
    run('UPDATE leads SET webhook_status=? WHERE id=?', `HTTP ${r.status}`, leadId);
  } catch (e) {
    run('UPDATE leads SET webhook_status=? WHERE id=?', `lỗi: ${e.message}`.slice(0, 120), leadId);
  }
}

const EVENT_TYPES = new Set(['view', 'scene', 'hotspot', 'plan', 'gallery', 'cta', 'share']);
app.post('/api/tour/:slug/events', rateLimit(240, 60e3), express.text({ type: '*/*', limit: '16kb' }), (req, res) => {
  const p = get('SELECT id FROM projects WHERE slug=?', req.params.slug);
  if (!p) return res.status(204).end();
  let list = [];
  try { list = JSON.parse(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)); } catch { /* bỏ qua */ }
  if (!Array.isArray(list)) list = [list];
  const sceneIds = new Map(all('SELECT id, slug FROM scenes WHERE project_id=?', p.id).map((s) => [s.slug, s.id]));
  tx(() => {
    for (const e of list.slice(0, 50)) {
      if (!e || !EVENT_TYPES.has(e.type)) continue;
      insert('events', {
        project_id: p.id, scene_id: sceneIds.get(e.scene) ?? null, type: e.type,
        ref: String(e.ref ?? '').slice(0, 80), session: String(e.session ?? '').slice(0, 40),
      }, ['project_id', 'scene_id', 'type', 'ref', 'session']);
    }
  });
  res.status(204).end();
});

// Thời tiết: gọi qua server để KHÔNG lộ API key ra trình duyệt; cache 15 phút.
let weatherCache = new Map();
app.get('/api/tour/:slug/weather', async (req, res) => {
  const p = get('SELECT settings FROM projects WHERE slug=?', req.params.slug);
  const s = p?.settings || {};
  if (!s.features?.weather || !s.weather_api_key || s.location?.lat == null) return res.status(404).json({});
  const hit = weatherCache.get(req.params.slug);
  if (hit && Date.now() - hit.at < 15 * 60e3) return res.json(hit.data);
  try {
    const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${s.location.lat}&lon=${s.location.lng}&units=metric&appid=${encodeURIComponent(s.weather_api_key)}`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const data = { temp: Math.round(j.main?.temp), icon: j.weather?.[0]?.icon, city: s.location.city || j.name };
    weatherCache.set(req.params.slug, { at: Date.now(), data });
    res.json(data);
  } catch { res.status(502).json({}); }
});

// ======================= ADMIN =======================
app.get(['/admin', '/admin/*'], (req, res) => res.sendFile(path.join(PUB, 'admin', 'index.html')));

app.post('/api/admin/login', loginThrottle, (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email=?', String(email || '').toLowerCase().trim());
  if (!u || !verifyPassword(String(password || ''), u.pass_hash)) {
    req.failLogin();
    return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
  }
  res.cookie('sid', createSession(u.id), cookieOpts(req));
  res.json({ id: u.id, email: u.email, name: u.name, role: u.role });
});
app.post('/api/admin/logout', (req, res) => {
  if (req.cookies?.sid) destroySession(req.cookies.sid);
  res.clearCookie('sid', { path: '/' }); res.json({ ok: true });
});

const A = express.Router();
A.use(requireAuth());
// Chống CSRF: API admin chỉ nhận request có header tuỳ chỉnh (form của trang lạ không gửi được) + cookie SameSite=Strict
A.use((req, res, next) => (req.method === 'GET' || req.get('x-requested-with') === 'admin') ? next() : res.status(403).json({ error: 'CSRF' }));
const editor = requireAuth(['admin', 'editor']);
const adminOnly = requireAuth(['admin']);

A.get('/me', (req, res) => res.json(req.user));
A.post('/me/password', (req, res) => {
  const { current, next: pw } = req.body || {};
  const u = get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!verifyPassword(String(current || ''), u.pass_hash)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  if (String(pw || '').length < 8) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 8 ký tự' });
  run('UPDATE users SET pass_hash=? WHERE id=?', hashPassword(pw), u.id);
  res.json({ ok: true });
});

// --- Người dùng (chỉ admin) ---
A.get('/users', adminOnly, (req, res) => res.json(all('SELECT id,email,name,role,created_at FROM users ORDER BY id')));
A.post('/users', adminOnly, (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!/^[^@\s]+@[^@\s]+$/.test(email || '') || String(password || '').length < 8) return res.status(400).json({ error: 'Email/mật khẩu (≥8 ký tự) không hợp lệ' });
  if (!['admin', 'editor', 'sales'].includes(role)) return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  try {
    res.json({ id: insert('users', { email: email.toLowerCase(), name, role, pass_hash: hashPassword(password) }, ['email', 'name', 'role', 'pass_hash']) });
  } catch { res.status(409).json({ error: 'Email đã tồn tại' }); }
});
A.delete('/users/:id', adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Không thể tự xoá' });
  run('DELETE FROM users WHERE id=?', req.params.id); res.json({ ok: true });
});

// --- Dự án ---
A.get('/projects', (req, res) => res.json(all('SELECT id, slug, name, updated_at FROM projects ORDER BY id')));
A.post('/projects', adminOnly, (req, res) => {
  const { slug, name } = req.body || {};
  if (!/^[a-z0-9-]{2,60}$/.test(slug || '')) return res.status(400).json({ error: 'Slug chỉ gồm a-z, 0-9, dấu gạch' });
  try { res.json({ id: insert('projects', { slug, name: name || { vi: slug }, settings: defaultSettings() }, COLS.projects) }); }
  catch { res.status(409).json({ error: 'Slug đã tồn tại' }); }
});
// Toàn bộ dữ liệu (kể cả bản nháp + khoá bí mật) cho trình chỉnh sửa
A.get('/projects/:pid', (req, res) => {
  const p = get('SELECT * FROM projects WHERE id=?', req.params.pid);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({
    project: p,
    groups: all('SELECT * FROM groups WHERE project_id=? ORDER BY sort, id', p.id),
    scenes: all('SELECT * FROM scenes WHERE project_id=? ORDER BY sort, id', p.id),
    hotspots: all('SELECT h.* FROM hotspots h JOIN scenes s ON s.id=h.scene_id WHERE s.project_id=?', p.id),
    plans: all('SELECT * FROM plans WHERE project_id=? ORDER BY sort, id', p.id),
    areas: all('SELECT a.* FROM plan_areas a JOIN plans pl ON pl.id=a.plan_id WHERE pl.project_id=?', p.id),
    media: all('SELECT * FROM media WHERE project_id=? ORDER BY sort, id', p.id),
    preview: buildTour(p.slug, { includeDrafts: true }),
  });
});
A.put('/projects/:pid', editor, (req, res) => {
  const b = { ...req.body };
  if (b.slug && !/^[a-z0-9-]{2,60}$/.test(b.slug)) return res.status(400).json({ error: 'Slug không hợp lệ' });
  update('projects', req.params.pid, b, COLS.projects);
  run('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', req.params.pid);
  invalidate(); res.json({ ok: true });
});

// --- CRUD chung cho groups / scenes / hotspots / plans / plan_areas ---
// Kiểm tra quyền sở hữu: bản ghi phải thuộc đúng project trên URL.
const OWNER_SQL = {
  groups: 'SELECT project_id pid FROM groups WHERE id=?',
  scenes: 'SELECT project_id pid FROM scenes WHERE id=?',
  plans: 'SELECT project_id pid FROM plans WHERE id=?',
  hotspots: 'SELECT s.project_id pid FROM hotspots h JOIN scenes s ON s.id=h.scene_id WHERE h.id=?',
  plan_areas: 'SELECT p.project_id pid FROM plan_areas a JOIN plans p ON p.id=a.plan_id WHERE a.id=?',
  media: 'SELECT project_id pid FROM media WHERE id=?',
};
const PARENT_CHECK = {
  hotspots: (b, pid) => get('SELECT 1 x FROM scenes WHERE id=? AND project_id=?', b.scene_id, pid),
  plan_areas: (b, pid) => get('SELECT 1 x FROM plans WHERE id=? AND project_id=?', b.plan_id, pid),
};
function owns(table, id, pid) { return get(OWNER_SQL[table], id)?.pid === Number(pid); }

function validate(table, b) {
  if (table === 'scenes' && b.slug !== undefined && !/^[a-z0-9-]{1,80}$/.test(b.slug)) return 'Slug cảnh chỉ gồm a-z, 0-9, dấu gạch';
  if (table === 'hotspots' && b.type !== undefined && !['link', 'poi', 'info', 'video', 'image'].includes(b.type)) return 'Loại hotspot không hợp lệ';
  if (table === 'plan_areas' && b.points !== undefined && (!Array.isArray(b.points) || !b.points.length)) return 'Thiếu toạ độ vùng';
  return null;
}

for (const table of ['groups', 'scenes', 'hotspots', 'plans', 'plan_areas']) {
  const projectScoped = COLS[table].includes('project_id');
  A.post(`/projects/:pid/${table}`, editor, (req, res) => {
    const b = { ...req.body };
    if (projectScoped) b.project_id = Number(req.params.pid);
    else if (!PARENT_CHECK[table](b, req.params.pid)) return res.status(400).json({ error: 'Bản ghi cha không thuộc dự án' });
    const err = validate(table, b); if (err) return res.status(400).json({ error: err });
    try { const id = insert(table, b, COLS[table]); invalidate(); res.json(get(`SELECT * FROM ${table} WHERE id=?`, id)); }
    catch (e) { res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Slug đã tồn tại' : e.message }); }
  });
  A.put(`/projects/:pid/${table}/:id`, editor, (req, res) => {
    if (!owns(table, req.params.id, req.params.pid)) return res.status(404).json({ error: 'not found' });
    const b = { ...req.body }; delete b.project_id; delete b.scene_id; delete b.plan_id;
    const err = validate(table, b); if (err) return res.status(400).json({ error: err });
    try { update(table, req.params.id, b, COLS[table]); invalidate(); res.json(get(`SELECT * FROM ${table} WHERE id=?`, req.params.id)); }
    catch (e) { res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Slug đã tồn tại' : e.message }); }
  });
  A.delete(`/projects/:pid/${table}/:id`, editor, (req, res) => {
    if (!owns(table, req.params.id, req.params.pid)) return res.status(404).json({ error: 'not found' });
    run(`DELETE FROM ${table} WHERE id=?`, req.params.id); invalidate(); res.json({ ok: true });
  });
}
// Sắp xếp hàng loạt (kéo-thả)
A.post('/projects/:pid/reorder', editor, (req, res) => {
  const { table, ids } = req.body || {};
  if (!['groups', 'scenes', 'plans', 'media', 'plan_areas'].includes(table) || !Array.isArray(ids)) return res.status(400).json({ error: 'bad' });
  tx(() => ids.forEach((id, i) => { if (owns(table, id, req.params.pid)) run(`UPDATE ${table} SET sort=? WHERE id=?`, i, id); }));
  invalidate(); res.json({ ok: true });
});

// --- Media ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });
A.post('/projects/:pid/media', editor, upload.single('file'), async (req, res) => {
  const pid = Number(req.params.pid);
  const { kind = 'image', category = 'gallery', url } = req.body;
  const title = safeJson(req.body.title, { vi: req.file?.originalname || url || '' });
  try {
    let r = { file: null, meta: {} };
    if (kind === 'video' && url) {
      if (!youtubeId(url)) return res.status(400).json({ error: 'Chỉ hỗ trợ link YouTube' });
    } else if (!req.file) return res.status(400).json({ error: 'Thiếu file' });
    else if (kind === 'pano') r = await processPanorama(req.file.buffer);
    else if (kind === 'image') r = await processImage(req.file.buffer, path.extname(req.file.originalname).toLowerCase());
    else if (kind === 'pdf' && req.file.mimetype === 'application/pdf') r = storeFile(req.file.buffer, req.file.originalname);
    else if (kind === 'audio' && /^audio\//.test(req.file.mimetype)) r = storeFile(req.file.buffer, req.file.originalname);
    else return res.status(400).json({ error: 'Định dạng không được hỗ trợ' });
    const id = insert('media', { project_id: pid, kind, category, file: r.file, url: url || null, title, meta: r.meta }, COLS.media);
    invalidate();
    res.json(get('SELECT * FROM media WHERE id=?', id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
A.put('/projects/:pid/media/:id', editor, (req, res) => {
  if (!owns('media', req.params.id, req.params.pid)) return res.status(404).json({ error: 'not found' });
  update('media', req.params.id, req.body, ['title', 'category', 'url', 'sort']); invalidate();
  res.json(get('SELECT * FROM media WHERE id=?', req.params.id));
});
A.delete('/projects/:pid/media/:id', editor, (req, res) => {
  if (!owns('media', req.params.id, req.params.pid)) return res.status(404).json({ error: 'not found' });
  const m = get('SELECT * FROM media WHERE id=?', req.params.id);
  run('DELETE FROM media WHERE id=?', m.id); removeMediaFiles(m.file); invalidate();
  res.json({ ok: true });
});

// --- Leads (admin + sales) ---
A.get('/projects/:pid/leads', (req, res) => {
  res.json(all(`SELECT l.*, s.slug scene_slug FROM leads l LEFT JOIN scenes s ON s.id=l.scene_id WHERE l.project_id=? ORDER BY l.id DESC LIMIT 1000`, req.params.pid));
});
A.put('/projects/:pid/leads/:id', (req, res) => {
  const { status, note } = req.body || {};
  if (status && !['new', 'contacted', 'qualified', 'closed'].includes(status)) return res.status(400).json({ error: 'bad status' });
  run('UPDATE leads SET status=COALESCE(?,status), note=COALESCE(?,note) WHERE id=? AND project_id=?', status ?? null, note ?? null, req.params.id, req.params.pid);
  res.json({ ok: true });
});
A.get('/projects/:pid/leads.csv', (req, res) => {
  const rows = all(`SELECT l.created_at, l.name, l.phone, l.email, l.interest, l.note, l.status, s.slug scene, l.source FROM leads l LEFT JOIN scenes s ON s.id=l.scene_id WHERE l.project_id=? ORDER BY l.id DESC`, req.params.pid);
  const cols = ['created_at', 'name', 'phone', 'email', 'interest', 'note', 'status', 'scene', 'source'];
  const cell = (v) => { const s = String(v ?? ''); const safe = /^[=+\-@]/.test(s) ? "'" + s : s; return `"${safe.replace(/"/g, '""')}"`; };
  res.set('Content-Disposition', 'attachment; filename="leads.csv"');
  res.type('text/csv').send('\ufeff' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n'));
});

// --- Thống kê ---
A.get('/projects/:pid/stats', (req, res) => {
  const pid = req.params.pid, days = Math.min(365, Number(req.query.days) || 30);
  const since = `-${days} days`;
  res.json({
    totals: all(`SELECT type, COUNT(*) n, COUNT(DISTINCT session) sessions FROM events WHERE project_id=? AND created_at>=datetime('now',?) GROUP BY type`, pid, since),
    daily: all(`SELECT date(created_at) d, COUNT(DISTINCT session) sessions, SUM(type='lead') leads FROM events WHERE project_id=? AND created_at>=datetime('now',?) GROUP BY d ORDER BY d`, pid, since),
    scenes: all(`SELECT s.slug, s.title, COUNT(e.id) n FROM scenes s LEFT JOIN events e ON e.scene_id=s.id AND e.type='scene' AND e.created_at>=datetime('now',?) WHERE s.project_id=? GROUP BY s.id ORDER BY n DESC`, since, pid),
    hotspots: all(`SELECT ref, COUNT(*) n FROM events WHERE project_id=? AND type IN ('hotspot','plan','cta') AND created_at>=datetime('now',?) GROUP BY ref ORDER BY n DESC LIMIT 15`, pid, since),
  });
});

app.use('/api/admin', A);

function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

export function defaultSettings() {
  return {
    theme_color: '#0b2a40', accent: '#e8b04b', logo_text: '', start_language: 'vi', languages: ['vi', 'en'], layout: 'topnav',
    hotline: '', zalo: '', messenger: '', website: '', facebook: '', youtube: '',
    disclaimer: { vi: 'Hình ảnh mang tính minh hoạ, có thể thay đổi theo thực tế.', en: 'Images are for illustration purposes only.' },
    location: { lat: null, lng: null, city: '', address: { vi: '', en: '' }, content: { vi: '', en: '' }, map_embed: '' },
    features: { autorotate: true, compass: true, daynight: true, sound: true, vr: true, gyroscope: true, share: true,
      lead_form: true, floorplan: true, weather: false, disclaimer: true, help: true },
    ga4_id: '', webhook: '', weather_api_key: '', bg_sound_media_id: null,
  };
}

// Lỗi chung
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Lỗi máy chủ' }); });

// Route tour đặt cuối cùng (bắt /:slug và /:slug/:sub)
app.get('/:slug', (req, res, next) => (/^[a-z0-9-]+$/.test(req.params.slug) ? renderShell(req, res, req.params.slug, null) : next()));
app.get('/:slug/:sub', (req, res, next) => (/^[a-z0-9-]+$/.test(req.params.sub) ? renderShell(req, res, req.params.slug, req.params.sub) : next()));
