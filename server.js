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

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(helmet());
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

const upload = multer({ dest: 'uploads/' });

// === Routes ===

// Account submission
app.post('/api/submit-account', async (req, res) => {
  try {
    const { name, email, mt5Account, broker, tier, message } = req.body;

    const text = `
🔑 NEW LICENSE REQUEST

Full Name: ${name}
Email Address: ${email}
MT5 Account Number: ${mt5Account}
Broker Name: ${broker}
License Tier: ${tier}
Additional Notes: ${message && message.trim() ? message : '—'}

⏰ Submitted At: ${new Date().toUTCString()}
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit account' });
  }
});

// Payment proof
app.post('/api/payment-proof', async (req, res) => {
  try {
    const { name, email, mt5Account, method, amount } = req.body;

    const text = `
💰 PAYMENT PROOF RECEIVED

Full Name: ${name}
Email Address: ${email}
MT5 Account Number: ${mt5Account}
Payment Method: ${method}
Amount Paid: ${amount}

⏰ Submitted At: ${new Date().toUTCString()}
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
    res.status(500).json({ ok: false, error: 'Failed to submit payment proof' });
  }
});

// AI Chat Route (placeholder response)
app.post('/api/ask-ai', async (req, res) => {
  const { question } = req.body;

  res.json({
    answer: "Our AI trading assistant is not available right now. Stay tuned for future updates!",
    model: "placeholder"
  });
});

// Upload route
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, file: req.file.filename });
});

// ✅ Correct port binding for Render
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
});
