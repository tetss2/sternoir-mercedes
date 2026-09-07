import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const uid = () => randomUUID();
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const verifyPassword = (password, encoded) => { try { const [salt, hash] = encoded.split(':'); return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } };
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const publicUser = user => user ? { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } : null;

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || resolve(ROOT, 'data');
  const publicDir = options.publicDir || resolve(ROOT, 'public');
  const appUrl = options.appUrl || process.env.APP_URL || '';
  const production = options.production ?? process.env.NODE_ENV === 'production';
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'sternoir.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cars (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),model TEXT NOT NULL,year TEXT NOT NULL DEFAULT '',registration TEXT NOT NULL DEFAULT '',vin TEXT NOT NULL DEFAULT '',reminders_enabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY,public_id TEXT UNIQUE NOT NULL,customer_id TEXT REFERENCES users(id),car_id TEXT REFERENCES cars(id) ON DELETE SET NULL,name TEXT NOT NULL,phone TEXT NOT NULL,model TEXT NOT NULL,service TEXT NOT NULL,symptom TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'new',scheduled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,consent_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),version INTEGER NOT NULL,items TEXT NOT NULL,total INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,approved_at TEXT,approved_by TEXT REFERENCES users(id),UNIQUE(order_id,version));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),author_id TEXT NOT NULL REFERENCES users(id),author_role TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),actor_id TEXT REFERENCES users(id),type TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);
CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Audit events cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Audit events cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS immutable_approved_quote BEFORE UPDATE ON quotes WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'Approved quotes cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS immutable_approved_quote_delete BEFORE DELETE ON quotes WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'Approved quotes cannot be deleted'); END;`);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = work => { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const adminEmail = clean(options.adminEmail || process.env.ADMIN_EMAIL).toLowerCase();
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 14) throw new Error('ADMIN_PASSWORD must contain at least 14 characters');
    const existing = get('SELECT * FROM users WHERE email=?', adminEmail);
    if (existing && existing.role !== 'admin') throw new Error('ADMIN_EMAIL belongs to a customer; use a separate owner address');
    if (!existing) run('INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', uid(), 'Администратор STERNOIR', adminEmail, hashPassword(adminPassword), 'admin', now());
    else if (!verifyPassword(adminPassword, existing.password_hash)) transaction(() => { run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(adminPassword), existing.id); run('DELETE FROM sessions WHERE user_id=?', existing.id); });
  }
  const rates = new Map();
  const rate = (req, category, limit, duration = 15 * 60_000) => {
    // Railway sets X-Forwarded-For. Local development uses the socket address.
    const ip = production ? clean(req.headers['x-forwarded-for']?.split(',').at(-1), 100) || req.socket.remoteAddress : req.socket.remoteAddress;
    const key = `${category}:${ip}`; const time = Date.now();
    if (rates.size > 10000) for (const [k,v] of rates) if (v.until < time) rates.delete(k);
    const entry = rates.get(key); if (!entry || entry.until < time) { rates.set(key, { count: 1, until: time + duration }); return; }
    entry.count++; if (entry.count > limit) fail(429, 'Слишком много попыток. Повторите позже.');
  };
  const event = (orderId, actor, type, body) => run('INSERT INTO events VALUES(?,?,?,?,?,?)', uid(), orderId, actor || null, type, body, now());
  const quoteShape = quote => quote ? { id: quote.id, version: quote.version, items: JSON.parse(quote.items), total: quote.total, note: quote.note, status: quote.status, createdAt: quote.created_at, approvedAt: quote.approved_at } : null;
  const latestQuote = id => get('SELECT * FROM quotes WHERE order_id=? ORDER BY version DESC LIMIT 1', id);
  const orderShape = order => ({ id: order.id, publicId: order.public_id, customerId: order.customer_id, carId: order.car_id, name: order.name, phone: order.phone, model: order.model, service: order.service, symptom: order.symptom, status: order.status, scheduledAt: order.scheduled_at, createdAt: order.created_at, updatedAt: order.updated_at,
    quote: quoteShape(latestQuote(order.id)), quotes: all('SELECT * FROM quotes WHERE order_id=? ORDER BY version DESC', order.id).map(quoteShape),
    messages: all('SELECT id,author_role AS authorRole,body,created_at AS createdAt FROM messages WHERE order_id=? ORDER BY rowid', order.id),
    events: all('SELECT id,type,body,created_at AS createdAt FROM events WHERE order_id=? ORDER BY rowid', order.id) });
  const carsFor = id => all('SELECT id,model,year,registration,vin,reminders_enabled AS remindersEnabled,created_at AS createdAt FROM cars WHERE user_id=? ORDER BY created_at DESC', id).map(c => ({ ...c, remindersEnabled: !!c.remindersEnabled }));
  const sessionUser = req => { const cookie = req.headers.cookie?.match(/(?:^|;\s*)sternoir_session=([a-f0-9]{64})(?:;|$)/)?.[1]; if (!cookie) return null; return get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', sha(cookie), Date.now()) || null; };
  const requireUser = user => { if (!user) fail(401, 'Войдите в личный кабинет.'); return user; };
  const requireAdmin = user => { requireUser(user); if (user.role !== 'admin') fail(403, 'Недостаточно прав.'); };
  const ownOrder = (id, user, adminOnly = false) => { requireUser(user); if (adminOnly) requireAdmin(user); const order = get('SELECT * FROM orders WHERE id=?', id); if (!order || (user.role !== 'admin' && order.customer_id !== user.id)) fail(404, 'Заказ не найден.'); return order; };
  const setSession = (res, user) => { const token = randomBytes(32).toString('hex'); run('DELETE FROM sessions WHERE expires_at<?', Date.now()); run('INSERT INTO sessions VALUES(?,?,?)', sha(token), user.id, Date.now() + 7 * 86400000); res.setHeader('Set-Cookie', `sternoir_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${production ? '; Secure' : ''}`); };
  const readBody = async req => { if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Используйте application/json.'); let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32768) fail(413, 'Слишком большой запрос.'); } try { const parsed = JSON.parse(body || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail(400, 'Некорректный JSON.'); return parsed; } catch { fail(400, 'Некорректный JSON.'); } };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const transitions = { new:['contacted','scheduled','cancelled'], contacted:['scheduled','diagnostics','cancelled'], scheduled:['diagnostics','cancelled'], diagnostics:['awaiting_approval','cancelled'], awaiting_approval:['in_progress','diagnostics','cancelled'], in_progress:['ready','diagnostics'], ready:['completed','in_progress'], completed:[], cancelled:[] };
  const statusNames = {new:'Новая заявка',contacted:'Связались с клиентом',scheduled:'Визит подтверждён',diagnostics:'Диагностика',awaiting_approval:'Согласование сметы',in_progress:'В работе',ready:'Готов к выдаче',completed:'Завершён',cancelled:'Отменён'};
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost'); const path = decodeURIComponent(url.pathname); const method = req.method;
      if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
      if (!path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(method)) fail(405, 'Метод не поддерживается.');
        let file = resolve(publicDir, `.${path}`);
        if (file !== publicDir && !file.startsWith(publicDir + sep)) fail(404, 'Страница не найдена.');
        if (!existsSync(file) || statSync(file).isDirectory()) {
          if (extname(path)) fail(404, 'Файл не найден.');
          file = resolve(publicDir, 'index.html');
        }
        if (!existsSync(file)) fail(404, 'Страница не найдена.');
        const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff':'font/woff','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'}[extname(file)] || 'application/octet-stream';
        const stat = statSync(file); res.setHeader('Content-Type', type); res.setHeader('Cache-Control', type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600');
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) { const start = Number(range[1]), end = Math.min(Number(range[2] || stat.size - 1), stat.size - 1); if (start > end || start >= stat.size) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); return res.end(); } res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges':'bytes', 'Content-Length':end-start+1 }); return res.end(method === 'HEAD' ? undefined : readFileSync(file).subarray(start, end+1)); }
        res.writeHead(200, { 'Content-Length':stat.size, 'Accept-Ranges':'bytes' }); return res.end(method === 'HEAD' ? undefined : readFileSync(file));
      }
      if (!['GET','POST','PATCH','DELETE'].includes(method)) fail(405, 'Метод не поддерживается.');
      if (method !== 'GET') {
        const expected = appUrl ? new URL(appUrl).origin : `${production ? 'https' : 'http'}://${req.headers.host}`;
        if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Запрос должен быть отправлен с сайта сервиса.');
      }
      const user = sessionUser(req);
      if (path === '/api/auth/me' && method === 'GET') return json(res, 200, { user: publicUser(user) });
      const body = method !== 'GET' ? await readBody(req) : {};
      if (path === '/api/auth/register' && method === 'POST') {
        rate(req, 'register', 8);
        const name = clean(body.name, 100), email = clean(body.email, 254).toLowerCase(), password = body.password;
        if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400, 'Укажите имя, email и пароль от 10 до 128 символов.');
        if (get('SELECT id FROM users WHERE email=?', email)) fail(409, 'Аккаунт с этим email уже существует.');
        const id = uid(); run('INSERT INTO users(id,name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?,?)', id, name, email, clean(body.phone, 40), hashPassword(password), now());
        const created = get('SELECT * FROM users WHERE id=?', id); setSession(res, created); return json(res, 201, { user: publicUser(created) });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        rate(req, 'login', 15); const email = clean(body.email, 254).toLowerCase(); const account = get('SELECT * FROM users WHERE email=?', email);
        if (typeof body.password !== 'string' || body.password.length > 128) fail(400, 'Некорректный пароль.');
        // Perform scrypt for unknown addresses too, avoiding a cheap enumeration timing signal.
        const valid = verifyPassword(body.password, account?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64));
        if (!account || !valid) fail(401, 'Неверный email или пароль.');
        setSession(res, account); return json(res, 200, { user: publicUser(account) });
      }
      if (path === '/api/auth/logout' && method === 'POST') { const token = req.headers.cookie?.match(/(?:^|;\s*)sternoir_session=([a-f0-9]{64})(?:;|$)/)?.[1]; if (token) run('DELETE FROM sessions WHERE token_hash=?', sha(token)); res.setHeader('Set-Cookie', `sternoir_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production?'; Secure':''}`); return json(res, 200, { ok:true }); }
      if (path === '/api/bookings' && method === 'POST') {
        rate(req, 'booking', 10, 3600000);
        const name = clean(body.name, 100), phone = clean(body.phone, 40), model = clean(body.model, 100), service = clean(body.service, 160), symptom = clean(body.symptom, 3000);
        if (name.length < 2 || phone.replace(/\D/g,'').length < 10 || !model || !service || body.consent !== true) fail(400, 'Укажите имя, телефон, модель, услугу и согласие на обработку заявки.');
        let carId = null; if (body.carId) { requireUser(user); const car = get('SELECT id FROM cars WHERE id=? AND user_id=?', clean(body.carId, 64), user.id); if (!car) fail(404, 'Автомобиль не найден.'); carId = car.id; }
        const id = uid(), time = now(), publicId = `SN-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
        transaction(() => { run('INSERT INTO orders(id,public_id,customer_id,car_id,name,phone,model,service,symptom,created_at,updated_at,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, publicId, user?.id || null, carId, name, phone, model, service, symptom, time, time, time); event(id, user?.id, 'booking_created', 'Заявка получена. Время визита требует подтверждения сервисом.'); });
        return json(res, 201, { booking:orderShape(get('SELECT * FROM orders WHERE id=?', id)) });
      }
      if (path === '/api/account' && method === 'GET') { requireUser(user); return json(res, 200, { user:publicUser(user), cars:carsFor(user.id), orders:all('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC', user.id).map(orderShape), reminders:[] }); }
      if (path === '/api/cars' && method === 'POST') {
        requireUser(user); const model = clean(body.model, 100); if (!model) fail(400, 'Укажите модель.'); if (get('SELECT COUNT(*) AS n FROM cars WHERE user_id=?', user.id).n >= 30) fail(400, 'В гараже может быть не более 30 автомобилей.');
        const id = uid(); run('INSERT INTO cars VALUES(?,?,?,?,?,?,?,?)', id, user.id, model, clean(body.year,4), clean(body.registration,20), clean(body.vin,17).toUpperCase(), body.remindersEnabled ? 1:0, now());
        return json(res, 201, { car:carsFor(user.id).find(c=>c.id===id) });
      }
      let match = path.match(/^\/api\/cars\/([^/]+)$/);
      if (match && ['PATCH','DELETE'].includes(method)) { requireUser(user); const car = get('SELECT * FROM cars WHERE id=? AND user_id=?', match[1], user.id); if (!car) fail(404,'Автомобиль не найден.'); if (method === 'DELETE') { run('DELETE FROM cars WHERE id=?', car.id); return json(res,200,{ok:true}); } const model = body.model === undefined ? car.model : clean(body.model,100); if (!model) fail(400,'Укажите модель.'); run('UPDATE cars SET model=?,year=?,registration=?,vin=?,reminders_enabled=? WHERE id=?', model, body.year === undefined ? car.year : clean(body.year,4), body.registration === undefined ? car.registration : clean(body.registration,20), body.vin === undefined ? car.vin : clean(body.vin,17).toUpperCase(), body.remindersEnabled === undefined ? car.reminders_enabled : body.remindersEnabled?1:0, car.id); return json(res,200,{car:carsFor(user.id).find(c=>c.id===car.id)}); }
      match = path.match(/^\/api\/(admin\/)?orders\/([^/]+)\/messages$/);
      if (match && method === 'POST') { const order = ownOrder(match[2], user, !!match[1]); rate(req,'messages',60); const message = clean(body.body,4000); if (!message) fail(400,'Введите сообщение.'); run('INSERT INTO messages VALUES(?,?,?,?,?,?)',uid(),order.id,user.id,user.role,message,now()); return json(res,201,{order:orderShape(order)}); }
      match = path.match(/^\/api\/orders\/([^/]+)\/approve$/);
      if (match && method === 'POST') {
        const order = ownOrder(match[1], user); if (user.role !== 'customer' || order.customer_id !== user.id) fail(403,'Смету согласовывает владелец заказа.');
        transaction(() => { const quote = latestQuote(order.id); if (!quote || quote.id !== body.quoteId || quote.status !== 'pending' || order.status !== 'awaiting_approval') fail(409,'Смета изменилась или уже обработана. Обновите заказ.'); const time=now(); run('UPDATE quotes SET status=?,approved_at=?,approved_by=? WHERE id=?','approved',time,user.id,quote.id); run('UPDATE orders SET updated_at=? WHERE id=?',time,order.id); event(order.id,user.id,'quote_approved',`Согласована смета №${quote.version}: ${quote.total} ₽. ID ${quote.id}.`); });
        return json(res,200,{order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))});
      }
      match = path.match(/^\/api\/orders\/([^/]+)\/reject$/);
      if (match && method === 'POST') { const order = ownOrder(match[1],user); if (user.role !== 'customer' || order.customer_id !== user.id) fail(403,'Смету рассматривает владелец заказа.'); const reason=clean(body.reason,2000); if(!reason)fail(400,'Укажите, что нужно изменить или уточнить.'); transaction(()=>{const quote=latestQuote(order.id);if(!quote||quote.id!==body.quoteId||quote.status!=='pending'||order.status!=='awaiting_approval')fail(409,'Смета изменилась или уже обработана.');run('UPDATE quotes SET status=? WHERE id=?','rejected',quote.id);run('UPDATE orders SET status=?,updated_at=? WHERE id=?','diagnostics',now(),order.id);event(order.id,user.id,'quote_rejected',`Смета №${quote.version} не согласована: ${reason}`);});return json(res,200,{order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))}); }
      if (path === '/api/admin' && method === 'GET') { requireAdmin(user); return json(res,200,{user:publicUser(user),orders:all('SELECT * FROM orders ORDER BY created_at DESC').map(orderShape),customers:all("SELECT id,name,email,phone,role FROM users WHERE role='customer' ORDER BY created_at DESC")}); }
      match = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
      if (match && method === 'PATCH') {
        const order=ownOrder(match[1],user,true); const status=body.status || order.status;
        if (status !== order.status && !transitions[order.status]?.includes(status)) fail(409,'Этот переход статуса недоступен.');
        if (order.status === 'in_progress' && status === 'diagnostics' && !clean(body.note || body.reason,2000)) fail(400,'Укажите причину приостановки ремонта и дополнительной диагностики.');
        if (status === 'in_progress' && latestQuote(order.id)?.status !== 'approved') fail(409,'Начать ремонт можно только после согласования актуальной сметы клиентом.');
        if (status === 'awaiting_approval' && latestQuote(order.id)?.status !== 'pending') fail(409,'Сначала подготовьте актуальную смету.');
        let customerId=order.customer_id;
        if (body.customerId !== undefined) { if (order.customer_id) fail(409,'Владелец заказа уже закреплён.'); const customer=get("SELECT id FROM users WHERE id=? AND role='customer'",clean(body.customerId,64)); if(!customer)fail(404,'Клиент не найден.');customerId=customer.id; }
        const scheduledAt=body.scheduledAt===undefined?order.scheduled_at:body.scheduledAt===null?null:clean(body.scheduledAt,40);
        if(scheduledAt && Number.isNaN(Date.parse(scheduledAt)))fail(400,'Некорректная дата визита.');
        transaction(()=>{run('UPDATE orders SET status=?,scheduled_at=?,customer_id=?,updated_at=? WHERE id=?',status,scheduledAt,customerId,now(),order.id);if(status!==order.status)event(order.id,user.id,'status_changed',`Статус: ${statusNames[status] || status}`);if(body.scheduledAt!==undefined)event(order.id,user.id,'visit_scheduled',scheduledAt?`Визит: ${new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(scheduledAt))} (МСК)`:'Время визита снято.');if(customerId!==order.customer_id)event(order.id,user.id,'customer_linked','Заказ добавлен в личный кабинет клиента администратором.');if(order.status==='in_progress'&&status==='diagnostics')event(order.id,user.id,'work_paused',`Ремонт приостановлен: ${clean(body.note||body.reason,2000)}. Дополнительные работы требуют новой сметы и согласования.`);else if(clean(body.note,2000))event(order.id,user.id,'advisor_note',clean(body.note,2000));});
        return json(res,200,{order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))});
      }
      match=path.match(/^\/api\/admin\/orders\/([^/]+)\/quote$/);
      if(match&&method==='POST'){
        const order=ownOrder(match[1],user,true);if(!['diagnostics','awaiting_approval'].includes(order.status))fail(409,'Смета доступна на этапе диагностики или согласования.');
        if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)fail(400,'Добавьте от 1 до 50 позиций сметы.');
        const items=body.items.map(item=>{const title=clean(item?.title,200),quantity=Number(item?.quantity),unitPrice=Number(item?.unitPrice);if(!title||!Number.isSafeInteger(quantity)||quantity<1||quantity>100||!Number.isSafeInteger(unitPrice)||unitPrice<0||unitPrice>10000000)fail(400,'Позиция сметы: название, целое количество 1–100, цена в рублях.');return{title,quantity,unitPrice};});
        const total=items.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);if(total<1||total>100000000)fail(400,'Проверьте сумму сметы.');
        transaction(()=>{const previous=latestQuote(order.id);if(previous?.status==='pending')run('UPDATE quotes SET status=? WHERE id=?','superseded',previous.id);const version=(previous?.version||0)+1;run('INSERT INTO quotes(id,order_id,version,items,total,note,created_at) VALUES(?,?,?,?,?,?,?)',uid(),order.id,version,JSON.stringify(items),total,clean(body.note,2000),now());run('UPDATE orders SET status=?,updated_at=? WHERE id=?','awaiting_approval',now(),order.id);event(order.id,user.id,'quote_created',`Подготовлена смета №${version}: ${total} ₽. Ожидает согласования владельцем.`);});
        return json(res,201,{order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))});
      }
      fail(404,'Раздел API не найден.');
    } catch(error) { if (!res.headersSent) json(res,error.status||500,{error:error.status?error.message:'Не удалось обработать запрос. Повторите позже.'}); else res.end(); if (!error.status) console.error('Request failed:', error.code || error.name); }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,db,close:()=>new Promise(resolveClose=>server.close(()=>{db.close();resolveClose();}))};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const app=createApp();app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('STERNOIR server ready'));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0))); }
