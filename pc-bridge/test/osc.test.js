'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { build, str, int32 } = require('../src/osc');

test('OSC string is NUL-terminated and 4-byte padded', () => {
  assert.strictEqual(str('/a').toString('hex'), '2f610000');
  assert.strictEqual(str('/ab').toString('hex'), '2f616200');
  assert.strictEqual(str('/abc').toString('hex'), '2f61626300000000');
});

test('chatbox input matches the documented byte layout', () => {
  const packet = build('/chatbox/input', 'sTT', ['hi', true, true]);
  // 15-char address (+NUL = 16, already aligned) + 4-char tags (+NUL, aligned) + "hi" (+2 NUL = 4)
  assert.strictEqual(packet.length, 16 + 8 + 4);
  assert.strictEqual(packet.subarray(0, 16).toString('utf8').replace(/\0+$/, ''), '/chatbox/input');
  assert.strictEqual(packet.subarray(16, 24).toString('utf8').replace(/\0+$/, ''), ',sTT');
  assert.strictEqual(packet.subarray(24).toString('utf8'), 'hi\0\0');
});

test('T and F tags carry no payload', () => {
  assert.strictEqual(build('/x', 'TT', []).length, build('/x', '', []).length);
  assert.strictEqual(build('/x', 'F', []).length, build('/x', '', []).length);
});

test('UTF-8 text pads on byte length, not character count', () => {
  // 1 CJK char (3 bytes) + NUL = 4 -> no padding
  assert.strictEqual(build('/t', 's', ['\u4e2d']).length, 4 + 4 + 4);
  // 2 CJK chars (6 bytes) + NUL = 7 -> pad 1 => 8
  assert.strictEqual(build('/t', 's', ['\u4e2d\u6587']).length, 4 + 4 + 8);
});

test('typing indicator uses a bare T tag', () => {
  const p = build('/chatbox/typing', 'T', []);
  // "/chatbox/typing" is 15 chars + NUL = 16 (aligned); ",T" + NUL = 3 -> pad to 4
  assert.strictEqual(p.length, 16 + 4);
  assert.strictEqual(p.subarray(0, 16).toString('utf8').replace(/\0+$/, ''), '/chatbox/typing');
  assert.strictEqual(p.subarray(16).toString('utf8').replace(/\0+$/, ''), ',T');
});

test('rejects addresses without a leading slash', () => {
  assert.throws(() => build('chatbox/input', 's', ['x']), /must start with/);
});

test('rejects unknown type tags instead of emitting corrupt packets', () => {
  assert.throws(() => build('/x', 'z', [1]), /Unsupported OSC type tag/);
});

test('int32 handles negatives (OSC int is signed)', () => {
  assert.strictEqual(int32(-1).toString('hex'), 'ffffffff');
});
