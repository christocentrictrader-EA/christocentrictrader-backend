/**
 * ChristocentricTrader Backend — server.js
 * Node.js + Express
 */

require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const axios      = require('axios');
const fs         = require('fs');
const FormData   = require('form-data');

const path     = require('path');
const archiver = require('archiver');

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
app.use(cors({
  origin: 'https://christocentrictrader.d9thprofithub.com.ng',
  exposedHeaders: ['Content-Disposition']
}));
app.use(helmet());
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

const upload = multer({ dest: 'uploads/' });

// === Routes ===

// Debug route — check which files exist on Render's filesystem
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
app.get('/api/download/:ea', (req, res) => {
  const bundle = EA_BUNDLES[req.params.ea];

  if (!bundle) {
    return res.status(404).json({ error: 'EA not found' });
  }

  const eaPath    = path.resolve(__dirname, bundle.ea);
  const guidePath = path.resolve(__dirname, bundle.guide);

  // Verify both files exist before streaming
  if (!fs.existsSync(eaPath)) {
    return res.status(404).json({ error: `EA file not found: ${bundle.ea}` });
  }
  if (!fs.existsSync(guidePath)) {
    return res.status(404).json({ error: `Guide PDF not found: ${bundle.guide}` });
  }

  const zipName = `${bundle.label}_Bundle.zip`;
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', (err) => {
    console.error('Archiver error:', err);
    // Headers already sent — just destroy the stream
    res.destroy();
  });

  archive.pipe(res);
  archive.file(eaPath,    { name: path.basename(eaPath) });
  archive.file(guidePath, { name: path.basename(guidePath) });
  archive.finalize();
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
⏰ Submitted At: ${new Date().toUTCString()}\n\n
━━━━━━━━━━━━━━━\n
📌 License request logged successfully!
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });

    res.json({
      ok: true,
      message: "Account submission received successfully. Please return to the site to continue."
    });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit account' });
  }
});

// Payment proof (with file upload)
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
⏰ Submitted At: ${new Date().toUTCString()}\n\n
━━━━━━━━━━━━━━━\n
✅ Payment confirmation logged successfully!
`;

    // Send the text message
    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });

    // If a file was uploaded, send it too
    if (req.file) {
      try {
        const formData = new FormData();
        formData.append("chat_id", process.env.TG_CHAT_ID);
        // ✅ Preserve original filename so Telegram shows correct extension
        formData.append("document", fs.createReadStream(req.file.path), {
          filename: req.file.originalname
        });

        await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendDocument`, formData, {
          headers: formData.getHeaders()
        });

        // Clean up uploaded file after sending
        fs.unlink(req.file.path, () => {});
      } catch (fileErr) {
        console.error("File upload to Telegram failed:", fileErr.message);
      }
    }

    res.json({
      ok: true,
      message: "Form submitted and proof uploaded successfully. Please click back to continue on the site."
    });
  } catch (err) {
    console.error('Payment proof error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit payment proof' });
  }
});

// AI Chat Route (placeholder response)
app.post('/api/ask-ai', async (req, res) => {
  const { question } = req.body;

  res.json({
    answer: "🚀 AI Trading Assistant coming soon — stay tuned!",
    model: "placeholder"
  });
});

// Email subscription route
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Invalid email address' });
    }

    const text = `
📩 <b>NEW SUBSCRIPTION REQUEST</b>\n\n
👤 Email: ${email}\n\n
⏰ Submitted At: ${new Date().toUTCString()}\n\n
━━━━━━━━━━━━━━━\n
✨ Stay tuned — another trader wants AI updates!
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "HTML"
    });

    res.json({
      ok: true,
      message: "Subscription saved successfully. You will receive updates soon — please return to the site."
    });
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
    // ✅ Preserve original filename here too
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

// ✅ Correct port binding for Render
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
});
