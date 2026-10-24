// Sushida Malahide - zero-dependency Node.js server (Node >= 22.13).
// Run: node server.js  ->  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT) || config.port || 3000;
const SESSION_DAYS = 30;

// ---------- Database ----------
const db = new DatabaseSync(path.join(DATA, 'sushida.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    eircode TEXT DEFAULT '',
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    delivery_fee REAL NOT NULL,
    total REAL NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT DEFAULT '',
    eircode TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    payment TEXT NOT NULL,
    when_label TEXT NOT NULL,
    chopsticks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    people INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Passwords ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

// Admin account: from ADMIN_EMAIL / ADMIN_PASSWORD env vars when set (hosting),
// otherwise seeded on first run with a random password written to a local file, never logged.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const hash = hashPassword(process.env.ADMIN_PASSWORD);
  if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
    db.prepare(`UPDATE users SET pass_hash = ?, role = 'admin' WHERE email = ?`).run(hash, email);
  } else {
    db.prepare(`INSERT INTO users (name, email, pass_hash, role) VALUES ('Sushida Admin', ?, ?, 'admin')`).run(email, hash);
  }
} else if (!db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get()) {
  const email = 'admin@sushida.local';
  const password = crypto.randomBytes(9).toString('base64url');
  db.prepare(`INSERT INTO users (name, email, pass_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run('Sushida Admin', email, hashPassword(password));
  fs.writeFileSync(path.join(DATA, 'ADMIN_CREDENTIALS.txt'),
    `Sushida admin login\nEmail: ${email}\nPassword: ${password}\n\nChange or delete this file after noting the password.\n`);
  console.log(`Admin account created - see data/ADMIN_CREDENTIALS.txt`);
}

// ---------- Menu ----------
let menu, menuIndex;
function loadMenu() {
  menu = JSON.parse(fs.readFileSync(path.join(DATA, 'menu.json'), 'utf8'));
  menuIndex = new Map();
  for (const c of menu.categories) for (const it of c.items) menuIndex.set(it.id, it);
}
loadMenu();
fs.watchFile(path.join(DATA, 'menu.json'), { interval: 2000 }, () => {
  try { loadMenu(); console.log('menu.json reloaded'); } catch (e) { console.error('menu.json invalid:', e.message); }
});

// ---------- Time helpers (restaurant timezone) ----------
function nowInRestaurant() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.restaurant.timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) % 24 * 60 + Number(parts.minute) };
}
function isOpen() {
  const { minutes } = nowInRestaurant();
  return minutes >= config.restaurant.openHour * 60 && minutes < config.restaurant.closeHour * 60;
}

// ---------- HTTP helpers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src https://maps.google.com https://www.google.com; script-src 'self'",
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 100_000) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const round2 = n => Math.round(n * 100) / 100;

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.address, u.eircode, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  delete row.expires_at;
  return row;
}
function requireUser(req) { const u = currentUser(req); if (!u) throw new HttpError(401, 'Please log in'); return u; }
function requireAdmin(req) { const u = requireUser(req); if (u.role !== 'admin') throw new HttpError(403, 'Admins only'); return u; }

function startSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}` };
}

// Basic brute-force protection for login: 8 attempts per 15 min per IP+email.
const loginAttempts = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { count: 0, reset: now + 15 * 60e3 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 15 * 60e3; }
  rec.count++; loginAttempts.set(key, rec);
  if (rec.count > 8) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

const ORDER_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
const orderOut = o => ({ ...o, items: JSON.parse(o.items), chopsticks: !!o.chopsticks });

// ---------- Routes ----------
const routes = {
  'GET /api/config': () => ({
    restaurant: config.restaurant, delivery: config.delivery, collection: config.collection,
    open: isOpen(), now: nowInRestaurant(),
  }),
  'GET /api/menu': () => menu,

  'POST /api/register': async (req, res) => {
    const b = await readJson(req);
    const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 30);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!name) throw new HttpError(400, 'Please enter your name');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) throw new HttpError(409, 'An account with this email already exists');
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (name, email, phone, pass_hash) VALUES (?, ?, ?, ?)`)
      .run(name, email, phone, hashPassword(password));
    const headers = startSession(res, Number(lastInsertRowid), req);
    return [201, { ok: true }, headers];
  },

  'POST /api/login': async (req, res) => {
    const b = await readJson(req);
    const email = str(b.email, 120).toLowerCase();
    checkRateLimit(`${req.socket.remoteAddress}|${email}`);
    const user = db.prepare(`SELECT id, pass_hash FROM users WHERE email = ?`).get(email);
    if (!user || !verifyPassword(String(b.password || ''), user.pass_hash)) throw new HttpError(401, 'Incorrect email or password');
    return [200, { ok: true }, startSession(res, user.id, req)];
  },

  'POST /api/logout': (req) => {
    const token = parseCookies(req).sid;
    if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
    return [200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }];
  },

  'GET /api/me': (req) => ({ user: currentUser(req) }),

  'PUT /api/me': async (req) => {
    const u = requireUser(req);
    const b = await readJson(req);
    const name = str(b.name, 80) || u.name;
    db.prepare(`UPDATE users SET name = ?, phone = ?, address = ?, eircode = ? WHERE id = ?`)
      .run(name, str(b.phone, 30), str(b.address, 200), str(b.eircode, 10).toUpperCase(), u.id);
    if (b.newPassword) {
      const row = db.prepare(`SELECT pass_hash FROM users WHERE id = ?`).get(u.id);
      if (!verifyPassword(String(b.currentPassword || ''), row.pass_hash)) throw new HttpError(400, 'Current password is incorrect');
      if (String(b.newPassword).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
      db.prepare(`UPDATE users SET pass_hash = ? WHERE id = ?`).run(hashPassword(String(b.newPassword)), u.id);
    }
    return { user: currentUser(req) };
  },

  'POST /api/orders': async (req) => {
    const u = requireUser(req);
    const b = await readJson(req);
    const type = b.type === 'delivery' ? 'delivery' : 'collection';

    // Prices are always recalculated from the server-side menu.
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Your basket is empty');
    const items = b.items.slice(0, 50).map(i => {
      const m = menuIndex.get(i.id);
      const qty = Math.min(Math.max(parseInt(i.qty, 10) || 0, 0), 30);
      if (!m || !qty) throw new HttpError(400, 'An item in your basket is no longer available');
      return { id: m.id, name: m.name, price: m.price, qty };
    });
    const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));

    const name = str(b.name, 80) || u.name;
    const phone = str(b.phone, 30);
    if (!/^[+\d][\d\s-]{6,}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number');

    let address = '', eircode = '', fee = 0;
    if (type === 'delivery') {
      const d = config.delivery;
      address = str(b.address, 200);
      eircode = str(b.eircode, 10).toUpperCase().replace(/\s+/g, ' ');
      if (!address) throw new HttpError(400, 'Please enter your delivery address');
      if (!d.allowedEircodePrefixes.some(p => eircode.startsWith(p))) {
        throw new HttpError(400, `Sorry, we only deliver to ${d.allowedEircodePrefixes.join(', ')} Eircodes. Collection is available!`);
      }
      if (subtotal < d.minOrder) throw new HttpError(400, `Minimum order for delivery is €${d.minOrder.toFixed(2)}`);
      fee = subtotal >= d.freeOver ? 0 : d.fee;
    }

    // When: "asap" (only while open) or "HH:MM" later today within opening hours.
    const { openHour, closeHour } = config.restaurant;
    const eta = (type === 'delivery' ? config.delivery : config.collection).etaMinutes;
    const now = nowInRestaurant().minutes;
    let whenLabel;
    if (b.when === 'asap' || !b.when) {
      if (!isOpen()) throw new HttpError(400, `We're closed right now - please choose a time for later (opening ${openHour}:00).`);
      whenLabel = 'ASAP';
    } else {
      const m = /^(\d{2}):(\d{2})$/.exec(String(b.when));
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : -1;
      if (mins < openHour * 60 || mins > closeHour * 60 - 15 || mins < now + eta - 5) throw new HttpError(400, 'Please choose a valid time slot');
      whenLabel = String(b.when);
    }

    const payment = b.payment === 'card_on_arrival' ? 'card_on_arrival' : 'cash';
    const total = round2(subtotal + fee);
    const { lastInsertRowid } = db.prepare(`INSERT INTO orders
      (user_id, type, items, subtotal, delivery_fee, total, name, phone, address, eircode, notes, payment, when_label, chopsticks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u.id, type, JSON.stringify(items), subtotal, fee, total, name, phone, address, eircode, str(b.notes, 300), payment, whenLabel, b.chopsticks ? 1 : 0);

    // Remember details for next time.
    db.prepare(`UPDATE users SET phone = ?, address = CASE WHEN ? != '' THEN ? ELSE address END, eircode = CASE WHEN ? != '' THEN ? ELSE eircode END WHERE id = ?`)
      .run(phone, address, address, eircode, eircode, u.id);

    return [201, { order: orderOut(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(lastInsertRowid)) }];
  },

  'GET /api/orders': (req) => {
    const u = requireUser(req);
    return { orders: db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(u.id).map(orderOut) };
  },

  'POST /api/reservations': async (req) => {
    const u = currentUser(req);
    const b = await readJson(req);
    const name = str(b.name, 80), email = str(b.email, 120), phone = str(b.phone, 30);
    const date = str(b.date, 10), time = str(b.time, 5), people = parseInt(b.people, 10);
    if (!name || !EMAIL_RE.test(email) || !phone) throw new HttpError(400, 'Please fill in your name, email and phone');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, 'Please choose a date and time');
    if (!(people >= 1 && people <= 20)) throw new HttpError(400, 'Party size must be between 1 and 20 (call us for larger groups)');
    const today = nowInRestaurant();
    if (date < today.date) throw new HttpError(400, 'That date is in the past');
    if (date === today.date && today.minutes >= 14 * 60) throw new HttpError(400, 'Same-day online bookings close at 2pm - please call us');
    db.prepare(`INSERT INTO reservations (user_id, name, email, phone, date, time, people, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(u ? u.id : null, name, email, phone, date, time, people, str(b.notes, 300));
    return [201, { ok: true }];
  },

  // ----- Admin -----
  'GET /api/admin/orders': (req) => {
    requireAdmin(req);
    return { orders: db.prepare(`SELECT * FROM orders ORDER BY id DESC LIMIT 200`).all().map(orderOut) };
  },
  'GET /api/admin/reservations': (req) => {
    requireAdmin(req);
    return { reservations: db.prepare(`SELECT * FROM reservations ORDER BY date DESC, time DESC LIMIT 200`).all() };
  },
};

// Routes with an :id parameter
const paramRoutes = [
  ['PATCH', /^\/api\/admin\/orders\/(\d+)$/, async (req, id) => {
    requireAdmin(req);
    const b = await readJson(req);
    if (!ORDER_STATUSES.includes(b.status)) throw new HttpError(400, 'Invalid status');
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(b.status, id);
    return { order: orderOut(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id)) };
  }],
  ['PATCH', /^\/api\/admin\/reservations\/(\d+)$/, async (req, id) => {
    requireAdmin(req);
    const b = await readJson(req);
    if (!['pending', 'confirmed', 'declined'].includes(b.status)) throw new HttpError(400, 'Invalid status');
    db.prepare(`UPDATE reservations SET status = ? WHERE id = ?`).run(b.status, id);
    return { ok: true };
  }],
];

// ---------- Static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(PUBLIC, 'index.html'); // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- Server ----------
http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      // CSRF defence: state-changing API calls must come from our own pages.
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'sushida') throw new HttpError(403, 'Bad request origin');
      let handler = routes[`${req.method} ${pathname}`], param;
      if (!handler) for (const [m, re, h] of paramRoutes) { const mm = req.method === m && re.exec(pathname); if (mm) { handler = h; param = Number(mm[1]); break; } }
      if (!handler) throw new HttpError(404, 'Not found');
      const out = await handler(req, param ?? res);
      if (Array.isArray(out)) return send(res, out[0], out[1], out[2]);
      return send(res, 200, out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong' });
  }
}).listen(PORT, () => console.log(`Sushida Malahide running on http://localhost:${PORT}`));

// Housekeeping: drop expired sessions hourly.
setInterval(() => db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now()), 3600e3).unref();
