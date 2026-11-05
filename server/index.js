import { app } from './app.js';
import { get, insert } from './db.js';
import { hashPassword } from './auth.js';

// Tạo tài khoản admin đầu tiên nếu chưa có
if (!get('SELECT id FROM users LIMIT 1')) {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const pw = process.env.ADMIN_PASSWORD || 'admin12345';
  insert('users', { email, name: 'Quản trị', role: 'admin', pass_hash: hashPassword(pw) }, ['email', 'name', 'role', 'pass_hash']);
  console.log(`[init] Tạo admin: ${email} / ${pw}  — hãy đổi mật khẩu sau khi đăng nhập`);
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`VR Tour CMS chạy tại http://localhost:${port}  (admin: /admin)`));
