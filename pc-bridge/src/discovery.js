'use strict';
/**
 * LAN auto-discovery over UDP broadcast.
 *
 * The phone (or the web UI) broadcasts a small JSON probe to 7713; the bridge
 * answers with its HTTP endpoint, so the user never has to type an IP that may
 * have changed since the last DHCP lease.
 *
 * No mDNS/Bonjour dependency: plain UDP broadcast works on every platform,
 * including Android without the NsdManager quirks.
 */
const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 7713;
const MAGIC = 'AOST-DISCOVER';

function createDiscoveryResponder(cfg, log = console) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    log.warn('[discovery] socket error:', err.message);
    try { socket.close(); } catch { /* ignore */ }
  });

  socket.on('message', (msg, rinfo) => {
    let probe;
    try {
      probe = JSON.parse(msg.toString('utf8'));
    } catch {
      return; // not ours
    }
    if (!probe || probe.aost !== MAGIC) return;

    const reply = Buffer.from(JSON.stringify({
      aost: MAGIC,
      name: 'AndroidOSCText bridge',
      version: require('../package.json').version,
      port: cfg.httpPort,
      host: os.hostname(),
      requiresToken: cfg.requireToken,
    }), 'utf8');

    socket.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) log.warn('[discovery] reply failed:', err.message);
    });
  });

  socket.bind(DISCOVERY_PORT, () => {
    try {
      socket.setBroadcast(true);
      log.log('[discovery] 正在监听 UDP ' + DISCOVERY_PORT + '（手机可自动发现本机）');
    } catch (err) {
      log.warn('[discovery] 无法开启广播:', err.message);
    }
  });

  return {
    port: DISCOVERY_PORT,
    close() {
      try { socket.close(); } catch { /* ignore */ }
    },
  };
}

/** Enumerate LAN IPv4 addresses that can carry a broadcast. */
function broadcastTargets() {
  const out = new Set(['255.255.255.255']);
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (typeof info.cidr !== 'string') continue;
      const [addr, bitsStr] = info.cidr.split('/');
      const bits = Number(bitsStr);
      if (!bits || bits >= 32) continue;
      // Compute the directed broadcast address for this subnet.
      const ipParts = addr.split('.').map(Number);
      const maskParts = [];
      for (let i = 0; i < 4; i++) {
        const taken = Math.min(8, Math.max(0, bits - i * 8));
        maskParts.push(taken === 0 ? 0 : (0xFF << (8 - taken)) & 0xFF);
      }
      const bcast = ipParts.map((p, i) => (p | (~maskParts[i] & 0xFF)) & 0xFF);
      out.add(bcast.join('.'));
    }
  }
  return [...out];
}

module.exports = { createDiscoveryResponder, broadcastTargets, DISCOVERY_PORT, MAGIC };
