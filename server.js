/**
 * ChristocentricTrader Backend — server.js
 * Node.js + Express
 */

require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // fix proxy header issue on Render

// Dynamic import wrapper for node-fetch
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const {
  PORT            = 3000,
  TG_BOT_TOKEN,
  TG_CHAT_ID,
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

// ─────────────────────────────────────────────
// SECURITY + CORS
// ─────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'https://christocentrictrader.d9thprofithub.com.ng',
      'https://api.christocentrictrader.d9thprofithub.com.ng'
    ];
    if (!origin || allowed.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { ok: false, error: 'Too many account submissions, try later.' },
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { ok: false, error: 'Too many uploads, try later.' },
});

// ─────────────────────────────────────────────
// MULTER CONFIG
// ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '_' + Math.random().toString(36).substring(2) + ext);
  }
});
const ALLOWED_MIME = ['image/jpeg','image/png','image/webp','application/pdf'];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP, or PDF files are allowed'));
  }
});

// ─────────────────────────────────────────────
// TELEGRAM HELPERS
// ─────────────────────────────────────────────
async function tgSendFile(filePath, caption) {
  const ext = path.extname(filePath).toLowerCase();
  const isPhoto = ['.jpg','.jpeg','.png','.webp'].includes(ext);
  const endpoint = isPhoto ? 'sendPhoto' : 'sendDocument';
  const field = isPhoto ? 'photo' : 'document';
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/${endpoint}`;
  const { FormData, Blob } = await import('node-fetch').then(m => ({ FormData:m.FormData, Blob:m.Blob }));
  const form = new FormData();
  form.append('chat_id', TG_CHAT_ID);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML'); // enables bold formatting
  const fileBuffer = fs.readFileSync(filePath);
  form.append(field, new Blob([fileBuffer]), path.basename(filePath));
  const res = await fetch(url, { method:'POST', body:form });
  if (!res.ok) console.error(`Telegram ${endpoint} failed:`, await res.text());
  return res.ok;
}

// ─────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────
const isValidMT5   = v => /^[0-9]{5,12}$/.test((v||'').trim());
const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v||'').trim());
const sanitize     = v => String(v||'').replace(/[<>]/g,'');

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
app.get('/api/health', (req,res)=>res.json({ok:true}));

app.post('/api/submit-account', accountLimiter, async (req,res)=>{
  try {
    const { name,email,mt5Account,tier,broker,message } = req.body;
    if (!name?.trim()) return res.status(400).json({ok:false,error:'Name required'});
    if (!isValidEmail(email)) return res.status(400).json({ok:false,error:'Invalid email'});
    if (!isValidMT5(mt5Account)) return res.status(400).json({ok:false,error:'Invalid MT5 account'});
    if (!tier) return res.status(400).json({ok:false,error:'Tier required'});
    const tierLabel = { tier1:'Tier 1 — Classic EA ($50/month)', tier2:'Tier 2 — Advanced ($100/month)', tier3:'Tier 3 — Full Suite ($150/month)' }[tier] || tier;
    const msg = `🔑 <b>NEW LICENSE REQUEST</b>\n
<b>Full Name:</b> ${sanitize(name)}\n
<b>Email Address:</b> ${sanitize(email)}\n
<b>MT5 Account:</b> ${sanitize(mt5Account)}\n
<b>Broker:</b> ${sanitize(broker||'Not provided')}\n
<b>Tier:</b> ${tierLabel}\n
${message?`💬 ${sanitize(message)}`:''}\n
⏰ ${new Date().toUTCString()}`;
    await tgSendFile(null, msg); // text-only message
    res.json({ok:true,message:'Submitted successfully'});
  } catch(err) {
    console.error('[account] error:',err);
    res.status(500).json({ok:false,error:'Server error'});
  }
});

app.post('/api/payment-proof', uploadLimiter, upload.single('paymentProof'), async (req,res)=>{
  try {
    const { name,email,mt5Account,method,amount } = req.body;
    const file = req.file;
    if (!name?.trim()) return res.status(400).json({ok:false,error:'Name required'});
    if (!isValidEmail(email)) return res.status(400).json({ok:false,error:'Invalid email'});
    if (!isValidMT5(mt5Account)) return res.status(400).json({ok:false,error:'Invalid MT5 account'});
    if (!method) return res.status(400).json({ok:false,error:'Payment method required'});
    if (!amount?.trim()) return res.status(400).json({ok:false,error:'Amount required'});
    if (!file) return res.status(400).json({ok:false,error:'Payment proof file required'});

    // Bold labels with HTML formatting
    const caption = `💰 <b>PAYMENT PROOF RECEIVED</b>\n
<b>Full Name:</b> ${sanitize(name)}\n
<b>Email Address:</b> ${sanitize(email)}\n
<b>MT5 Account Number:</b> ${sanitize(mt5Account)}\n
<b>Payment Method:</b> ${sanitize(method)}\n
<b>Amount Paid:</b> ₦${sanitize(amount)}\n
<b>Timestamp:</b> ${new Date().toUTCString()}`;

    await tgSendFile(file.path, caption);
    res.json({ok:true,message:'Payment proof submitted successfully'});
  } catch(err) {
    console.error('[payment] error:',err);
    if (err.code==='LIMIT_FILE_SIZE') return res.status(400).json({ok:false,error:'File too large. Max 5MB.'});
    if (err.message?.includes('Only')) return res.status(400).json({ok:false,error:err.message});
    res.status(500).json({ok:false,error:'Server error'});
  }
});

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

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Downloads   : ${DOWNLOADS_DIR}`);
  console.log(`  Uploads     : ${UPLOADS_DIR}`);
});
