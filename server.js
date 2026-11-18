const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const GH_TOKEN = process.env['FFX-G'] || process.env.FFX_G || '';
const GH_REPO = (process.env['FFX-REPO'] || process.env.FFX_REPO || process.env.RENDER_GIT_REPO_SLUG || '').trim();
const GH_BRANCH = (process.env['FFX-BRANCH'] || process.env.FFX_BRANCH || 'ffx-data').trim();
const GH_API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const GH_DIR = 'ffx-data';
const USE_GH = !!GH_TOKEN;

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const ADMIN_PASSWORD = process.env['FFX-PASS'] || process.env.FFX_PASS || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const BLOCKED_NAMES = new Set(['server.js', 'package.json', 'package-lock.json', 'admin.html']);

const DEFAULT_PACKAGES = [
  { label: '200 FF LIKE- প্রতিদিন ১ আইডিতে ১বার', name: '200 FF LIKE', price: 30 },
  { label: '3000 FF LIKE- 15 দিন এ পাবেন', name: '3000 FF LIKE', price: 450 },
  { label: '6000 FF LIKE- 30 দিন এ পাবেন', name: '6000 FF LIKE', price: 900 },
  { label: '12000 FF LIKE- 60 দিন এ পাবেন', name: '12000 FF LIKE', price: 1800 }
];

const DEFAULT_BANNERS = ['default:Banner 1.jpg', 'default:Banner 2.jpg', 'default:Banner 3.jpg'];
const DEFAULT_QUICK = [
  { label: 'Telegram', url: '' },
  { label: 'Join Group', url: '' },
  { label: 'YouTube', url: '' }
];
const MAX_BANNERS = 10;

const PRODUCTS = [
  { key: 'ff',  view: 'ffView',  hash: 'ff-likes',         grid: 'pkGrid',    img: 'ffBanner' },
  { key: 'uid', view: 'uidView', hash: 'uid-topup',        grid: 'uidPkGrid', img: 'uid' },
  { key: 'wm',  view: 'wmView',  hash: 'weekly-monthly',   grid: 'wmPkGrid',  img: 'wm' },
  { key: 'wl',  view: 'wlView',  hash: 'weekly-lite',      grid: 'wlPkGrid',  img: 'wl' },
  { key: 'lu',  view: 'luView',  hash: 'level-up-pass',    grid: 'luPkGrid',  img: 'lu' },
  { key: 'in',  view: 'inView',  hash: 'indonesia-server', grid: 'inPkGrid',  img: 'in' },
  { key: 'uc',  view: 'ucView',  hash: 'uid-checker',      grid: null,        img: 'uc' }
];

const IMAGES = {
  logo:     { file: 'Main logo.jpg',          prefix: 'logo' },
  ffBanner: { file: 'FF LIKES.jpg',           prefix: 'ff-banner' },
  uid:      { file: 'UID TOPUP (BD).jpg',     prefix: 'img-uid' },
  wm:       { file: 'WEEKLYMONTHLY.jpg',      prefix: 'img-wm' },
  wl:       { file: 'WEEKLY LITE.jpg',        prefix: 'img-wl' },
  lu:       { file: 'LEVEL UP PASS.jpg',      prefix: 'img-lu' },
  in:       { file: 'INDONESIA SERVER.jpg',   prefix: 'img-in' },
  uc:       { file: 'uid checker.jpg',        prefix: 'img-uc' },
  pop:      { file: 'Notification.jpg',       prefix: 'img-pop' }
};
const IMG_KEYS = Object.keys(IMAGES);

const TEXTS = [
  { id: 'siteName', label: 'Website name', def: 'Nickname', max: 40 },
  { id: 'sec1', label: 'Home section title (top)', def: 'FREE FIRE TOPUP', max: 60, wrap: ['<em>', '</em>'] },
  { id: 'sec2', label: 'Home section title (UID Checker)', def: 'UID CHECKER', max: 60, wrap: ['<em>', '</em>'] },
  { id: 'pop', label: 'Popup message', def: 'সবথেকে কম দামে টপ করার জন্য সেরা ওয়েবসাইট\n১০০% বিশ্বস্ত ও দ্রুত ডেলিভারিতে\nঅর্ডার করুন নিশ্চিন্তে 🥰', max: 400, multi: true },
  { id: 'hours', label: 'Support hours', def: 'সকাল ৮টা থেকে রাত ১২টা', max: 60 },
  { id: 'warn', label: 'Footer warning', def: '১৮ বছরের নিচে অভিভাবকের অনুমতি ছাড়া অর্ডার করা সম্পূর্ণ নিষিদ্ধ।', max: 300, multi: true },
  { id: 'dlTitle', label: 'App download title', def: 'DOWNLOAD OUR MOBILE APP', max: 60 },
  { id: 'playUrl', label: 'Google Play link', def: '', max: 300, url: true }
];

function emptyCfg() { return { logo: null, ffBanner: null, banners: null, quick: null, images: null, prod: null, texts: null }; }
let config = emptyCfg();
function imgGet(c, k) { return (k === 'logo' || k === 'ffBanner') ? c[k] : ((c.images && c.images[k]) || null); }
function imgSet(next, k, v) {
  if (k === 'logo' || k === 'ffBanner') { next[k] = v; return; }
  const m = Object.assign({}, next.images || {});
  if (v) m[k] = v; else delete m[k];
  next.images = Object.keys(m).length ? m : null;
}
function uploadedFiles(c) {
  const out = [c.logo, c.ffBanner].concat(Array.isArray(c.banners) ? c.banners : []);
  if (c.images && typeof c.images === 'object') Object.keys(c.images).forEach(function (k) { out.push(c.images[k]); });
  return out.filter(isUploaded);
}
let renderCache = null;
let cfgVersion = 0;

const SAFE_FILE = /^[a-z0-9._-]+$/i;

function sanitizePackages(list) {
  if (!Array.isArray(list)) throw new Error('প্যাকেজ লিস্ট ঠিক নেই');
  if (list.length < 1) throw new Error('কমপক্ষে ১টি প্যাকেজ রাখতে হবে');
  if (list.length > 40) throw new Error('সর্বোচ্চ ৪০টি প্যাকেজ রাখা যাবে');
  return list.map(function (p, i) {
    const label = String((p && p.label) || '').trim().slice(0, 140);
    let name = String((p && p.name) || '').trim().slice(0, 100);
    const price = Number(p && p.price);
    if (!label) throw new Error('প্যাকেজ ' + (i + 1) + ': নাম/বিবরণ ফাঁকা');
    if (!Number.isFinite(price) || price < 0 || price > 10000000) throw new Error('প্যাকেজ ' + (i + 1) + ': প্রাইস ঠিক নেই');
    if (!name) name = label;
    return { label: label, name: name, price: Math.round(price * 100) / 100 };
  });
}

function sanitizeProd(c) {
  const o = {};
  if (!c || typeof c !== 'object') return o;
  ['name', 'title', 'pill'].forEach(function (k) { if (typeof c[k] === 'string' && c[k].trim()) o[k] = c[k].trim().slice(0, 80); });
  if (c.packages) o.packages = sanitizePackages(c.packages);
  if (Array.isArray(c.rules)) o.rules = c.rules.map(function (x) { return String(x == null ? '' : x).trim().slice(0, 300); }).filter(Boolean).slice(0, 20);
  return o;
}

function sanitizeBanners(list) {
  if (!Array.isArray(list)) throw new Error('ব্যানার লিস্ট ঠিক নেই');
  if (list.length < 1) throw new Error('কমপক্ষে ১টি ব্যানার রাখতে হবে');
  if (list.length > MAX_BANNERS) throw new Error('সর্বোচ্চ ' + MAX_BANNERS + 'টি ব্যানার রাখা যাবে');
  return list.map(function (e) {
    e = String(e);
    if (DEFAULT_BANNERS.indexOf(e) !== -1 || SAFE_FILE.test(e)) return e;
    throw new Error('ব্যানারের নাম ঠিক নেই');
  });
}

function cleanUrl(u) {
  u = String(u == null ? '' : u).trim().slice(0, 300);
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\/[^\s<>"']+$/i.test(u)) throw new Error('লিংক ঠিক নেই');
  return u;
}

function sanitizeQuick(list) {
  if (!Array.isArray(list) || list.length !== 3) throw new Error('বাটনের তথ্য ঠিক নেই');
  return list.map(function (q, i) {
    return {
      label: String((q && q.label) || '').trim().slice(0, 30) || DEFAULT_QUICK[i].label,
      url: cleanUrl(q && q.url)
    };
  });
}

function bannerSrc(e) {
  return e.indexOf('default:') === 0 ? '/' + encodeURI(e.slice(8)) : '/uploads/' + e;
}
function bannerList() { return config.banners || DEFAULT_BANNERS; }
function isUploaded(e) { return typeof e === 'string' && e.indexOf('default:') !== 0 && SAFE_FILE.test(e); }

function loadLocal() {
  config = emptyCfg();
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (typeof j.logo === 'string' && SAFE_FILE.test(j.logo) && fs.existsSync(path.join(UPLOAD_DIR, j.logo))) config.logo = j.logo;
    if (typeof j.ffBanner === 'string' && SAFE_FILE.test(j.ffBanner) && fs.existsSync(path.join(UPLOAD_DIR, j.ffBanner))) config.ffBanner = j.ffBanner;
    if (j.images && typeof j.images === 'object') {
      const im = {};
      IMG_KEYS.forEach(function (k) {
        const n = j.images[k];
        if (k !== 'logo' && k !== 'ffBanner' && typeof n === 'string' && SAFE_FILE.test(n) && fs.existsSync(path.join(UPLOAD_DIR, n))) im[k] = n;
      });
      if (Object.keys(im).length) config.images = im;
    }
    const pr = {};
    if (j.prod && typeof j.prod === 'object') {
      PRODUCTS.forEach(function (p) {
        if (!j.prod[p.key]) return;
        try { const c = sanitizeProd(j.prod[p.key]); if (Object.keys(c).length) pr[p.key] = c; } catch (e) {}
      });
    }
    if (j.ffPackages) { try { pr.ff = Object.assign({}, pr.ff, { packages: sanitizePackages(j.ffPackages) }); } catch (e) {} }
    if (Object.keys(pr).length) config.prod = pr;
    if (j.texts && typeof j.texts === 'object') {
      const tx = {};
      TEXTS.forEach(function (t) { if (typeof j.texts[t.id] === 'string' && j.texts[t.id].trim()) tx[t.id] = j.texts[t.id].trim().slice(0, t.max); });
      if (Object.keys(tx).length) config.texts = tx;
    }
    if (j.banners) {
      const b = sanitizeBanners(j.banners).filter(function (e) { return !isUploaded(e) || fs.existsSync(path.join(UPLOAD_DIR, e)); });
      config.banners = b.length ? b : null;
    }
    if (j.quick) config.quick = sanitizeQuick(j.quick);
  } catch (e) {}
  cfgVersion++;
  renderCache = null;
}

function writeLocalConfig(obj) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

const storage = { mode: USE_GH ? 'github' : 'local', ok: !USE_GH, error: null, repo: GH_REPO, branch: GH_BRANCH };
const shas = {};
let chain = Promise.resolve();
function enqueue(fn) { const run = chain.then(fn); chain = run.catch(function () {}); return run; }

function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
function contentsUrl(p) { return '/repos/' + GH_REPO + '/contents/' + encPath(p); }

async function gh(method, urlPath, body, accept) {
  const headers = {
    'Authorization': 'Bearer ' + GH_TOKEN,
    'Accept': accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ffx-admin'
  };
  if (body) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(GH_API + urlPath, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new Error('GitHub এর সাথে যোগাযোগ করা যাচ্ছে না, একটু পরে আবার চেষ্টা করুন');
  }
}

function ghErr(status) {
  if (status === 401) return new Error('GitHub টোকেন (FFX-G) ঠিক নেই বা মেয়াদ শেষ');
  if (status === 403) return new Error('GitHub: অনুমতি নেই বা রেট লিমিট। টোকেনে Contents → Read and write দিন');
  if (status === 404) return new Error('GitHub: repo (' + GH_REPO + ') পাওয়া যায়নি বা টোকেনের এই repo তে অ্যাক্সেস নেই');
  return new Error('GitHub সমস্যা (' + status + ')');
}

async function ensureBranch() {
  const b = await gh('GET', '/repos/' + GH_REPO + '/branches/' + encodeURIComponent(GH_BRANCH));
  if (b.ok) return;
  if (b.status !== 404) throw ghErr(b.status);

  const rp = await gh('GET', '/repos/' + GH_REPO);
  if (!rp.ok) throw ghErr(rp.status);
  const def = (await rp.json()).default_branch;
  const ref = await gh('GET', '/repos/' + GH_REPO + '/git/ref/heads/' + encodeURIComponent(def));
  if (!ref.ok) throw ghErr(ref.status);
  const sha = (await ref.json()).object.sha;
  const mk = await gh('POST', '/repos/' + GH_REPO + '/git/refs', { ref: 'refs/heads/' + GH_BRANCH, sha: sha });
  if (!mk.ok && mk.status !== 422) throw ghErr(mk.status);
}

async function ghPut(p, buf, msg) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { message: msg, content: buf.toString('base64'), branch: GH_BRANCH };
    if (shas[p]) body.sha = shas[p];
    const r = await gh('PUT', contentsUrl(p), body);
    if (r.ok) { shas[p] = (await r.json()).content.sha; return; }
    if (attempt === 0 && (r.status === 409 || r.status === 422)) {
      const g = await gh('GET', contentsUrl(p) + '?ref=' + encodeURIComponent(GH_BRANCH));
      if (g.ok) shas[p] = (await g.json()).sha; else delete shas[p];
      continue;
    }
    throw ghErr(r.status);
  }
  throw new Error('GitHub এ সেভ করা যায়নি, আবার চেষ্টা করুন');
}

async function ghDelete(p, msg) {
  const g = await gh('GET', contentsUrl(p) + '?ref=' + encodeURIComponent(GH_BRANCH));
  if (g.status === 404) return;
  if (!g.ok) throw ghErr(g.status);
  const sha = (await g.json()).sha;
  const r = await gh('DELETE', contentsUrl(p), { message: msg, sha: sha, branch: GH_BRANCH });
  delete shas[p];
  if (!r.ok && r.status !== 404) throw ghErr(r.status);
}

async function ghDownload(p) {
  const r = await gh('GET', contentsUrl(p) + '?ref=' + encodeURIComponent(GH_BRANCH), null, 'application/vnd.github.raw+json');
  if (!r.ok) throw ghErr(r.status);
  return Buffer.from(await r.arrayBuffer());
}

let retryTimer = null;
async function initStorage() {
  loadLocal();
  if (!USE_GH) return;
  if (!GH_REPO) {
    storage.ok = false;
    storage.error = 'repo নাম পাওয়া যায়নি। Render Environment এ FFX-REPO = username/repo দিন';
    return;
  }
  try {
    await ensureBranch();
    const r = await gh('GET', contentsUrl(GH_DIR + '/config.json') + '?ref=' + encodeURIComponent(GH_BRANCH));
    if (r.ok) {
      const j = await r.json();
      shas[GH_DIR + '/config.json'] = j.sha;
      const remote = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const remoteFiles = uploadedFiles(remote);
      for (const n of remoteFiles) {
        if (typeof n === 'string' && SAFE_FILE.test(n) && !fs.existsSync(path.join(UPLOAD_DIR, n))) {
          fs.writeFileSync(path.join(UPLOAD_DIR, n), await ghDownload(GH_DIR + '/uploads/' + n));
        }
      }
      writeLocalConfig(remote);
      loadLocal();
    } else if (r.status === 404) {

      if (Object.keys(config).some(function (k) { return config[k]; })) {
        await enqueue(async function () {
          const localFiles = uploadedFiles(config);
          for (const n of localFiles) {
            await ghPut(GH_DIR + '/uploads/' + n, fs.readFileSync(path.join(UPLOAD_DIR, n)), 'Initial sync');
          }
          await ghPut(GH_DIR + '/config.json', Buffer.from(JSON.stringify(config, null, 2)), 'Initial sync');
        });
      }
    } else {
      throw ghErr(r.status);
    }
    storage.ok = true;
    storage.error = null;
  } catch (e) {
    storage.ok = false;
    storage.error = e.message || 'GitHub সংযোগ হয়নি';
    console.log('GitHub init error:', storage.error);
    if (!retryTimer) {
      retryTimer = setTimeout(function () { retryTimer = null; ready = initStorage(); }, 30000);
      retryTimer.unref();
    }
  }
}

async function commit(next, msg, add, del) {
  if (USE_GH && !storage.ok) throw new Error('GitHub এর সাথে এখনো সংযোগ হয়নি। উপরের "আবার চেষ্টা করুন" চাপুন।');
  if (USE_GH) {
    await enqueue(async function () {
      const done = [];
      try {
        for (const f of add) { await ghPut(GH_DIR + '/uploads/' + f.name, f.buf, msg); done.push(f.name); }
        await ghPut(GH_DIR + '/config.json', Buffer.from(JSON.stringify(next, null, 2)), msg);
      } catch (e) {
        for (const n of done) { try { await ghDelete(GH_DIR + '/uploads/' + n, 'Rollback'); } catch (_) {} }
        throw e;
      }
    });
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  add.forEach(function (f) { fs.writeFileSync(path.join(UPLOAD_DIR, f.name), f.buf); });
  writeLocalConfig(next);
  config = next;
  cfgVersion++;
  renderCache = null;
  del.forEach(function (n) {
    removeUpload(n);
    if (USE_GH) enqueue(function () { return ghDelete(GH_DIR + '/uploads/' + n, 'Remove old image'); }).catch(function () {});
  });
}

let ready = initStorage();

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function packagesHtml(list) {
  return list.map(function (p) {
    return '        <button type="button" class="pk" data-name="' + esc(p.name) + '" data-price="' + esc(p.price) +
      '"><span>' + esc(p.label) + '</span><b>BDT ' + esc(p.price) + '</b></button>';
  }).join('\n');
}

function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
function stripTags(s) { return String(s).replace(/<[^>]+>/g, ''); }
function jsStr(s) { return JSON.stringify(String(s)).replace(/</g, '\\u003c'); }
function parseDefaults(html) {
  const out = {};
  PRODUCTS.forEach(function (p) {
    const d = { name: '', title: '', pill: '', packages: [], rules: [] };
    const cm = html.match(new RegExp('data-open="' + p.hash + '"[^>]*>[\\s\\S]*?<p>([\\s\\S]*?)</p>'));
    if (cm) d.name = unesc(stripTags(cm[1])).trim();
    const s = html.indexOf('<main class="wrap" id="' + p.view + '"');
    const e = s < 0 ? -1 : html.indexOf('</main>', s);
    if (s >= 0 && e > s) {
      const seg = html.slice(s, e);
      let m = seg.match(/<h1>([\s\S]*?)<\/h1>/); if (m) d.title = unesc(stripTags(m[1])).trim();
      m = seg.match(/<span class="pv-pill">(?:<svg[\s\S]*?<\/svg>)?([\s\S]*?)<\/span>/); if (m) d.pill = unesc(m[1]).trim();
      const gm = p.grid && seg.match(new RegExp('<div class="pk-grid" id="' + p.grid + '">([\\s\\S]*?)</div>'));
      if (gm) {
        const re = /<button[^>]*class="pk"[^>]*data-name="([^"]*)"[^>]*data-price="([^"]*)"[^>]*>\s*<span>([\s\S]*?)<\/span>/g; let b;
        while ((b = re.exec(gm[1]))) d.packages.push({ label: unesc(b[3]).trim(), name: unesc(b[1]), price: Number(b[2]) });
      }
      const rm = seg.match(/<ul class="rl">([\s\S]*?)<\/ul>/);
      if (rm) { const re = /<li>([\s\S]*?)<\/li>/g; let b; while ((b = re.exec(rm[1]))) d.rules.push(unesc(stripTags(b[1])).trim()); }
    }
    out[p.key] = d;
  });
  return out;
}
let defCache = { mtime: 0, v: null };
function getDefaults() {
  try {
    const f = path.join(ROOT_DIR, 'FFX.html');
    const st = fs.statSync(f);
    if (!defCache.v || defCache.mtime !== st.mtimeMs) defCache = { mtime: st.mtimeMs, v: parseDefaults(fs.readFileSync(f, 'utf8')) };
    return defCache.v;
  } catch (e) { return {}; }
}

function applyProducts(html) {
  const P = config.prod || {};
  PRODUCTS.forEach(function (p) {
    const c = P[p.key];
    if (!c) return;
    if (c.name) html = html.replace(new RegExp('(data-open="' + p.hash + '"[^>]*>[\\s\\S]*?<p>)[\\s\\S]*?(</p>)'), function (m, a, b) { return a + esc(c.name) + b; });
    const s = html.indexOf('<main class="wrap" id="' + p.view + '"');
    const e = s < 0 ? -1 : html.indexOf('</main>', s);
    if (s < 0 || e < 0) return;
    let seg = html.slice(s, e);
    if (c.title) seg = seg.replace(/(<h1>)[\s\S]*?(<\/h1>)/, function (m, a, b) { return a + esc(c.title) + b; });
    if (c.pill) seg = seg.replace(/(<span class="pv-pill">(?:<svg[\s\S]*?<\/svg>)?)[\s\S]*?(<\/span>)/, function (m, a, b) { return a + esc(c.pill) + b; });
    if (c.packages && p.grid) seg = seg.replace(new RegExp('(<div class="pk-grid" id="' + p.grid + '">)[\\s\\S]*?(</div>)'), function (m, a, b) { return a + '\n' + packagesHtml(c.packages) + '\n      ' + b; });
    if (c.rules) seg = seg.replace(/(<ul class="rl">)[\s\S]*?(<\/ul>)/, function (m, a, b) { return a + '\n' + c.rules.map(function (r) { return '        <li>' + esc(r) + '</li>'; }).join('\n') + '\n      ' + b; });
    html = html.slice(0, s) + seg + html.slice(e);
  });
  return html;
}

function applyTexts(html, inj) {
  const T = config.texts || {};
  if (T.siteName) {
    const v = esc(T.siteName);
    html = html.split('<title>Nickname</title>').join('<title>' + v + '</title>')
      .split('data-site-name>Nickname<').join('data-site-name>' + v + '<')
      .split('alt="Nickname"').join('alt="' + v + '"')
      .split("(typeof website_name !== 'undefined'").join("(window.__SITE ? window.__SITE : typeof website_name !== 'undefined'");
    inj.push('window.__SITE = ' + jsStr(T.siteName) + ';');
  }
  if (T.pop) {
    html = html.split("(typeof notification_text !== 'undefined'").join("(window.__POP ? window.__POP : typeof notification_text !== 'undefined'");
    inj.push('window.__POP = ' + jsStr(T.pop) + ';');
    html = html.replace(/(<p id="popText">)[\s\S]*?(<\/p>)/, function (m, a, b) { return a + esc(T.pop).split(/\r?\n/).join('<br>') + b; });
  }
  TEXTS.forEach(function (t) {
    if (!T[t.id] || t.id === 'siteName' || t.id === 'pop' || t.id === 'playUrl') return;
    const w = t.wrap || ['>', '<'];
    html = html.split(w[0] + t.def + w[1]).join(w[0] + esc(T[t.id]) + w[1]);
  });
  if (T.hours) html = html.split(TEXTS.filter(function (t) { return t.id === 'hours'; })[0].def).join(esc(T.hours));
  if (T.playUrl) html = html.replace('<a class="play" href="#">', '<a class="play" href="' + esc(T.playUrl) + '" target="_blank" rel="noopener noreferrer">');
  return html;
}

function applySiteConfig(html) {
  const inj = [];

  if (config.banners) {
    const slides = config.banners.map(function (e, i) {
      return '      <div class="slide"><img src="' + esc(bannerSrc(e)) + '" alt="Banner ' + (i + 1) + '" draggable="false" decoding="async"></div>';
    }).join('\n');
    const dots = config.banners.map(function (e, i) { return '<i' + (i === 0 ? ' class="on"' : '') + '></i>'; }).join('');
    html = html.replace(/(<div class="track" id="track">)[\s\S]*?(<\/div>\s*<div class="dots" id="dots">)[\s\S]*?(<\/div>)/, function (m, a, b, c) {
      return a + '\n' + slides + '\n    ' + b + dots + c;
    });
  }

  if (config.quick) {
    const icons = ['tg', 'grp', 'yt'], keys = ['telegram-channel', 'telegram-group', 'youtube-channel'], small = ['Support', 'Group', 'Channel'];
    const items = config.quick.map(function (x, i) {
      return '    <a class="q" href="#" data-link="' + keys[i] + '"><span class="ic"><svg class="f"><use href="#' + icons[i] + '"/></svg></span><span><small>' + small[i] + '</small><b>' + esc(x.label) + '</b></span></a>';
    }).join('\n');
    html = html.replace(/(<div class="quick">)[\s\S]*?(<\/div>)/, function (m, a, b) { return a + '\n' + items + '\n  ' + b; });
    const L = { tgCh: config.quick[0].url, tgGrp: config.quick[1].url, yt: config.quick[2].url };
    if (L.tgCh || L.tgGrp || L.yt) {
      inj.push('window.__LINKS = ' + JSON.stringify(L).replace(/</g, '\\u003c') + ';');
      html = html.split("bindLinks('[data-link=\"telegram-channel\"]', validTgCh);").join("bindLinks('[data-link=\"telegram-channel\"]', (window.__LINKS && window.__LINKS.tgCh) || validTgCh);");
      html = html.split("bindLinks('[data-link=\"telegram-group\"]', validTgGrp);").join("bindLinks('[data-link=\"telegram-group\"]', (window.__LINKS && window.__LINKS.tgGrp) || validTgGrp);");
      html = html.split("bindLinks('[data-link=\"youtube-channel\"]', validYtCh);").join("bindLinks('[data-link=\"youtube-channel\"]', (window.__LINKS && window.__LINKS.yt) || validYtCh);");
    }
  }
  html = applyProducts(html);
  html = applyTexts(html, inj);
  if (inj.length) html = html.replace('window.ACCOUNT_CONFIG = window.ACCOUNT_CONFIG || {};', function (m) { return m + '\n' + inj.join('\n'); });
  return html;
}

function getHomePage(cb) {
  const file = path.join(ROOT_DIR, 'FFX.html');
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return cb(null);
    if (renderCache && renderCache.mtime === st.mtimeMs && renderCache.cfgVersion === cfgVersion) return cb(renderCache);
    fs.readFile(file, 'utf8', function (e2, html) {
      if (e2) return cb(null);
      IMG_KEYS.forEach(function (k) {
        const f = imgGet(config, k);
        if (f) html = html.split(IMAGES[k].file).join('/uploads/' + f);
      });
      html = applySiteConfig(html);
      const stockScript = `<script>
(function(){
  function applyStock(stock){
    document.querySelectorAll('.pk[data-name]').forEach(function(btn){
      var name=btn.getAttribute('data-name')||'';
      if(!/diamond/i.test(name)) return;
      var m=name.match(/(\\d[\\d,]*)\\s*diamond/i)||name.match(/diamond\\s*[-x×]?\\s*(\\d[\\d,]*)/i);
      if(!m) return;
      var qty=Number(m[1].replace(/,/g,''));
      if(!Number.isFinite(qty)||qty<1) return;
      var old=btn.querySelector('.stock-state'); if(old) old.remove();
      var available=stock>=qty;
      btn.disabled=!available;
      btn.setAttribute('aria-disabled',String(!available));
      if(!available){
        var tag=document.createElement('small');tag.className='stock-state';
        tag.textContent='Out of Stock';tag.style.cssText='display:block;color:#dc2626;font-weight:800;margin-top:4px';
        btn.appendChild(tag);
      }
    });
  }
  fetch('/api/diamond-stock',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;})
    .then(function(d){if(d&&Number.isFinite(Number(d.stock)))applyStock(Number(d.stock));}).catch(function(){});
})();
</script>`;
      html = html.replace(/<\/body>/i, stockScript + '</body>');
      const raw = Buffer.from(html, 'utf8');
      zlib.gzip(raw, function (e3, gz) {
        renderCache = { mtime: st.mtimeMs, cfgVersion: cfgVersion, raw: raw, gz: e3 ? null : gz };
        cb(renderCache);
      });
    });
  });
}

function sendHome(req, res) {
  getHomePage(function (page) {
    if (!page) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const headers = {
      'Content-Type': MIME_TYPES['.html'],
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Vary': 'Accept-Encoding'
    };
    const wantsGzip = page.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantsGzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(wantsGzip ? page.gz : page.raw);
  });
}

const SECRET = crypto.createHash('sha256').update('ffx-admin-secret:' + ADMIN_PASSWORD).digest();

function safeEq(a, b) {
  const A = crypto.createHash('sha256').update(String(a)).digest();
  const B = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}
function sign(exp) { return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex'); }
function makeToken() { const exp = Date.now() + SESSION_MS; return { token: exp + '.' + sign(exp), expires: exp }; }
function checkToken(t) {
  if (!ADMIN_PASSWORD || typeof t !== 'string') return false;
  const parts = t.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
  if (Number(parts[0]) < Date.now()) return false;
  return safeEq(parts[1], sign(parts[0]));
}
function isAuthed(req) {
  const h = req.headers['authorization'] || '';
  return checkToken(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
}

const LOCK_MS = 15 * 60 * 1000;
const fails = new Map();
let globalFails = { n: 0, first: Date.now() };
function clientIp(req) {
  return ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}
function lockedFor(ip) {
  const now = Date.now();
  if (now - globalFails.first > LOCK_MS) globalFails = { n: 0, first: now };
  if (globalFails.n >= 40) return LOCK_MS - (now - globalFails.first);
  const f = fails.get(ip);
  if (!f) return 0;
  if (now - f.first > LOCK_MS) { fails.delete(ip); return 0; }
  return f.n >= 5 ? LOCK_MS - (now - f.first) : 0;
}
function recordFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > LOCK_MS) fails.set(ip, { n: 1, first: Date.now() });
  else f.n++;
  globalFails.n++;
}
setInterval(function () {
  const now = Date.now();
  fails.forEach(function (v, k) { if (now - v.first > LOCK_MS) fails.delete(k); });
}, 5 * 60 * 1000).unref();

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const txt = await readBody(req, limit || 64 * 1024);
  try { return JSON.parse(txt || '{}'); } catch (e) { throw new Error('bad_json'); }
}

function currentView() {
  const defs = getDefaults();
  const images = {};
  IMG_KEYS.forEach(function (k) {
    const f = imgGet(config, k);
    images[k] = { src: f ? '/uploads/' + f : null, def: '/' + IMAGES[k].file, custom: !!f };
  });
  const P = config.prod || {}, T = config.texts || {};
  return {
    images: images,
    products: PRODUCTS.map(function (p) {
      const c = P[p.key] || {}, d = defs[p.key] || { name: '', title: '', pill: '', packages: [], rules: [] };
      return {
        key: p.key, img: p.img, hasGrid: !!p.grid, hasRules: d.rules.length > 0 || !!c.rules,
        name: c.name || d.name, title: c.title || d.title, pill: c.pill || d.pill,
        packages: c.packages || d.packages, rules: c.rules || d.rules,
        defaults: d, anyCustom: Object.keys(c).length > 0,
        custom: { packages: !!c.packages, rules: !!c.rules }
      };
    }),
    texts: TEXTS.map(function (t) {
      return { id: t.id, label: t.label, def: t.def, value: T[t.id] || t.def, custom: !!T[t.id], multi: !!t.multi, url: !!t.url, max: t.max };
    }),
    // Payment settings are included so the existing Admin UI can display them.
    payments: {
      bKash: accountData.settings.bkash || '',
      Nagad: accountData.settings.nagad || '',
      Rocket: accountData.settings.rocket || ''
    },
    banners: bannerList().map(function (e) { return { id: e, src: bannerSrc(e), isDefault: !isUploaded(e) }; }),
    bannersCustom: !!config.banners,
    quick: config.quick || DEFAULT_QUICK,
    quickCustom: !!config.quick,
    maxBanners: MAX_BANNERS,
    storage: { mode: storage.mode, ok: storage.ok, error: storage.error, repo: storage.repo, branch: storage.branch },
    persistent: USE_GH || !!process.env.DATA_DIR
  };
}

function detectImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeUpload(name) {
  if (name && SAFE_FILE.test(name)) fs.unlink(path.join(UPLOAD_DIR, name), function () {});
}


// ===== User accounts, wallet and manual payment store =====
const ACCOUNT_FILE = path.join(DATA_DIR, 'accounts-payments.json');
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
let accountData = { users: [], deposits: [], settings: { bkash: '', nagad: '', rocket: '' }, diamondStock: 0 };
async function loadAccountData() {
  const empty = { users: [], deposits: [], settings: { bkash: '', nagad: '', rocket: '' }, diamondStock: 0 };
  let raw = null;

  // GitHub is the persistent source when FFX-G is configured.
  if (USE_GH && storage.ok) {
    const remote = await gh(
      'GET',
      contentsUrl(GH_DIR + '/accounts-payments.json') + '?ref=' + encodeURIComponent(GH_BRANCH),
      null,
      'application/vnd.github.raw+json'
    );
    if (remote.ok) raw = Buffer.from(await remote.arrayBuffer());
    else if (remote.status !== 404) throw ghErr(remote.status);
    // 404 is expected the first time this feature is deployed.
  }

  if (!raw) {
    try { raw = fs.readFileSync(ACCOUNT_FILE); } catch (_) {}
  }

  if (raw) {
    const x = JSON.parse(raw.toString('utf8'));
    accountData = {
      users: Array.isArray(x.users) ? x.users : [],
      deposits: Array.isArray(x.deposits) ? x.deposits : [],
      settings: Object.assign({ bkash: '', nagad: '', rocket: '' }, x.settings || {}),
      diamondStock: Number.isSafeInteger(Number(x.diamondStock)) && Number(x.diamondStock) >= 0 ? Number(x.diamondStock) : 0
    };
  } else {
    accountData = empty;
  }
}

async function saveAccountData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = Buffer.from(JSON.stringify(accountData, null, 2));
  const tmp = ACCOUNT_FILE + '.tmp';
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, ACCOUNT_FILE);

  if (USE_GH) {
    if (!storage.ok) throw new Error('GitHub Storage এখনো প্রস্তুত নয়; কিছুক্ষণ পর আবার চেষ্টা করুন');
    await enqueue(function () {
      return ghPut(GH_DIR + '/accounts-payments.json', data, 'Update accounts and manual payments');
    });
  }
}
function cleanUser(u) {
  return { id: u.id, username: u.username, createdAt: u.createdAt, balance: Number(u.balance || 0) };
}
function userToken(userId) {
  const exp = Date.now() + USER_SESSION_MS;
  const payload = userId + '.' + exp;
  const sig = crypto.createHmac('sha256', SECRET).update('user:' + payload).digest('hex');
  return { token: Buffer.from(payload).toString('base64url') + '.' + sig, expires: exp };
}
function verifyUserToken(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const p = tok.split('.');
  if (p.length !== 2) return null;
  let payload;
  try { payload = Buffer.from(p[0], 'base64url').toString('utf8'); } catch (_) { return null; }
  const bits = payload.split('.');
  if (bits.length !== 2 || !/^\d+$/.test(bits[1]) || Number(bits[1]) < Date.now()) return null;
  const expected = crypto.createHmac('sha256', SECRET).update('user:' + payload).digest('hex');
  if (!safeEq(p[1], expected)) return null;
  return accountData.users.find(u => u.id === bits[0]) || null;
}
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (e, key) => e ? reject(e) : resolve(key.toString('hex'))));
}
function diamondQuantity(product) {
  const name = String(product || '');
  if (!/diamond/i.test(name)) return 0;
  const m = name.match(/(\\d[\\d,]*)\\s*diamond/i) || name.match(/diamond\\s*[-x×]?\\s*(\\d[\\d,]*)/i);
  if (!m) return 0;
  const qty = Number(String(m[1]).replace(/,/g, ''));
  return Number.isSafeInteger(qty) && qty > 0 ? qty : 0;
}
function publicDeposit(d) {
  return { id: d.id, method: d.method, amount: d.amount, trxid: d.trxid, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt, purpose: d.purpose || 'wallet', product: d.product || '', playerUid: d.playerUid || '' };
}

async function handleApi(req, res, pathname) {
  try {

    // Public total diamond stock
    if (req.method === 'GET' && pathname === '/api/diamond-stock') {
      return sendJson(res, 200, { stock: Number(accountData.diamondStock || 0) });
    }

    // Public payment numbers
    if (req.method === 'GET' && pathname === '/api/payments/settings') {
      return sendJson(res, 200, accountData.settings);
    }

    // User registration and login
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const b = await readJson(req, 4096);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return sendJson(res, 400, { error: 'Username 3-24 অক্ষর; শুধু ইংরেজি, সংখ্যা ও _ ব্যবহার করুন' });
      if (password.length < 8 || password.length > 128) return sendJson(res, 400, { error: 'Password কমপক্ষে ৮ অক্ষরের হতে হবে' });
      if (accountData.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return sendJson(res, 409, { error: 'এই Username আগে থেকেই আছে' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passHash = await hashPassword(password, salt);
      const user = { id: crypto.randomUUID(), username, salt, passHash, balance: 0, createdAt: new Date().toISOString() };
      accountData.users.push(user); await saveAccountData();
      const t = userToken(user.id);
      return sendJson(res, 201, { token: t.token, expires: t.expires, user: cleanUser(user) });
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const b = await readJson(req, 4096);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const user = accountData.users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (!user || !safeEq(await hashPassword(password, user.salt), user.passHash)) {
        return sendJson(res, 401, { error: 'Username অথবা Password ভুল' });
      }
      const t = userToken(user.id);
      return sendJson(res, 200, { token: t.token, expires: t.expires, user: cleanUser(user) });
    }
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const u = verifyUserToken(req);
      if (!u) return sendJson(res, 401, { error: 'আবার লগইন করুন' });
      return sendJson(res, 200, { user: cleanUser(u) });
    }
    if (req.method === 'GET' && pathname === '/api/payments/mine') {
      const u = verifyUserToken(req);
      if (!u) return sendJson(res, 401, { error: 'লগইন করুন' });
      return sendJson(res, 200, { deposits: accountData.deposits.filter(d => d.userId === u.id).map(publicDeposit) });
    }
    if (req.method === 'POST' && pathname === '/api/payments/deposit') {
      const u = verifyUserToken(req);
      if (!u) return sendJson(res, 401, { error: 'প্রথমে লগইন করুন' });
      const b = await readJson(req, 8192);
      const method = String(b.method || '');
      const amount = Number(b.amount);
      const trxid = String(b.trxid || '').trim().toUpperCase();
      if (!['bKash', 'Nagad', 'Rocket'].includes(method)) return sendJson(res, 400, { error: 'পেমেন্ট মাধ্যম নির্বাচন করুন' });
      if (!Number.isInteger(amount) || amount < 10 || amount > 100000) return sendJson(res, 400, { error: 'Amount ১০ থেকে ১,০০,০০০ টাকার মধ্যে দিন' });
      if (!/^[A-Z0-9-]{6,40}$/.test(trxid)) return sendJson(res, 400, { error: 'সঠিক Transaction ID দিন' });
      if (!accountData.settings[method.toLowerCase()]) return sendJson(res, 400, { error: 'এই পেমেন্ট মাধ্যমের নম্বর এখনো সেট করা হয়নি' });
      if (accountData.deposits.some(d => d.method === method && d.trxid === trxid)) return sendJson(res, 409, { error: 'এই Transaction ID আগেই জমা হয়েছে' });
      const d = { id: crypto.randomUUID(), userId: u.id, username: u.username, method, amount, trxid, status: 'Pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      accountData.deposits.unshift(d); await saveAccountData();
      return sendJson(res, 201, { deposit: publicDeposit(d) });
    }

    if (req.method === 'POST' && pathname === '/api/payments/product-order') {
      const u = verifyUserToken(req);
      if (!u) return sendJson(res, 401, { error: 'প্রথমে লগইন করুন' });
      const b = await readJson(req, 8192);
      const method = String(b.method || '');
      const amount = Number(b.amount);
      const trxid = String(b.trxid || '').trim().toUpperCase();
      const product = String(b.product || '').trim().slice(0, 100);
      const playerUid = String(b.playerUid || '').trim();
      if (!['bKash', 'Nagad', 'Rocket'].includes(method)) return sendJson(res, 400, { error: 'পেমেন্ট মাধ্যম নির্বাচন করুন' });
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) return sendJson(res, 400, { error: 'Amount সঠিক নয়' });
      if (!product || !/^\d{6,20}$/.test(playerUid)) return sendJson(res, 400, { error: 'Product ও সঠিক Player ID দিন' });
      if (!/^[A-Z0-9-]{6,40}$/.test(trxid)) return sendJson(res, 400, { error: 'সঠিক Transaction ID দিন' });
      if (!accountData.settings[method.toLowerCase()]) return sendJson(res, 400, { error: 'এই পেমেন্ট মাধ্যমের নম্বর সেট করা হয়নি' });
      if (accountData.deposits.some(d => d.method === method && d.trxid === trxid)) return sendJson(res, 409, { error: 'এই Transaction ID আগেই জমা হয়েছে' });
      const d = { id: crypto.randomUUID(), userId: u.id, username: u.username, method, amount, trxid, purpose: 'product', product, playerUid, status: 'Pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      accountData.deposits.unshift(d); await saveAccountData();
      return sendJson(res, 201, { deposit: publicDeposit(d) });
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'Render এ FFX-PASS সেট করা নেই। Environment এ FFX-PASS যোগ করে আবার Deploy করুন।' });
      const ip = clientIp(req);
      const wait = lockedFor(ip);
      if (wait > 0) return sendJson(res, 429, { error: 'অনেকবার ভুল হয়েছে। ' + Math.ceil(wait / 60000) + ' মিনিট পরে আবার চেষ্টা করুন।' });
      const body = await readJson(req, 4096);
      if (typeof body.password === 'string' && safeEq(body.password, ADMIN_PASSWORD)) {
        fails.delete(ip);
        const t = makeToken();
        return sendJson(res, 200, { token: t.token, expires: t.expires });
      }
      recordFail(ip);
      await new Promise(function (r) { setTimeout(r, 500); });
      return sendJson(res, 401, { error: 'পাসওয়ার্ড ঠিক নেই' });
    }

    if (!pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Not found' });
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'লগইন করুন' });


    if (req.method === 'GET' && pathname === '/api/admin/diamond-stock') {
      return sendJson(res, 200, { stock: Number(accountData.diamondStock || 0) });
    }
    if (req.method === 'POST' && pathname === '/api/admin/diamond-stock') {
      const b = await readJson(req, 4096);
      const stock = Number(b.stock);
      if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000000) {
        return sendJson(res, 400, { error: 'স্টকের সংখ্যা ০ থেকে ১০০ কোটি-এর মধ্যে পূর্ণসংখ্যা হতে হবে' });
      }
      accountData.diamondStock = stock;
      await saveAccountData();
      return sendJson(res, 200, { stock: accountData.diamondStock });
    }
    if (req.method === 'GET' && pathname === '/api/admin/payment-settings') {
      return sendJson(res, 200, { settings: accountData.settings });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payment-settings') {
      const b = await readJson(req, 4096);
      const next = {};
      ['bkash', 'nagad', 'rocket'].forEach(k => {
        const v = String((b.settings || {})[k] || '').trim();
        if (v && !/^[0-9+ -]{8,20}$/.test(v)) throw new Error(k + ' নম্বর ঠিক নেই');
        next[k] = v;
      });
      accountData.settings = next; await saveAccountData();
      return sendJson(res, 200, { settings: accountData.settings });
    }
    if (req.method === 'GET' && pathname === '/api/admin/deposits') {
      return sendJson(res, 200, { deposits: accountData.deposits.map(d => Object.assign({}, publicDeposit(d), { username: d.username })) });
    }
    if (req.method === 'POST' && pathname === '/api/admin/deposits/status') {
      const b = await readJson(req, 4096);
      const d = accountData.deposits.find(x => x.id === String(b.id || ''));
      if (!d) return sendJson(res, 404, { error: 'Payment request পাওয়া যায়নি' });
      if (d.status !== 'Pending') return sendJson(res, 409, { error: 'এই Payment আগেই প্রসেস করা হয়েছে' });
      if (!['Approved', 'Rejected'].includes(b.status)) return sendJson(res, 400, { error: 'ভুল Status' });
      if (b.status === 'Approved' && (d.purpose || 'wallet') === 'product') {
        const qty = diamondQuantity(d.product);
        if (qty > 0 && Number(accountData.diamondStock || 0) < qty) {
          return sendJson(res, 409, { error: 'পর্যাপ্ত Diamond Stock নেই। প্রয়োজন: ' + qty + ', বর্তমান স্টক: ' + Number(accountData.diamondStock || 0) });
        }
        if (qty > 0) accountData.diamondStock = Number(accountData.diamondStock || 0) - qty;
      }
      d.status = b.status; d.updatedAt = new Date().toISOString();
      if (b.status === 'Approved' && (d.purpose || 'wallet') !== 'product') {
        const u = accountData.users.find(x => x.id === d.userId);
        if (u) u.balance = Math.round((Number(u.balance || 0) + d.amount) * 100) / 100;
      }
      await saveAccountData();
      return sendJson(res, 200, { deposit: publicDeposit(d) });
    }

    if (req.method === 'GET' && pathname === '/api/admin/config') {
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/packages') {
      const body = await readJson(req, 128 * 1024);
      const cur = Object.assign({}, (config.prod || {}).ff, { packages: body.packages });
      const prod = Object.assign({}, config.prod, { ff: sanitizeProd(cur) });
      await commit(Object.assign({}, config, { prod: prod }), 'Update FF Like packages', [], []);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/product') {
      const body = await readJson(req, 128 * 1024);
      const p = PRODUCTS.filter(function (x) { return x.key === body.key; })[0];
      if (!p) return sendJson(res, 400, { error: 'প্রোডাক্ট পাওয়া যায়নি' });
      const patch = (body.patch && typeof body.patch === 'object') ? body.patch : {};
      const cur = Object.assign({}, (config.prod || {})[p.key]);
      ['name', 'title', 'pill', 'packages', 'rules'].forEach(function (f) {
        if (!(f in patch)) return;
        if (patch[f] === null || patch[f] === '') delete cur[f]; else cur[f] = patch[f];
      });
      const clean = sanitizeProd(cur);
      const prod = Object.assign({}, config.prod);
      if (Object.keys(clean).length) prod[p.key] = clean; else delete prod[p.key];
      await commit(Object.assign({}, config, { prod: Object.keys(prod).length ? prod : null }), 'Update product ' + p.key, [], []);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/texts') {
      const body = await readJson(req, 32 * 1024);
      const T = Object.assign({}, config.texts);
      Object.keys(body.texts || {}).forEach(function (id) {
        const t = TEXTS.filter(function (x) { return x.id === id; })[0];
        if (!t) throw new Error('ভুল ফিল্ড');
        let v = String(body.texts[id] == null ? '' : body.texts[id]).trim().slice(0, t.max);
        if (t.url) v = cleanUrl(v);
        if (v) T[id] = v; else delete T[id];
      });
      await commit(Object.assign({}, config, { texts: Object.keys(T).length ? T : null }), 'Update texts', [], []);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/upload') {
      const body = await readJson(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024);
      if (IMG_KEYS.indexOf(body.kind) === -1) return sendJson(res, 400, { error: 'ভুল ধরন' });
      const kind = IMAGES[body.kind];
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
      if (!m) return sendJson(res, 400, { error: 'শুধু PNG, JPG বা WEBP ছবি দিন' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: 'ছবি ৩MB এর বেশি বড়' });
      const ext = detectImage(buf);
      if (!ext) return sendJson(res, 400, { error: 'ছবিটা ঠিক নেই' });
      const fname = kind.prefix + '-' + Date.now() + '.' + ext;
      const old = imgGet(config, body.kind);
      const next = Object.assign({}, config);
      imgSet(next, body.kind, fname);
      await commit(next, 'Update ' + kind.prefix, [{ name: fname, buf: buf }], old ? [old] : []);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/quick') {
      const body = await readJson(req, 8 * 1024);
      const next = Object.assign({}, config, { quick: sanitizeQuick(body.items) });
      await commit(next, 'Update quick buttons', [], []);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/banner') {
      const body = await readJson(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024);
      const act = body.action;
      const list = bannerList().slice();
      const add = [], del = [];
      const idx = Number(body.index);
      const readImg = function () {
        const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
        if (!m) throw new Error('শুধু PNG, JPG বা WEBP ছবি দিন');
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_UPLOAD_BYTES) throw new Error('ছবি ৩MB এর বেশি বড়');
        const ext = detectImage(buf);
        if (!ext) throw new Error('ছবিটা ঠিক নেই');
        return { name: 'banner-' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '.' + ext, buf: buf };
      };
      const okIdx = function (i) { return Number.isInteger(i) && i >= 0 && i < list.length; };
      if (act === 'add') {
        if (list.length >= MAX_BANNERS) throw new Error('সর্বোচ্চ ' + MAX_BANNERS + 'টি ব্যানার রাখা যাবে');
        const f = readImg(); add.push(f); list.push(f.name);
      } else if (act === 'replace') {
        if (!okIdx(idx)) throw new Error('ব্যানার পাওয়া যায়নি');
        const f = readImg(); add.push(f);
        const old = list[idx]; list[idx] = f.name;
        if (isUploaded(old)) del.push(old);
      } else if (act === 'delete') {
        if (list.length <= 1) throw new Error('কমপক্ষে ১টি ব্যানার রাখতে হবে');
        if (!okIdx(idx)) throw new Error('ব্যানার পাওয়া যায়নি');
        const old = list.splice(idx, 1)[0];
        if (isUploaded(old)) del.push(old);
      } else if (act === 'move') {
        const to = idx + (body.dir === 'up' ? -1 : 1);
        if (!okIdx(idx) || to < 0 || to >= list.length) throw new Error('সরানো যাচ্ছে না');
        const t = list[idx]; list[idx] = list[to]; list[to] = t;
      } else {
        throw new Error('ভুল কাজ');
      }
      const next = Object.assign({}, config, { banners: list });
      await commit(next, 'Update banners', add, del);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/reset') {
      const body = await readJson(req, 4096);
      const next = Object.assign({}, config);
      let del = [];
      if (body.kind === 'packages' || body.kind === 'product') {
        const key = body.kind === 'packages' ? 'ff' : body.key;
        const prod = Object.assign({}, config.prod);
        if (body.kind === 'packages') { const c = Object.assign({}, prod.ff); delete c.packages; if (Object.keys(c).length) prod.ff = c; else delete prod.ff; }
        else delete prod[key];
        next.prod = Object.keys(prod).length ? prod : null;
      } else if (body.kind === 'text') {
        const T = Object.assign({}, config.texts); delete T[body.id];
        next.texts = Object.keys(T).length ? T : null;
      } else if (body.kind === 'quick') {
        next.quick = null;
      } else if (body.kind === 'banners') {
        del = (config.banners || []).filter(isUploaded);
        next.banners = null;
      } else {
        if (IMG_KEYS.indexOf(body.kind) === -1) return sendJson(res, 400, { error: 'ভুল ধরন' });
        const old = imgGet(config, body.kind);
        if (old) del = [old];
        imgSet(next, body.kind, null);
      }
      await commit(next, 'Reset ' + String(body.kind), [], del);
      return sendJson(res, 200, currentView());
    }

    if (req.method === 'POST' && pathname === '/api/admin/resync') {
      ready = initStorage().then(function () { return loadAccountData(); });
      await ready;
      return sendJson(res, 200, currentView());
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e && e.message === 'too_large') return sendJson(res, 413, { error: 'ডাটা অনেক বড়' });
    if (e && e.message === 'bad_json') return sendJson(res, 400, { error: 'ভুল ডাটা' });
    return sendJson(res, 400, { error: (e && e.message) || 'কিছু একটা সমস্যা হয়েছে' });
  }
}

// Wait for the existing site storage to initialize before loading wallet data.
ready = ready.then(function () { return loadAccountData(); });

const server = http.createServer((req, res) => {
  ready.then(function () { handle(req, res); }).catch(function () {
    try { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500 Internal Server Error'); } catch (e) {}
  });
});

function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURI(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('400 Bad Request');
  }

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname);
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    const f = path.join(ROOT_DIR, 'admin.html');
    return fs.readFile(f, function (err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('admin.html পাওয়া যায়নি');
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES['.html'],
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(data);
    });
  }

  if (pathname.startsWith('/uploads/')) {
    const name = pathname.slice('/uploads/'.length);
    if (!SAFE_FILE.test(name)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    return serveFile(path.join(UPLOAD_DIR, name), res, 'public, max-age=31536000, immutable');
  }

  if (pathname === '/' || pathname === '' || pathname === '/index.html' || pathname === '/FFX.html') {
    return sendHome(req, res);
  }

  const filePath = path.normalize(path.join(ROOT_DIR, pathname));
  const rel = path.relative(ROOT_DIR, filePath);
  const base = path.basename(filePath).toLowerCase();
  const insideData = filePath === DATA_DIR || filePath.startsWith(DATA_DIR + path.sep);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }
  if (insideData || BLOCKED_NAMES.has(base) || base.startsWith('.') || rel.split(path.sep).some(function (p) { return p === 'node_modules' || p.startsWith('.'); })) {
    return sendHome(req, res);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {

      return sendHome(req, res);
    }
    serveFile(filePath, res, 'public, max-age=3600');
  });
}

function serveFile(filePath, res, cache) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', cache || 'public, max-age=3600');
    stream.pipe(res);
  });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } else {
      res.end();
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  if (!ADMIN_PASSWORD) console.log('⚠️  FFX-PASS সেট করা নেই — /admin লগইন বন্ধ থাকবে');
  console.log(USE_GH ? 'Storage: GitHub (' + (GH_REPO || '?') + ' @ ' + GH_BRANCH + ')' : 'Storage: লোকাল (FFX-G সেট করা নেই)');
});
