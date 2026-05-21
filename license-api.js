// =============================================================================
//  license-api.js  —  ChristocentricTrader License Validation API
//  Mount this in your existing server.js with:
//      const licenseApi = require('./license-api');
//      app.use('/api', licenseApi);
// =============================================================================

const express = require('express');
const crypto  = require('crypto');  // Node built-in — no install needed
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

// =============================================================================
//  CONFIGURATION
//  Set CCT_LICENSE_SALT as an environment variable on Render — never hard-code it.
//  In Render dashboard → Environment → Add variable:
//      Key:   CCT_LICENSE_SALT
//      Value: CCT_TIERED_SALT_2025
// =============================================================================
const SALT = process.env.CCT_LICENSE_SALT;

if (!SALT) {
  console.error('[LICENSE] FATAL: CCT_LICENSE_SALT environment variable is not set.');
  console.error('[LICENSE] Set it in your Render dashboard under Environment Variables.');
}

// =============================================================================
//  INDICATOR → FILE MAP
//  Place your compiled .ex5 files in a "downloads/" folder next to server.js.
//  The filenames here must match exactly.
//  Tier restrictions: each indicator specifies the minimum tier required.
// =============================================================================
const INDICATOR_MAP = {
  'blue-gate-ai':     { file: 'BLUE_GATE_AI_SMC_Suite.ex5',              minTier: 2 },
  'mtf-structure':    { file: 'Driverline_MTF_Structure.ex5',             minTier: 1 },
  'cct-advanced':     { file: 'ChristocentricTrader_Advanced_EA.ex5',     minTier: 3 },
  'multipattern':     { file: 'MultiPattern_EA_v4.ex5',                   minTier: 2 },
  'trend-compass':    { file: 'Driverline_Trend_Compass.ex5',             minTier: 1 },
  'liquidity-mapper': { file: 'CCT_Liquidity_Mapper.ex5',                 minTier: 2 },
};

const TIER_NAMES = {
  1: 'Tier 1 — Classic',
  2: 'Tier 2 — Classic + SMC',
  3: 'Tier 3 — Full Access',
};

// =============================================================================
//  SHA-256 HELPER  (mirrors Gen_SHA256 in CCT_LicenseGenerator.mq5)
//  seed = accountStr + tierStr + expiryStr + SALT
//  Returns first 8 chars of hex digest, uppercase.
// =============================================================================
function computeHash8(accountStr, tierStr, expiryStr) {
  const seed   = accountStr + tierStr + expiryStr + SALT;
  const digest = crypto.createHash('sha256').update(seed, 'utf8').digest('hex');
  return digest.slice(0, 8).toUpperCase();
}

// =============================================================================
//  KEY PARSER
//  Expected format:  ACCOUNTNUMBER-TIER-YYYYMMDD-HASH8
//  e.g.              12345678-2-20260101-A3F7C2D1
// =============================================================================
function parseKey(licenseKey) {
  const parts = licenseKey.trim().split('-');
  // Must have exactly 4 parts
  if (parts.length !== 4) return null;

  const [accountStr, tierStr, expiryStr, hash8] = parts;

  // Account: digits only
  if (!/^\d+$/.test(accountStr)) return null;

  // Tier: 1, 2, or 3
  const tier = parseInt(tierStr, 10);
  if (![1, 2, 3].includes(tier)) return null;

  // Expiry: exactly 8 digits (YYYYMMDD)
  if (!/^\d{8}$/.test(expiryStr)) return null;

  // Hash: exactly 8 hex chars
  if (!/^[A-Fa-f0-9]{8}$/.test(hash8)) return null;

  return { accountStr, tier, expiryStr, hash8: hash8.toUpperCase() };
}

// =============================================================================
//  EXPIRY CHECKER
//  Returns true if today (UTC) is on or before the expiry date.
// =============================================================================
function isNotExpired(expiryStr) {
  const yr  = parseInt(expiryStr.slice(0, 4), 10);
  const mo  = parseInt(expiryStr.slice(4, 6), 10) - 1; // 0-indexed
  const dy  = parseInt(expiryStr.slice(6, 8), 10);
  // End of expiry day UTC (23:59:59)
  const expiryMs = Date.UTC(yr, mo, dy, 23, 59, 59, 999);
  return Date.now() <= expiryMs;
}

// =============================================================================
//  POST /api/validate-license
//  Body: { licenseKey, accountNumber, indicator, email }
//  Response 200: { valid: true,  tier, tierName, expiry }
//  Response 400: { valid: false, message }
// =============================================================================
router.post('/validate-license', (req, res) => {
  if (!SALT) {
    return res.status(500).json({ valid: false, message: 'Server configuration error. Contact support.' });
  }

  const { licenseKey, accountNumber, indicator, email } = req.body || {};

  // ── Basic input checks ──
  if (!licenseKey || !accountNumber || !indicator) {
    return res.status(400).json({ valid: false, message: 'Missing required fields.' });
  }
  if (!/^\d{6,12}$/.test(accountNumber)) {
    return res.status(400).json({ valid: false, message: 'Account number must be 6–12 digits.' });
  }
  if (!INDICATOR_MAP[indicator]) {
    return res.status(400).json({ valid: false, message: 'Unknown indicator selected.' });
  }

  // ── Parse the key ──
  const parsed = parseKey(licenseKey);
  if (!parsed) {
    return res.status(400).json({
      valid: false,
      message: 'Invalid key format. Expected: AccountNo-Tier-YYYYMMDD-HASH8'
    });
  }

  // ── Account number must match the key ──
  if (parsed.accountStr !== accountNumber.trim()) {
    return res.status(400).json({
      valid: false,
      message: 'License key does not match this MT5 account number.'
    });
  }

  // ── Verify the hash ──
  const expectedHash = computeHash8(parsed.accountStr, String(parsed.tier), parsed.expiryStr);
  if (parsed.hash8 !== expectedHash) {
    return res.status(400).json({ valid: false, message: 'License key is invalid or has been tampered with.' });
  }

  // ── Check expiry ──
  if (!isNotExpired(parsed.expiryStr)) {
    const yr = parsed.expiryStr.slice(0,4);
    const mo = parsed.expiryStr.slice(4,6);
    const dy = parsed.expiryStr.slice(6,8);
    return res.status(400).json({
      valid: false,
      message: `License expired on ${yr}-${mo}-${dy}. Please renew via Telegram.`
    });
  }

  // ── Check tier is sufficient for this indicator ──
  const required = INDICATOR_MAP[indicator].minTier;
  if (parsed.tier < required) {
    return res.status(400).json({
      valid: false,
      message: `This indicator requires ${TIER_NAMES[required]} or higher. Your license is ${TIER_NAMES[parsed.tier]}.`
    });
  }

  // ── All checks passed ──
  const expiryFormatted = `${parsed.expiryStr.slice(0,4)}-${parsed.expiryStr.slice(4,6)}-${parsed.expiryStr.slice(6,8)}`;

  console.log(`[LICENSE] Valid — Account: ${parsed.accountStr} | Tier: ${parsed.tier} | Indicator: ${indicator} | Expires: ${expiryFormatted}`);

  return res.json({
    valid:    true,
    tier:     String(parsed.tier),
    tierName: TIER_NAMES[parsed.tier],
    expiry:   expiryFormatted,
  });
});

// =============================================================================
//  GET /api/download?key=...&account=...&file=...
//  Re-validates before streaming the .ex5 file so the download URL can't be
//  shared without a valid key.
// =============================================================================
router.get('/download', (req, res) => {
  if (!SALT) {
    return res.status(500).send('Server configuration error.');
  }

  const { key, account, file } = req.query;

  if (!key || !account || !file) {
    return res.status(400).send('Missing parameters.');
  }

  // Re-validate
  const parsed = parseKey(key);
  if (!parsed || parsed.accountStr !== account.trim()) {
    return res.status(403).send('Access denied: invalid license.');
  }

  const expectedHash = computeHash8(parsed.accountStr, String(parsed.tier), parsed.expiryStr);
  if (parsed.hash8 !== expectedHash) {
    return res.status(403).send('Access denied: license verification failed.');
  }

  if (!isNotExpired(parsed.expiryStr)) {
    return res.status(403).send('Access denied: license has expired.');
  }

  // Sanitize filename — no path traversal
  const safeFile = path.basename(file);

  // Find which indicator this file belongs to and check tier
  const entry = Object.values(INDICATOR_MAP).find(e => e.file === safeFile);
  if (!entry) {
    return res.status(404).send('File not found.');
  }
  if (parsed.tier < entry.minTier) {
    return res.status(403).send('Access denied: your tier does not include this indicator.');
  }

  // Stream the file
  const filePath = path.join(__dirname, 'downloads', safeFile);
  if (!fs.existsSync(filePath)) {
    console.error(`[DOWNLOAD] File not found on disk: ${filePath}`);
    return res.status(404).send('File not available yet. Contact support on Telegram.');
  }

  console.log(`[DOWNLOAD] Serving ${safeFile} to account ${account}`);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFile}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
