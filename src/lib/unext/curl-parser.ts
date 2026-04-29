import 'server-only'

/**
 * Pull cookie / zxuid / zxemp out of whatever the user pasted into the
 * connect form. We accept three forms so they can copy whichever feels
 * least intimidating:
 *
 *   1. Full cURL command (Copy as cURL from DevTools).
 *   2. Just the URL — cookie missing → fail with a friendly message.
 *   3. A bare Cookie header followed by a URL — fall back to regex on the
 *      whole blob.
 *
 * Returns null when we can't find both the cookie and the zx* params; the
 * caller turns that into a redirect with ?error=unext_paste_invalid.
 */
export type ParsedUnextPaste = {
  cookieHeader: string
  zxuid: string
  zxemp: string
}

export function parseUnextPaste(raw: string): ParsedUnextPaste | null {
  if (!raw) return null
  const text = raw.replace(/\r\n/g, '\n')

  const cookie =
    extractCookieFromCurl(text) ??
    extractRawCookieHeader(text) ??
    null
  if (!cookie) return null

  const zxuid = pickQueryParam(text, 'zxuid')
  const zxemp = pickQueryParam(text, 'zxemp')
  if (!zxuid || !zxemp) return null

  // Sanity: refuse if the access token cookie isn't there — without
  // _at the request hits cc.unext.jp anonymously and returns nothing
  // useful. Better to fail loudly at paste time.
  if (!/(?:^|;\s*)_at=/.test(cookie)) return null

  return { cookieHeader: cookie, zxuid, zxemp }
}

/**
 * cURL formats vary by shell. The Windows "Copy as cURL (cmd)" form
 * uses `^"..."` and `^%^` escapes; the bash form uses single-quoted -b.
 * We unescape the cmd-style sequences first, then run a permissive
 * match against either form.
 */
function extractCookieFromCurl(text: string): string | null {
  const unescaped = text
    // strip cmd.exe ^ line continuations and embedded ^ escapes
    .replace(/\^\s*\n/g, ' ')
    .replace(/\^"/g, '"')
    .replace(/\^%/g, '%')
    .replace(/\\\^"/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\^\^/g, '^')

  // -b 'cookie...'  or  -b "cookie..."  or  --cookie ...
  const m =
    unescaped.match(/--cookie\s+(['"])([\s\S]*?)\1/) ??
    unescaped.match(/-b\s+(['"])([\s\S]*?)\1/)
  if (m) return m[2].trim()

  // -b cookie-without-quotes-up-to-next-flag (rare, but covered)
  const bare = unescaped.match(/(?:^|\s)-b\s+([^-\s][^\n]*?)(?=\s+-[A-Za-z]|\s*$)/)
  if (bare) return bare[1].trim()

  return null
}

/**
 * Last-resort: if the user pasted a bare "Cookie: ..." header (e.g.
 * copied from the Headers tab instead of cURL), grab everything after
 * the colon up to the next newline.
 */
function extractRawCookieHeader(text: string): string | null {
  const m = text.match(/(?:^|\n)\s*Cookie:\s*([^\n]+)/i)
  if (m) return m[1].trim()
  // Or if they pasted only the cookie blob directly and it contains _at
  if (/(?:^|;\s*)_at=/.test(text) && /;/.test(text)) {
    return text.split('\n').find((line) => /_at=/.test(line))?.trim() ?? null
  }
  return null
}

function pickQueryParam(text: string, name: string): string | null {
  const re = new RegExp(`[?&^]${name}=([^&"\\s^]+)`, 'i')
  const m = text.match(re)
  if (!m) return null
  // cmd-style cURL escapes & as ^& — already covered by the char class.
  return decodeURIComponent(m[1])
}
