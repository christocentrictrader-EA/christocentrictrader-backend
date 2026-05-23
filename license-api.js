// =============================================================================
//  license-api.js  —  ChristocentricTrader License Validation API
//  One License = One Indicator enforcement via persistent JSON store.
//  Mount in server.js:
//      const licenseApi = require('./license-api');
//      app.use('/api', licenseApi);
// =============================================================================

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

// =============================================================================
//  ENVIRONMENT VARIABLES (set in Render dashboard)
//  CCT_LICENSE_SALT  — your hash salt  (required)
//  STORE_BACKEND     — "json" or "mongo" (default: "json")
//  MONGODB_URI       — only needed when STORE_BACKEND=mongo
// =============================================================================
const SALT         = process.env.CCT_LICENSE_SALT;
const STORE_BACKEND = (process.env.STORE_BACKEND || 'json').toLowerCase();
const MONGODB_URI  = process.env.MONGODB_URI || '';

if (!SALT) {
  console.error('[LICENSE] FATAL: CCT_LICENSE_SALT env var not set.');
}

// =============================================================================
//  INDICATOR MAP
// =============================================================================
const INDICATOR_MAP = {
  'blue-gate-ai':     { file: 'Driverline_AI_SMC_Suite.ex5',              minTier: 2 },
  'mtf-structure':    { file: 'Driverline_MTF_Structure.ex5',             minTier: 1 },
  'cct-advanced-mw':  { file: 'ChristocentricTrader_Advanced_MW.ex5',     minTier: 3 },
  'dl-mw-advanced':   { file: 'Driverline_Indicator_MW_Advanced.ex5',     minTier: 2 },
  'trend-compass':    { file: 'Driverline_Trend_Compass.ex5',             minTier: 1 },
  'dl-pro':           { file: 'Driverline_Indicator_Pro.ex5',             minTier: 2 },
};

const TIER_NAMES = {
  1: 'Tier 1 - Classic',
  2: 'Tier 2 - Classic + SMC',
  3: 'Tier 3 - Full Access',
};

// =============================================================================
//  STORE INTERFACE
//  Both backends expose the same 3 functions:
//    getRecord(licenseKey)           -> { indicator, downloadedAt, file } | null
//    saveRecord(licenseKey, data)    -> void
//    initStore()                     -> Promise (called once on startup)
// =============================================================================

// ── JSON FILE STORE ──────────────────────────────────────────────────────────
//  Stored at ./data/license_usage.json next to server.js.
//  NOTE: Render free tier has an ephemeral disk — data resets on redeploy.
//  If that's a problem, switch to the MongoDB backend below.
// ─────────────────────────────────────────────────────────────────────────────
const JSON_STORE_PATH = path.join(__dirname, 'data', 'license_usage.json');

const jsonStore = {
  _data: {},

  async init() {
    const dir = path.dirname(JSON_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(JSON_STORE_PATH)) {
      try {
        this._data = JSON.parse(fs.readFileSync(JSON_STORE_PATH, 'utf8'));
        console.log(`[STORE] JSON store loaded — ${Object.keys(this._data).length} records`);
      } catch (e) {
        console.error('[STORE] Could not parse JSON store, starting fresh.', e.message);
        this._data = {};
      }
    } else {
      console.log('[STORE] JSON store not found — starting fresh.');
    }
  },

  async getRecord(licenseKey) {
    return this._data[licenseKey] || null;
  },

  async saveRecord(licenseKey, data) {
    this._data[licenseKey] = data;
    fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(this._data, null, 2), 'utf8');
  },
};

// ── MONGODB STORE ────────────────────────────────────────────────────────────
//  Uses the official 'mongodb' npm package (no mongoose needed).
//  Install: npm install mongodb
//  Set env var MONGODB_URI to your Atlas connection string.
//  Free Atlas cluster is sufficient for this usage volume.
// ─────────────────────────────────────────────────────────────────────────────
const mongoStore = {
  _col: null,

  async init() {
    if (!MONGODB_URI) {
      throw new Error('[STORE] MONGODB_URI env var not set. Cannot use mongo backend.');
    }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db('cct_licenses');
    this._col = db.collection('usage');
    // Unique index on licenseKey
    await this._col.createIndex({ licenseKey: 1 }, { unique: true });
    console.log('[STORE] MongoDB connected.');
  },

  async getRecord(licenseKey) {
    return await this._col.findOne({ licenseKey }, { projection: { _id: 0 } });
  },

  async saveRecord(licenseKey, data) {
    await this._col.updateOne(
      { licenseKey },
      { $set: { licenseKey, ...data } },
      { upsert: true }
    );
  },
};

// ── SELECT BACKEND ────────────────────────────────────────────────────────────
const store = STORE_BACKEND === 'mongo' ? mongoStore : jsonStore;

// Initialise store on startup
store.init().catch(err => {
  console.error('[STORE] Init failed:', err.message);
});

// =============================================================================
//  SHA-256  (mirrors CCT_LicenseGenerator.mq5 exactly)
//  CP_ACP + null terminator via latin1 encoding + 0x00 appended
// =============================================================================
function computeHash8(accountStr, tierStr, expiryStr) {
  const seed      = accountStr + tierStr + expiryStr + SALT;
  const withNull  = Buffer.concat([Buffer.from(seed, 'latin1'), Buffer.from([0x00])]);
  return crypto.createHash('sha256').update(withNull).digest('hex').slice(0, 8).toUpperCase();
}

// =============================================================================
//  KEY PARSER  —  ACCOUNTNUMBER-TIER-YYYYMMDD-HASH8
// =============================================================================
function parseKey(licenseKey) {
  const parts = licenseKey.trim().split('-');
  if (parts.length !== 4) return null;

  const [accountStr, tierStr, expiryStr, hash8] = parts;
  if (!/^\d+$/.test(accountStr))         return null;
  const tier = parseInt(tierStr, 10);
  if (![1, 2, 3].includes(tier))         return null;
  if (!/^\d{8}$/.test(expiryStr))        return null;
  if (!/^[A-Fa-f0-9]{8}$/.test(hash8))  return null;

  return { accountStr, tier, expiryStr, hash8: hash8.toUpperCase() };
}

function isNotExpired(expiryStr) {
  const yr = parseInt(expiryStr.slice(0, 4), 10);
  const mo = parseInt(expiryStr.slice(4, 6), 10) - 1;
  const dy = parseInt(expiryStr.slice(6, 8), 10);
  return Date.now() <= Date.UTC(yr, mo, dy, 23, 59, 59, 999);
}

// =============================================================================
//  CORE VALIDATION HELPER
//  Returns { ok, parsed, entry, error, status } 
// =============================================================================
function coreValidate(licenseKey, accountNumber, indicator) {
  if (!SALT)
    return { ok: false, status: 500, error: 'Server configuration error. Contact support.' };

  if (!licenseKey || !accountNumber || !indicator)
    return { ok: false, status: 400, error: 'Missing required fields.' };

  if (!/^\d{6,12}$/.test(accountNumber))
    return { ok: false, status: 400, error: 'Account number must be 6-12 digits.' };

  if (!INDICATOR_MAP[indicator])
    return { ok: false, status: 400, error: 'Unknown indicator selected.' };

  const parsed = parseKey(licenseKey);
  if (!parsed)
    return { ok: false, status: 400, error: 'Invalid key format. Expected: AccountNo-Tier-YYYYMMDD-HASH8' };

  if (parsed.accountStr !== accountNumber.trim())
    return { ok: false, status: 400, error: 'License key does not match this MT5 account number.' };

  const expected = computeHash8(parsed.accountStr, String(parsed.tier), parsed.expiryStr);
  if (parsed.hash8 !== expected)
    return { ok: false, status: 400, error: 'License key is invalid or has been tampered with.' };

  if (!isNotExpired(parsed.expiryStr)) {
    const d = `${parsed.expiryStr.slice(0,4)}-${parsed.expiryStr.slice(4,6)}-${parsed.expiryStr.slice(6,8)}`;
    return { ok: false, status: 400, error: `License expired on ${d}. Please renew via Telegram.` };
  }

  const entry = INDICATOR_MAP[indicator];
  if (parsed.tier < entry.minTier)
    return {
      ok: false, status: 400,
      error: `This indicator requires ${TIER_NAMES[entry.minTier]} or higher. Your license is ${TIER_NAMES[parsed.tier]}.`
    };

  return { ok: true, parsed, entry };
}

// =============================================================================
//  POST /api/validate-license
//  Body: { licenseKey, accountNumber, indicator, email }
//
//  ONE-LICENSE-ONE-INDICATOR LOGIC:
//  1. Validate the key cryptographically (hash, expiry, tier).
//  2. Check the store — has this key been used before?
//     a. Never used  → valid, but DON'T record yet (record only on actual download).
//     b. Used for THIS indicator → valid (re-download allowed).
//     c. Used for a DIFFERENT indicator → rejected.
// =============================================================================
router.post('/validate-license', async (req, res) => {
  const { licenseKey, accountNumber, indicator, email } = req.body || {};

  const check = coreValidate(licenseKey, accountNumber, indicator);
  if (!check.ok) {
    return res.status(check.status).json({ valid: false, message: check.error });
  }

  const { parsed } = check;

  // ── Check store ──
  let record = null;
  try {
    record = await store.getRecord(licenseKey);
  } catch (e) {
    console.error('[LICENSE] Store read error:', e.message);
    return res.status(500).json({ valid: false, message: 'Server storage error. Try again or contact support.' });
  }

  if (record) {
    // Key has been used before
    if (record.indicator !== indicator) {
      // Trying to use on a DIFFERENT indicator — REJECT
      const usedName = Object.keys(INDICATOR_MAP).find(k => k === record.indicator) || record.indicator;
      const friendlyNames = {
        'blue-gate-ai':     'Driverline AI SMC Suite',
        'mtf-structure':    'Driverline MTF Structure',
        'cct-advanced-mw':  'ChristocentricTrader Advanced MW',
        'dl-mw-advanced':   'Driverline Indicator MW Advanced',
        'trend-compass':    'Driverline Trend Compass',
        'dl-pro':           'Driverline Indicator Pro',
      };
      const usedFriendly = friendlyNames[record.indicator] || record.indicator;
      return res.status(400).json({
        valid: false,
        message: `This license key has already been used to download ${usedFriendly}. Each license key is valid for one indicator only. Please contact @ChristocentricTrader on Telegram for a new key.`,
      });
    }
    // Same indicator — allow re-download (client may have lost the file)
    console.log(`[LICENSE] Re-download allowed — Key: ...${licenseKey.slice(-6)} | Indicator: ${indicator}`);
  }

  // ── Valid ──
  const expiryFormatted = `${parsed.expiryStr.slice(0,4)}-${parsed.expiryStr.slice(4,6)}-${parsed.expiryStr.slice(6,8)}`;
  console.log(`[LICENSE] Valid — Account: ${parsed.accountStr} | Tier: ${parsed.tier} | Indicator: ${indicator} | Expires: ${expiryFormatted}`);

  return res.json({
    valid:    true,
    tier:     String(parsed.tier),
    tierName: TIER_NAMES[parsed.tier],
    expiry:   expiryFormatted,
    redownload: !!record,  // true if this is a re-download
  });
});

// =============================================================================
//  GET /api/download?key=...&account=...&file=...
//  Re-validates cryptographically + checks store + RECORDS the usage.
//  This is where we write to the store — only on confirmed download.
// =============================================================================
router.get('/download', async (req, res) => {
  if (!SALT) return res.status(500).send('Server configuration error.');

  const { key, account, file } = req.query;
  if (!key || !account || !file) return res.status(400).send('Missing parameters.');

  // Find indicator key from filename
  const safeFile    = path.basename(file);
  const indicatorKey = Object.keys(INDICATOR_MAP).find(k => INDICATOR_MAP[k].file === safeFile);
  if (!indicatorKey) return res.status(404).send('Unknown file requested.');

  // Core cryptographic validation
  const check = coreValidate(key, account, indicatorKey);
  if (!check.ok) return res.status(403).send(`Access denied: ${check.error}`);

  const { parsed, entry } = check;

  // ── Check and enforce one-license-one-indicator ──
  let record = null;
  try {
    record = await store.getRecord(key);
  } catch (e) {
    console.error('[DOWNLOAD] Store read error:', e.message);
    return res.status(500).send('Storage error. Please try again.');
  }

  if (record && record.indicator !== indicatorKey) {
    // Already used for a different indicator — block the download
    return res.status(403).send(
      `Access denied: This license key was already used to download ${record.file}. ` +
      `Each key is valid for one indicator only.`
    );
  }

  // ── Record usage if first time ──
  if (!record) {
    try {
      await store.saveRecord(key, {
        indicator:    indicatorKey,
        file:         entry.file,
        accountStr:   parsed.accountStr,
        tier:         parsed.tier,
        downloadedAt: new Date().toISOString(),
      });
      console.log(`[DOWNLOAD] Recorded — Key: ...${key.slice(-6)} | Account: ${parsed.accountStr} | File: ${entry.file}`);
    } catch (e) {
      console.error('[DOWNLOAD] Store write error:', e.message);
      // Non-fatal — still serve the file but log the error
    }
  }

  // ── Stream the .ex5 file ──
  const filePath = path.join(__dirname, 'downloads', safeFile);
  if (!fs.existsSync(filePath)) {
    console.error(`[DOWNLOAD] File missing on disk: ${filePath}`);
    return res.status(404).send('File not available yet. Contact support on Telegram.');
  }

  console.log(`[DOWNLOAD] Serving ${safeFile} to account ${account}`);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

// =============================================================================
//  GET /api/check-usage?key=...
//  Optional endpoint — lets the frontend show what a key has already been
//  used for BEFORE the client fills in the full form.
// =============================================================================
router.get('/check-usage', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key parameter.' });

  const parsed = parseKey(key);
  if (!parsed) return res.status(400).json({ error: 'Invalid key format.' });

  let record = null;
  try { record = await store.getRecord(key); } catch(e) {}

  if (!record) return res.json({ used: false });

  const friendlyNames = {
    'blue-gate-ai':     'Driverline AI SMC Suite',
    'mtf-structure':    'Driverline MTF Structure',
    'cct-advanced-mw':  'ChristocentricTrader Advanced MW',
    'dl-mw-advanced':   'Driverline Indicator MW Advanced',
    'trend-compass':    'Driverline Trend Compass',
    'dl-pro':           'Driverline Indicator Pro',
  };

  return res.json({
    used:         true,
    indicator:    record.indicator,
    friendlyName: friendlyNames[record.indicator] || record.indicator,
    file:         record.file,
    downloadedAt: record.downloadedAt,
  });
});

module.exports = router;
