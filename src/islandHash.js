'use strict';

/**
 * Anonymous "tryit" key minting for deepai.org.
 *
 * A tryit key looks like `tryit-<digits>-<32 hex>` where the hex part is a
 * deterministic hash over the User-Agent the request will carry:
 *
 *      H(UA + H(UA + H(UA + digits + SALT)))
 *
 * The upstream validates this hash server-side against the request's
 * User-Agent header, and anonymous keys are single-use: one key == one
 * request. `mintTryItKey()` therefore generates a fresh key per request.
 *
 * The hash below is an integer/bit-level look-alike of MD5 taken from the
 * live deepai.org chat client. Do not simplify it.
 */
const crypto = require('crypto');

const TRYIT_SALT = 'hackers_become_a_little_stinkier_every_time_they_hack';

function islandHash(input) {
  const a = [];
  for (let b = 0; 64 > b; ) a[b] = 0 | (4294967296 * Math.sin(++b % Math.PI));
  let d, e, f, g = [(d = 1732584193), (e = 4023233417), ~d, ~e], h = [];
  const l = unescape(encodeURI(input)) + '\u0080';
  let k = l.length;
  let c = (--k / 4 + 2) | 15;
  for (h[--c] = 8 * k; ~k; ) h[k >> 2] |= l.charCodeAt(k) << (8 * k--);
  for (let b = 0, m = 0; b < c; b += 16) {
    for (k = g; 64 > m; k = [ (f = k[3]), d + (((f = k[0] + [d & e | ~d & f, f & d | ~f & e, d ^ e ^ f, e ^ (d | ~f)][(k = m >> 4)] + a[m] + ~~h[b | [m, 5 * m + 1, 3 * m + 5, 7 * m][k] & 15]) << (k = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][4 * k + (m++ % 4)])) | (f >>> -k)), d, e ]) {
      d = k[1] | 0;
      e = k[2];
    }
    for (m = 4; m; ) g[--m] += k[m];
  }
  let result = '';
  for (let i = 0; 32 > i; ) result += ((g[i >> 3] >> 4 * (1 ^ i++)) & 15).toString(16);
  return result.split('').reverse().join('');
}

/** `tryit-<digits>-<32hex>` derived from the given User-Agent. */
function mintTryItKey(userAgent) {
  const ua = String(
    userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  );
  const digits = String(Math.floor(Math.random() * 1e11));
  const hash = islandHash(ua + islandHash(ua + islandHash(ua + digits + TRYIT_SALT)));
  return `tryit-${digits}-${hash}`;
}

function isTryItKey(key) {
  return /^tryit-\d+-[0-9a-f]{32}$/i.test(String(key || ''));
}

/** 32 random bytes, base64url — sent as the `deepai_device_id` cookie. */
function randomDeviceId() {
  return crypto.randomBytes(32).toString('base64url');
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = { islandHash, mintTryItKey, isTryItKey, randomDeviceId, uuid };
