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

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(helmet());
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use(limiter);

const upload = multer({ dest: 'uploads/' });

// === Routes ===

// License / Account submission
app.post('/api/submit-account', async (req, res) => {
  try {
    const { name, email, mt5Account, broker, tier, message } = req.body;

    const text = `
🔑 *NEW LICENSE REQUEST*

👤 Name: ${name}
📧 Email: ${email}
🔑 MT5 Account: ${mt5Account}
🏦 Broker: ${broker}
🎟️ Tier: ${tier}
📝 Notes: ${message && message.trim() ? message : '—'}

⏰ Submitted At: ${new Date().toUTCString()}

━━━━━━━━━━━━━━━
📌 License request logged successfully!
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
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
app.post('/api/payment-proof', upload.single('file'), async (req, res) => {
  try {
    const { name, email, mt5Account, method, amount } = req.body;

    const text = `
💰 *PAYMENT PROOF RECEIVED*

👤 Name: ${name}
📧 Email: ${email}
🔑 MT5 Account: ${mt5Account}
🏦 Method: ${method}
💵 Amount: ${amount}

⏰ Submitted At: ${new Date().toUTCString()}

━━━━━━━━━━━━━━━
✅ Payment confirmation logged successfully!
`;

    // Send the text message
    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });

    // If a file was uploaded, send it too
    if (req.file) {
      const formData = new FormData();
      formData.append("chat_id", process.env.TG_CHAT_ID);
      formData.append("document", fs.createReadStream(req.file.path));

      await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendDocument`, formData, {
        headers: formData.getHeaders()
      });
    }

    res.json({
      ok: true,
      message: "Form submitted and proof uploaded successfully. Please click back to continue on the site."
    });
  } catch (err) {
    console.error('Telegram send error:', err.response ? err.response.data : err.message);
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
📩 *NEW SUBSCRIPTION REQUEST*

👤 Email: ${email}

⏰ Submitted At: ${new Date().toUTCString()}

━━━━━━━━━━━━━━━
✨ Stay tuned — another trader wants AI updates!
`;

    await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
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
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    ok: true,
    file: req.file.filename,
    message: "File uploaded successfully."
  });
});

// ✅ Correct port binding for Render
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`ChristocentricTrader backend running on port ${PORT}`);
});
