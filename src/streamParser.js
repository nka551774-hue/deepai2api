'use strict';

/**
 * Parser for the upstream chat stream.
 *
 * The chat endpoint does not return clean prose. It returns a plain-text
 * stream with out-of-band packets embedded in it:
 *
 *   1. Tool-activity packets   \u001C{"tool_activity":"Searching the web…"}\u001C
 *   2. A trailing payload      …answer text…\u001C{"type":"generated_image",…}
 *      Everything after the LAST \u001C may be JSON: web search results, a
 *      generated-image object or a function call.
 *   3. Thinking blocks        \u001DTHINKING_START12s\u001E<cot>\u001DTHINKING_END
 *
 * `parse()` on the accumulated body splits all of that apart. It is safe to
 * call on partial data at any point of the stream.
 */
const FS = '\u001C'; // packet delimiter
const GS = '\u001D';
const RS = '\u001E';

const ACTIVITY_PACKET = /\u001C(\{[^\u001C]*\})\u001C/g;
const THINK_START = `${GS}THINKING_START`;
const THINK_END = `${GS}THINKING_END`;

class StreamParser {
  /**
   * @param {string} raw full or partial response body
   * @returns {{
   *   text: string,
   *   thinkingText: string,
   *   thinkingClosed: boolean,
   *   payload: any|null,
   *   toolActivity: string[],
   *   images: string[],
   * }}
   */
  static parse(raw) {
    const source = String(raw ?? '');

    // ---- 1. tool activity packets -------------------------------------------
    const toolActivity = [];
    let text = source.replace(ACTIVITY_PACKET, (_m, json) => {
      try {
        const packet = JSON.parse(json);
        if (typeof packet.tool_activity === 'string') toolActivity.push(packet.tool_activity);
      } catch {
        /* not an activity packet; drop it, it is not prose either */
      }
      return '';
    });

    // ---- 2. trailing JSON payload --------------------------------------------
    let payload = null;
    const fsIndex = text.indexOf(FS);
    if (fsIndex !== -1) {
      const candidate = text.slice(fsIndex + 1).trim();
      try {
        payload = candidate ? JSON.parse(candidate) : null;
      } catch {
        // Truncated / not JSON: ignore, but still cut the text before it so
        // half packets never leak into the visible output.
        payload = null;
      }
      text = text.slice(0, fsIndex);
    }

    // ---- 3. thinking block (open or closed) ---------------------------------
    let thinkingText = '';
    let thinkingClosed = false;
    const start = text.indexOf(THINK_START);
    if (start !== -1) {
      const end = text.indexOf(THINK_END);
      let after = '';
      if (end !== -1 && end > start) {
        const body = text.slice(start + THINK_START.length, end);
        const sep = body.indexOf(RS);
        thinkingText = sep !== -1 ? body.slice(sep + 1) : body;
        thinkingClosed = true;
        after = text.slice(end + THINK_END.length);
      } else {
        const body = text.slice(start + THINK_START.length);
        const sep = body.indexOf(RS);
        thinkingText = sep !== -1 ? body.slice(sep + 1) : '';
      }
      text = text.slice(0, start) + after;
    }

    // Strip stray separators so partial packets never ship.
    text = text.replace(/[\u001C\u001D\u001E]/g, '');
    thinkingText = thinkingText.replace(/[\u001C\u001D\u001E]/g, '');

    return {
      text,
      thinkingText,
      thinkingClosed,
      payload,
      toolActivity,
      images: StreamParser.imagesFrom(payload),
    };
  }

  /** Image URLs carried by a `{type:'generated_image'}` / share payload. */
  static imagesFrom(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const urls = [];
    if (payload.type === 'generated_image' || payload.share_url || payload.output_url) {
      const url = payload.share_url || payload.url || payload.output_url;
      if (typeof url === 'string' && url) urls.push(url);
    }
    if (Array.isArray(payload.images)) {
      for (const img of payload.images) {
        const url = typeof img === 'string' ? img : img?.share_url || img?.url;
        if (url) urls.push(url);
      }
    }
    return urls;
  }
}

module.exports = { StreamParser };
