const http = require('http');
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('D:/OpenCode/AndroidOSCText/pc-bridge/config.json', 'utf8'));
const TOKEN = cfg.token;

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: 7712, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json, rawLen: raw.length });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const results = [];
  const check = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail });
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  | ' + detail : ''));
  };

  // 1. health (no auth)
  const h = await req('GET', '/api/health');
  check('health 200', h.status === 200 && h.json.ok);

  // 2. info (no auth)
  const info = await req('GET', '/api/info');
  check('info has LAN addr', info.status === 200 && info.json.addresses.some(a => a.address === '192.168.31.57'));

  // 3. auth rejection
  const noAuth = await req('POST', '/api/say', { text: 'nope' });
  check('rejects missing token', noAuth.status === 401, 'status=' + noAuth.status);

  const badAuth = await req('POST', '/api/say', { text: 'nope' }, 'wrongtoken');
  check('rejects wrong token', badAuth.status === 401, 'status=' + badAuth.status);

  // 4. unicode round trip
  const unicode = '[AOST] 中文 emoji 😀 测试';
  const say = await req('POST', '/api/say', { text: unicode, sfx: false }, TOKEN);
  check('say 200', say.status === 200 && say.json.ok, say.json && say.json.error);
  check('utf8 preserved exactly', say.json && say.json.text === unicode,
        say.json ? JSON.stringify(say.json.text) : 'no body');

  // 5. truncation to 144 code points
  const long = '字'.repeat(200);
  const trunc = await req('POST', '/api/say', { text: long, sfx: false }, TOKEN);
  const tlen = trunc.json && trunc.json.text ? Array.from(trunc.json.text).length : -1;
  check('truncates to 144', tlen === 144, 'len=' + tlen);

  // 6. 9-line cap
  const manyLines = Array.from({length: 20}, (_, i) => 'L' + i).join('\n');
  const lines = await req('POST', '/api/say', { text: manyLines, sfx: false }, TOKEN);
  const nLines = lines.json && lines.json.text ? lines.json.text.split('\n').length : -1;
  check('caps at 9 lines', nLines === 9, 'lines=' + nLines);

  // 7. empty text rejected
  await new Promise(r => setTimeout(r, 1000));
  const empty = await req('POST', '/api/say', { text: '   ' }, TOKEN);
  check('rejects blank text', empty.status === 400, 'status=' + empty.status);

  // 8. typing indicator
  const typing = await req('POST', '/api/typing', { on: true }, TOKEN);
  check('typing on', typing.status === 200 && typing.json.typing === true);

  // 9. history
  await new Promise(r => setTimeout(r, 1200));
  const hist = await req('GET', '/api/history', null, TOKEN);
  check('history populated', hist.status === 200 && hist.json.items.length >= 3, 'n=' + (hist.json ? hist.json.items.length : -1));

  // 10. web UI served
  const ui = await req('GET', '/');
  check('web UI served', ui.status === 200 && ui.rawLen > 1000, 'bytes=' + ui.rawLen);

  // 11. 404
  const nf = await req('GET', '/api/nope');
  check('404 for unknown route', nf.status === 404);

  // 12. health stats increased
  const h2 = await req('GET', '/api/health');
  check('stats.sent increased', h2.json.stats.sent >= 3, 'sent=' + h2.json.stats.sent);

  const failed = results.filter(r => !r.pass);
  console.log('');
  console.log('=== ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join(', ')); process.exitCode = 1; }
})();
