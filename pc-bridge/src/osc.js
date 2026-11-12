'use strict';
/**
 * Minimal, zero-dependency OSC 1.0/1.1 message encoder.
 *
 * Implements only what VRChat's chatbox needs, but the encoder is generic.
 * Reference: OSC 1.0 (CNMAT) + OSC 1.1 additions (T / F / N / I tags).
 */

/** Bytes needed to pad `n` up to the next multiple of 4. */
function padTo4(n) {
  return (4 - (n % 4)) % 4;
}

/** OSC-string: UTF-8 bytes, NUL terminated, padded to 4 bytes. */
function str(value) {
  const body = Buffer.from(String(value), 'utf8');
  return Buffer.concat([body, Buffer.alloc(1 + padTo4(body.length + 1))]);
}

function int32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v | 0);
  return b;
}

function float32(v) {
  const b = Buffer.alloc(4);
  b.writeFloatBE(Number(v));
  return b;
}

function double64(v) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(Number(v));
  return b;
}

/** OSC-blob: int32 size, raw bytes, padded to 4. */
function blob(input) {
  const body = Buffer.from(input);
  const head = Buffer.alloc(4);
  head.writeInt32BE(body.length);
  return Buffer.concat([head, body, Buffer.alloc(padTo4(body.length))]);
}

/**
 * Build an OSC message packet.
 *
 * @param {string} address  OSC address, e.g. "/chatbox/input"
 * @param {string} typeTags Type tag string WITHOUT the leading comma, e.g. "sTT"
 * @param {any[]}  args     Values for the payload-carrying tags, in order
 * @returns {Buffer}
 */
function build(address, typeTags, args = []) {
  if (typeof address !== 'string' || !address.startsWith('/')) {
    throw new Error('OSC address must start with "/": ' + address);
  }
  const tags = String(typeTags || '');
  const parts = [str(address), str(',' + tags)];
  let ai = 0;

  for (const t of tags) {
    switch (t) {
      case 'i':
        parts.push(int32(args[ai++]));
        break;
      case 'f':
        parts.push(float32(args[ai++]));
        break;
      case 's':
        parts.push(str(args[ai++]));
        break;
      case 'b':
        parts.push(blob(args[ai++]));
        break;
      case 'd':
        parts.push(double64(args[ai++]));
        break;
      case 'T':
      case 'F':
      case 'N':
      case 'I':
        // OSC 1.1: these tags carry no payload
        break;
      default:
        throw new Error('Unsupported OSC type tag: "' + t + '"');
    }
  }
  return Buffer.concat(parts);
}

module.exports = { build, str, int32, float32, double64, blob, padTo4 };
