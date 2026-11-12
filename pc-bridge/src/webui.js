'use strict';
/**
 * Self-contained web UI served at "/".
 *
 * Doubles as (a) a desktop fallback when the phone is unavailable and
 * (b) a live reference implementation of the HTTP API for the Android client.
 */
function render(cfg) {
  const MAX = cfg.maxChars;
  const MAXLINES = cfg.maxLines;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>AndroidOSCText</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #262b36;
    --fg: #e6e9ef; --dim: #8a93a6; --accent: #4c8dff; --ok: #3fb950; --err: #f85149;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom));
    display: flex; flex-direction: column; gap: 12px; min-height: 100dvh;
  }
  h1 { font-size: 17px; margin: 0; letter-spacing: .3px; }
  .sub { color: var(--dim); font-size: 12px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
  textarea {
    width: 100%; min-height: 110px; resize: vertical; background: #0c0e13; color: var(--fg);
    border: 1px solid var(--line); border-radius: 10px; padding: 10px; font: inherit; outline: none;
  }
  textarea:focus { border-color: var(--accent); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button {
    background: var(--accent); color: #fff; border: 0; border-radius: 10px;
    padding: 11px 18px; font: inherit; font-weight: 600; cursor: pointer; flex: 1 1 auto;
  }
  button:disabled { opacity: .45; cursor: default; }
  button.ghost { background: #232935; flex: 0 0 auto; padding: 11px 14px; }
  input[type=password] {
    flex: 1 1 160px; background: #0c0e13; color: var(--fg); border: 1px solid var(--line);
    border-radius: 10px; padding: 10px; font: inherit; outline: none;
  }
  .meta { display: flex; justify-content: space-between; color: var(--dim); font-size: 12px; margin-top: 8px; }
  .meta .over { color: var(--err); }
  .log { max-height: 30vh; overflow: auto; display: flex; flex-direction: column-reverse; gap: 6px; }
  .item { border-left: 3px solid var(--line); padding: 6px 10px; font-size: 13px; word-break: break-word; white-space: pre-wrap; }
  .item.ok { border-color: var(--ok); }
  .item.err { border-color: var(--err); }
  label { display: flex; align-items: center; gap: 6px; color: var(--dim); font-size: 13px; }
  .status { font-size: 12px; color: var(--dim); }
  .status.on { color: var(--ok); }
  .status.off { color: var(--err); }
</style>
</head>
<body>
  <div class="row">
    <h1>AndroidOSCText</h1>
    <span class="status" id="status">连接中…</span>
  </div>
  <div class="sub">手机 / 浏览器 → 本机 → VRChat Chatbox（OSC <span id="oscInfo"></span>）</div>

  <div class="panel" id="authPanel">
    <div class="row">
      <input type="password" id="token" placeholder="访问令牌" autocomplete="off" value="">
      <button class="ghost" id="saveToken">保存</button>
    </div>
    <div class="sub" style="margin-top:6px">令牌显示在 PC 端启动窗口里，也保存在 config.json 中。</div>
  </div>

  <div class="panel">
    <textarea id="text" placeholder="输入要显示在 Chatbox 上的文字…"></textarea>
    <div class="meta">
      <span id="count">0 / ${MAX}</span>
      <span id="hint">Ctrl+Enter 发送</span>
    </div>
    <div class="row" style="margin-top:10px">
      <label><input type="checkbox" id="sfx" checked> 提示音</label>
      <button id="send">发送</button>
    </div>
  </div>

  <div class="panel">
    <div class="row"><strong style="font-size:13px">最近发送</strong></div>
    <div class="log" id="log"></div>
  </div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MAX = ${MAX};
  var MAXLINES = ${MAXLINES};
  var elText = $('text'), elCount = $('count'), elSend = $('send');
  var elLog = $('log'), elStatus = $('status'), elToken = $('token');

  var params = new URLSearchParams(location.search);
  var urlToken = params.get('token');
  if (urlToken) { localStorage.setItem('aost.token', urlToken); history.replaceState({}, '', '/'); }
  elToken.value = localStorage.getItem('aost.token') || '';

  function token() { return localStorage.getItem('aost.token') || ''; }
  function authHeaders() {
    var t = token();
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }
  function setStatus(text, cls) {
    elStatus.textContent = text;
    elStatus.className = 'status ' + (cls || '');
  }
  function codePointLen(s) { return Array.from(s).length; }

  function updateCount() {
    var n = codePointLen(elText.value);
    var lines = elText.value.split('\n').length;
    var over = n > MAX || lines > MAXLINES;
    elCount.textContent = n + ' / ' + MAX + (lines > 1 ? '  ·  ' + lines + '/' + MAXLINES + ' 行' : '');
    elCount.className = over ? 'over' : '';
    elSend.disabled = n === 0 || over;
  }

  function addLog(text, cls) {
    var d = document.createElement('div');
    d.className = 'item ' + (cls || '');
    d.textContent = text;
    elLog.prepend(d);
    while (elLog.children.length > 40) { elLog.lastChild.remove(); }
  }

  function refreshHealth() {
    return fetch('/api/health', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        setStatus('已连接', 'on');
        $('oscInfo').textContent = j.osc.host + ':' + j.osc.port;
      })
      .catch(function () { setStatus('未连接', 'off'); });
  }

  function send() {
    var text = elText.value;
    if (!text.trim()) return;
    elSend.disabled = true;
    fetch('/api/say', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ text: text, sfx: $('sfx').checked })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        if (!o.ok) throw new Error(o.j.error || 'send failed');
        addLog(o.j.text, 'ok');
        elText.value = '';
      })
      .catch(function (e) { addLog('发送失败：' + e.message, 'err'); })
      .finally(function () { updateCount(); });
  }

  $('saveToken').onclick = function () {
    localStorage.setItem('aost.token', elToken.value.trim());
    addLog('令牌已保存', 'ok');
    refreshHealth();
  };
  elSend.onclick = send;
  elText.addEventListener('input', updateCount);
  elText.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  });

  updateCount();
  refreshHealth();
  setInterval(refreshHealth, 10000);
})();
</script>
</body>
</html>`;
}

module.exports = { render };
