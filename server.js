/**
 * ChristocentricTrader + Driverline Backend — server.js
 * Node.js + Express
 */

require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const axios      = require('axios');
const fs         = require('fs');
const FormData   = require('form-data');
const path       = require('path');
const archiver   = require('archiver');

// === License API router ===
const licenseApi = require('./license-api'); // ← ADD

const app = express();
app.set('trust proxy', 1);

// === EA → file mapping (paths relative to project root) ===
const EA_BUNDLES = {
  'ChristocentricTrader_EA': {
    ea:    'downloads/ChristocentricTrader_EA.ex5',
    guide: 'guides/ChristocentricTrader_EA_Guide.pdf',
    label: 'ChristocentricTrader_EA',
  },
  'ChristocentricTrader_Advanced': {
    ea:    'downloads/ChristocentricTrader_Advanced.ex5',
    guide: 'guides/ChristocentricTrader_Advanced_Guide.pdf',
    label: 'ChristocentricTrader_Advanced',
  },
  'ChristocentricTrader_Advanced_Tiered': {
    ea:    'downloads/ChristocentricTrader_Advanced_Tiered.ex5',
    guide: 'guides/ChristocentricTrader_Advanced_Tiered_Guide.pdf',
    label: 'ChristocentricTrader_Advanced_Tiered',
  },
};

// === Middleware ===
app.use(express.json()); 
app.use(helmet());

// Updated CORS block
app.use((req, res, next) => {
  const allowed = [
    'https://d9thprofithub.com.ng',
    'https://driverline.d9thprofithub.com.ng',
    'https://christocentrictrader.d9thprofithub.com.ng',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

const upload = multer({ dest: 'uploads/' });

// === Routes ===

// Debug route
app.get('/api/debug-files', (req, res) => {
  const files = [
    'downloads/ChristocentricTrader_EA.ex5',
    'downloads/ChristocentricTrader_Advanced.ex5',
    'downloads/ChristocentricTrader_Advanced_Tiered.ex5',
    'guides/ChristocentricTrader_EA_Guide.pdf',
    'guides/ChristocentricTrader_Advanced_Guide.pdf',
    'guides/ChristocentricTrader_Advanced_Tiered_Guide.pdf',
  ];
  const results = {};
  files.forEach(f => {
    const full = path.resolve(__dirname, f);
    results[f] = fs.existsSync(full) ? '✅ found' : `❌ missing — resolved to: ${full}`;
  });
  res.json({ __dirname, cwd: process.cwd(), results });
});

// Bundled EA + PDF guide download
app.get('/api/download/:ea', async (req, res) => {
  try {
    const bundle = EA_BUNDLES[req.params.ea];
    if (!bundle) return res.status(404).json({ error: 'EA not found' });

    const eaPath    = path.resolve(__dirname, bundle.ea);
    const guidePath = path.resolve(__dirname, bundle.guide);

    if (!fs.existsSync(eaPath)) return res.status(404).json({ error: `EA file not found: ${bundle.ea}` });
    if (!fs.existsSync(guidePath)) return res.status(404).json({ error: `Guide PDF not found: ${bundle.guide}` });

    const zipName = `${bundle.label}_Bundle.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip');
    archive.pipe(res);
    archive.file(eaPath,    { name: path.basename(eaPath) });
    archive.file(guidePath, { name: path.basename(guidePath) });
    await archive.finalize();

  } catch (err) {
    console.error('Download route error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});
// License / Account submission
app.post('/api/submit-account', async (req, res) => {
  try {
    const { name, email, mt5Account, broker, tier, message } = req.body;
    const text = `
🔑 <b>NEW LICENSE REQUEST</b>\n\n
👤 Name: ${name}\n
📧 Email: ${email}\n
🔑 MT5 Account: ${mt5Account}\n
🏦 Broker: ${broker}\n
🎟️ Tier: ${tier}\n
📝 Notes: ${message && message.trim() ? message : '—'}\n\n
⏰ Submitted At: ${new Date().toUTCString()}
`;
    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });
    res.json({ ok: true, message: "Account submission received successfully." });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit account' });
  }
});

// Payment proof
app.post('/api/payment-proof', upload.single('paymentProof'), async (req, res) => {
  try {
    const { name, email, mt5Account, method, amount } = req.body;
    const text = `
💰 <b>PAYMENT PROOF RECEIVED</b>\n\n
👤 Name: ${name}\n
📧 Email: ${email}\n
🔑 MT5 Account: ${mt5Account}\n
🏦 Method: ${method}\n
💵 Amount: ${amount}\n\n
⏰ Submitted At: ${new Date().toUTCString()}
`;
    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });
    if (req.file) {
      const formData = new FormData();
      formData.append("chat_id", process.env.TG_CHAT_ID);
      formData.append("document", fs.createReadStream(req.file.path), { filename: req.file.originalname });
      await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendDocument`, formData, {
        headers: formData.getHeaders()
      });
      fs.unlink(req.file.path, () => {});
    }
    res.json({ ok: true, message: "Proof uploaded successfully." });
  } catch (err) {
    console.error('Payment proof error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit payment proof' });
  }
});

// AI Chat placeholder
app.post('/api/ask-ai', async (req, res) => {
  res.json({ answer: "🚀 AI Trading Assistant coming soon — stay tuned!", model: "placeholder" });
});

// Subscription
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Invalid email address' });
    const text = `
📩 <b>NEW SUBSCRIPTION REQUEST</b>\n\n
👤 Email: ${email}\n
⏰ Submitted At: ${new Date().toUTCString()}
`;
    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });
    res.json({ ok: true, message: "Subscription saved successfully." });
  } catch (err) {
    console.error('Subscription error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to save subscription' });
  }
});
// Upload route
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const formData = new FormData();
    formData.append("chat_id", process.env.TG_CHAT_ID);
    formData.append("document", fs.createReadStream(req.file.path), {
      filename: req.file.originalname
    });

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendDocument`, formData, {
      headers: formData.getHeaders()
    });

    // Clean up uploaded file after sending
    fs.unlink(req.file.path, () => {});

    res.json({
      ok: true,
      file: req.file.originalname,
      message: "File uploaded and forwarded successfully."
    });
  } catch (err) {
    console.error("Upload route error:", err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to upload file' });
  }
});

// === Driverline License API integration ===
// Mount the license router so /api/validate-license and /api/download work
app.use('/api', licenseApi); // ← ADD

// === Test route ===
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, message: '✅ Backend is alive and serving routes!' });
});

// ✅ Correct port binding for Render
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ChristocentricTrader + Driverline backend running on port ${PORT}`);
});
