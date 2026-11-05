// Trình xem tour 360° — một trang duy nhất, dữ liệu từ window.__TOUR__ (nhúng sẵn bởi server).
// Không jQuery; engine mã nguồn mở Photo Sphere Viewer (không cần bản quyền theo tên miền).
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { AutorotatePlugin } from '@photo-sphere-viewer/autorotate-plugin';
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin';
import { StereoPlugin } from '@photo-sphere-viewer/stereo-plugin';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';

const T = window.__TOUR__;
const R = window.__ROUTE__ || {};
const S = T.settings || {};
const F = { autorotate: true, compass: true, daynight: true, sound: true, vr: true, gyroscope: true, share: true, lead_form: true, floorplan: true, help: true, disclaimer: true, ...(S.features || {}) };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sceneBySlug = new Map(T.scenes.map((s) => [s.slug, s]));
const groupById = new Map(T.groups.map((g) => [g.id, g]));
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------------- i18n ----------------
let lang = R.lang || S.start_language || 'vi';
const UI = {
  vi: { cta: 'Nhận báo giá', units: 'Căn hộ mẫu', location: 'Vị trí', plan: 'Mặt bằng', facilities: 'Tiện ích', gallery: 'Thư viện', minutes: 'phút',
    autorotate: 'Tự xoay', autotour: 'Tham quan tự động', sound: 'Nhạc nền', fullscreen: 'Toàn màn hình', vr: 'Kính VR', gyro: 'Cảm biến xoay',
    share: 'Chia sẻ', help: 'Hướng dẫn', zoomIn: 'Phóng to', zoomOut: 'Thu nhỏ', images: 'Hình ảnh', videos: 'Video', documents: 'Tài liệu', legal: 'Pháp lý',
    name: 'Họ và tên', phone: 'Số điện thoại', email: 'Email (không bắt buộc)', interest: 'Quan tâm', other: 'Khác', note: 'Lời nhắn',
    send: 'Gửi thông tin', sent: 'Cảm ơn bạn! Chúng tôi sẽ liên hệ sớm.', leadTitle: 'Đăng ký nhận thông tin', leadSub: 'Để lại thông tin, chuyên viên tư vấn sẽ gửi bảng giá & chính sách mới nhất.',
    copy: 'Sao chép link', copied: 'Đã sao chép link', call: 'Gọi', open: 'Mở', download: 'Tải về', nearby: 'Kết nối khu vực', floorplan: 'Mặt bằng căn',
    helpBody: '<p><b>Kéo</b> chuột hoặc vuốt để nhìn xung quanh, <b>cuộn</b> hoặc chụm 2 ngón để phóng to.</p><p>Bấm vào <b>điểm tròn</b> để di chuyển, <b>biểu tượng</b> để xem thông tin.</p><p>Dùng menu bên trái để chuyển khu vực, xem vị trí, mặt bằng, tiện ích và thư viện.</p>',
    error: 'Có lỗi xảy ra, vui lòng thử lại.', back: 'Quay lại tour' },
  en: { cta: 'Get a quote', units: 'Show units', location: 'Location', plan: 'Masterplan', facilities: 'Facilities', gallery: 'Gallery', minutes: 'min',
    autorotate: 'Auto-rotate', autotour: 'Auto tour', sound: 'Music', fullscreen: 'Fullscreen', vr: 'VR headset', gyro: 'Gyroscope',
    share: 'Share', help: 'Help', zoomIn: 'Zoom in', zoomOut: 'Zoom out', images: 'Images', videos: 'Videos', documents: 'Documents', legal: 'Legal',
    name: 'Full name', phone: 'Phone number', email: 'Email (optional)', interest: 'Interested in', other: 'Other', note: 'Message',
    send: 'Send', sent: 'Thank you! We will contact you shortly.', leadTitle: 'Request information', leadSub: 'Leave your details and our consultant will send the latest price list.',
    copy: 'Copy link', copied: 'Link copied', call: 'Call', open: 'Open', download: 'Download', nearby: 'Connectivity', floorplan: 'Unit floorplan',
    helpBody: '<p><b>Drag</b> or swipe to look around, <b>scroll</b> or pinch to zoom.</p><p>Click <b>circles</b> to move, <b>icons</b> for information.</p><p>Use the left menu to switch areas, view location, masterplan, facilities and gallery.</p>',
    error: 'Something went wrong, please try again.', back: 'Back to tour' },
};
const u = (k) => UI[lang]?.[k] ?? UI.vi[k] ?? k;
const tr = (v) => (v && typeof v === 'object' ? v[lang] || v.vi || '' : v || '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- Icons (SVG nội tuyến) ----------------
const I = {
  city: '<path d="M3 21V9l6-3v15M9 21V3l8 4v14M17 21v-9l4 2v7M2 21h20"/>',
  home: '<path d="M3 11l9-7 9 7M5 10v11h14V10M10 21v-6h4v6"/>',
  pin: '<path d="M12 22s7-7.5 7-12a7 7 0 10-14 0c0 4.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  plan: '<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  rotate: '<path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  vr: '<rect x="2" y="7" width="20" height="11" rx="3"/><circle cx="8" cy="12.5" r="2"/><circle cx="16" cy="12.5" r="2"/>',
  gyro: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 006 6L16 13l5 2v4a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M21 16l-5-5-8 8"/>',
  doc: '<path d="M6 2h9l5 5v15H6zM14 2v6h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  fb: '<path d="M14 8h3V4h-3a4 4 0 00-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8z"/>',
  yt: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.info}</svg>`;

// ---------------- Theme ----------------
document.documentElement.style.setProperty('--brand', S.theme_color || '#0b2a40');
document.documentElement.style.setProperty('--accent', S.accent || '#e8b04b');

// ---------------- Analytics (gom lô, gửi bằng sendBeacon) ----------------
let session = '';
try { session = sessionStorage.getItem('vt_s') || crypto.randomUUID().slice(0, 18); sessionStorage.setItem('vt_s', session); } catch { session = Math.random().toString(36).slice(2); }
const queue = [];
function track(type, ref, scene = current?.slug) {
  queue.push({ type, ref, scene, session });
  if (window.gtag) window.gtag('event', `tour_${type}`, { ref, scene });
  if (queue.length >= 20) flush();
}
function flush() {
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0));
  const url = `/api/tour/${T.slug}/events`;
  if (!navigator.sendBeacon?.(url, body)) fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
}
setInterval(flush, 10000);
addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

// ---------------- Viewer ----------------
let current = null;
const tileCfg = (p) => ({
  width: p.width, cols: p.cols, rows: p.rows, baseUrl: p.base,
  tileUrl: (col, row) => `${p.tiles}${col}_${row}.jpg`,
});
const deg = (d) => `${d}deg`;

const startSlug = R.scene || T.startScene;
const startScene = sceneBySlug.get(startSlug) || T.scenes[0];
const qp = new URLSearchParams(location.search);
const sharedView = (qp.get('v') || '').split(',').map(Number); // ?v=yaw,pitch,zoom — chia sẻ đúng góc nhìn

const plugins = [
  [MarkersPlugin, { defaultHoverScale: true }],
  [AutorotatePlugin, { autostartDelay: F.autorotate ? 4000 : null, autostartOnIdle: F.autorotate, autorotateSpeed: '1rpm', autorotatePitch: null }],
];
if (isTouch && (F.gyroscope || F.vr)) plugins.push([GyroscopePlugin, {}]);
if (isTouch && F.vr) plugins.push([StereoPlugin, {}]);

const viewer = new Viewer({
  container: $('#pano'),
  adapter: [EquirectangularTilesAdapter, { showErrorTile: false, baseBlur: true }],
  panorama: startScene?.pano ? tileCfg(startScene.pano) : null,
  defaultYaw: deg(sharedView.length === 3 ? sharedView[0] : startScene?.view.yaw || 0),
  defaultPitch: deg(sharedView.length === 3 ? sharedView[1] : startScene?.view.pitch || 0),
  defaultZoomLvl: sharedView.length === 3 ? sharedView[2] : startScene?.view.zoom ?? 40,
  navbar: false, loadingTxt: '', mousewheelCtrlKey: false, touchmoveTwoFingers: false,
  plugins,
});
const markers = viewer.getPlugin(MarkersPlugin);
const autorotate = viewer.getPlugin(AutorotatePlugin);
const gyro = isTouch ? viewer.getPlugin(GyroscopePlugin) : null;
const stereo = isTouch && F.vr ? viewer.getPlugin(StereoPlugin) : null;

viewer.addEventListener('ready', () => { $('#loader').classList.add('done'); updateCompass(viewer.getPosition().yaw); }, { once: true });
viewer.addEventListener('position-updated', ({ position }) => updateCompass(position.yaw));
viewer.addEventListener('panorama-error', () => toast(u('error')));

function markerFor(h) {
  const label = esc(tr(h.label));
  const base = { id: `h${h.id}`, position: { yaw: deg(h.yaw), pitch: deg(h.pitch) }, data: { h } };
  if (h.type === 'link') {
    return { ...base, html: `<button class="hs hs-link" aria-label="${label}"><span class="hs-ring"></span>${label ? `<span class="hs-label">${label}</span>` : ''}</button>`, anchor: 'center center', size: { width: 56, height: 56 } };
  }
  if (h.type === 'poi') {
    const mins = h.meta?.travel ? `<small>${esc(h.meta.travel)} ${u('minutes')}</small>` : '';
    return { ...base, html: `<div class="hs hs-poi" style="--line:${Number(h.meta?.line) || 70}px"><div class="poi-card"><b>${label}</b>${mins}</div><div class="poi-line"></div><div class="poi-dot"></div></div>`, anchor: 'bottom center' };
  }
  const ic = { info: 'info', video: 'video', image: 'image' }[h.type] || 'info';
  return { ...base, html: `<button class="hs hs-icon" aria-label="${label}">${icon(ic)}</button>`, anchor: 'center center', tooltip: label ? { content: label, position: 'top center' } : undefined };
}

markers.addEventListener('select-marker', ({ marker }) => {
  const h = marker.data?.h; if (!h) return;
  track('hotspot', `${h.type}:${h.id}`);
  if (h.type === 'link' && h.target) return goScene(h.target);
  if (h.type === 'info') return openModal(`<h2>${esc(tr(h.label))}</h2><div class="rich">${esc(tr(h.meta?.body)).replace(/\n/g, '<br>')}</div>`);
  if (h.type === 'video') return openVideo(h.meta?.url);
  if (h.type === 'image' && h.media) return openModal(`<img class="modal-img" src="${esc(h.media)}" alt="${esc(tr(h.label))}"><p>${esc(tr(h.meta?.body))}</p>`, 'wide');
});

async function goScene(slug, { push = true, keepView = false, view } = {}) {
  const sc = sceneBySlug.get(slug);
  if (!sc || !sc.pano) return;
  closeView(false);
  const pos = viewer.getPosition();
  const same = current?.slug === slug;
  const prev = current;
  current = sc;
  renderSceneUI();
  if (push) history.pushState({ scene: slug }, '', urlFor(slug));
  document.title = `${tr(sc.title)} – ${tr(T.name)}`;
  track('scene', slug, slug);
  if (same) return;
  markers.clearMarkers();
  const options = keepView
    ? { position: { yaw: pos.yaw, pitch: pos.pitch }, zoom: viewer.getZoomLevel(), transition: 'fade-only', speed: 900 }
    : { position: { yaw: deg(view?.yaw ?? sc.view.yaw), pitch: deg(view?.pitch ?? sc.view.pitch) }, zoom: view?.zoom ?? sc.view.zoom, transition: true, speed: 1200 };
  try {
    if (prev) await viewer.setPanorama(tileCfg(sc.pano), options);
    markers.setMarkers(sc.hotspots.map(markerFor));
  } catch (e) { if (!String(e?.message).includes('abort')) console.warn(e); }
  playSceneSound();
}

function urlFor(slug, extra = '') {
  const q = new URLSearchParams(); if (lang !== (S.start_language || 'vi')) q.set('lang', lang);
  if (extra) q.set('v', extra);
  const s = q.toString();
  return `/${T.slug}${slug ? '/' + slug : ''}${s ? '?' + s : ''}`;
}

// ---------------- Rail + drawer ----------------
const VIEWS = [
  ['location', 'pin', 'vi-tri', () => S.location?.content || S.location?.lat != null],
  ['plan', 'plan', 'mat-bang', () => T.plans.some((p) => p.kind === 'masterplan')],
  ['facilities', 'star', 'tien-ich', () => T.plans.some((p) => p.kind === 'facility')],
  ['gallery', 'photo', 'thu-vien', () => T.library.length > 0],
];
const SLUG_TO_VIEW = Object.fromEntries(VIEWS.map(([k, , s]) => [s, k]));

// ---- Kiểu giao diện "menu ngang" (topnav): menu trên cùng có menu con + ảnh xem trước ----
// dock (mặc định): menu nổi ở đáy; topnav: menu ngang trên cùng; rail: thanh dọc trái
const LAYOUT = ['rail', 'topnav'].includes(S.layout) ? S.layout : 'dock';
const MENU_TOP = LAYOUT === 'topnav' || LAYOUT === 'dock'; // hai kiểu dùng chung markup menu
document.body.classList.add(`layout-${LAYOUT}`);
if (LAYOUT === 'dock') {
  // Thanh công cụ dọc bên phải: mạng xã hội + liên hệ + điều khiển
  const tb = $('#toolbar'); tb.hidden = false;
  tb.append($('#social'), $('#quick'), $('#controls'));
}

function renderTopnav() {
  const rail = $('#rail');
  const overview = T.groups.filter((g) => g.kind !== 'unit' && g.scenes.length);
  const units = T.groups.filter((g) => g.kind === 'unit' && g.scenes.length);
  const sub = (entries) => `<div class="tn-sub"><div class="tn-sub-list">${entries.map(([slug, label]) =>
    `<button class="tn-sub-item" data-scene="${esc(slug)}">${esc(label)}</button>`).join('')}</div>
    <div class="tn-sub-thumb"><img alt="" src="${esc(sceneBySlug.get(entries[0][0])?.pano?.thumb || '')}"><span>${esc(entries[0][1])}</span></div></div>`;
  let html = overview.map((g) => `<div class="tn-item" data-group="${g.id}">
      <button class="tn-link"><span>${esc(tr(g.name))}</span>${icon('city')}</button>
      ${sub(g.scenes.map((s) => [s, tr(sceneBySlug.get(s).title)]))}</div>`).join('');
  if (units.length) {
    html += `<div class="tn-item" data-units="${units.map((g) => g.id).join(',')}">
      <button class="tn-link"><span>${u('units')}</span>${icon('home')}</button>
      ${sub(units.map((g) => [g.scenes[0], tr(g.name)]))}</div>`;
  }
  html += VIEWS.filter(([, , , ok]) => ok()).map(([k, ic]) => `<div class="tn-item"><button class="tn-link" data-view="${k}"><span>${u(k)}</span>${icon(ic)}</button></div>`).join('');
  if (LAYOUT === 'dock') {
    const brandHtml = S.logo_url ? `<img src="${esc(S.logo_url)}" alt="${esc(tr(T.name))}">` : `<span>${esc(S.logo_text || tr(T.name))}</span>`;
    html = `<a class="dock-brand" href="/${esc(T.slug)}" data-home>${brandHtml}</a>` + html;
  }
  rail.innerHTML = html;
  $('.dock-brand', rail)?.addEventListener('click', (e) => { e.preventDefault(); closeMobileMenu(); goScene(T.startScene); });

  $$('.tn-item', rail).forEach((item) => {
    const link = $('.tn-link', item);
    if (link.dataset.view) return link.addEventListener('click', () => { closeMobileMenu(); openView(link.dataset.view); });
    // Desktop: mở khi rê chuột (CSS); cảm ứng / mobile: bấm để mở-đóng
    link.addEventListener('click', () => {
      const open = !item.classList.contains('open');
      $$('.tn-item.open', rail).forEach((x) => x.classList.remove('open'));
      item.classList.toggle('open', open);
    });
    const img = $('.tn-sub-thumb img', item), cap = $('.tn-sub-thumb span', item);
    $$('.tn-sub-item', item).forEach((b) => {
      b.addEventListener('mouseenter', () => { img.src = sceneBySlug.get(b.dataset.scene)?.pano?.thumb || ''; cap.textContent = b.textContent; });
      b.addEventListener('click', () => { item.classList.remove('open'); closeMobileMenu(); goScene(b.dataset.scene); });
    });
  });
  const brand = $('.brand-mark');
  brand.innerHTML = S.logo_url ? `<img src="${esc(S.logo_url)}" alt="${esc(tr(T.name))}">` : `<span>${esc(S.logo_text || tr(T.name))}</span>`;
  brand.onclick = (e) => { e.preventDefault(); closeMobileMenu(); goScene(T.startScene); };
  renderSocial();
  markActive();
}
document.addEventListener('click', (e) => { if (!e.target.closest('.tn-item')) $$('.tn-item.open').forEach((x) => x.classList.remove('open')); });

function renderSocial() {
  const links = [['website', S.website, 'globe'], ['facebook', S.facebook, 'fb'], ['youtube', S.youtube, 'yt']].filter(([, url]) => url && /^https?:\/\//.test(url));
  $('#social').innerHTML = links.map(([k, url, ic]) => `<a class="soc" href="${esc(url)}" target="_blank" rel="noopener" title="${k}" data-t="${k}">${icon(ic)}</a>`).join('');
  $$('#social a').forEach((a) => a.addEventListener('click', () => track('cta', a.dataset.t)));
}

// Nút riêng cho nhóm căn hộ: mặt bằng căn + danh sách phòng
function renderUnitBar() {
  const bar = $('#unitBar'), g = groupById.get(current?.group);
  if (!MENU_TOP || !g || g.kind !== 'unit') { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `${g.floorplan && F.floorplan ? `<button class="ub-btn" data-ub="plan" title="${u('floorplan')}">${icon('plan')}</button>` : ''}
    <div class="ub-menu"><button class="ub-btn" data-ub="list" title="${esc(tr(g.name))}">${icon('list')}</button>
      <div class="ub-pop"><div class="ub-head">${esc(tr(g.name))}</div>${g.scenes.map((slug) => `<button class="ub-room ${slug === current.slug ? 'on' : ''}" data-scene="${esc(slug)}">${esc(tr(sceneBySlug.get(slug).title))}</button>`).join('')}
      <div class="ub-thumb"><img alt="" src="${esc(current.pano?.thumb || '')}"><span>${esc(tr(current.title))}</span></div></div></div>`;
  const pop = $('.ub-pop', bar);
  // Mỗi lúc chỉ mở một bảng: mặt bằng căn HOẶC danh sách phòng
  $('[data-ub="plan"]', bar)?.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.remove('open'); $('#minimap').classList.toggle('show'); });
  $('[data-ub="list"]', bar).addEventListener('click', (e) => { e.stopPropagation(); $('#minimap').classList.remove('show'); pop.classList.toggle('open'); });
  $$('.ub-room', bar).forEach((b) => {
    b.addEventListener('mouseenter', () => { $('.ub-thumb img', bar).src = sceneBySlug.get(b.dataset.scene)?.pano?.thumb || ''; $('.ub-thumb span', bar).textContent = b.textContent; });
    b.addEventListener('click', () => goScene(b.dataset.scene));
  });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.ub-menu')) $('.ub-pop.open')?.classList.remove('open'); });

// Mobile: nút hamburger mở menu toàn màn hình
const burger = $('#burger');
function closeMobileMenu() { document.body.classList.remove('menu-open'); burger?.setAttribute('aria-expanded', 'false'); }
burger?.addEventListener('click', () => {
  const open = !document.body.classList.contains('menu-open');
  document.body.classList.toggle('menu-open', open); burger.setAttribute('aria-expanded', String(open));
});

function renderRail() {
  if (MENU_TOP) return renderTopnav();
  const rail = $('#rail');
  rail.innerHTML = T.groups.filter((g) => g.scenes.length).map((g) => `
    <button class="rail-item" data-group="${g.id}">${icon(g.icon === 'home' ? 'home' : 'city')}<span>${esc(tr(g.name))}</span></button>`).join('')
    + VIEWS.filter(([, , , ok]) => ok()).map(([k, ic]) => `<button class="rail-item" data-view="${k}">${icon(ic)}<span>${u(k)}</span></button>`).join('');
  $$('.rail-item[data-group]', rail).forEach((b) => b.addEventListener('click', () => toggleDrawer(Number(b.dataset.group))));
  $$('.rail-item[data-view]', rail).forEach((b) => b.addEventListener('click', () => openView(b.dataset.view)));
  const brand = $('.brand-mark');
  brand.innerHTML = S.logo_url ? `<img src="${esc(S.logo_url)}" alt="${esc(tr(T.name))}">` : `<span>${esc(S.logo_text || tr(T.name))}</span>`;
  brand.onclick = (e) => { e.preventDefault(); goScene(T.startScene); };
  markActive();
}

let drawerGroup = null;
function toggleDrawer(gid) {
  const d = $('#drawer');
  if (drawerGroup === gid) { drawerGroup = null; d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); markActive(); return; }
  drawerGroup = gid;
  const g = groupById.get(gid);
  d.innerHTML = `<div class="drawer-head">${esc(tr(g.name))}</div><div class="drawer-list">${g.scenes.map((slug) => {
    const s = sceneBySlug.get(slug);
    return `<button class="thumb ${current?.slug === slug ? 'active' : ''}" data-scene="${slug}"><img loading="lazy" src="${esc(s.pano?.thumb)}" alt=""><span>${esc(tr(s.title))}</span></button>`;
  }).join('')}</div>`;
  $$('.thumb', d).forEach((b) => b.addEventListener('click', () => { goScene(b.dataset.scene); if (isTouch) toggleDrawer(gid); }));
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  markActive();
}
function closeDrawer() { if (drawerGroup !== null) toggleDrawer(drawerGroup); }

function markActive() {
  $$('.rail-item').forEach((b) => {
    const gActive = b.dataset.group && Number(b.dataset.group) === current?.group && !openViewKey;
    b.classList.toggle('active', !!(gActive || (b.dataset.view && b.dataset.view === openViewKey)));
    b.classList.toggle('expanded', Number(b.dataset.group) === drawerGroup);
  });
  $$('#drawer .thumb').forEach((t) => t.classList.toggle('active', t.dataset.scene === current?.slug));
  // topnav
  $$('.tn-item').forEach((it) => {
    const inGroup = it.dataset.group && Number(it.dataset.group) === current?.group;
    const inUnits = it.dataset.units && it.dataset.units.split(',').map(Number).includes(current?.group);
    const view = $('.tn-link', it)?.dataset.view;
    it.classList.toggle('active', openViewKey ? view === openViewKey : !!(inGroup || inUnits));
  });
  $$('.tn-sub-item').forEach((b) => {
    const sc = sceneBySlug.get(b.dataset.scene);
    b.classList.toggle('on', b.closest('[data-units]') ? sc?.group === current?.group : b.dataset.scene === current?.slug);
  });
}

// ---------------- Scene UI ----------------
function renderSceneUI() {
  const sc = current, g = groupById.get(sc.group);
  $('#sceneTitle .st-group').textContent = g ? tr(g.name) : '';
  $('#sceneTitle .st-name').textContent = tr(sc.title);
  $('#sceneTitle').classList.toggle('no-group', !g);
  // Ngày/đêm
  const dn = $('#dayNight');
  dn.hidden = !(F.daynight && sc.pair);
  if (sc.pair) { dn.classList.toggle('night', sc.pair.role === 'night'); dn.setAttribute('aria-label', sc.pair.role === 'night' ? 'Đêm' : 'Ngày'); }
  renderMinimap();
  renderUnitBar();
  markActive();
}
$('#dayNight').addEventListener('click', () => { if (current?.pair) { track('cta', 'daynight'); goScene(current.pair.slug, { keepView: true }); } });

function renderMinimap() {
  const mm = $('#minimap'), g = groupById.get(current.group);
  if (!F.floorplan || !g?.floorplan) { mm.hidden = true; return; }
  mm.hidden = false;
  $('.mm-head span', mm).textContent = `${u('floorplan')} · ${tr(g.name)}`;
  const dots = g.scenes.map((slug) => sceneBySlug.get(slug)).filter((s) => s.floorplan)
    .map((s) => `<button class="mm-dot ${s.slug === current.slug ? 'active' : ''}" style="left:${s.floorplan.x * 100}%;top:${s.floorplan.y * 100}%" data-scene="${s.slug}" title="${esc(tr(s.title))}"><i></i></button>`).join('');
  $('.mm-body', mm).innerHTML = `<div class="mm-img"><img src="${esc(g.floorplan)}" alt="">${dots}</div>`;
  $$('.mm-dot', mm).forEach((d) => d.addEventListener('click', () => goScene(d.dataset.scene)));
  updateCompass(viewer.getPosition().yaw);
}
$('.mm-close').addEventListener('click', () => $('#minimap').classList.toggle('collapsed'));

function updateCompass(yawRad) {
  if (!current) return;
  const d = (yawRad * 180) / Math.PI + (current.north || 0);
  if (F.compass && LAYOUT === 'dock') updateTape(d);
  else if (F.compass) { $('#compass').hidden = false; $('.compass-dial').style.transform = `rotate(${-d}deg)`; }
  const active = $('.mm-dot.active i'); if (active) active.style.transform = `rotate(${d}deg)`;
}

// ---------------- Controls ----------------
let autotourTimer = null;
// La bàn dạng thước ngang (kiểu dock): vạch mỗi 15°, nhãn mỗi 45°, trượt theo hướng nhìn
const PX_PER_DEG = 2.4;
function buildTape() {
  const tape = $('#tapeInner'); if (!tape) return;
  const names = lang === 'en' ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] : ['B', 'ĐB', 'Đ', 'ĐN', 'N', 'TN', 'T', 'TB'];
  let html = '';
  for (let a = -360; a <= 720; a += 15) {
    const n = ((a % 360) + 360) % 360;
    const major = n % 90 === 0, mid = n % 45 === 0;
    html += `<i class="tk ${major ? 'major' : mid ? 'mid' : ''}" style="left:${(a + 360) * PX_PER_DEG}px">${mid ? `<b>${names[n / 45]}</b>` : ''}</i>`;
  }
  tape.innerHTML = html;
}
function updateTape(d) {
  const tape = $('#tapeInner'); if (!tape) return;
  $('#compassTape').hidden = false;
  const n = ((d % 360) + 360) % 360;
  tape.style.transform = `translateX(${-(n + 360) * PX_PER_DEG}px)`;
}

// Ẩn/hiện toàn bộ giao diện để ngắm ảnh trọn vẹn
$('#uiToggle')?.addEventListener('click', () => {
  const hidden = document.body.classList.toggle('ui-hidden');
  $('#uiToggle').innerHTML = icon(hidden ? 'menu' : 'close');
  $('#uiToggle').setAttribute('aria-label', hidden ? 'Hiện giao diện' : 'Ẩn giao diện');
});

function renderControls() {
  const items = [
    LAYOUT !== 'dock' && ['zoomOut', 'minus', () => viewer.zoomOut(10)], LAYOUT !== 'dock' && ['zoomIn', 'plus', () => viewer.zoomIn(10)],
    F.autorotate && ['autorotate', 'rotate', () => { autorotate.toggle(); syncControls(); }],
    ['autotour', 'play', toggleAutotour],
    F.sound && S.bg_sound && ['sound', 'sound', toggleSound],
    ['fullscreen', 'full', toggleFullscreen],
    gyro && F.gyroscope && ['gyro', 'gyro', () => gyro.toggle()],
    stereo && ['vr', 'vr', () => stereo.toggle()],
    F.share && ['share', 'share', share],
    F.help && ['help', 'help', () => openModal(`<h2>${u('help')}</h2>${u('helpBody')}`)],
  ].filter(Boolean);
  const c = $('#controls');
  c.innerHTML = items.map(([k, ic]) => `<button class="ctl" data-k="${k}" title="${u(k)}" aria-label="${u(k)}">${icon(ic)}</button>`).join('');
  items.forEach(([k, , fn]) => $(`.ctl[data-k="${k}"]`, c).addEventListener('click', () => { fn(); track('cta', k); }));
  syncControls();
}
function syncControls() {
  $('.ctl[data-k="autorotate"]')?.classList.toggle('on', autorotate.isEnabled());
  const at = $('.ctl[data-k="autotour"]'); if (at) { at.classList.toggle('on', !!autotourTimer); at.innerHTML = icon(autotourTimer ? 'pause' : 'play'); }
  const sb = $('.ctl[data-k="sound"]'); if (sb) { sb.classList.toggle('on', soundOn); sb.innerHTML = icon(soundOn ? 'sound' : 'mute'); }
}
autorotate.addEventListener('autorotate', syncControls);

function toggleAutotour() {
  if (autotourTimer) { clearInterval(autotourTimer); autotourTimer = null; autorotate.stop(); }
  else {
    const order = T.groups.flatMap((g) => g.scenes);
    autorotate.start();
    autotourTimer = setInterval(() => {
      const i = order.indexOf(current.slug);
      goScene(order[(i + 1) % order.length]).then(() => autorotate.start());
    }, 20000);
  }
  syncControls();
}
viewer.addEventListener('click', () => { if (autotourTimer) toggleAutotour(); });

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => viewer.toggleFullscreen());
}

// ---------------- Âm thanh (chỉ phát sau tương tác đầu tiên — chính sách autoplay của trình duyệt) ----------------
const audio = new Audio(); audio.loop = true; audio.volume = 0.5;
let soundOn = F.sound && !!S.bg_sound, interacted = false;
function playSceneSound() {
  const src = current?.sound || S.bg_sound;
  if (!src || !soundOn || !interacted) return;
  if (!audio.src.endsWith(src)) audio.src = src;
  audio.play().catch(() => {});
}
function toggleSound() { soundOn = !soundOn; if (soundOn) { interacted = true; playSceneSound(); } else audio.pause(); syncControls(); }
addEventListener('pointerdown', () => { if (!interacted) { interacted = true; playSceneSound(); } }, { once: true });

// ---------------- Chia sẻ ----------------
async function share() {
  const p = viewer.getPosition();
  const v = [(p.yaw * 180 / Math.PI).toFixed(1), (p.pitch * 180 / Math.PI).toFixed(1), Math.round(viewer.getZoomLevel())].join(',');
  const url = location.origin + urlFor(current.slug, v);
  track('share', current.slug);
  if (navigator.share && isTouch) { try { await navigator.share({ title: document.title, url }); return; } catch { /* huỷ */ } }
  const e = encodeURIComponent(url);
  openModal(`<h2>${u('share')}</h2><div class="share-row">
    <a class="btn" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${e}">Facebook</a>
    <a class="btn" target="_blank" rel="noopener" href="https://zalo.me/share?url=${e}">Zalo</a>
    <a class="btn" target="_blank" rel="noopener" href="https://t.me/share/url?url=${e}">Telegram</a>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${e}">WhatsApp</a></div>
    <div class="copy-row"><input readonly value="${esc(url)}"><button class="btn primary" id="copyBtn">${u('copy')}</button></div>`);
  $('#copyBtn').onclick = () => navigator.clipboard?.writeText(url).then(() => toast(u('copied')));
}

// ---------------- Lang ----------------
function renderLang() {
  const langs = S.languages?.length ? S.languages : ['vi', 'en'];
  $('#lang').innerHTML = langs.map((l) => `<button class="${l === lang ? 'on' : ''}" data-l="${l}">${l.toUpperCase()}</button>`).join('');
  $$('#lang button').forEach((b) => b.onclick = () => setLang(b.dataset.l));
}
function setLang(l) {
  lang = l; document.documentElement.lang = l;
  renderAll();
  if (current) { markers.setMarkers(current.hotspots.map(markerFor)); history.replaceState(history.state, '', openViewKey ? viewUrl(openViewKey) : urlFor(current.slug)); }
  if (openViewKey) openView(openViewKey, false);
}
function renderI18n() { $$('[data-i18n]').forEach((el) => { el.textContent = u(el.dataset.i18n); }); }

// ---------------- Liên hệ nhanh + form lead ----------------
function renderQuick() {
  const q = [];
  if (S.hotline) q.push(`<a class="q q-phone" href="tel:${esc(S.hotline)}" data-t="hotline">${icon('phone')}<span>${esc(S.hotline)}</span></a>`);
  if (S.zalo) q.push(`<a class="q q-zalo" target="_blank" rel="noopener" href="https://zalo.me/${esc(S.zalo)}" data-t="zalo"><b>Zalo</b></a>`);
  if (S.messenger) q.push(`<a class="q q-msg" target="_blank" rel="noopener" href="https://m.me/${esc(S.messenger)}" data-t="messenger">${icon('chat')}</a>`);
  $('#quick').innerHTML = q.join('');
  $$('#quick a').forEach((a) => a.addEventListener('click', () => track('cta', a.dataset.t)));
  $('#ctaBtn').hidden = !F.lead_form;
}
$('#ctaBtn').addEventListener('click', () => { track('cta', 'lead_open'); openLead(); });

function openLead(interest = '') {
  const opts = T.groups.filter((g) => g.kind === 'unit').map((g) => tr(g.name));
  openModal(`<h2>${u('leadTitle')}</h2><p class="muted">${u('leadSub')}</p>
  <form class="lead" novalidate>
    <label>${u('name')}<input name="name" required autocomplete="name" maxlength="100"></label>
    <label>${u('phone')}<input name="phone" required inputmode="tel" autocomplete="tel" maxlength="15"></label>
    <label>${u('email')}<input name="email" type="email" autocomplete="email" maxlength="120"></label>
    <label>${u('interest')}<select name="interest">${[...opts, u('other')].map((o) => `<option ${o === interest ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
    <label>${u('note')}<textarea name="note" rows="2" maxlength="1000"></textarea></label>
    <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="err" hidden></p>
    <button class="btn primary block" type="submit">${u('send')}</button>
  </form>`);
  const f = $('.lead');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    const err = $('.err', f); err.hidden = true;
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const utm = Object.fromEntries([...qp].filter(([k]) => k.startsWith('utm_')));
      const r = await fetch(`/api/tour/${T.slug}/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, scene: current?.slug, source: openViewKey || 'tour', utm }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || u('error'));
      $('.modal-body').innerHTML = `<div class="ok">✓</div><h2>${u('sent')}</h2>`;
      if (window.gtag) window.gtag('event', 'generate_lead');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  });
}

// ---------------- Modal / toast ----------------
function openModal(html, size = '') {
  const m = $('#modal');
  $('.modal-card', m).className = `modal-card ${size}`;
  $('.modal-body', m).innerHTML = html;
  m.hidden = false;
  $('.modal-card', m).focus?.();
}
function closeModal() { const m = $('#modal'); m.hidden = true; $('.modal-body', m).innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close-modal]')) closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (openViewKey) closeView(); else closeDrawer(); } });
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2500); }

function ytId(url = '') { return (url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/) || [])[1]; }
function openVideo(url) {
  const id = ytId(url); if (!id) return;
  openModal(`<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe></div>`, 'wide');
}

// ---------------- Trang con (lớp phủ) ----------------
let openViewKey = null;
const viewUrl = (k) => urlFor(VIEWS.find((v) => v[0] === k)[2]);

function openView(key, push = true) {
  openViewKey = key;
  closeDrawer();
  const v = $('#view');
  $('h1', v).textContent = u(key);
  const body = $('.view-body', v);
  body.className = `view-body v-${key}`;
  ({ location: renderLocation, plan: () => renderPlans('masterplan', body), facilities: () => renderPlans('facility', body), gallery: renderGallery })[key](body);
  v.hidden = false; document.body.classList.add('has-view');
  autorotate.stop();
  if (push) history.pushState({ view: key }, '', viewUrl(key));
  document.title = `${u(key)} – ${tr(T.name)}`;
  track(key === 'gallery' ? 'gallery' : 'plan', key);
  markActive();
}
function closeView(push = true) {
  if (!openViewKey) return;
  openViewKey = null; $('#view').hidden = true; document.body.classList.remove('has-view');
  if (push && current) history.pushState({ scene: current.slug }, '', urlFor(current.slug));
  if (current) document.title = `${tr(current.title)} – ${tr(T.name)}`;
  markActive();
}
$('[data-close-view]').addEventListener('click', () => closeView());

function renderLocation(body) {
  const L = S.location || {};
  let map = '';
  if (L.map_embed && /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed/.test(L.map_embed)) map = L.map_embed;
  else if (L.lat != null && L.lng != null) {
    const d = 0.03;
    map = `https://www.openstreetmap.org/export/embed.html?bbox=${L.lng - d},${L.lat - d},${L.lng + d},${L.lat + d}&layer=mapnik&marker=${L.lat},${L.lng}`;
  }
  // Tận dụng POI của cảnh tổng thể => không nhập lại dữ liệu
  const start = sceneBySlug.get(T.startScene);
  const pois = (start?.hotspots || []).filter((h) => h.type === 'poi').sort((a, b) => (a.meta?.travel || 0) - (b.meta?.travel || 0));
  body.innerHTML = `<div class="loc-grid">
    <div class="loc-text">
      ${L.address ? `<p class="addr">${icon('pin')} ${esc(tr(L.address))}</p>` : ''}
      <div class="rich">${esc(tr(L.content)).replace(/\n/g, '<br>')}</div>
      ${pois.length ? `<h3>${u('nearby')}</h3><ul class="poi-list">${pois.map((p) => `<li><span>${esc(tr(p.label))}</span><b>${p.meta?.travel ? `${esc(p.meta.travel)} ${u('minutes')}` : ''}</b></li>`).join('')}</ul>` : ''}
      ${F.lead_form ? `<button class="btn primary" data-lead>${u('cta')}</button>` : ''}
    </div>
    ${map ? `<div class="loc-map"><iframe loading="lazy" src="${esc(map)}" referrerpolicy="no-referrer-when-downgrade" title="Map"></iframe></div>` : ''}
  </div>`;
  $('[data-lead]', body)?.addEventListener('click', () => openLead());
}

function renderPlans(kind, body, activeId) {
  const plans = T.plans.filter((p) => p.kind === kind);
  const plan = plans.find((p) => p.id === activeId) || plans[0];
  if (!plan) { body.innerHTML = ''; return; }
  const ar = plan.width && plan.height ? plan.width / plan.height : 1.6;
  const poly = plan.areas.filter((a) => a.shape === 'polygon');
  const pts = plan.areas.filter((a) => a.shape === 'point');
  const centroid = (p) => [p.reduce((s, x) => s + x[0], 0) / p.length, p.reduce((s, x) => s + x[1], 0) / p.length];
  body.innerHTML = `
    ${plans.length > 1 ? `<div class="tabs">${plans.map((p) => `<button class="${p.id === plan.id ? 'on' : ''}" data-plan="${p.id}">${esc(tr(p.name))}</button>`).join('')}</div>` : ''}
    <div class="plan-wrap">
      <div class="plan-stage"><div class="plan-canvas" style="aspect-ratio:${ar}">
        <img src="${esc(plan.image)}" alt="${esc(tr(plan.name))}">
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">${poly.map((a) => `<polygon data-a="${a.id}" points="${a.points.map((p) => p.join(',')).join(' ')}"/>`).join('')}</svg>
        ${poly.map((a) => { const [x, y] = centroid(a.points); return `<span class="area-label" data-a="${a.id}" style="left:${x * 100}%;top:${y * 100}%">${esc(tr(a.label))}</span>`; }).join('')}
        ${pts.map((a, i) => `<button class="area-pin" data-a="${a.id}" style="left:${a.points[0][0] * 100}%;top:${a.points[0][1] * 100}%" aria-label="${esc(tr(a.label))}">${i + 1}</button>`).join('')}
      </div></div>
      <ol class="area-list">${plan.areas.map((a, i) => `<li data-a="${a.id}"><span class="n">${a.shape === 'point' ? i + 1 - poly.length : '▸'}</span>${esc(tr(a.label))}</li>`).join('')}</ol>
    </div>`;
  $$('.tabs button', body).forEach((b) => b.onclick = () => renderPlans(kind, body, Number(b.dataset.plan)));
  const byId = new Map(plan.areas.map((a) => [a.id, a]));
  const hover = (id, on) => $$(`[data-a="${id}"]`, body).forEach((el) => el.classList.toggle('hover', on));
  $$('[data-a]', body).forEach((el) => {
    const id = Number(el.dataset.a);
    el.addEventListener('mouseenter', () => hover(id, true));
    el.addEventListener('mouseleave', () => hover(id, false));
    el.addEventListener('click', () => areaAction(byId.get(id)));
  });
}

function areaAction(a) {
  track('plan', `area:${a.id}`);
  const act = a.action || {};
  if (act.type === 'scene' && act.target && sceneBySlug.has(act.target)) return goScene(act.target);
  if (act.type === 'plan' && act.target) return renderPlans(T.plans.find((p) => p.id === Number(act.target))?.kind || 'masterplan', $('.view-body'), Number(act.target));
  openModal(`${a.image ? `<img class="modal-img" src="${esc(a.image)}" alt="">` : ''}<h2>${esc(tr(a.label))}</h2><p>${esc(tr(a.description))}</p>
    ${F.lead_form ? `<button class="btn primary" data-lead>${u('cta')}</button>` : ''}`, a.image ? 'wide' : '');
  $('.modal [data-lead]')?.addEventListener('click', () => openLead());
}

function renderGallery(body, cat) {
  const cats = [['gallery', 'images'], ['video', 'videos'], ['document', 'documents'], ['legal', 'legal']].filter(([c]) => T.library.some((m) => m.category === c));
  cat = cat || cats[0]?.[0];
  const items = T.library.filter((m) => m.category === cat);
  body.innerHTML = `<div class="tabs">${cats.map(([c, k]) => `<button class="${c === cat ? 'on' : ''}" data-c="${c}">${u(k)}</button>`).join('')}</div>
    <div class="grid ${cat === 'document' || cat === 'legal' ? 'docs' : ''}">${items.map((m, i) => {
      if (m.kind === 'pdf') return `<a class="doc" href="${esc(m.url)}" data-i="${i}" target="_blank" rel="noopener">${icon('doc')}<span>${esc(tr(m.title))}</span><small>PDF</small></a>`;
      return `<button class="tile" data-i="${i}">${m.thumb ? `<img loading="lazy" src="${esc(m.thumb)}" alt="">` : ''}${m.kind === 'video' ? `<span class="play">${icon('play')}</span>` : ''}<span class="cap">${esc(tr(m.title))}</span></button>`;
    }).join('')}</div>`;
  $$('.tabs button', body).forEach((b) => b.onclick = () => renderGallery(body, b.dataset.c));
  $$('[data-i]', body).forEach((el) => el.addEventListener('click', (e) => {
    const m = items[Number(el.dataset.i)];
    track('gallery', `${m.category}:${m.id}`);
    if (m.kind === 'video') return openVideo(m.url);
    if (m.kind === 'pdf') {
      if (isTouch) return; // mobile: mở tab mới (trình xem PDF hệ thống)
      e.preventDefault();
      return openModal(`<div class="pdf-wrap"><iframe src="${esc(m.url)}#view=FitH" title="${esc(tr(m.title))}"></iframe></div><p><a class="btn" href="${esc(m.url)}" download>${u('download')}</a></p>`, 'wide');
    }
    lightbox(items.filter((x) => x.kind === 'image'), m);
  }));
}

function lightbox(list, start) {
  let i = list.indexOf(start);
  const show = () => {
    const m = list[i];
    openModal(`<div class="lb"><img src="${esc(m.url)}" alt="${esc(tr(m.title))}"><button class="lb-prev" aria-label="Trước">‹</button><button class="lb-next" aria-label="Sau">›</button><p>${esc(tr(m.title))} <span class="muted">${i + 1}/${list.length}</span></p></div>`, 'wide');
    $('.lb-prev').onclick = () => { i = (i - 1 + list.length) % list.length; show(); };
    $('.lb-next').onclick = () => { i = (i + 1) % list.length; show(); };
  };
  show();
}

// ---------------- Thời tiết (qua server, không lộ API key) ----------------
async function loadWeather() {
  if (!F.weather) return;
  try {
    const r = await fetch(`/api/tour/${T.slug}/weather`); if (!r.ok) return;
    const w = await r.json();
    const el = $('#weather'); el.hidden = false;
    el.innerHTML = `${w.icon ? `<img src="https://openweathermap.org/img/wn/${encodeURIComponent(w.icon)}.png" alt="">` : ''}<span>${esc(w.city)} ${esc(w.temp)}°C</span>`;
  } catch { /* bỏ qua */ }
}

// ---------------- Lịch sử trình duyệt ----------------
addEventListener('popstate', () => {
  const parts = location.pathname.split('/').filter(Boolean);
  const sub = parts[1];
  if (sub && SLUG_TO_VIEW[sub]) return openView(SLUG_TO_VIEW[sub], false);
  closeView(false);
  goScene(sub && sceneBySlug.has(sub) ? sub : T.startScene, { push: false });
});

// ---------------- Khởi động ----------------
function renderAll() {
  renderI18n(); renderRail(); renderControls(); renderQuick(); renderLang();
  if (LAYOUT === 'dock') { buildTape(); $('#uiToggle').hidden = false; $('#uiToggle').innerHTML = icon('close'); }
  const disc = $('#disclaimer'); disc.hidden = !(F.disclaimer && tr(S.disclaimer)); disc.textContent = tr(S.disclaimer);
  $('.loader-name').textContent = tr(T.name);
  if (current) renderSceneUI();
}
document.documentElement.lang = lang;
renderAll();
if (startScene) {
  current = startScene;
  renderSceneUI();
  document.title = R.view ? document.title : `${tr(startScene.title)} – ${tr(T.name)}`;
  history.replaceState(R.view ? { view: R.view } : { scene: startScene.slug }, '', location.pathname + location.search);
  viewer.addEventListener('ready', () => { markers.setMarkers(startScene.hotspots.map(markerFor)); }, { once: true });
  track('view', 'open', startScene.slug);
}
if (R.view) openView(R.view, false);
loadWeather();
