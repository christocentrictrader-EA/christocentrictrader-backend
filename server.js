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
const axios      = require('axios');

const app = express();

// Security & middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Rate limiter
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
});
app.use(limiter);

// File upload setup
const upload = multer({ dest: 'uploads/' });

// === Existing Routes ===

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
// AI Chat Route (simulated streaming)
app.post('/api/ask-ai', async (req, res) => {
  try {
    const { question } = req.body;

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct',
      { inputs: `You are a trading assistant. Answer clearly:\n${question}` },
      { headers: { Authorization: `Bearer ${process.env.HF_API_TOKEN}` } }
    );

    const answer = response.data[0].generated_text;
    res.json({ answer });
  } catch (err) {
    console.error('AI error:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

// Example upload route (if you already have one)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, file: req.file.filename });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
});
