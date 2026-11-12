'use strict';
const dgram = require('dgram');
const { build } = require('./osc');

/**
 * VRChat chatbox driver.
 *
 * Protocol (authoritative: https://wiki.vrchat.com/wiki/OSC#Chatbox):
 *   /chatbox/input  ,sTT   text, sendImmediately, playNotificationSfx
 *   /chatbox/typing ,T     typing indicator visibility
 *
 * VRChat listens on UDP 9000 and sends back on 9001.
 */
class Chatbox {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9000;
    this.maxChars = options.maxChars ?? 144;
    this.maxLines = options.maxLines ?? 9;
    this.minIntervalMs = options.minIntervalMs ?? 900;
    this.typingHoldMs = options.typingHoldMs ?? 3000;

    this.socket = null;
    this.lastSentAt = 0;
    this.typingsOn = false;
    this.typingTimer = null;
    this.stats = { sent: 0, dropped: 0, errors: 0 };
    this._queue = Promise.resolve();
  }

  async open() {
    if (this.socket) return this;
    this.socket = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => {
      const onErr = (err) => { this.socket.off('listening', onOk); reject(err); };
      const onOk = () => { this.socket.off('error', onErr); resolve(); };
      this.socket.once('error', onErr);
      this.socket.once('listening', onOk);
      // Bind to an ephemeral port: we only send, we never need 9000.
      this.socket.bind(0);
    });
    this.socket.on('error', (err) => {
      this.stats.errors++;
      console.error('[osc] socket error:', err.message);
    });
    return this;
  }

  close() {
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    if (this.socket) {
      try { this.socket.close(); } catch { /* already closed */ }
      this.socket = null;
    }
  }

  /**
   * Normalise text for the chatbox:
   *   - collapse CRLF / CR to a single LF
   *   - drop C0 control characters (except LF) and DEL
   *   - turn TAB into spaces
   *   - cap the line count
   *   - cap the character count, counting code points so emoji never split
   */
  normalise(text) {
    let s = String(text ?? '');
    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
    s = s.replace(/\t/g, '    ');

    const lines = s.split('\n');
    if (lines.length > this.maxLines) {
      s = lines.slice(0, this.maxLines).join('\n');
    }

    // Truncate by code point so surrogate pairs are never split.
    const chars = Array.from(s);
    if (chars.length > this.maxChars) {
      s = chars.slice(0, this.maxChars).join('');
    }
    return s;
  }

  _send(buffer) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('chatbox socket is not open'));
      this.socket.send(buffer, this.port, this.host, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Send text to the chatbox, honouring the rate limit. Resolves with details. */
  async send(text, opts = {}) {
    const sendNow = opts.sendNow ?? true;
    const sfx = opts.sfx ?? true;
    const body = this.normalise(text);

    if (!body.trim()) {
      throw new Error('refusing to send empty text');
    }

    // Serialise sends and enforce the minimum interval.
    const run = async () => {
      const wait = this.lastSentAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const packet = build('/chatbox/input', 'sTT', [body, !!sendNow, !!sfx]);
      await this._send(packet);
      this.lastSentAt = Date.now();
      this.stats.sent++;
      return { text: body, bytes: packet.length, sendNow: !!sendNow, sfx: !!sfx };
    };

    const result = this._queue.then(run, run);
    this._queue = result.catch(() => {});
    return result;
  }

  /** Toggle the "..." typing indicator. */
  async setTyping(on) {
    const want = !!on;
    if (want === this.typingsOn) return this.typingsOn;
    const packet = build('/chatbox/typing', want ? 'T' : 'F', []);
    await this._send(packet);
    this.typingsOn = want;

    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    if (want) {
      this.typingTimer = setTimeout(() => {
        this.setTyping(false).catch(() => {});
      }, this.typingHoldMs);
      if (this.typingTimer.unref) this.typingTimer.unref();
    }
    return this.typingsOn;
  }
}

module.exports = { Chatbox };
