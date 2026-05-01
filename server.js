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


// ─────────────────────────────────────────────
// ENV + DEPENDENCIES
// ─────────────────────────────────────────────
require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app = express();

// Dynamic import wrapper for node-fetch
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

// ────────────────────────────────────────────────────
// CONFIGURATION
// ────────────────────────────────────────────────────
const {
  PORT            = 3000,
  TG_BOT_TOKEN,
  TG_CHAT_ID,
  ALLOWED_ORIGIN  = 'https://api.christocentrictrader.d9thprofithub.com.ng',
  DOWNLOADS_DIR   = path.join(__dirname, '../downloads'),
  UPLOADS_DIR     = path.join(__dirname, 'uploads'),
  NODE_ENV        = 'production',
} = process.env;

if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
  console.error('ERROR: TG_BOT_TOKEN and TG_CHAT_ID must be set');
  process.exit(1);
}

// Ensure directories exist
[DOWNLOADS_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ────────────────────────────────────────────────────
// RATE LIMITING
// ────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,   // 15 minutes
  max      : 20,               // max 20 API calls per window
  message  : { ok: false, error: 'Too many requests. Please try again later.' },
});

// ────────────────────────────────────────────────────
// FILE UPLOAD CONFIG (multer)
// ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename   : (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const safe = Date.now() + '_' + Math.random().toString(36).substring(2) + ext;
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
      cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed'));
    }
  },
});

// ────────────────────────────────────────────────────
// TELEGRAM HELPERS
// ────────────────────────────────────────────────────
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

async function tgSendFile(filePath, caption) {
  const ext      = path.extname(filePath).toLowerCase();
  const isPhoto  = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  const endpoint = isPhoto ? 'sendPhoto' : 'sendDocument';
  const field    = isPhoto ? 'photo'     : 'document';
  const url      = `https://api.telegram.org/bot${TG_BOT_TOKEN}/${endpoint}`;

  const { FormData, Blob } = await import('node-fetch').then(m => ({
    FormData: m.FormData,
    Blob    : m.Blob,
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

// ────────────────────────────────────────────────────
// VALIDATION HELPERS
// ────────────────────────────────────────────────────
const isValidMT5    = v => /^[0-9]{5,12}$/.test((v || '').trim());
const isValidEmail  = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const sanitize      = v => String(v || '').replace(/[<>]/g, '');

// ─────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({

  origin: (origin, callback) => {

    const allowedOrigins = [

      'https://christocentrictrader.d9thprofithub.com.ng',

      'https://api.christocentrictrader.d9thprofithub.com.ng'

    ];

    if (!origin || allowedOrigins.includes(origin)) {

      callback(null, true);

    } else {

      console.error('Blocked by CORS:', origin);

      callback(new Error('Not allowed by CORS'));

    }

  },

  methods: ['GET', 'POST'],

}));

app.use(express.json({ limit: '1mb' }));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────
// More relaxed limit for account submissions
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,                 // allow up to 200 requests per IP
  message: { ok: false, message: 'Too many account submissions, please try again later.' },
});

// Stricter limit for file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                  // only 50 uploads per IP
  message: { ok: false, message: 'Too many uploads, please try again later.' },
});

// Apply per-route
app.use('/api/submit-account', accountLimiter);
app.use('/api/payment-proof', uploadLimiter);

// ─────────────────────────────────────────────
// FILTERED REQUEST LOGGING MIDDLEWARE
// ─────────────────────────────────────────────
const logRoutes = ['/api/submit-account', '/api/payment-proof'];
app.use((req, res, next) => {
  if (logRoutes.includes(req.path)) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Body:', req.body);
    }
    console.log('Origin:', req.headers.origin || 'No origin header');
  }
  next();
});

// ─────────────────────────────────────────────
// ROOT ROUTE
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Backend service is running on custom domain');
});

module.exports = app;
// ────────────────────────────────────────────────────
// ROUTES
// ────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Submit account route
app.post('/api/submit-account', apiLimiter, async (req, res) => {
  try {
    const { name, email, mt5Account, tier, broker, message } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ ok: false, error: 'Name is required.' });
    if (!isValidEmail(email))
      return res.status(400).json({ ok: false, error: 'Invalid email.' });
    if (!isValidMT5(mt5Account))
      return res.status(400).json({ ok: false, error: 'Invalid MT5 account.' });
    if (!tier)
      return res.status(400).json({ ok: false, error: 'Tier is required.' });

    const tierLabel = {
      tier1: 'Tier 1 — Classic EA ($50/month)',
      tier2: 'Tier 2 — Advanced: Classic + SMC ($100/month)',
      tier3: 'Tier 3 — Full Suite ($150/month)',
    }[tier] || tier;

    const msg =
      `🔑 <b>NEW LICENSE REQUEST</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>Name      :</b> ${sanitize(name)}\n` +
      `📧 <b>Email     :</b> ${sanitize(email)}\n` +
      `🖥 <b>MT5 Acct  :</b> <code>${sanitize(mt5Account)}</code>\n` +
      `🏦 <b>Broker    :</b> ${sanitize(broker || 'Not provided')}\n` +
      `🎯 <b>Tier      :</b> ${tierLabel}\n` +
      (message ? `💬 <b>Notes     :</b> ${sanitize(message)}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⏰ ${new Date().toUTCString()}`;

    await tgSend(msg);
    res.json({ ok: true, message: 'Submitted successfully.' });
  } catch (err) {
    console.error('[account] error:', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// Payment proof route
app.post('/api/payment-proof', apiLimiter, upload.single('file'), async (req, res) => {
  try {
    const { name, email, mt5Account, method, amount } = req.body;
    const file = req.file;

    if (!name || !name.trim())
      return res.status(400).json({ ok: false, error: 'Name is required.' });
    if (!isValidEmail(email))
      return res.status(400).json({ ok: false, error: 'Invalid email.' });
    if (!isValidMT5(mt5Account))
      return res.status(400).json({ ok: false, error: 'Invalid MT5 account.' });
    if (!method)
      return res.status(400).json({ ok: false, error: 'Payment method is required.' });
    if (!amount || !amount.trim())
      return res.status(400).json({ ok: false, error: 'Amount is required.' });
    if (!file)
      return res.status(400).json({ ok: false, error: 'Payment proof file is required.' });

    const methodLabel = {
      bank_ng : 'Bank Transfer (NGN)',
      usdt    : 'USDT TRC20',
      usdt     : 'USDT BEP20',
      other   : 'Other',
    }[method] || method;

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

    // Send text message first, then the file itself
    await tgSend(caption);
    await tgSendFile(file.path, caption);

    console.log(`[payment] ${sanitize(email)} | MT5:${sanitize(mt5Account)}`);
    res.json({ ok: true, message: 'Payment proof submitted successfully.' });

  } catch (err) {
    console.error('[payment] error:', err);
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ ok: false, error: 'File too large. Max 5MB.' });
    if (err.message && err.message.includes('Only'))
      return res.status(400).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// ── GET /downloads/:filename ─────────────────────────
// Serves .ex5 EA files — add token-based auth if needed
app.get('/downloads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);

  if (!filename.endsWith('.ex5')) {
    return res.status(403).json({ error: 'Forbidden. Only .ex5 files allowed.' });
  }

  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.download(filePath, filename);
});

// ── Serve frontend (static) ──────────────────────────
const FRONTEND = path.join(__dirname, '../frontend');
app.use(express.static(FRONTEND));
app.get('*', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));

//────────────────────────────────────────────────────
// DEBUG ROUTES
//────────────────────────────────────────────────────
app.post('/api/submit-account', (req, res) => {

  console.log('Received /api/submit-account request body:', req.body);

  res.json({ message: 'Debug: request received successfully', data: req.body });

});



app.post('/api/payment-proof', upload.single('file'), (req, res) => {

  console.log('Received /api/payment-proof upload:', req.file);

  res.json({ message: 'Debug: file uploaded successfully', file: req.file });

});

//────────────────────────────────────────────────────
//  ORIGIN LOGGING SNIPPET
//────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log('Request Origin:', req.headers.origin);
  next();
});
//────────────────────────────────────────────────────
// API ROUTES
//────────────────────────────────────────────────────
app.post('/api/submit-account', (req, res) => {

  console.log('Received /api/submit-account request body:', req.body);

  res.json({ message: 'Debug: request received successfully', data: req.body });

});

;

app.post('/api/payment-proof', upload.single('paymentProof'), (req, res) => {
  console.log('Received upload:', req.file);
  res.json({ message: 'File uploaded successfully', file: req.file });
});

//────────────────────────────────────────────────────
// CATCH-ALL ROUTE FOR FRONTEND
//────────────────────────────────────────────────────
app.get('*', (req, res) => {

  res.sendFile(path.join(__dirname, '../frontend/index.html'));

});

//────────────────────────────────────────────────────
// OPTIONAL ERROR HANDLER
//────────────────────────────────────────────────────
app.use((err, req, res, next) => {

  console.error('Unhandled error:', err.message);

  res.status(500).json({ error: 'Internal Server Error', details: err.message });

});


// ────────────────────────────────────────────────────
// START SERVER
// ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Downloads   : ${DOWNLOADS_DIR}`);
  console.log(`  Uploads     : ${UPLOADS_DIR}`);
});
