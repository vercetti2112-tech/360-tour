// Xác thực admin: mật khẩu băm scrypt, phiên lưu DB, cookie httpOnly + SameSite=Strict.
import crypto from 'node:crypto';
import { get, run } from './db.js';

const SESSION_DAYS = 7;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}

export function destroySession(token) { run('DELETE FROM sessions WHERE token=?', token); }

export function cookieOpts(req) {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_DAYS * 864e5, path: '/' };
}

export function requireAuth(roles) {
  return (req, res, next) => {
    const token = req.cookies?.sid;
    const s = token && get(
      `SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`, token);
    if (!s || s.expires_at < Date.now()) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (roles && !roles.includes(s.role)) return res.status(403).json({ error: 'Không đủ quyền' });
    req.user = s;
    next();
  };
}

// Chống dò mật khẩu: tối đa 10 lần sai / 15 phút / IP
const attempts = new Map();
export function loginThrottle(req, res, next) {
  const k = req.ip, now = Date.now();
  const a = (attempts.get(k) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(k, a);
  if (a.length >= 10) return res.status(429).json({ error: 'Thử lại sau ít phút' });
  req.failLogin = () => a.push(now);
  next();
}
