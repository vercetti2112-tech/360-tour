// Tạo dữ liệu DEMO: ảnh 360 sinh bằng thuật toán (không dùng ảnh thật của dự án nào), mặt bằng vẽ SVG.
// Chạy: npm run seed   (xoá dữ liệu cũ và tạo lại)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DATA_DIR, MEDIA_DIR, db, insert, update, run, COLS } from './db.js';
import { processPanorama, processImage } from './images.js';
import { defaultSettings } from './app.js';

const W = 4096, H = 2048;

// ---------- Sinh ảnh equirectangular bằng SVG ----------
function skyline(seed, night) {
  // Dãy nhà ở đường chân trời, chạy quanh 360°
  let s = seed, out = '';
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let x = 0; x < W;) {
    const w = 40 + rnd() * 120, h = 40 + rnd() * (rnd() > 0.85 ? 420 : 160);
    const shade = night ? 18 + rnd() * 20 : 120 + rnd() * 60;
    out += `<rect x="${x}" y="${H / 2 - h}" width="${w}" height="${h}" fill="rgb(${shade},${shade + 8},${shade + 20})"/>`;
    if (night) {
      for (let wy = H / 2 - h + 10; wy < H / 2 - 8; wy += 18) for (let wx = x + 6; wx < x + w - 8; wx += 14)
        if (rnd() > 0.55) out += `<rect x="${wx}" y="${wy}" width="6" height="8" fill="#ffd27a" opacity="${0.5 + rnd() * 0.5}"/>`;
    }
    x += w + rnd() * 18;
  }
  return out;
}

function compassLabels(color) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs.map((d, i) => `<text x="${(i / 8) * W + W / 2}" y="${H / 2 + 120}" font-size="48" fill="${color}" text-anchor="middle" font-family="sans-serif" opacity=".55">${d}</text>`).join('')
    .replace(/x="(\d+(\.\d+)?)"/g, (m, v) => `x="${Number(v) % W}"`);
}

function outdoorSvg(title, { night = false, seed = 7 } = {}) {
  const sky = night ? ['#050b1e', '#13234a', '#2b3a6b'] : ['#3d8fd6', '#8cc4ef', '#dcefff'];
  const ground = night ? ['#0d1410', '#050806'] : ['#6f9a4c', '#3c5a2a'];
  const stars = night ? Array.from({ length: 220 }, (_, i) => `<circle cx="${(i * 7919) % W}" cy="${(i * 104729) % (H / 2 - 300)}" r="${i % 5 ? 1.5 : 2.5}" fill="#fff" opacity=".8"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".7" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground[0]}"/><stop offset="1" stop-color="${ground[1]}"/></linearGradient></defs>
  <rect width="${W}" height="${H / 2}" fill="url(#s)"/>${stars}
  ${night ? `<circle cx="${W * 0.7}" cy="380" r="60" fill="#f4f1de"/>` : `<circle cx="${W * 0.3}" cy="300" r="90" fill="#fff6c9" opacity=".9"/>`}
  <rect y="${H / 2}" width="${W}" height="${H / 2}" fill="url(#g)"/>
  ${Array.from({ length: 24 }, (_, i) => `<line x1="${(i / 24) * W}" y1="${H / 2}" x2="${(i / 24) * W}" y2="${H}" stroke="#fff" stroke-opacity=".06" stroke-width="3"/>`).join('')}
  ${skyline(seed, night)}
  <rect x="${W / 2 - 520}" y="${H / 2 + 260}" width="1040" height="170" rx="24" fill="#000" opacity=".35"/>
  <text x="${W / 2}" y="${H / 2 + 345}" font-size="72" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${title}</text>
  <text x="${W / 2}" y="${H / 2 + 405}" font-size="36" fill="#fff" text-anchor="middle" font-family="sans-serif" opacity=".8">ẢNH 360° DEMO – thay bằng ảnh thật trong trang quản trị</text>
  ${compassLabels('#fff')}
</svg>`;
}

function indoorSvg(title, hue) {
  const wall = `hsl(${hue},25%,82%)`, wall2 = `hsl(${hue},22%,74%)`, floor = `hsl(${(hue + 30) % 360},30%,42%)`;
  let walls = '';
  for (let i = 0; i < 4; i++) {
    const x = (i / 4) * W;
    walls += `<rect x="${x}" y="${H * 0.18}" width="${W / 4}" height="${H * 0.62}" fill="${i % 2 ? wall : wall2}"/>`;
    walls += `<rect x="${x + W / 8 - 180}" y="${H * 0.3}" width="360" height="420" rx="8" fill="${i === 1 ? '#bfe3ff' : '#fff'}" opacity="${i === 1 ? 0.9 : 0.35}" stroke="#555" stroke-opacity=".3" stroke-width="6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H * 0.18}" fill="#f6f4ef"/>${walls}
  <rect y="${H * 0.8}" width="${W}" height="${H * 0.2}" fill="${floor}"/>
  ${Array.from({ length: 32 }, (_, i) => `<line x1="${(i / 32) * W}" y1="${H * 0.8}" x2="${(i / 32) * W}" y2="${H}" stroke="#000" stroke-opacity=".08" stroke-width="4"/>`).join('')}
  <rect x="${W / 2 - 480}" y="${H / 2 + 120}" width="960" height="150" rx="20" fill="#000" opacity=".3"/>
  <text x="${W / 2}" y="${H / 2 + 215}" font-size="66" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${title}</text>
  ${compassLabels('#333')}
</svg>`;
}

function planSvg(kind) {
  const w = 1600, h = 1000;
  if (kind === 'master') {
    let blocks = '';
    for (let f = 0; f < 12; f++) {
      const y = 800 - f * 50;
      blocks += `<polygon points="560,${y} 1040,${y} 1080,${y - 40} 600,${y - 40}" fill="hsl(205,30%,${70 - f * 2}%)" stroke="#fff" stroke-width="2"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#dfe8df"/>
      <rect x="100" y="820" width="1400" height="80" fill="#9aa59a"/><text x="800" y="870" text-anchor="middle" font-size="28" font-family="sans-serif" fill="#fff">ĐƯỜNG CHÍNH (demo)</text>
      ${Array.from({ length: 14 }, (_, i) => `<circle cx="${140 + i * 100}" cy="790" r="22" fill="#5f8f4e"/>`).join('')}
      ${blocks}<text x="800" y="120" text-anchor="middle" font-size="44" font-family="sans-serif" fill="#334">PHỐI CẢNH TOÀ NHÀ – DEMO</text></svg>`;
  }
  if (kind === 'unit1' || kind === 'unit2') {
    const rooms = kind === 'unit1'
      ? [[100, 150, 700, 450, 'Phòng khách'], [800, 150, 500, 300, 'Phòng ngủ'], [800, 450, 500, 150, 'WC'], [100, 600, 700, 250, 'Bếp + ăn'], [800, 600, 500, 250, 'Phòng đa năng']]
      : [[100, 150, 650, 400, 'Phòng khách'], [750, 150, 550, 350, 'Phòng ngủ master'], [100, 550, 450, 300, 'Bếp'], [550, 550, 400, 300, 'Phòng ngủ 2'], [950, 500, 350, 350, 'WC']];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>
      ${rooms.map(([x, y, rw, rh, n]) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#f3efe6" stroke="#444" stroke-width="8"/><text x="${x + rw / 2}" y="${y + rh / 2}" text-anchor="middle" font-size="34" font-family="sans-serif" fill="#555">${n}</text>`).join('')}</svg>`;
  }
  // mặt bằng tiện ích
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#e9efe4"/>
    <rect x="200" y="200" width="1200" height="600" rx="40" fill="#f7f5ef" stroke="#8a9" stroke-width="6"/>
    <rect x="300" y="300" width="500" height="200" rx="80" fill="#7cc7e8"/>
    <rect x="900" y="300" width="400" height="400" fill="#c9d9b8"/>
    <circle cx="500" cy="650" r="90" fill="#b5d39a"/><text x="800" y="150" text-anchor="middle" font-size="40" font-family="sans-serif" fill="#344">MẶT BẰNG TIỆN ÍCH – DEMO</text></svg>`;
}

const buf = (svg) => sharp(Buffer.from(svg.replace(/&(?!amp;|lt;|gt;|#)/g, '&amp;'))).jpeg({ quality: 90 }).toBuffer();
const L = (vi, en) => ({ vi, en });

async function main() {
  // Xoá dữ liệu cũ
  db.exec('DELETE FROM events; DELETE FROM leads; DELETE FROM plan_areas; DELETE FROM plans; DELETE FROM hotspots; UPDATE projects SET start_scene_id=NULL; DELETE FROM scenes; DELETE FROM groups; DELETE FROM media; DELETE FROM projects;');
  for (const d of fs.readdirSync(MEDIA_DIR)) fs.rmSync(path.join(MEDIA_DIR, d), { recursive: true, force: true });

  const settings = defaultSettings();
  Object.assign(settings, {
    logo_text: 'SKYLINE DEMO', hotline: '0900000000', zalo: '0900000000', website: 'https://example.com',
    facebook: 'https://www.facebook.com/', youtube: 'https://www.youtube.com/',
    location: {
      lat: 10.80, lng: 106.70, city: 'TP. Demo',
      address: L('Số 1 Đường Demo, TP. Demo', '1 Demo Street, Demo City'),
      content: L('Dự án demo minh hoạ trang Vị trí. Nội dung này được soạn trong trang quản trị và hỗ trợ đa ngôn ngữ. Các điểm kết nối hiển thị kèm thời gian di chuyển ước tính.',
        'A demo project for the Location page. This content is authored in the admin and supports multiple languages.'),
      map_embed: '',
    },
  });
  const pid = insert('projects', {
    slug: 'skyline-demo', name: L('Skyline Demo', 'Skyline Demo'),
    description: L('Tham quan dự án căn hộ demo qua ảnh 360°: toàn cảnh ngày/đêm, view theo tầng, căn hộ mẫu, mặt bằng, tiện ích.',
      'Explore the demo apartment project in 360°: day/night overview, floor views, show units, masterplan and facilities.'),
    settings,
  }, COLS.projects);

  const addMedia = (r, kind, category, title) => insert('media', { project_id: pid, kind, category, file: r.file, title, meta: r.meta }, COLS.media);
  const pano = async (svg, title) => addMedia(await processPanorama(await buf(svg)), 'pano', 'pano', title);
  const image = async (svg, category, title) => addMedia(await processImage(await buf(svg)), 'image', category, title);

  console.log('Sinh ảnh demo...');
  const gOverview = insert('groups', { project_id: pid, name: L('Toàn cảnh', 'Overview'), kind: 'overview', icon: 'city', sort: 0 }, COLS.groups);
  const fp1 = await image(planSvg('unit1'), 'floorplan', L('Mặt bằng căn 1PN+', '1BR+ floorplan'));
  const fp2 = await image(planSvg('unit2'), 'floorplan', L('Mặt bằng căn 2PN', '2BR floorplan'));
  const gU1 = insert('groups', { project_id: pid, name: L('Căn hộ 1 phòng ngủ +', '1 Bedroom+ unit'), kind: 'unit', icon: 'home', floorplan_media_id: fp1, sort: 1 }, COLS.groups);
  const gU2 = insert('groups', { project_id: pid, name: L('Căn hộ 2 phòng ngủ', '2 Bedroom unit'), kind: 'unit', icon: 'home', floorplan_media_id: fp2, sort: 2 }, COLS.groups);

  const S = {};
  let sort = 0;
  const scene = async (slug, title, group, svg, extra = {}) => {
    const m = await pano(svg, title);
    S[slug] = insert('scenes', { project_id: pid, group_id: group, slug, title, pano_media_id: m, sort: sort++, zoom: 30, ...extra }, COLS.scenes);
    process.stdout.write('.');
  };
  await scene('tong-the-ban-ngay', L('Tổng thể ban ngày', 'Overview – Daytime'), gOverview, outdoorSvg('Tổng thể ban ngày', { seed: 3 }), { pair_role: 'day' });
  await scene('tong-the-ban-dem', L('Tổng thể ban đêm', 'Overview – Nighttime'), gOverview, outdoorSvg('Tổng thể ban đêm', { seed: 3, night: true }), { pair_role: 'night' });
  await scene('view-tang-8', L('Cảnh quan từ tầng 8', 'View from 8th floor'), gOverview, outdoorSvg('View tầng 8', { seed: 11 }));
  await scene('view-tang-17', L('Cảnh quan từ tầng 17', 'View from 17th floor'), gOverview, outdoorSvg('View tầng 17', { seed: 19 }));
  await scene('view-tang-25', L('Cảnh quan từ tầng 25', 'View from 25th floor'), gOverview, outdoorSvg('View tầng 25', { seed: 23 }));
  update('scenes', S['tong-the-ban-ngay'], { pair_scene_id: S['tong-the-ban-dem'] }, COLS.scenes);
  update('scenes', S['tong-the-ban-dem'], { pair_scene_id: S['tong-the-ban-ngay'] }, COLS.scenes);

  const u1 = [['1pn-phong-khach', 'Phòng khách', 'Living room', 0.28, 0.3], ['1pn-phong-ngu', 'Phòng ngủ', 'Bedroom', 0.66, 0.3], ['1pn-bep', 'Bếp & bàn ăn', 'Kitchen & dining', 0.28, 0.72], ['1pn-da-nang', 'Phòng đa năng', 'Multi-purpose room', 0.66, 0.72]];
  for (const [i, [slug, vi, en, x, y]] of u1.entries()) await scene(slug, L(vi, en), gU1, indoorSvg(`Căn 1PN+ · ${vi}`, 30 + i * 40), { floorplan_x: x, floorplan_y: y });
  const u2 = [['2pn-phong-khach', 'Phòng khách', 'Living room', 0.27, 0.35], ['2pn-ngu-master', 'Phòng ngủ master', 'Master bedroom', 0.64, 0.32], ['2pn-bep', 'Bếp', 'Kitchen', 0.2, 0.7], ['2pn-ngu-2', 'Phòng ngủ 2', 'Bedroom 2', 0.47, 0.7]];
  for (const [i, [slug, vi, en, x, y]] of u2.entries()) await scene(slug, L(vi, en), gU2, indoorSvg(`Căn 2PN · ${vi}`, 200 + i * 35), { floorplan_x: x, floorplan_y: y });
  console.log();
  run('UPDATE projects SET start_scene_id=? WHERE id=?', S['tong-the-ban-ngay'], pid);

  // ---- Hotspots ----
  const hs = (scene, type, yaw, pitch, data = {}) => insert('hotspots', { scene_id: S[scene], type, yaw, pitch, ...data }, COLS.hotspots);
  const pois = [
    ['Trung tâm thành phố', 'City centre', 15, 0], ['Sân bay quốc tế', 'International airport', 25, 70],
    ['Bệnh viện đa khoa', 'General hospital', 5, 130], ['Trường tiểu học', 'Primary school', 3, -40],
    ['Siêu thị', 'Supermarket', 4, -100], ['Công viên ven sông', 'Riverside park', 6, 180],
  ];
  for (const sc of ['tong-the-ban-ngay', 'tong-the-ban-dem']) {
    pois.forEach(([vi, en, min, yaw], i) => hs(sc, 'poi', yaw, 4 + (i % 3) * 3, { label: L(vi, en), meta: { travel: min, line: 60 + (i % 3) * 50 } }));
    hs(sc, 'info', -10, -20, { label: L('Dự án Skyline Demo', 'Skyline Demo project'), meta: { body: L('Thông tin này được soạn trong trang quản trị: hỗ trợ nhiều dòng, nhiều ngôn ngữ.', 'This popup is authored in the admin.') } });
  }
  hs('tong-the-ban-ngay', 'link', 60, -15, { target_scene_id: S['view-tang-8'], label: L('View tầng 8', 'Floor 8 view') });
  hs('tong-the-ban-ngay', 'link', 90, -12, { target_scene_id: S['1pn-phong-khach'], label: L('Căn hộ mẫu 1PN+', '1BR+ show unit') });
  hs('tong-the-ban-ngay', 'link', 120, -12, { target_scene_id: S['2pn-phong-khach'], label: L('Căn hộ mẫu 2PN', '2BR show unit') });
  hs('view-tang-8', 'link', 0, -20, { target_scene_id: S['view-tang-17'], label: L('Lên tầng 17', 'Up to floor 17') });
  hs('view-tang-17', 'link', 0, -20, { target_scene_id: S['view-tang-25'], label: L('Lên tầng 25', 'Up to floor 25') });
  hs('view-tang-17', 'link', 180, -20, { target_scene_id: S['view-tang-8'], label: L('Xuống tầng 8', 'Down to floor 8') });
  hs('view-tang-25', 'link', 180, -20, { target_scene_id: S['view-tang-17'], label: L('Xuống tầng 17', 'Down to floor 17') });
  hs('view-tang-25', 'video', 40, 0, { label: L('Video giới thiệu', 'Intro video'), meta: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' } });
  // chuỗi phòng trong căn hộ
  for (const list of [u1, u2]) {
    list.forEach(([slug], i) => {
      const next = list[(i + 1) % list.length][0], prev = list[(i - 1 + list.length) % list.length][0];
      hs(slug, 'link', 90, -25, { target_scene_id: S[next], label: L(list[(i + 1) % list.length][1], list[(i + 1) % list.length][2]) });
      hs(slug, 'link', -90, -25, { target_scene_id: S[prev], label: L(list[(i - 1 + list.length) % list.length][1], list[(i - 1 + list.length) % list.length][2]) });
    });
  }

  // ---- Mặt bằng tổng thể: 12 tầng, mỗi tầng 1 polygon (toạ độ chuẩn hoá 0..1) ----
  const master = await image(planSvg('master'), 'plan', L('Phối cảnh tổng thể', 'Masterplan'));
  const planM = insert('plans', { project_id: pid, kind: 'masterplan', name: L('Mặt bằng tổng thể', 'Masterplan'), image_media_id: master, sort: 0 }, COLS.plans);
  const viewFor = (f) => (f >= 10 ? 'view-tang-25' : f >= 6 ? 'view-tang-17' : 'view-tang-8');
  for (let f = 0; f < 12; f++) {
    const y = 800 - f * 50;
    insert('plan_areas', {
      plan_id: planM, shape: 'polygon', sort: f,
      points: [[560, y], [1040, y], [1080, y - 40], [600, y - 40]].map(([x, yy]) => [+(x / 1600).toFixed(4), +(yy / 1000).toFixed(4)]),
      label: L(`Tầng ${f + 1}`, `Floor ${f + 1}`),
      description: L(`Bấm để xem cảnh quan gần nhất từ tầng ${f + 1}.`, `Open the closest view from floor ${f + 1}.`),
      action: { type: 'scene', target: viewFor(f + 1) },
    }, COLS.plan_areas);
  }

  // ---- Mặt bằng tiện ích: điểm đánh số + ảnh minh hoạ ----
  const facImg = await image(planSvg('facility'), 'plan', L('Tầng tiện ích', 'Amenity deck'));
  const planF = insert('plans', { project_id: pid, kind: 'facility', name: L('Tầng 5 – Tiện ích', 'Level 5 – Amenities'), image_media_id: facImg, sort: 1 }, COLS.plans);
  const facs = [['Hồ bơi tràn bờ', 'Infinity pool', 0.34, 0.4, 200], ['Vườn thư giãn', 'Zen garden', 0.69, 0.5, 100], ['Sân chơi trẻ em', 'Kids playground', 0.31, 0.65, 140], ['Khu BBQ', 'BBQ area', 0.8, 0.28, 30], ['Phòng gym', 'Gym', 0.2, 0.25, 260]];
  for (const [i, [vi, en, x, y, hue]] of facs.entries()) {
    const ph = await image(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="hsl(${hue},45%,55%)"/><text x="600" y="420" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${vi} (ảnh demo)</text></svg>`, 'facility', L(vi, en));
    insert('plan_areas', { plan_id: planF, shape: 'point', points: [[x, y]], label: L(vi, en), description: L(`${vi}: mô tả tiện ích soạn trong admin.`, `${en}: described in the admin.`), action: { type: 'image' }, media_id: ph, sort: i }, COLS.plan_areas);
  }

  // ---- Thư viện ----
  for (const [i, [vi, en, hue]] of [['Phối cảnh mặt tiền', 'Facade', 210], ['Sảnh đón', 'Lobby', 35], ['Hồ bơi', 'Pool', 190], ['Căn hộ mẫu', 'Show unit', 20], ['Khu vườn trên cao', 'Sky garden', 120], ['Toàn cảnh đêm', 'Night view', 240]].entries()) {
    await image(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="a" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},50%,40%)"/><stop offset="1" stop-color="hsl(${hue + 40},60%,70%)"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#a)"/><text x="800" y="520" font-size="72" text-anchor="middle" fill="#fff" font-family="sans-serif">${vi}</text></svg>`, 'gallery', L(vi, en));
    run('UPDATE media SET sort=? WHERE id=(SELECT MAX(id) FROM media)', i);
  }
  insert('media', { project_id: pid, kind: 'video', category: 'video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: L('Video demo', 'Demo video'), meta: {} }, COLS.media);
  // Tài liệu PDF demo (tạo bằng tay: PDF tối giản 1 trang)
  const pdfDir = path.join(MEDIA_DIR, 'file-demo-brochure'); fs.mkdirSync(pdfDir, { recursive: true });
  fs.writeFileSync(path.join(pdfDir, 'brochure.pdf'), minimalPdf('Brochure demo - thay bang tai lieu that'));
  insert('media', { project_id: pid, kind: 'pdf', category: 'document', file: 'file-demo-brochure/brochure.pdf', title: L('Brochure (demo)', 'Brochure (demo)'), meta: {} }, COLS.media);
  const legalDir = path.join(MEDIA_DIR, 'file-demo-legal'); fs.mkdirSync(legalDir, { recursive: true });
  fs.writeFileSync(path.join(legalDir, 'giay-phep.pdf'), minimalPdf('Giay phep xay dung - DEMO'));
  insert('media', { project_id: pid, kind: 'pdf', category: 'legal', file: 'file-demo-legal/giay-phep.pdf', title: L('Giấy phép xây dựng (demo)', 'Building permit (demo)'), meta: {} }, COLS.media);

  console.log(`Xong. Dữ liệu tại ${DATA_DIR}`);
}

function minimalPdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 24 Tf 60 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

main().catch((e) => { console.error(e); process.exit(1); });
