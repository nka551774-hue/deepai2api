'use strict';
/* Quick sanity tests for deepai2api internals — run with: node test/sanity.js */
const assert = require('assert');
const { islandHash, mintTryItKey, isTryItKey } = require('../src/islandHash');
const { StreamParser } = require('../src/streamParser');

// islandHash must produce stable 32-hex output
const h1 = islandHash('hello');
const h2 = islandHash('hello');
assert.strictEqual(h1, h2, 'islandHash must be deterministic');
assert.match(h1, /^[0-9a-f]{32}$/, 'islandHash must be 32 hex chars');
assert.notStrictEqual(islandHash('hello'), islandHash('hellp'), 'collision sanity');

// tryit key shape (asked UA)
const key = mintTryItKey('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
assert.ok(isTryItKey(key), `bad tryit key: ${key}`);
assert.notStrictEqual(key, mintTryItKey('Mozilla/5.0'), 'each mint must be unique');

// stream parser: plain text
let p = StreamParser.parse('Hello world');
assert.strictEqual(p.text, 'Hello world');
assert.strictEqual(p.images.length, 0);

// activity packets stripped
p = StreamParser.parse('A\u001C{"tool_activity":"Searching the web…"}\u001CB');
assert.strictEqual(p.text, 'AB');
assert.deepStrictEqual(p.toolActivity, ['Searching the web…']);

// trailing payload (generated image)
p = StreamParser.parse('Here you go\u001C{"type":"generated_image","share_url":"https://x/img.png"}');
assert.strictEqual(p.text, 'Here you go');
assert.deepStrictEqual(p.images, ['https://x/img.png']);

// thinking block
p = StreamParser.parse('\u001DTHINKING_START12s\u001Elet me think…\u001DTHINKING_ENDThe answer is 4.');
assert.strictEqual(p.text, 'The answer is 4.');
assert.strictEqual(p.thinkingText, 'let me think…');
assert.ok(p.thinkingClosed);

// partial thinking (stream mid-way)
p = StreamParser.parse('\u001DTHINKING_START12s\u001Ele');
assert.ok(!p.thinkingClosed);
assert.strictEqual(p.thinkingText, 'le');
assert.strictEqual(p.text, '');

console.log('all sanity checks passed');
