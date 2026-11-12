// Simulate the Android client's discovery probe (same wire format).
const dgram = require('dgram');
const os = require('os');

const MAGIC = 'AOST-DISCOVER';
const PORT = 7713;

function targets() {
  const out = new Set(['255.255.255.255']);
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const i of os.networkInterfaces()[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const [addr, bitsStr] = i.cidr.split('/');
      const bits = Number(bitsStr);
      const p = addr.split('.').map(Number);
      const m = [0,1,2,3].map(k => { const t = Math.min(8, Math.max(0, bits - k*8)); return t===0?0:((0xFF << (8-t)) & 0xFF); });
      out.add(p.map((x,k)=> (x | (~m[k] & 0xFF)) & 0xFF).join('.'));
    }
  }
  return [...out];
}

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const found = [];

sock.on('message', (m, r) => {
  try {
    const j = JSON.parse(m.toString('utf8'));
    if (j.aost !== MAGIC) return;
    found.push({ from: r.address, port: j.port, name: j.name, version: j.version });
  } catch {}
});

sock.bind(0, () => {
  sock.setBroadcast(true);
  const msg = Buffer.from(JSON.stringify({ aost: MAGIC }), 'utf8');
  const list = targets();
  console.log('probing:', list.join(', '));
  for (const t of list) {
    try { sock.send(msg, PORT, t, () => {}); } catch (e) { console.log('send fail', t, e.message); }
  }
  setTimeout(() => {
    console.log('--- replies ---');
    if (found.length === 0) console.log('(none)');
    for (const f of found) console.log('  ' + f.from + ' -> port ' + f.port + '  ' + f.name + ' v' + f.version);
    sock.close();
    process.exit(found.length > 0 ? 0 : 1);
  }, 2500);
});
