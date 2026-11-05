// Trang quản trị — SPA thuần JS (không cần build). Toàn bộ dữ liệu tour được sửa ở đây, thay cho việc sửa XML/JS thủ công.
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vi = (v) => (v && typeof v === 'object' ? v.vi || v.en || '' : v || '');
const RAD = 180 / Math.PI;
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// ---------------- API ----------------
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'x-requested-with': 'admin' } };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(`/api/admin${path}`, init);
  if (r.status === 401) { state.user = null; render(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : {};
  if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
  return j;
}
const P = (path) => `/projects/${state.pid}${path}`;

let toastT;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast ${bad ? 'bad' : ''}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}
async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } }

// ---------------- State ----------------
const state = { user: null, projects: [], pid: Number(localGet('pid')) || null, data: null, section: 'scenes', sel: {} };
function localGet(k) { try { return localStorage.getItem(`vtadm_${k}`); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(`vtadm_${k}`, v); } catch { /* bỏ qua */ } }

async function reload() {
  state.data = await api(`/projects/${state.pid}`);
  return state.data;
}
const D = () => state.data;
const sceneById = (id) => D().scenes.find((s) => s.id === id);
const mediaById = (id) => D().media.find((m) => m.id === id);
const mediaSrc = (m) => !m ? '' : m.kind === 'pano' ? `/media/${m.file}/thumb.jpg` : m.meta?.thumb ? `/media/${m.meta.thumb}` : m.file ? `/media/${m.file}` : '';

// ---------------- Form helpers ----------------
const i18nField = (name, label, val = {}, { area = false } = {}) => `
  <div class="field i18n"><label>${label}</label><div class="i18n-row">
    ${['vi', 'en'].map((l) => area
      ? `<div><span class="tag">${l.toUpperCase()}</span><textarea name="${name}.${l}" rows="4">${esc(val?.[l])}</textarea></div>`
      : `<div><span class="tag">${l.toUpperCase()}</span><input name="${name}.${l}" value="${esc(val?.[l])}"></div>`).join('')}
  </div></div>`;
const field = (name, label, val = '', type = 'text', extra = '') => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(val ?? '')}" ${extra}></div>`;
const select = (name, label, val, options, extra = '') => `<div class="field"><label>${label}</label><select name="${name}" ${extra}>${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
const check = (name, label, val) => `<label class="check"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}> ${label}</label>`;
const mediaOptions = (filter, none = '— Không —') => [['', none], ...D().media.filter(filter).map((m) => [m.id, `#${m.id} · ${vi(m.title) || m.file || m.url}`])];

/** Đọc form thành object lồng nhau: "title.vi" => {title:{vi}}; ô số => number; checkbox => bool */
function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
    if (el.dataset.num !== undefined) v = el.value === '' ? null : Number(el.value);
    const keys = el.name.split('.');
    let o = out;
    keys.slice(0, -1).forEach((k) => (o = o[k] ??= {}));
    o[keys.at(-1)] = v;
  }
  return out;
}

// ---------------- Root render ----------------
async function boot() {
  try { state.user = await api('/me'); } catch { state.user = null; }
  if (state.user) await loadProjects();
  render();
}
async function loadProjects() {
  state.projects = await api('/projects');
  if (!state.projects.find((p) => p.id === state.pid)) state.pid = state.projects[0]?.id || null;
  if (state.pid) await reload();
}

function render() {
  const app = $('#app');
  if (!state.user) return renderLogin(app);
  const sections = [
    ['scenes', 'Cảnh 360°', '🌐'], ['groups', 'Nhóm & menu', '🗂'], ['plans', 'Mặt bằng & tiện ích', '🗺'],
    ['media', 'Thư viện media', '🖼'], ['leads', 'Khách hàng (lead)', '📇'], ['stats', 'Thống kê', '📊'],
    ['settings', 'Cài đặt dự án', '⚙️'], ...(state.user.role === 'admin' ? [['users', 'Người dùng', '👤']] : []),
  ].filter(([k]) => state.user.role !== 'sales' || ['leads', 'stats'].includes(k));
  if (!sections.find(([k]) => k === state.section)) state.section = sections[0][0];
  const proj = state.projects.find((p) => p.id === state.pid);
  app.innerHTML = `
  <aside class="side">
    <div class="logo">Tour 360 <b>CMS</b></div>
    <div class="proj">
      <select id="projSel">${state.projects.map((p) => `<option value="${p.id}" ${p.id === state.pid ? 'selected' : ''}>${esc(vi(p.name))}</option>`).join('')}</select>
      ${state.user.role === 'admin' ? '<button class="ghost sm" id="newProj" title="Dự án mới">＋</button>' : ''}
    </div>
    ${proj ? `<a class="view-site" href="/${esc(proj.slug)}" target="_blank" rel="noopener">Xem tour ↗</a>` : ''}
    <nav>${sections.map(([k, t, ic]) => `<button class="nav ${k === state.section ? 'on' : ''}" data-s="${k}"><span>${ic}</span>${t}</button>`).join('')}</nav>
    <div class="me"><div>${esc(state.user.name || state.user.email)}<small>${esc(state.user.role)}</small></div>
      <button class="ghost sm" id="pwBtn">Đổi mật khẩu</button><button class="ghost sm" id="logout">Đăng xuất</button></div>
  </aside>
  <main class="main" id="main"></main>`;
  $('#projSel')?.addEventListener('change', async (e) => { state.pid = Number(e.target.value); localSet('pid', state.pid); state.sel = {}; await reload(); render(); });
  $('#newProj')?.addEventListener('click', newProject);
  $$('.nav').forEach((b) => b.addEventListener('click', () => { state.section = b.dataset.s; render(); }));
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); state.user = null; render(); };
  $('#pwBtn').onclick = changePassword;
  if (!state.pid) { $('#main').innerHTML = '<div class="empty">Chưa có dự án. Bấm ＋ để tạo.</div>'; return; }
  ({ scenes: renderScenes, groups: renderGroups, plans: renderPlans, media: renderMedia, leads: renderLeads, stats: renderStats, settings: renderSettings, users: renderUsers })[state.section]($('#main'));
}

function renderLogin(app) {
  app.innerHTML = `<form class="login card"><h1>Tour 360 <b>CMS</b></h1>
    ${field('email', 'Email', '', 'email', 'required autocomplete="username"')}
    ${field('password', 'Mật khẩu', '', 'password', 'required autocomplete="current-password"')}
    <p class="err" hidden></p><button class="primary block">Đăng nhập</button></form>`;
  $('.login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(readForm(e.target)) });
    const j = await r.json();
    if (!r.ok) { const er = $('.err'); er.textContent = j.error; er.hidden = false; return; }
    state.user = j; await loadProjects(); render();
  });
}

function modal(html, onMount) {
  const m = document.createElement('div');
  m.className = 'modal'; m.innerHTML = `<div class="card modal-card"><button class="x" aria-label="Đóng">×</button>${html}</div>`;
  document.body.append(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m || e.target.classList.contains('x')) close(); });
  onMount?.(m, close);
  return close;
}

function newProject() {
  modal(`<h2>Dự án mới</h2><form>${field('name', 'Tên dự án', '', 'text', 'required')}${field('slug', 'Slug URL (a-z, 0-9, -)', '', 'text', 'required pattern="[a-z0-9-]{2,60}"')}<button class="primary">Tạo</button></form>`, (m, close) => {
    const f = $('form', m);
    f.name.addEventListener('input', () => (f.slug.value = slugify(f.name.value)));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await act(() => api('/projects', { method: 'POST', body: { slug: f.slug.value, name: { vi: f.name.value, en: f.name.value } } }), 'Đã tạo dự án');
      close(); state.pid = r.id; localSet('pid', r.id); await loadProjects(); render();
    });
  });
}

function changePassword() {
  modal(`<h2>Đổi mật khẩu</h2><form>${field('current', 'Mật khẩu hiện tại', '', 'password', 'required')}${field('next', 'Mật khẩu mới (≥ 8 ký tự)', '', 'password', 'required minlength="8"')}<button class="primary">Lưu</button></form>`, (m, close) => {
    $('form', m).addEventListener('submit', async (e) => { e.preventDefault(); await act(() => api('/me/password', { method: 'POST', body: readForm(e.target) }), 'Đã đổi mật khẩu'); close(); });
  });
}

// ---------------- Upload helper ----------------
function uploadDialog({ kind, category, title = 'Tải lên', accept, onDone }) {
  modal(`<h2>${title}</h2><form class="upl">
    ${kind === 'video' ? field('url', 'Link YouTube', '', 'url', 'required') : `<div class="field"><label>File</label><input type="file" name="file" ${accept ? `accept="${accept}"` : ''} required ${kind !== 'pano' ? 'multiple' : ''}></div>`}
    ${i18nField('title', 'Tiêu đề (để trống = tên file)', {})}
    ${kind === 'pano' ? '<p class="hint">Ảnh equirectangular tỉ lệ 2:1 (khuyến nghị 8000×4000 trở lên). Hệ thống tự cắt tile, tạo thumbnail và ảnh chia sẻ.</p>' : ''}
    <div class="progress" hidden><div></div></div>
    <button class="primary">Tải lên</button></form>`, (m, close) => {
    const f = $('form', m);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Đang xử lý...';
      const t = readForm(f).title;
      const files = kind === 'video' ? [null] : [...f.file.files];
      const results = [];
      try {
        for (const [i, file] of files.entries()) {
          const fd = new FormData();
          fd.append('kind', kind); fd.append('category', category);
          if (file) fd.append('file', file); else fd.append('url', f.url.value);
          const name = file ? file.name.replace(/\.[^.]+$/, '') : f.url.value;
          fd.append('title', JSON.stringify({ vi: t.vi || name, en: t.en || t.vi || name }));
          $('.progress', f).hidden = false; $('.progress div', f).style.width = `${((i + 0.5) / files.length) * 100}%`;
          results.push(await api(P('/media'), { method: 'POST', body: fd }));
        }
        toast(`Đã tải lên ${results.length} file`); close();
        await reload(); onDone?.(results);
      } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = 'Tải lên'; }
    });
  });
}

// ---------------- Mini viewer (dùng chung cho chỉnh hotspot) ----------------
let adminViewer = null;
function destroyViewer() { try { adminViewer?.destroy(); } catch { /* bỏ qua */ } adminViewer = null; }
function tileCfg(m) {
  return { width: m.meta.width, cols: m.meta.cols, rows: m.meta.rows, baseUrl: `/media/${m.file}/base.jpg`, tileUrl: (c, r) => `/media/${m.file}/t/${c}_${r}.jpg` };
}

// ================= CẢNH 360 =================
function renderScenes(main) {
  destroyViewer();
  const scenes = D().scenes, groups = D().groups;
  const sel = sceneById(state.sel.scene) || scenes[0];
  state.sel.scene = sel?.id;
  main.innerHTML = `
  <div class="split">
    <div class="list-col card">
      <div class="col-head"><h2>Cảnh (${scenes.length})</h2><button class="primary sm" id="addScene">＋ Cảnh</button></div>
      <div class="hint">Kéo để sắp xếp thứ tự menu.</div>
      <div class="list" id="sceneList">${groups.concat([{ id: null, name: { vi: 'Chưa xếp nhóm' } }]).map((g) => {
        const items = scenes.filter((s) => (s.group_id ?? null) === g.id);
        if (!items.length && g.id === null) return '';
        return `<div class="list-group">${esc(vi(g.name))}</div>${items.map((s) => `
          <div class="row ${s.id === sel?.id ? 'on' : ''}" draggable="true" data-id="${s.id}">
            <img src="${esc(mediaSrc(mediaById(s.pano_media_id)))}" alt="">
            <div><b>${esc(vi(s.title))}</b><small>/${esc(s.slug)} ${s.status === 'draft' ? '<span class="pill">nháp</span>' : ''} ${D().project.start_scene_id === s.id ? '<span class="pill gold">mở đầu</span>' : ''}</small></div>
          </div>`).join('')}`;
      }).join('')}</div>
    </div>
    <div class="edit-col">${sel ? sceneEditor(sel) : '<div class="empty card">Chưa có cảnh nào. Bấm “＋ Cảnh”.</div>'}</div>
  </div>`;
  $$('#sceneList .row').forEach((r) => r.addEventListener('click', () => { state.sel.scene = Number(r.dataset.id); state.sel.hotspot = null; renderScenes(main); }));
  enableDragSort($('#sceneList'), '.row', (ids) => act(() => api(P('/reorder'), { method: 'POST', body: { table: 'scenes', ids } }), 'Đã lưu thứ tự').then(reload));
  $('#addScene').onclick = () => addSceneDialog(main);
  if (sel) mountSceneEditor(main, sel);
}

function addSceneDialog(main) {
  modal(`<h2>Thêm cảnh</h2><form>
    ${i18nField('title', 'Tiêu đề', {})}${field('slug', 'Slug URL', '', 'text', 'required pattern="[a-z0-9-]{1,80}"')}
    ${select('group_id', 'Nhóm', '', [['', '—'], ...D().groups.map((g) => [g.id, vi(g.name)])])}
    <div class="field"><label>Ảnh 360° (equirectangular 2:1)</label><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></div>
    <button class="primary">Tạo cảnh</button></form>`, (m, close) => {
    const f = $('form', m);
    f['title.vi'].addEventListener('input', () => (f.slug.value = slugify(f['title.vi'].value)));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.primary', f); btn.disabled = true; btn.textContent = 'Đang cắt tile...';
      try {
        const fd = new FormData(); fd.append('kind', 'pano'); fd.append('category', 'pano'); fd.append('file', f.file.files[0]);
        fd.append('title', JSON.stringify({ vi: f['title.vi'].value, en: f['title.en'].value }));
        const media = await api(P('/media'), { method: 'POST', body: fd });
        const v = readForm(f);
        const s = await api(P('/scenes'), { method: 'POST', body: { title: v.title, slug: v.slug, group_id: v.group_id ? Number(v.group_id) : null, pano_media_id: media.id, sort: D().scenes.length } });
        toast('Đã tạo cảnh'); close(); state.sel.scene = s.id; await reload(); renderScenes(main);
      } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = 'Tạo cảnh'; }
    });
  });
}

function sceneEditor(s) {
  const g = D().groups.find((x) => x.id === s.group_id);
  const fp = g && mediaById(g.floorplan_media_id);
  const hs = D().hotspots.filter((h) => h.scene_id === s.id);
  return `
  <div class="card">
    <div class="col-head"><h2>${esc(vi(s.title))}</h2>
      <div class="btns"><a class="ghost sm" target="_blank" href="/${esc(D().project.slug)}/${esc(s.slug)}">Xem ↗</a><button class="danger sm" id="delScene">Xoá</button></div></div>
    <div class="pano-box"><div id="adminPano"></div>
      <div class="pano-tools">
        <button class="sm" data-tool="add-link">＋ Điểm chuyển cảnh</button><button class="sm" data-tool="add-poi">＋ Nhãn POI</button>
        <button class="sm" data-tool="add-info">＋ Thông tin</button><button class="sm" data-tool="add-video">＋ Video</button><button class="sm" data-tool="add-image">＋ Ảnh</button>
        <span class="sep"></span>
        <button class="sm" id="setView" title="Lấy góc nhìn hiện tại làm góc mở đầu">📷 Đặt góc mở đầu</button>
        <button class="sm" id="setNorth" title="Xoay tới hướng Bắc thực tế rồi bấm">🧭 Đặt hướng Bắc</button>
      </div>
      <div class="pano-hint" id="panoHint" hidden></div>
    </div>
    <div class="hs-panel" id="hsPanel">${hotspotPanel(s, hs)}</div>
  </div>
  <form class="card" id="sceneForm">
    <h3>Thông tin cảnh</h3>
    ${i18nField('title', 'Tiêu đề', s.title)}
    ${i18nField('description', 'Mô tả (SEO & chia sẻ)', s.description || {}, { area: true })}
    <div class="grid3">
      ${field('slug', 'Slug URL', s.slug, 'text', 'pattern="[a-z0-9-]{1,80}" required')}
      ${select('group_id', 'Nhóm', s.group_id, [['', '—'], ...D().groups.map((x) => [x.id, vi(x.name)])], 'data-num')}
      ${select('status', 'Trạng thái', s.status, [['published', 'Xuất bản'], ['draft', 'Bản nháp (ẩn)']])}
      ${select('pano_media_id', 'Ảnh 360°', s.pano_media_id, mediaOptions((m) => m.kind === 'pano'), 'data-num')}
      ${select('sound_media_id', 'Âm thanh riêng', s.sound_media_id, mediaOptions((m) => m.kind === 'audio'), 'data-num')}
      ${select('in_menu', 'Hiện trong menu', s.in_menu, [[1, 'Có'], [0, 'Không']], 'data-num')}
      ${select('pair_scene_id', 'Cảnh đôi ngày/đêm', s.pair_scene_id, [['', '— Không —'], ...D().scenes.filter((x) => x.id !== s.id).map((x) => [x.id, vi(x.title)])], 'data-num')}
      ${select('pair_role', 'Cảnh này là', s.pair_role, [['', '—'], ['day', 'Ban ngày'], ['night', 'Ban đêm']])}
      ${field('north_offset', 'Lệch hướng Bắc (°)', s.north_offset, 'number', 'step="0.1"')}
      ${field('yaw', 'Góc mở đầu – yaw (°)', s.yaw, 'number', 'step="0.1"')}
      ${field('pitch', 'Góc mở đầu – pitch (°)', s.pitch, 'number', 'step="0.1"')}
      ${field('zoom', 'Zoom mở đầu (0–100)', s.zoom, 'number', 'min="0" max="100"')}
      ${field('lat', 'Vĩ độ (tuỳ chọn)', s.lat, 'number', 'step="any"')}
      ${field('lng', 'Kinh độ (tuỳ chọn)', s.lng, 'number', 'step="any"')}
    </div>
    ${fp ? `<div class="field"><label>Vị trí trên mặt bằng căn “${esc(vi(g.name))}” — bấm vào ảnh để đặt</label>
      <div class="fp-pick" id="fpPick"><img src="/media/${esc(fp.file)}" alt="">${s.floorplan_x != null ? `<span class="fp-dot" style="left:${s.floorplan_x * 100}%;top:${s.floorplan_y * 100}%"></span>` : ''}</div>
      <input type="hidden" name="floorplan_x" data-num value="${s.floorplan_x ?? ''}"><input type="hidden" name="floorplan_y" data-num value="${s.floorplan_y ?? ''}"></div>` : ''}
    <div class="btns">${check('is_start', 'Đặt làm cảnh mở đầu của tour', D().project.start_scene_id === s.id)}<button class="primary">Lưu cảnh</button></div>
  </form>`;
}

function hotspotPanel(s, hs) {
  const h = hs.find((x) => x.id === state.sel.hotspot);
  const label = { link: 'Chuyển cảnh', poi: 'Nhãn POI', info: 'Thông tin', video: 'Video', image: 'Ảnh' };
  const list = `<div class="hs-list">${hs.length ? hs.map((x) => `<button class="chip ${x.id === h?.id ? 'on' : ''}" data-h="${x.id}">${label[x.type]} · ${esc(vi(x.label) || (x.target_scene_id ? vi(sceneById(x.target_scene_id)?.title) : '') || '#' + x.id)}</button>`).join('') : '<span class="hint">Chưa có hotspot. Chọn công cụ “＋ …” rồi bấm lên ảnh 360°.</span>'}</div>`;
  if (!h) return list;
  return `${list}<form class="hs-form" id="hsForm">
    <div class="grid3">
      ${select('type', 'Loại', h.type, Object.entries(label))}
      ${field('yaw', 'Yaw (°)', (+h.yaw).toFixed(2), 'number', 'step="0.01"')}
      ${field('pitch', 'Pitch (°)', (+h.pitch).toFixed(2), 'number', 'step="0.01"')}
    </div>
    ${i18nField('label', 'Nhãn', h.label || {})}
    ${h.type === 'link' ? select('target_scene_id', 'Đi tới cảnh', h.target_scene_id, [['', '—'], ...D().scenes.filter((x) => x.id !== s.id).map((x) => [x.id, vi(x.title)])], 'data-num') : ''}
    ${h.type === 'poi' ? `<div class="grid3">${field('meta.travel', 'Thời gian di chuyển (phút)', h.meta?.travel, 'number', 'min="0"')}${field('meta.line', 'Độ dài đường dẫn (px)', h.meta?.line ?? 70, 'number', 'min="0" max="400"')}</div>` : ''}
    ${['info', 'image'].includes(h.type) ? i18nField('meta.body', 'Nội dung', h.meta?.body || {}, { area: true }) : ''}
    ${h.type === 'video' ? field('meta.url', 'Link YouTube', h.meta?.url, 'url') : ''}
    ${h.type === 'image' ? select('meta.media_id', 'Ảnh', h.meta?.media_id, mediaOptions((m) => m.kind === 'image'), 'data-num') : ''}
    <div class="btns"><button type="button" class="ghost sm" id="hsMove">✥ Di chuyển (bấm vị trí mới)</button><button type="button" class="danger sm" id="hsDel">Xoá</button><button class="primary sm">Lưu hotspot</button></div>
  </form>`;
}

function mountSceneEditor(main, s) {
  const m = mediaById(s.pano_media_id);
  let tool = null;
  const hint = $('#panoHint');
  const setTool = (t, msg) => { tool = t; hint.hidden = !t; hint.textContent = msg || ''; $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); $('#adminPano').classList.toggle('crosshair', !!t); };

  if (m?.meta?.tiled) {
    adminViewer = new Viewer({
      container: $('#adminPano'), adapter: [EquirectangularTilesAdapter, { showErrorTile: false }],
      panorama: tileCfg(m), defaultYaw: `${s.yaw}deg`, defaultPitch: `${s.pitch}deg`, defaultZoomLvl: s.zoom,
      navbar: ['zoom', 'move', 'fullscreen'], loadingTxt: '', plugins: [[MarkersPlugin, {}]],
    });
    const markers = adminViewer.getPlugin(MarkersPlugin);
    const draw = () => markers.setMarkers(D().hotspots.filter((h) => h.scene_id === s.id).map((h) => ({
      id: String(h.id), position: { yaw: `${h.yaw}deg`, pitch: `${h.pitch}deg` },
      html: `<div class="adm-hs t-${h.type} ${h.id === state.sel.hotspot ? 'sel' : ''}"><span></span><em>${esc(vi(h.label) || (h.target_scene_id ? '→ ' + vi(sceneById(h.target_scene_id)?.title) : h.type))}</em></div>`,
      anchor: 'center center',
    })));
    adminViewer.addEventListener('ready', draw, { once: true });
    markers.addEventListener('select-marker', ({ marker }) => { if (tool) return; selectHotspot(Number(marker.id)); });
    adminViewer.addEventListener('click', async ({ data }) => {
      if (!tool || data.rightclick) return;
      const yaw = +(data.yaw * RAD).toFixed(2), pitch = +(data.pitch * RAD).toFixed(2);
      if (tool === 'move') {
        await act(() => api(P(`/hotspots/${state.sel.hotspot}`), { method: 'PUT', body: { yaw, pitch } }), 'Đã di chuyển');
      } else {
        const type = tool.replace('add-', '');
        const h = await act(() => api(P('/hotspots'), { method: 'POST', body: { scene_id: s.id, type, yaw, pitch, label: { vi: '', en: '' }, meta: type === 'poi' ? { line: 70 } : {} } }), 'Đã thêm hotspot — điền thông tin bên dưới');
        state.sel.hotspot = h.id;
      }
      setTool(null);
      await reload(); draw(); refreshPanel();
    });
    $('#setView').onclick = async () => {
      const p = adminViewer.getPosition();
      await act(() => api(P(`/scenes/${s.id}`), { method: 'PUT', body: { yaw: +(p.yaw * RAD).toFixed(2), pitch: +(p.pitch * RAD).toFixed(2), zoom: Math.round(adminViewer.getZoomLevel()) } }), 'Đã lưu góc mở đầu');
      await reload(); const f = $('#sceneForm'); const sc = sceneById(s.id); f.yaw.value = sc.yaw; f.pitch.value = sc.pitch; f.zoom.value = sc.zoom;
    };
    $('#setNorth').onclick = async () => {
      // Người dùng xoay tới hướng Bắc thật: north_offset = -yaw hiện tại
      const north = +(-(adminViewer.getPosition().yaw * RAD)).toFixed(1);
      await act(() => api(P(`/scenes/${s.id}`), { method: 'PUT', body: { north_offset: north } }), 'Đã đặt hướng Bắc');
      await reload(); $('#sceneForm').north_offset.value = north;
    };
    var redraw = draw; // eslint-disable-line no-var
  } else {
    $('#adminPano').innerHTML = '<div class="empty">Chưa có ảnh 360°. Chọn ảnh trong “Thông tin cảnh” hoặc tải lên ở Thư viện media.</div>';
  }

  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(tool === b.dataset.tool ? null : b.dataset.tool, 'Bấm lên ảnh 360° để đặt vị trí. (Esc để huỷ)')));
  addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') setTool(null); if (!document.body.contains($('#adminPano'))) removeEventListener('keydown', esc_); });

  function selectHotspot(id) { state.sel.hotspot = id; redraw?.(); refreshPanel(); }
  function refreshPanel() {
    $('#hsPanel').innerHTML = hotspotPanel(s, D().hotspots.filter((h) => h.scene_id === s.id));
    $$('#hsPanel [data-h]').forEach((b) => b.addEventListener('click', () => {
      selectHotspot(Number(b.dataset.h));
      const h = D().hotspots.find((x) => x.id === Number(b.dataset.h));
      adminViewer?.animate({ yaw: `${h.yaw}deg`, pitch: `${h.pitch}deg`, speed: '6rpm' });
    }));
    const f = $('#hsForm'); if (!f) return;
    f.type.addEventListener('change', async () => { await act(() => api(P(`/hotspots/${state.sel.hotspot}`), { method: 'PUT', body: { type: f.type.value } })); await reload(); refreshPanel(); redraw?.(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(f);
      const cur = D().hotspots.find((x) => x.id === state.sel.hotspot);
      const meta = { ...(cur.meta || {}), ...(v.meta || {}) };
      await act(() => api(P(`/hotspots/${state.sel.hotspot}`), { method: 'PUT', body: { type: v.type, yaw: v.yaw, pitch: v.pitch, label: v.label, target_scene_id: v.target_scene_id ?? null, meta } }), 'Đã lưu hotspot');
      await reload(); redraw?.(); refreshPanel();
    });
    $('#hsDel').onclick = async () => {
      if (!confirm('Xoá hotspot này?')) return;
      await act(() => api(P(`/hotspots/${state.sel.hotspot}`), { method: 'DELETE' }), 'Đã xoá');
      state.sel.hotspot = null; await reload(); redraw?.(); refreshPanel();
    };
    $('#hsMove').onclick = () => setTool('move', 'Bấm vị trí mới cho hotspot trên ảnh 360°.');
  }
  refreshPanel();

  // Chọn vị trí trên mặt bằng căn
  $('#fpPick')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = +((e.clientX - r.left) / r.width).toFixed(4), y = +((e.clientY - r.top) / r.height).toFixed(4);
    const f = $('#sceneForm'); f.floorplan_x.value = x; f.floorplan_y.value = y;
    let dot = $('.fp-dot', e.currentTarget); if (!dot) { dot = document.createElement('span'); dot.className = 'fp-dot'; e.currentTarget.append(dot); }
    dot.style.left = `${x * 100}%`; dot.style.top = `${y * 100}%`;
  });

  $('#sceneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readForm(e.target);
    const isStart = v.is_start; delete v.is_start;
    v.pair_role ||= null;
    await act(async () => {
      await api(P(`/scenes/${s.id}`), { method: 'PUT', body: v });
      // Đồng bộ cảnh đôi: B cũng trỏ về A với vai trò ngược lại
      if (v.pair_scene_id) {
        const other = v.pair_role === 'day' ? 'night' : v.pair_role === 'night' ? 'day' : null;
        await api(P(`/scenes/${v.pair_scene_id}`), { method: 'PUT', body: { pair_scene_id: s.id, pair_role: other } });
      }
      if (isStart && D().project.start_scene_id !== s.id) await api(P(''), { method: 'PUT', body: { start_scene_id: s.id } });
    }, 'Đã lưu cảnh');
    await reload(); renderScenes(main);
  });
  $('#delScene').onclick = async () => {
    if (!confirm(`Xoá cảnh “${vi(s.title)}” và toàn bộ hotspot của nó?`)) return;
    await act(() => api(P(`/scenes/${s.id}`), { method: 'DELETE' }), 'Đã xoá cảnh');
    state.sel.scene = null; await reload(); renderScenes(main);
  };
}

// Kéo-thả sắp xếp
function enableDragSort(container, itemSel, onDone) {
  let dragging = null;
  container.addEventListener('dragstart', (e) => { dragging = e.target.closest(itemSel); dragging?.classList.add('dragging'); });
  container.addEventListener('dragend', () => {
    if (!dragging) return; dragging.classList.remove('dragging'); dragging = null;
    onDone($$(itemSel, container).map((el) => Number(el.dataset.id)));
  });
  container.addEventListener('dragover', (e) => {
    if (!dragging) return; e.preventDefault();
    const after = $$(`${itemSel}:not(.dragging)`, container).find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
    after ? after.before(dragging) : container.append(dragging);
  });
}

// ================= NHÓM =================
function renderGroups(main) {
  destroyViewer();
  main.innerHTML = `<div class="card"><div class="col-head"><h2>Nhóm cảnh (menu)</h2><button class="primary sm" id="addGroup">＋ Nhóm</button></div>
    <p class="hint">Mỗi nhóm là một mục trên thanh menu. Nhóm “căn hộ” có thể gắn mặt bằng căn để hiện mini-map. Kéo để sắp xếp.</p>
    <div id="groupList">${D().groups.map((g) => `
      <form class="group-row" draggable="true" data-id="${g.id}">
        <span class="handle">⋮⋮</span>
        ${i18nField('name', 'Tên', g.name)}
        ${select('kind', 'Loại', g.kind, [['overview', 'Toàn cảnh'], ['unit', 'Căn hộ']])}
        ${select('icon', 'Biểu tượng', g.icon, [['city', 'Toà nhà'], ['home', 'Căn hộ']])}
        ${select('floorplan_media_id', 'Mặt bằng căn', g.floorplan_media_id, mediaOptions((m) => m.kind === 'image'), 'data-num')}
        <div class="btns"><span class="hint">${D().scenes.filter((s) => s.group_id === g.id).length} cảnh</span><button class="primary sm">Lưu</button><button type="button" class="danger sm" data-del>Xoá</button></div>
      </form>`).join('')}</div></div>`;
  $('#addGroup').onclick = async () => { await act(() => api(P('/groups'), { method: 'POST', body: { name: { vi: 'Nhóm mới', en: 'New group' }, kind: 'overview', sort: D().groups.length } }), 'Đã thêm nhóm'); await reload(); renderGroups(main); };
  $$('.group-row').forEach((f) => {
    f.addEventListener('submit', async (e) => { e.preventDefault(); await act(() => api(P(`/groups/${f.dataset.id}`), { method: 'PUT', body: readForm(f) }), 'Đã lưu nhóm'); await reload(); });
    $('[data-del]', f).onclick = async () => { if (!confirm('Xoá nhóm? Các cảnh trong nhóm sẽ thành “chưa xếp nhóm”.')) return; await act(() => api(P(`/groups/${f.dataset.id}`), { method: 'DELETE' }), 'Đã xoá'); await reload(); renderGroups(main); };
  });
  enableDragSort($('#groupList'), '.group-row', (ids) => act(() => api(P('/reorder'), { method: 'POST', body: { table: 'groups', ids } }), 'Đã lưu thứ tự').then(reload));
}

// ================= MẶT BẰNG & TIỆN ÍCH (vẽ vùng) =================
function renderPlans(main) {
  destroyViewer();
  const plans = D().plans;
  const plan = plans.find((p) => p.id === state.sel.plan) || plans[0];
  state.sel.plan = plan?.id;
  main.innerHTML = `
  <div class="split">
    <div class="list-col card">
      <div class="col-head"><h2>Bản vẽ</h2><button class="primary sm" id="addPlan">＋ Bản vẽ</button></div>
      <div class="list">${plans.map((p) => `<div class="row ${p.id === plan?.id ? 'on' : ''}" data-id="${p.id}"><img src="${esc(mediaSrc(mediaById(p.image_media_id)))}" alt=""><div><b>${esc(vi(p.name))}</b><small>${{ masterplan: 'Mặt bằng tổng thể', facility: 'Tiện ích', floor: 'Mặt bằng tầng' }[p.kind]} · ${D().areas.filter((a) => a.plan_id === p.id).length} vùng</small></div></div>`).join('')}</div>
    </div>
    <div class="edit-col">${plan ? planEditor(plan) : '<div class="empty card">Chưa có bản vẽ.</div>'}</div>
  </div>`;
  $$('.list .row').forEach((r) => r.addEventListener('click', () => { state.sel.plan = Number(r.dataset.id); state.sel.area = null; renderPlans(main); }));
  $('#addPlan').onclick = () => uploadDialog({ kind: 'image', category: 'plan', title: 'Ảnh bản vẽ mới', accept: 'image/*', onDone: async ([m]) => {
    const p = await act(() => api(P('/plans'), { method: 'POST', body: { kind: 'masterplan', name: m.title, image_media_id: m.id, sort: plans.length } }));
    state.sel.plan = p.id; await reload(); renderPlans(main);
  } });
  if (plan) mountPlanEditor(main, plan);
}

function planEditor(p) {
  const img = mediaById(p.image_media_id);
  const areas = D().areas.filter((a) => a.plan_id === p.id);
  const a = areas.find((x) => x.id === state.sel.area);
  return `
  <form class="card" id="planForm"><div class="col-head"><h2>${esc(vi(p.name))}</h2><button type="button" class="danger sm" id="delPlan">Xoá bản vẽ</button></div>
    <div class="grid3">${select('kind', 'Loại', p.kind, [['masterplan', 'Mặt bằng tổng thể'], ['facility', 'Tiện ích'], ['floor', 'Mặt bằng tầng']])}
    ${select('image_media_id', 'Ảnh', p.image_media_id, mediaOptions((m) => m.kind === 'image'), 'data-num')}</div>
    ${i18nField('name', 'Tên', p.name)}<div class="btns"><button class="primary sm">Lưu bản vẽ</button></div></form>
  <div class="card">
    <div class="pano-tools"><button class="sm" data-tool="polygon">⬠ Vẽ vùng (đa giác)</button><button class="sm" data-tool="point">● Thêm điểm</button>
      ${a ? '<button class="sm" data-tool="redraw">↺ Vẽ lại vùng đang chọn</button>' : ''}
      <span class="hint" id="planHint">Bấm để đặt đỉnh; bấm lại đỉnh đầu, nhấp đúp hoặc Enter để khép vùng; Esc để huỷ. Kéo các đỉnh để chỉnh.</span></div>
    <div class="plan-ed" id="planEd" style="aspect-ratio:${img?.meta?.width && img?.meta?.height ? img.meta.width / img.meta.height : 1.6}">
      ${img ? `<img src="/media/${esc(img.file)}" alt="" draggable="false">` : ''}
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" id="planSvg"></svg>
    </div>
    <div class="hs-list">${areas.map((x, i) => `<button class="chip ${x.id === a?.id ? 'on' : ''}" data-a="${x.id}">${x.shape === 'point' ? '●' : '⬠'} ${esc(vi(x.label) || '#' + (i + 1))}</button>`).join('') || '<span class="hint">Chưa có vùng nào.</span>'}</div>
    ${a ? `<form class="hs-form" id="areaForm">
      ${i18nField('label', 'Tên vùng', a.label || {})}
      ${i18nField('description', 'Mô tả (hiện khi bấm)', a.description || {}, { area: true })}
      <div class="grid3">
        ${select('action.type', 'Khi bấm', a.action?.type || 'none', [['none', 'Hiện popup thông tin'], ['image', 'Popup có ảnh'], ['scene', 'Mở cảnh 360°'], ['plan', 'Mở bản vẽ khác']])}
        ${select('action.target', 'Đích', a.action?.target ?? '', [['', '—'], ...D().scenes.map((s) => [s.slug, '360° · ' + vi(s.title)]), ...D().plans.filter((x) => x.id !== p.id).map((x) => [x.id, 'Bản vẽ · ' + vi(x.name)])])}
        ${select('media_id', 'Ảnh minh hoạ', a.media_id, mediaOptions((m) => m.kind === 'image'), 'data-num')}
      </div>
      <div class="btns"><button type="button" class="danger sm" id="areaDel">Xoá vùng</button><button class="primary sm">Lưu vùng</button></div></form>` : ''}
  </div>`;
}

function mountPlanEditor(main, p) {
  const svg = $('#planSvg'), ed = $('#planEd');
  let tool = null, draft = [];
  const areas = () => D().areas.filter((a) => a.plan_id === p.id);
  const ptFromEvent = (e) => { const r = ed.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]; };
  const ar = ed.getBoundingClientRect().width / ed.getBoundingClientRect().height || 1.6;
  const rx = 0.008, ry = 0.008 * ar; // bán kính điểm theo tỉ lệ ảnh để hiển thị tròn

  function draw() {
    svg.innerHTML = areas().map((a) => a.shape === 'polygon'
      ? `<polygon class="ar ${a.id === state.sel.area ? 'sel' : ''}" data-a="${a.id}" points="${a.points.map((q) => q.join(',')).join(' ')}"/>`
      : `<ellipse class="ar pt ${a.id === state.sel.area ? 'sel' : ''}" data-a="${a.id}" cx="${a.points[0][0]}" cy="${a.points[0][1]}" rx="${rx * 1.4}" ry="${ry * 1.4}"/>`).join('')
      + (draft.length ? `<polyline class="draft" points="${draft.map((q) => q.join(',')).join(' ')}"/>${draft.map((q, i) => `<ellipse class="vx ${i === 0 ? 'first' : ''}" cx="${q[0]}" cy="${q[1]}" rx="${rx}" ry="${ry}"/>`).join('')}` : '')
      + (!tool && state.sel.area ? (() => { const a = areas().find((x) => x.id === state.sel.area); return a?.shape === 'polygon' ? a.points.map((q, i) => `<ellipse class="vx handle" data-i="${i}" cx="${q[0]}" cy="${q[1]}" rx="${rx}" ry="${ry}"/>`).join('') : ''; })() : '');
  }
  const setTool = (t) => { tool = t; draft = []; $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); ed.classList.toggle('crosshair', !!t); draw(); };

  async function finish() {
    if (draft.length < 3) return toast('Vùng cần ít nhất 3 đỉnh', true);
    const points = draft; const wasRedraw = tool === 'redraw'; setTool(null);
    if (wasRedraw) await act(() => api(P(`/plan_areas/${state.sel.area}`), { method: 'PUT', body: { points } }), 'Đã cập nhật vùng');
    else { const a = await act(() => api(P('/plan_areas'), { method: 'POST', body: { plan_id: p.id, shape: 'polygon', points, label: { vi: '', en: '' }, sort: areas().length } }), 'Đã tạo vùng'); state.sel.area = a.id; }
    await reload(); renderPlans(main);
  }

  ed.addEventListener('click', async (e) => {
    if (dragInfo?.moved) return;
    const pt = ptFromEvent(e);
    if (tool === 'point') {
      setTool(null);
      const a = await act(() => api(P('/plan_areas'), { method: 'POST', body: { plan_id: p.id, shape: 'point', points: [pt], label: { vi: '', en: '' }, action: { type: 'image' }, sort: areas().length } }), 'Đã thêm điểm');
      state.sel.area = a.id; await reload(); return renderPlans(main);
    }
    if (tool === 'polygon' || tool === 'redraw') {
      const first = draft[0];
      if (first && draft.length >= 3 && Math.hypot(first[0] - pt[0], (first[1] - pt[1]) / ar) < 0.015) return finish();
      draft.push(pt); return draw();
    }
    const id = Number(e.target.dataset?.a);
    if (id) { state.sel.area = id; renderPlans(main); }
  });
  ed.addEventListener('dblclick', (e) => { if (tool === 'polygon' || tool === 'redraw') { e.preventDefault(); draft.pop(); finish(); } });
  const onKey = (e) => {
    if (!document.body.contains(ed)) return removeEventListener('keydown', onKey);
    if (e.key === 'Escape') setTool(null);
    if (e.key === 'Enter' && draft.length) finish();
    if (e.key === 'Backspace' && draft.length && e.target === document.body) { draft.pop(); draw(); }
  };
  addEventListener('keydown', onKey);

  // Kéo đỉnh để chỉnh polygon / kéo điểm
  let dragInfo = null;
  svg.addEventListener('pointerdown', (e) => {
    if (tool) return;
    const a = areas().find((x) => x.id === state.sel.area); if (!a) return;
    if (e.target.classList.contains('handle')) dragInfo = { a, i: Number(e.target.dataset.i), moved: false };
    else if (a.shape === 'point' && Number(e.target.dataset.a) === a.id) dragInfo = { a, i: 0, moved: false };
    if (dragInfo) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragInfo) return;
    dragInfo.moved = true; dragInfo.a.points[dragInfo.i] = ptFromEvent(e); draw();
  });
  svg.addEventListener('pointerup', async () => {
    if (!dragInfo) return;
    const { a, moved } = dragInfo;
    if (moved) await act(() => api(P(`/plan_areas/${a.id}`), { method: 'PUT', body: { points: a.points } }), 'Đã cập nhật toạ độ');
    setTimeout(() => (dragInfo = null), 0);
  });

  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(tool === b.dataset.tool ? null : b.dataset.tool)));
  $$('[data-a].chip').forEach((b) => b.addEventListener('click', () => { state.sel.area = Number(b.dataset.a); renderPlans(main); }));
  draw();

  $('#planForm').addEventListener('submit', async (e) => { e.preventDefault(); await act(() => api(P(`/plans/${p.id}`), { method: 'PUT', body: readForm(e.target) }), 'Đã lưu'); await reload(); renderPlans(main); });
  $('#delPlan').onclick = async () => { if (!confirm('Xoá bản vẽ và mọi vùng?')) return; await act(() => api(P(`/plans/${p.id}`), { method: 'DELETE' }), 'Đã xoá'); state.sel.plan = null; await reload(); renderPlans(main); };
  const af = $('#areaForm');
  if (af) {
    af.addEventListener('submit', async (e) => {
      e.preventDefault(); const v = readForm(af);
      await act(() => api(P(`/plan_areas/${state.sel.area}`), { method: 'PUT', body: v }), 'Đã lưu vùng'); await reload(); renderPlans(main);
    });
    $('#areaDel').onclick = async () => { await act(() => api(P(`/plan_areas/${state.sel.area}`), { method: 'DELETE' }), 'Đã xoá vùng'); state.sel.area = null; await reload(); renderPlans(main); };
  }
}

// ================= MEDIA =================
const CATS = [['gallery', 'Thư viện ảnh'], ['video', 'Video'], ['document', 'Tài liệu'], ['legal', 'Pháp lý'], ['pano', 'Ảnh 360°'], ['plan', 'Bản vẽ'], ['floorplan', 'Mặt bằng căn'], ['facility', 'Ảnh tiện ích'], ['audio', 'Âm thanh'], ['brand', 'Logo / thương hiệu']];
function renderMedia(main) {
  destroyViewer();
  const cat = state.sel.cat || 'gallery';
  const items = D().media.filter((m) => (m.category || 'gallery') === cat);
  const upl = { gallery: ['image', 'image/*'], video: ['video'], document: ['pdf', 'application/pdf'], legal: ['pdf', 'application/pdf'], pano: ['pano', 'image/*'], plan: ['image', 'image/*'], floorplan: ['image', 'image/*'], facility: ['image', 'image/*'], audio: ['audio', 'audio/*'], brand: ['image', 'image/*'] }[cat];
  main.innerHTML = `<div class="card"><div class="col-head"><h2>Thư viện media</h2><button class="primary sm" id="upl">＋ Tải lên</button></div>
    <div class="tabs">${CATS.map(([k, t]) => `<button class="${k === cat ? 'on' : ''}" data-c="${k}">${t} <small>${D().media.filter((m) => (m.category || 'gallery') === k).length}</small></button>`).join('')}</div>
    <p class="hint">${['gallery', 'video', 'document', 'legal'].includes(cat) ? 'Các mục này hiển thị trong trang “Thư viện” của tour. Kéo để sắp xếp.' : 'Dùng để gắn vào cảnh, nhóm, bản vẽ hoặc cài đặt.'}</p>
    <div class="media-grid" id="mediaGrid">${items.map((m) => `
      <form class="media-item" draggable="true" data-id="${m.id}">
        <div class="thumb">${m.kind === 'pdf' ? '<span class="big">PDF</span>' : m.kind === 'audio' ? '<span class="big">♪</span>' : m.kind === 'video' ? `<img src="https://i.ytimg.com/vi/${esc((m.url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/) || [])[1])}/mqdefault.jpg" alt="">` : `<img src="${esc(mediaSrc(m))}" alt="" loading="lazy">`}</div>
        <input name="title.vi" value="${esc(m.title?.vi)}" placeholder="Tiêu đề VI"><input name="title.en" value="${esc(m.title?.en)}" placeholder="Tiêu đề EN">
        <div class="btns"><small>#${m.id}</small><a class="ghost sm" href="${esc(m.url || (m.kind === 'pano' ? `/media/${m.file}/base.jpg` : `/media/${m.file}`))}" target="_blank" rel="noopener">Mở</a><button class="primary sm">Lưu</button><button type="button" class="danger sm" data-del>Xoá</button></div>
      </form>`).join('') || '<div class="empty">Chưa có mục nào.</div>'}</div></div>`;
  $$('.tabs [data-c]').forEach((b) => b.addEventListener('click', () => { state.sel.cat = b.dataset.c; renderMedia(main); }));
  $('#upl').onclick = () => uploadDialog({ kind: upl[0], category: cat, accept: upl[1], onDone: () => renderMedia(main) });
  $$('.media-item').forEach((f) => {
    f.addEventListener('submit', async (e) => { e.preventDefault(); await act(() => api(P(`/media/${f.dataset.id}`), { method: 'PUT', body: readForm(f) }), 'Đã lưu'); await reload(); });
    $('[data-del]', f).onclick = async () => {
      const used = D().scenes.some((s) => s.pano_media_id === Number(f.dataset.id));
      if (!confirm(used ? 'File này đang được một cảnh sử dụng. Vẫn xoá?' : 'Xoá file này?')) return;
      await act(() => api(P(`/media/${f.dataset.id}`), { method: 'DELETE' }), 'Đã xoá'); await reload(); renderMedia(main);
    };
  });
  enableDragSort($('#mediaGrid'), '.media-item', (ids) => act(() => api(P('/reorder'), { method: 'POST', body: { table: 'media', ids } }), 'Đã lưu thứ tự').then(reload));
}

// ================= LEADS =================
async function renderLeads(main) {
  destroyViewer();
  main.innerHTML = '<div class="card"><div class="empty">Đang tải...</div></div>';
  const leads = await api(P('/leads'));
  const ST = [['new', 'Mới'], ['contacted', 'Đã liên hệ'], ['qualified', 'Tiềm năng'], ['closed', 'Đã chốt / đóng']];
  const filter = state.sel.leadStatus || '';
  const rows = leads.filter((l) => !filter || l.status === filter);
  main.innerHTML = `<div class="card"><div class="col-head"><h2>Khách hàng đăng ký (${leads.length})</h2>
    <div class="btns">${select('f', '', filter, [['', 'Tất cả trạng thái'], ...ST]).replace('<div class="field"><label></label>', '').replace(/<\/div>$/, '')}<a class="primary sm" href="/api/admin${P('/leads.csv')}">⬇ Xuất CSV (Excel)</a></div></div>
    <div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Họ tên</th><th>Điện thoại</th><th>Email</th><th>Quan tâm</th><th>Lời nhắn</th><th>Cảnh</th><th>Trạng thái</th><th>CRM</th></tr></thead>
    <tbody>${rows.map((l) => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.name)}</td><td><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></td><td>${esc(l.email)}</td><td>${esc(l.interest)}</td><td class="note">${esc(l.note)}</td><td>${esc(l.scene_slug || l.source)}</td>
      <td><select data-lead="${l.id}">${ST.map(([v, t]) => `<option value="${v}" ${v === l.status ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td><small>${esc(l.webhook_status || '—')}</small></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có lead.</td></tr>'}</tbody></table></div></div>`;
  $('select[name=f]').onchange = (e) => { state.sel.leadStatus = e.target.value; renderLeads(main); };
  $$('[data-lead]').forEach((s) => s.addEventListener('change', () => act(() => api(P(`/leads/${s.dataset.lead}`), { method: 'PUT', body: { status: s.value } }), 'Đã cập nhật')));
}

// ================= THỐNG KÊ =================
async function renderStats(main) {
  destroyViewer();
  const days = state.sel.days || 30;
  const st = await api(P(`/stats?days=${days}`));
  const tot = Object.fromEntries(st.totals.map((t) => [t.type, t]));
  const visits = tot.view?.sessions || 0, leads = tot.lead?.n || 0;
  const maxD = Math.max(1, ...st.daily.map((d) => d.sessions));
  const maxS = Math.max(1, ...st.scenes.map((s) => s.n));
  main.innerHTML = `<div class="card"><div class="col-head"><h2>Thống kê</h2>${select('days', '', days, [[7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày'], [365, '1 năm']]).replace('<div class="field"><label></label>', '').replace(/<\/div>$/, '')}</div>
    <div class="kpis">
      <div><b>${visits}</b><span>Lượt truy cập</span></div><div><b>${tot.scene?.n || 0}</b><span>Lượt xem cảnh</span></div>
      <div><b>${(tot.hotspot?.n || 0) + (tot.plan?.n || 0)}</b><span>Tương tác hotspot / mặt bằng</span></div>
      <div><b>${leads}</b><span>Lead</span></div><div><b>${visits ? ((leads / visits) * 100).toFixed(1) : 0}%</b><span>Tỉ lệ chuyển đổi</span></div>
    </div>
    <h3>Truy cập theo ngày</h3>
    <div class="bars">${st.daily.map((d) => `<div title="${esc(d.d)}: ${d.sessions} lượt, ${d.leads} lead"><i style="height:${(d.sessions / maxD) * 100}%"></i><small>${esc(d.d.slice(5))}</small></div>`).join('') || '<div class="empty">Chưa có dữ liệu.</div>'}</div>
    <div class="grid2"><div><h3>Cảnh được xem nhiều</h3>${st.scenes.map((s) => `<div class="hbar"><span>${esc(vi(s.title))}</span><i style="width:${(s.n / maxS) * 100}%"></i><b>${s.n}</b></div>`).join('')}</div>
    <div><h3>Tương tác nhiều nhất</h3>${st.hotspots.map((h) => `<div class="hbar"><span>${esc(h.ref)}</span><b>${h.n}</b></div>`).join('') || '<div class="hint">Chưa có.</div>'}</div></div></div>`;
  $('select[name=days]').onchange = (e) => { state.sel.days = Number(e.target.value); renderStats(main); };
}

// ================= CÀI ĐẶT =================
function renderSettings(main) {
  destroyViewer();
  const p = D().project, s = p.settings || {}, f = s.features || {};
  const FEAT = [['autorotate', 'Tự xoay'], ['compass', 'La bàn'], ['daynight', 'Công tắc ngày/đêm'], ['sound', 'Nhạc nền'], ['vr', 'Kính VR (mobile)'], ['gyroscope', 'Cảm biến xoay (mobile)'], ['share', 'Chia sẻ'], ['lead_form', 'Form nhận báo giá'], ['floorplan', 'Mini-map mặt bằng căn'], ['weather', 'Thời tiết'], ['disclaimer', 'Dòng miễn trừ'], ['help', 'Hướng dẫn']];
  main.innerHTML = `<form class="card" id="setForm">
    <div class="col-head"><h2>Cài đặt dự án</h2><button class="primary">Lưu cài đặt</button></div>
    <h3>Chung</h3>
    ${i18nField('name', 'Tên dự án', p.name)}${i18nField('description', 'Mô tả (SEO)', p.description || {}, { area: true })}
    <div class="grid3">${field('slug', 'Slug URL', p.slug, 'text', 'pattern="[a-z0-9-]{2,60}"')}
      ${select('start_scene_id', 'Cảnh mở đầu', p.start_scene_id, D().scenes.map((x) => [x.id, vi(x.title)]), 'data-num')}
      ${select('settings.start_language', 'Ngôn ngữ mặc định', s.start_language, [['vi', 'Tiếng Việt'], ['en', 'English']])}
      ${select('settings.layout', 'Kiểu giao diện', s.layout || 'topnav', [['topnav', 'Menu ngang (trên cùng)'], ['rail', 'Thanh dọc bên trái']])}</div>
    <h3>Thương hiệu</h3>
    <div class="grid3">${field('settings.logo_text', 'Chữ logo (khi không có ảnh)', s.logo_text)}
      ${select('settings.logo_media_id', 'Ảnh logo', s.logo_media_id, mediaOptions((m) => m.kind === 'image'), 'data-num')}
      ${select('settings.bg_sound_media_id', 'Nhạc nền', s.bg_sound_media_id, mediaOptions((m) => m.kind === 'audio'), 'data-num')}
      ${field('settings.theme_color', 'Màu chủ đạo', s.theme_color, 'color')}${field('settings.accent', 'Màu nhấn', s.accent, 'color')}</div>
    ${i18nField('settings.disclaimer', 'Dòng miễn trừ trách nhiệm', s.disclaimer || {})}
    <h3>Liên hệ & chuyển đổi</h3>
    <div class="grid3">${field('settings.hotline', 'Hotline', s.hotline, 'tel')}${field('settings.zalo', 'Số Zalo', s.zalo)}${field('settings.messenger', 'Facebook page (username cho m.me)', s.messenger)}
      ${field('settings.website', 'Website', s.website, 'url')}${field('settings.facebook', 'Facebook', s.facebook, 'url')}${field('settings.youtube', 'YouTube', s.youtube, 'url')}</div>
    <div class="grid3">${field('settings.webhook', 'Webhook CRM (https) — nhận lead mới dạng JSON', s.webhook, 'url', 'placeholder="https://..."')}
      ${field('settings.ga4_id', 'Google Analytics 4 ID', s.ga4_id, 'text', 'placeholder="G-XXXXXXX"')}
      ${field('settings.weather_api_key', 'OpenWeatherMap API key (chỉ lưu ở server)', s.weather_api_key, 'password', 'autocomplete="off"')}</div>
    <h3>Vị trí</h3>
    <div class="grid3">${field('settings.location.lat', 'Vĩ độ', s.location?.lat, 'number', 'step="any"')}${field('settings.location.lng', 'Kinh độ', s.location?.lng, 'number', 'step="any"')}${field('settings.location.city', 'Tên khu vực (thời tiết)', s.location?.city)}</div>
    ${field('settings.location.map_embed', 'Link nhúng Google Maps (tuỳ chọn, dạng https://www.google.com/maps/embed?...) — để trống sẽ dùng OpenStreetMap', s.location?.map_embed, 'url')}
    ${i18nField('settings.location.address', 'Địa chỉ', s.location?.address || {})}
    ${i18nField('settings.location.content', 'Nội dung trang Vị trí', s.location?.content || {}, { area: true })}
    <h3>Tính năng (bật/tắt — không cần sửa code)</h3>
    <div class="feat">${FEAT.map(([k, t]) => check(`settings.features.${k}`, t, f[k] ?? true)).join('')}</div>
    <div class="btns"><button class="primary">Lưu cài đặt</button></div>
  </form>`;
  $('#setForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readForm(e.target);
    v.settings = { ...s, ...v.settings, location: { ...s.location, ...v.settings.location }, features: { ...f, ...v.settings.features } };
    await act(() => api(P(''), { method: 'PUT', body: v }), 'Đã lưu cài đặt');
    await loadProjects(); render();
  });
}

// ================= NGƯỜI DÙNG =================
async function renderUsers(main) {
  destroyViewer();
  const users = await api('/users');
  const R = [['admin', 'Quản trị (toàn quyền)'], ['editor', 'Biên tập (sửa nội dung)'], ['sales', 'Kinh doanh (xem lead, thống kê)']];
  main.innerHTML = `<div class="card"><h2>Người dùng</h2>
    <table><thead><tr><th>Email</th><th>Tên</th><th>Vai trò</th><th>Tạo lúc</th><th></th></tr></thead><tbody>
    ${users.map((x) => `<tr><td>${esc(x.email)}</td><td>${esc(x.name)}</td><td>${esc(R.find((r) => r[0] === x.role)?.[1])}</td><td>${esc(x.created_at)}</td><td>${x.id !== state.user.id ? `<button class="danger sm" data-del="${x.id}">Xoá</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <h3>Thêm người dùng</h3><form id="userForm" class="grid3">${field('email', 'Email', '', 'email', 'required')}${field('name', 'Tên', '')}${select('role', 'Vai trò', 'editor', R)}${field('password', 'Mật khẩu (≥8)', '', 'password', 'required minlength="8"')}<div class="btns"><button class="primary">Thêm</button></div></form></div>`;
  $('#userForm').addEventListener('submit', async (e) => { e.preventDefault(); await act(() => api('/users', { method: 'POST', body: readForm(e.target) }), 'Đã thêm'); renderUsers(main); });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Xoá người dùng?')) return; await act(() => api(`/users/${b.dataset.del}`, { method: 'DELETE' }), 'Đã xoá'); renderUsers(main); }));
}

boot();
