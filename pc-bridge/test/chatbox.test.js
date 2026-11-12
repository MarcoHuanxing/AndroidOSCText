'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Chatbox } = require('../src/chatbox');

function fresh(overrides) {
  return new Chatbox(Object.assign({ minIntervalMs: 0, typingHoldMs: 0 }, overrides || {}));
}

test('normalise collapses CRLF and CR to LF', () => {
  const cb = fresh();
  assert.strictEqual(cb.normalise('a\r\nb\rc'), 'a\nb\nc');
});

test('normalise strips control characters', () => {
  const cb = fresh();
  assert.strictEqual(cb.normalise('a\u0007b\u001fc'), 'abc');
});

test('normalise converts tab to spaces', () => {
  const cb = fresh();
  assert.strictEqual(cb.normalise('a\tb'), 'a    b');
});

test('normalise caps at 144 characters', () => {
  const cb = fresh();
  assert.strictEqual(Array.from(cb.normalise('x'.repeat(300))).length, 144);
});

test('normalise caps at 9 lines', () => {
  const cb = fresh();
  const out = cb.normalise(Array.from({ length: 20 }, function (_, i) { return 'l' + i; }).join('\n'));
  assert.strictEqual(out.split('\n').length, 9);
});

test('normalise never splits a surrogate pair (emoji)', () => {
  const cb = fresh({ maxChars: 3 });
  const out = cb.normalise('\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00');
  assert.strictEqual(Array.from(out).length, 3);
  assert.strictEqual(Buffer.from(out, 'utf8').toString('utf8'), out);
});

test('normalise keeps CJK intact', () => {
  const cb = fresh();
  assert.strictEqual(cb.normalise('\u4f60\u597d\uff0c\u4e16\u754c'), '\u4f60\u597d\uff0c\u4e16\u754c');
});

test('send refuses empty text', async () => {
  const cb = fresh();
  cb.socket = { send: function () {} };
  await assert.rejects(function () { return cb.send('   '); }, /empty/);
});

test('send emits /chatbox/input with ,sTT and updates stats', async () => {
  const cb = fresh();
  const sent = [];
  cb.socket = {
    send: function (buf, port, host, cb2) { sent.push({ buf: buf, port: port, host: host }); cb2(null); },
  };
  const r = await cb.send('hello');
  assert.strictEqual(r.text, 'hello');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].port, 9000);
  assert.ok(sent[0].buf.includes(Buffer.from('/chatbox/input')));
  assert.ok(sent[0].buf.includes(Buffer.from(',sTT')));
  assert.strictEqual(cb.stats.sent, 1);
});
