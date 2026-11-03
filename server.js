'use strict';

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const required = ['DATABASE_URL', 'SESSION_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD_HASH'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'ffx_wallet_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 6 }
}));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      bkash_number VARCHAR(30) NOT NULL DEFAULT '',
      nagad_number VARCHAR(30) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS deposit_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id),
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      method VARCHAR(10) NOT NULL CHECK (method IN ('bKash','Nagad')),
      sender_number VARCHAR(30) NOT NULL,
      trxid VARCHAR(100) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
      admin_note VARCHAR(250) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS deposit_trxid_unique ON deposit_requests (LOWER(trxid));
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES app_users(id),
      deposit_id BIGINT UNIQUE REFERENCES deposit_requests(id),
      amount NUMERIC(12,2) NOT NULL,
      description VARCHAR(160) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function requireUser(req, res, next) {
  if (!req.session.userId || req.session.isAdmin) return res.status(401).json({ error: 'প্রথমে লগইন করুন' });
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.isAdmin !== true) return res.status(401).json({ error: 'Admin login required' });
  next();
}
function cleanText(v, max) { return String(v || '').trim().slice(0, max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', async (req, res) => {
  try {
    const name = cleanText(req.body.name, 60);
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || !validEmail(email) || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'নাম, সঠিক ইমেইল এবং কমপক্ষে ৮ অক্ষরের পাসওয়ার্ড দিন' });
    const hash = await bcrypt.hash(password, 12);
    const q = await pool.query('INSERT INTO app_users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,balance', [name,email,hash]);
    req.session.userId = q.rows[0].id;
    req.session.isAdmin = false;
    res.json({ user: q.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'এই ইমেইলে অ্যাকাউন্ট আগে থেকেই আছে' });
    console.error(e); res.status(500).json({ error: 'অ্যাকাউন্ট তৈরি করা যায়নি' });
  }
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = cleanText(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    const q = await pool.query('SELECT id,name,email,password_hash,balance FROM app_users WHERE email=$1', [email]);
    if (!q.rowCount || !(await bcrypt.compare(password, q.rows[0].password_hash))) return res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড সঠিক নয়' });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      req.session.userId = q.rows[0].id;
      req.session.isAdmin = false;
      req.session.save(saveErr => saveErr ? res.status(500).json({ error: 'Login failed' }) : res.json({ user: { id:q.rows[0].id,name:q.rows[0].name,email:q.rows[0].email,balance:q.rows[0].balance } }));
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
});
app.post('/api/auth/logout', (req,res) => req.session.destroy(() => { res.clearCookie('ffx_wallet_session'); res.json({ ok:true }); }));
app.get('/api/auth/me', async (req,res) => {
  if (!req.session.userId || req.session.isAdmin) return res.json({ user:null });
  const q = await pool.query('SELECT id,name,email,balance FROM app_users WHERE id=$1', [req.session.userId]);
  if (!q.rowCount) return res.json({ user:null });
  res.json({ user:q.rows[0] });
});
app.get('/api/payment-settings', async (_req,res) => {
  const q = await pool.query('SELECT bkash_number,nagad_number FROM payment_settings WHERE id=1');
  res.json(q.rows[0] || { bkash_number:'', nagad_number:'' });
});
app.get('/api/deposits/mine', requireUser, async (req,res) => {
  const q = await pool.query('SELECT id,amount,method,sender_number,trxid,status,admin_note,created_at FROM deposit_requests WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [req.session.userId]);
  res.json({ deposits:q.rows });
});
app.post('/api/deposits', requireUser, async (req,res) => {
  try {
    const amount = Number(req.body.amount);
    const method = req.body.method;
    const sender = cleanText(req.body.sender_number,30);
    const trxid = cleanText(req.body.trxid,100);
    if (!Number.isFinite(amount) || amount < 10 || amount > 100000 || Math.round(amount*100)!==amount*100)
      return res.status(400).json({ error:'১০ থেকে ১,০০,০০০ টাকার মধ্যে সঠিক পরিমাণ দিন' });
    if (!['bKash','Nagad'].includes(method) || !/^01[3-9]\d{8}$/.test(sender) || trxid.length < 5)
      return res.status(400).json({ error:'পেমেন্টের তথ্য সঠিকভাবে পূরণ করুন' });
    const q = await pool.query('INSERT INTO deposit_requests(user_id,amount,method,sender_number,trxid) VALUES($1,$2,$3,$4,$5) RETURNING id,status,created_at', [req.session.userId,amount,method,sender,trxid]);
    res.status(201).json({ deposit:q.rows[0], message:'আবেদন জমা হয়েছে। Admin যাচাই করার পর ব্যালেন্স যোগ হবে।' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error:'এই TrxID আগে জমা দেওয়া হয়েছে' });
    console.error(e); res.status(500).json({ error:'আবেদন জমা দেওয়া যায়নি' });
  }
});

app.post('/api/admin/login', async (req,res) => {
  const user = cleanText(req.body.username,100);
  const pass = String(req.body.password || '');
  try {
    const okUser = user === process.env.ADMIN_USER;
    const okPass = await bcrypt.compare(pass, process.env.ADMIN_PASSWORD_HASH);
    if (!okUser || !okPass) return res.status(401).json({ error:'Admin username/password ভুল' });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error:'Login failed' });
      req.session.isAdmin = true;
      req.session.save(saveErr => saveErr ? res.status(500).json({error:'Login failed'}) : res.json({ok:true}));
    });
  } catch (e) { console.error(e); res.status(500).json({error:'Login failed'}); }
});
app.get('/api/admin/me', (req,res) => res.json({ isAdmin:req.session.isAdmin === true }));
app.post('/api/admin/logout', requireAdmin, (req,res) => req.session.destroy(() => { res.clearCookie('ffx_wallet_session'); res.json({ok:true}); }));
app.get('/api/admin/settings', requireAdmin, async (_req,res) => {
  const q = await pool.query('SELECT bkash_number,nagad_number FROM payment_settings WHERE id=1'); res.json(q.rows[0]);
});
app.put('/api/admin/settings', requireAdmin, async (req,res) => {
  const bkash = cleanText(req.body.bkash_number,30), nagad = cleanText(req.body.nagad_number,30);
  if ((bkash && !/^01[3-9]\d{8}$/.test(bkash)) || (nagad && !/^01[3-9]\d{8}$/.test(nagad))) return res.status(400).json({error:'সঠিক বাংলাদেশি মোবাইল নম্বর দিন'});
  await pool.query('UPDATE payment_settings SET bkash_number=$1,nagad_number=$2,updated_at=NOW() WHERE id=1',[bkash,nagad]); res.json({ok:true});
});
app.get('/api/admin/deposits', requireAdmin, async (_req,res) => {
  const q = await pool.query(`SELECT d.id,d.amount,d.method,d.sender_number,d.trxid,d.status,d.created_at,u.name,u.email FROM deposit_requests d JOIN app_users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 300`);
  res.json({deposits:q.rows});
});
app.post('/api/admin/deposits/:id/review', requireAdmin, async (req,res) => {
  const id = Number(req.params.id), status = req.body.status, note = cleanText(req.body.note,250);
  if (!Number.isSafeInteger(id) || !['Approved','Rejected'].includes(status)) return res.status(400).json({error:'Invalid request'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query('SELECT * FROM deposit_requests WHERE id=$1 FOR UPDATE',[id]);
    if (!q.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({error:'আবেদন পাওয়া যায়নি'}); }
    const d = q.rows[0];
    if (d.status !== 'Pending') { await client.query('ROLLBACK'); return res.status(409).json({error:'এই আবেদন আগে review করা হয়েছে'}); }
    if (status === 'Approved') {
      await client.query('UPDATE app_users SET balance=balance+$1 WHERE id=$2',[d.amount,d.user_id]);
      await client.query('INSERT INTO wallet_ledger(user_id,deposit_id,amount,description) VALUES($1,$2,$3,$4)',[d.user_id,d.id,d.amount,`Manual ${d.method} deposit approved`]);
    }
    await client.query('UPDATE deposit_requests SET status=$1,admin_note=$2,reviewed_at=NOW() WHERE id=$3',[status,note,id]);
    await client.query('COMMIT'); res.json({ok:true,status});
  } catch(e) { await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Review failed'}); }
  finally { client.release(); }
});

app.get('/admin', (_req,res) => res.sendFile(path.join(__dirname,'admin.html')));
app.use((req,res,next) => { if (['/server.js','/package.json','/generate-admin-hash.js'].includes(req.path)) return res.sendStatus(404); next(); });
app.use(express.static(__dirname, { index:'FFX.html', dotfiles:'ignore', etag:true, maxAge:'1h' }));
app.get('*', (req,res,next) => { if (req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'}); res.sendFile(path.join(__dirname,'FFX.html')); });

initDb().then(() => app.listen(PORT,'0.0.0.0',() => console.log(`FFX server running on ${PORT}`)))
  .catch(err => { console.error('Database initialization failed:',err); process.exit(1); });
