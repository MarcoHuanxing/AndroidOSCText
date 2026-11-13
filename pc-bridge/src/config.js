'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  // --- VRChat / OSC ---
  oscHost: '127.0.0.1',
  oscPort: 9000,
  // Sending to a remote machine running VRChat (e.g. a VR PC) is supported:
  // just change oscHost.

  // --- HTTP server (what the phone talks to) ---
  httpHost: '0.0.0.0',
  httpPort: 7712,
  // UDP broadcast responder so the phone can auto-discover this PC
  enableDiscovery: true,
  // Access token required from clients. Auto-generated on first run and
  // persisted; override via config.json or AOST_TOKEN.
  token: '',
  requireToken: true,

  // --- Chatbox behaviour ---
  maxChars: 144,
  maxLines: 9,
  sendNow: true,
  sfx: true,
  // Minimum gap between outgoing chatbox messages (VRChat rate-limits hard).
  minIntervalMs: 900,
  // How long the typing indicator stays on after the last keystroke.
  typingHoldMs: 3000,

  // --- Logging ---
  historySize: 200,
};

/**
 * Are we running as a Node SEA single-file executable?
 *
 * node:sea exists from Node 21; on plain "node src/index.js" it is present and
 * isSea() simply returns false, so this never throws in practice.
 */
function isSeaMode() {
  try {
    const sea = require('node:sea');
    return typeof sea.isSea === 'function' && sea.isSea() === true;
  } catch {
    return false;
  }
}

/**
 * Where does config.json live? Resolution order:
 *   1) AOST_CONFIG environment variable (absolute, or relative to the CWD)
 *   2) single-file exe (SEA): the directory the .exe sits in, so the exe can be
 *      dropped anywhere (e.g. a USB stick) and keeps its token beside it
 *   3) source checkout: pc-bridge/config.json (the historical behaviour)
 */
function resolveConfigFile() {
  const fromEnv = process.env.AOST_CONFIG;
  if (fromEnv && String(fromEnv).trim()) return path.resolve(String(fromEnv).trim());
  if (isSeaMode()) return path.join(path.dirname(process.execPath), 'config.json');
  return path.join(__dirname, '..', 'config.json');
}

const CONFIG_FILE = resolveConfigFile();

/** Enumerate non-loopback IPv4 addresses so the phone can find us. */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push({ iface: name, address: info.address, cidr: info.cidr });
      }
    }
  }
  return out;
}

function randomToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

/**
 * Load configuration: defaults <- config.json <- environment variables.
 * Generates and persists an access token on first run.
 */
function loadConfig(overrides = {}) {
  let fileCfg = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      throw new Error('config.json is not valid JSON: ' + err.message);
    }
  }

  const cfg = { ...DEFAULTS, ...fileCfg, ...overrides };

  // Environment overrides (handy for testing / multiple instances).
  if (process.env.AOST_PORT) cfg.httpPort = Number(process.env.AOST_PORT);
  if (process.env.AOST_OSC_PORT) cfg.oscPort = Number(process.env.AOST_OSC_PORT);
  if (process.env.AOST_OSC_HOST) cfg.oscHost = process.env.AOST_OSC_HOST;
  if (process.env.AOST_TOKEN) cfg.token = process.env.AOST_TOKEN;

  // First run: mint a token and write it back so it survives restarts.
  if (!cfg.token) {
    cfg.token = randomToken();
    try {
      const merged = { ...fileCfg, token: cfg.token };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.warn('[config] could not persist token:', err.message);
    }
  }

  return cfg;
}

module.exports = { loadConfig, lanAddresses, randomToken, DEFAULTS, CONFIG_FILE, isSeaMode, resolveConfigFile };
