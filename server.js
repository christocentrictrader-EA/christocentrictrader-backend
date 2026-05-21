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
const licenseApi = require('./license-api'); 

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

// === Driverline License API integration ===
app.use('/api', licenseApi);
console.log('✅ License API mounted at /api');

// === Test route ===
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, message: '✅ Backend is alive and serving routes!' });
});

// ✅ Correct port binding for Render
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, () => {
  console.log(`ChristocentricTrader + Driverline backend running on port ${PORT}`);
});
