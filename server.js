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
app.post('/api/submit-account', async (req, res) => { /* unchanged */ });

// Payment proof
app.post('/api/payment-proof', async (req, res) => { /* unchanged */ });

// AI Chat Route
app.post('/api/ask-ai', async (req, res) => {
  try {
    const { question } = req.body;
    const modelName = process.env.MODEL_NAME || "google/flan-t5-small";
    const url = `https://api-inference.huggingface.co/models/${modelName}`;

    const response = await axios.post(
      url,
      { inputs: question },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const answer = response.data[0]?.generated_text || response.data?.generated_text || "No answer generated.";
    console.log(`Model used: ${modelName}`);
    res.json({ answer, model: modelName });
  } catch (err) {
    if (err.response) {
      console.error("AI error response:", err.response.status, err.response.data);
      res.status(err.response.status).json({
        error: "AI request failed",
        details: err.response.data,
        fallback: "AI is busy or model not found, please try again later."
      });
    } else {
      console.error("AI error:", err.message);
      res.status(500).json({
        error: "AI request failed",
        details: err.message,
        fallback: "AI is busy right now, please try again later."
      });
    }
  }
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
