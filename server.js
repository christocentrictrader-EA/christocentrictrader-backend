/**
 * ChristocentricTrader Backend — server.js
 * Node.js + Express
 *
 * Handles:
 *  POST /api/submit-account  — MT5 account + tier submission → Telegram
 *  POST /api/payment-proof   — proof-of-payment file upload  → Telegram
 *  GET  /downloads/:file     — protected EA file downloads
 *
 * Required npm packages:
 *   npm install express multer node-fetch dotenv cors helmet express-rate-limit
 */

require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

// Dynamic import wrapper for node-fetch (ESM-only in v3+)
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

// ─────────────────────────────────────────────────────────────────
// CONFIGURATION  (set in .env — never hardcode in production)
// ─────────────────────────────────────────────────────────────────
const {
  PORT            = 3000,
  TG_BOT_TOKEN,          // Telegram bot token from @BotFather
  TG_CHAT_ID,            // Your Telegram channel / group chat ID
  ALLOWED_ORIGIN  = 'https://christocentrictrader.d9thprofithub.com.ng',
  DOWNLOADS_DIR   = path.join(__dirname, '../downloads'),
  UPLOADS_DIR     = path.join(__dirname, 'uploads'),
  NODE_ENV        = 'production',
} = process.env;

// Validate required env vars on startup
if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
  console.error('ERROR: TG_BOT_TOKEN and TG_CHAT_ID must be set in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────
// SETUP DIRECTORIES
// ─────────────────────────────────────────────────────────────────
[DOWNLOADS_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─────────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────────
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,   // frontend uses inline styles
}));

// CORS — only allow the subdomain
app.use(cors({
  origin: NODE_ENV === 'development' ? '*' : ALLOWED_ORIGIN=https://christocentrictrader-fronte.onrender.com ,
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    // Build Telegram message
    const message = `📂 New file uploaded:\n\nFilename: ${file.originalname}\nSize: ${file.size} bytes`;

    // Send to Telegram
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: message,
      }),
    });

    res.status(200).send('File uploaded successfully and notification sent to Telegram.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file.');
  }
});
app.post('/submit', async (req, res) => {
  try {
    const { name, email, account, broker, tier, msg } = req.body;

    const message = `📝 New form submission:\n
    Name: ${name}\n
    Email: ${email}\n
    Account: ${account}\n
    Broker: ${broker}\n
    Tier: ${tier}\n
    Notes: ${msg || 'None'}`;

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: message,
      }),
    });

    res.status(200).send('Form submitted successfully and notification sent to Telegram.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error submitting form.');
  }
});
// ─────────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,   // 15 minutes
  max      : 20,                // max 20 API calls per IP per window
  message  : { ok: false, error: 'Too many requests. Please try again later.' },
});

// ─────────────────────────────────────────────────────────────────
// FILE UPLOAD CONFIG (multer)
// ─────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename   : (req, file, cb) => {
    // Sanitise filename: timestamp + random + safe extension
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const safe = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, safe);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
  storage,
  limits : { fileSize: 5 * 1024 * 1024 },   // 5 MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed.'));
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// TELEGRAM HELPER
// ─────────────────────────────────────────────────────────────────

/**
 * Send a plain text message to Telegram.
 * Uses HTML parse_mode for bold/code formatting.
 */
async function tgSend(text) {
  const url  = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id    : TG_CHAT_ID,
    text,
    parse_mode : 'HTML',
  });
  const res = await fetch(url, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Telegram sendMessage failed:', err);
  }
  return res.ok;
}

/**
 * Send a file (photo or document) to Telegram.
 * Telegram auto-renders JPEG/PNG as photos; PDF as document.
 */
async function tgSendFile(filePath, caption) {
  const ext      = path.extname(filePath).toLowerCase();
  const isPhoto  = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  const endpoint = isPhoto ? 'sendPhoto' : 'sendDocument';
  const field    = isPhoto ? 'photo'     : 'document';
  const url      = `https://api.telegram.org/bot${TG_BOT_TOKEN}/${endpoint}`;

  // Build multipart/form-data manually using FormData (Node 18+) or FormData polyfill
  const { FormData, Blob } = await import('node-fetch').then(m => ({
    FormData: m.FormData,
    Blob    : m.Blob,
  })).catch(() => ({
    FormData: global.FormData,
    Blob    : global.Blob,
  }));

  const form = new FormData();
  form.append('chat_id', TG_CHAT_ID);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');

  const fileBuffer = fs.readFileSync(filePath);
  const filename   = path.basename(filePath);
  form.append(field, new Blob([fileBuffer]), filename);

  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram ${endpoint} failed:`, err);
  }
  return res.ok;
}

// ─────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────
const isValidMT5    = v => /^[0-9]{5,12}$/.test((v || '').trim());
const isValidEmail  = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const sanitize      = v => String(v || '').replace(/[<>"'`]/g, '').trim().slice(0, 500);

// ─────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── POST /api/submit-account ──────────────────────────────────────
app.post('/api/submit-account', apiLimiter, async (req, res) => {
  try {
    const { name, email, mt5Account, tier, broker, message } = req.body;

    // Validation
    if (!name || !name.trim())
      return res.status(400).json({ ok: false, error: 'Name is required.' });
    if (!isValidEmail(email))
      return res.status(400).json({ ok: false, error: 'Valid email is required.' });
    if (!isValidMT5(mt5Account))
      return res.status(400).json({ ok: false, error: 'MT5 account number must be 5–12 digits.' });
    if (!tier)
      return res.status(400).json({ ok: false, error: 'Please select a tier.' });

    const tierLabel = {
      tier1: 'Tier 1 — Classic EA ($50/month)',
      tier2: 'Tier 2 — Advanced: Classic + SMC ($100/month)',
      tier3: 'Tier 3 — Full Suite ($150/month)',
    }[tier] || tier;

    // Build Telegram message
    const msg =
      `🔑 <b>NEW LICENSE REQUEST</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Name      :</b> ${sanitize(name)}\n` +
      `📧 <b>Email     :</b> ${sanitize(email)}\n` +
      `🖥 <b>MT5 Acct  :</b> <code>${sanitize(mt5Account)}</code>\n` +
      `🏦 <b>Broker    :</b> ${sanitize(broker || 'Not specified')}\n` +
      `🎯 <b>Tier      :</b> ${tierLabel}\n` +
      (message ? `💬 <b>Notes     :</b> ${sanitize(message)}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏰ ${new Date().toUTCString()}`;

    await tgSend(msg);

    console.log(`[account] ${sanitize(email)} | MT5:${sanitize(mt5Account)} | ${tier}`);
    res.json({ ok: true, message: 'Submitted successfully.' });

  } catch (err) {
    console.error('[account] error:', err);
    res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
});

// ── POST /api/payment-proof ───────────────────────────────────────
app.post('/api/payment-proof', apiLimiter, upload.single('proof'), async (req, res) => {
  try {
    const { name, email, mt5Account, method, amount } = req.body;
    const file = req.file;

    // Validation
    if (!name || !name.trim())
      return res.status(400).json({ ok: false, error: 'Name is required.' });
    if (!isValidEmail(email))
      return res.status(400).json({ ok: false, error: 'Valid email is required.' });
    if (!isValidMT5(mt5Account))
      return res.status(400).json({ ok: false, error: 'MT5 account number must be 5–12 digits.' });
    if (!method)
      return res.status(400).json({ ok: false, error: 'Payment method is required.' });
    if (!amount || !amount.trim())
      return res.status(400).json({ ok: false, error: 'Amount paid is required.' });
    if (!file)
      return res.status(400).json({ ok: false, error: 'Proof of payment file is required.' });

    const methodLabel = {
      bank_ng : 'Bank Transfer (NGN)',
      usdt    : 'USDT TRC20',
      btc     : 'Bitcoin (BTC)',
      other   : 'Other',
    }[method] || method;

    // Build caption for Telegram
    const caption =
      `💰 <b>PAYMENT PROOF RECEIVED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Name    :</b> ${sanitize(name)}\n` +
      `📧 <b>Email   :</b> ${sanitize(email)}\n` +
      `🖥 <b>MT5 Acct:</b> <code>${sanitize(mt5Account)}</code>\n` +
      `💳 <b>Method  :</b> ${methodLabel}\n` +
      `💵 <b>Amount  :</b> ${sanitize(amount)}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏰ ${new Date().toUTCString()}`;

    // Send text message first, then the file
    await tgSend(caption);
    await tgSendFile(file.path, caption);

    console.log(`[payment] ${sanitize(email)} | MT5:${sanitize(mt5Account)} | ${method} | ${sanitize(amount)}`);
    res.json({ ok: true, message: 'Payment proof submitted successfully.' });

  } catch (err) {
    console.error('[payment] error:', err);
    // Multer errors
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ ok: false, error: 'File must be under 5 MB.' });
    if (err.message && err.message.includes('Only'))
      return res.status(400).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
  }
});

// ── GET /downloads/:filename ──────────────────────────────────────
// Serves .ex5 EA files — add token-based auth here if needed
app.get('/downloads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);  // prevent path traversal

  // Only allow .ex5 files
  if (!filename.endsWith('.ex5')) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.download(filePath, filename);
});

// ── Serve frontend (static) ───────────────────────────────────────
const FRONTEND = path.join(__dirname, '../frontend');
app.use(express.static(FRONTEND));
app.get('*', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Downloads   : ${DOWNLOADS_DIR}`);
  console.log(`  Uploads     : ${UPLOADS_DIR}`);
});
