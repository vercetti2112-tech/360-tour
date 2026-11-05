# VR Tour CMS — Tour 360° bất động sản có trang quản trị

Viết lại toàn bộ chức năng của một tour 360° kiểu "Panotour/krpano + trang con tĩnh", có thêm backend và CMS.
Không dùng ảnh, logo, nội dung hay mã nguồn của bên thứ ba: dữ liệu demo được tạo tự động.

## Chạy

```bash
npm install
npm run seed      # tạo dữ liệu demo (xoá dữ liệu cũ!)
npm start         # http://localhost:3000  — admin: /admin
```
Tài khoản đầu tiên: `ADMIN_EMAIL` / `ADMIN_PASSWORD` (mặc định `admin@example.com` / `admin12345`, hãy đổi ngay).
Biến môi trường: `PORT`, `DATA_DIR` (DB + media), `PUBLIC_URL` (dùng cho canonical/OG/sitemap khi chạy sau proxy).

Yêu cầu Node ≥ 22.5 (dùng SQLite tích hợp `node:sqlite`, không cần build native).

## Cấu trúc
```
server/
  db.js       schema SQLite (dự án, nhóm, cảnh, hotspot, bản vẽ, vùng, media, lead, sự kiện, người dùng)
  images.js   pipeline ảnh: ảnh 360 → tile 512px + ảnh nền + thumbnail + ảnh OG; ảnh thường → bản tối ưu + thumb
  tour.js     dựng "tour JSON" công khai từ DB (cache + ETag), ẩn khoá bí mật
  app.js      route công khai (SSR meta theo URL, sitemap, robots, lead, tracking, thời tiết) + API admin
  auth.js     đăng nhập scrypt, phiên httpOnly SameSite=Strict, chống dò mật khẩu
  seed.js     dữ liệu demo
public/
  viewer.html + assets/viewer.(js|css)   trình xem (Photo Sphere Viewer, không jQuery)
  admin/                                 trang quản trị (SPA thuần JS)
```

## URL
| URL | Nội dung |
|---|---|
| `/{du-an}` | cảnh mở đầu |
| `/{du-an}/{slug-canh}` | một cảnh — meta/OG riêng; `?v=yaw,pitch,zoom` mở đúng góc nhìn; `?lang=en` |
| `/{du-an}/vi-tri`, `/mat-bang`, `/tien-ich`, `/thu-vien` | trang con (lớp phủ trong cùng một trang) |
| `/sitemap.xml`, `/robots.txt` | SEO |
| `/admin` | quản trị |

## Vai trò
- **admin**: toàn quyền, quản lý người dùng & dự án
- **editor**: sửa nội dung
- **sales**: chỉ xem lead & thống kê

## Webhook CRM
Khi có lead mới, server gửi `POST` JSON `{event:"lead.created", project, lead}` tới URL webhook (https) cấu hình trong *Cài đặt dự án*. Kết quả gửi lưu ở cột "CRM" của trang Lead.
