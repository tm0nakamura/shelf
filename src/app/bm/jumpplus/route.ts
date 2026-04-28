import { type NextRequest } from 'next/server'
import { env } from '@/lib/env'

/**
 * GET /bm/jumpplus — returns the bookmarklet payload script.
 *
 * Loaded as `<script src="/bm/jumpplus?t=<token>">` from a bookmarklet
 * the user has saved. The script runs in the Jump+ origin, scrapes the
 * current /mypage DOM, and POSTs the harvested items to /api/import on
 * shelf-jp using the token from the query string.
 *
 * The token is baked into the response body so the page-side script
 * doesn't have to read `document.currentScript`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const token = (url.searchParams.get('t') ?? '').trim()
  // Cheap guard so the endpoint can't be used to ferry arbitrary strings.
  const safeToken = /^[A-Za-z0-9._\-~]{8,256}$/.test(token) ? token : ''

  const apiUrl = `${env.APP_URL.replace(/\/$/, '')}/api/import`

  const js = renderScript({ token: safeToken, apiUrl })
  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Don't cache aggressively — selectors evolve.
      'Cache-Control': 'public, max-age=300, must-revalidate',
      // The browser loads this as a <script>, no CORS preflight; but be safe.
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function renderScript(args: { token: string; apiUrl: string }) {
  // The whole IIFE runs in the page being viewed (Jump+).
  return `(() => {
  const TOKEN = ${JSON.stringify(args.token)};
  const API = ${JSON.stringify(args.apiUrl)};
  const BANNER_ID = '__shelf_bm_banner';

  const banner = (msg, kind) => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:12px 18px;border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;color:#fff;background:#1a1614;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:320px;';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'err' ? '#7a2030' : kind === 'ok' ? '#1f5b3a' : '#1a1614';
    el.textContent = msg;
    if (kind === 'ok' || kind === 'err') {
      setTimeout(() => el.remove(), 5000);
    }
  };

  if (!TOKEN) {
    banner('shelf-jp: トークンが空です。設定ページから bookmarklet を保存し直してください。', 'err');
    return;
  }
  if (!/shonenjumpplus\\.com$/.test(location.hostname.replace(/^www\\./, ''))) {
    banner('shelf-jp: ジャンプ+のページで実行してください', 'err');
    return;
  }

  banner('shelf-jp: 読み込み中…');

  // --- Scrape ---
  const items = [];
  document.querySelectorAll('a[href^="/series/"], a[href^="/episode/"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href) return;
    const url = new URL(href, location.origin).toString();
    const seriesMatch = href.match(/\\/series\\/([^/?#]+)/);
    const episodeMatch = href.match(/\\/episode\\/([^/?#]+)/);
    const externalId = (seriesMatch && seriesMatch[1]) || (episodeMatch && episodeMatch[1]);
    if (!externalId) return;

    const img = a.querySelector('img');
    const cover = (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || null;
    const titleEl = a.querySelector('h3, h4, .title, [class*="title"], [class*="Title"]');
    const altText = img && img.getAttribute('alt');
    const title = ((titleEl && titleEl.textContent) || altText || '').trim();
    if (!title) return;

    const authorEl = a.querySelector('[class*="author"], [class*="Author"]');
    const creator = authorEl ? (authorEl.textContent || '').trim() || null : null;

    items.push({
      category: 'comic',
      external_id: externalId,
      title,
      creator,
      cover_image_url: cover,
      source_url: url,
      consumed_at: new Date().toISOString(),
      metadata: { kind: seriesMatch ? 'series' : 'episode' },
    });
  });

  // Dedup
  const seen = new Set();
  const unique = items.filter((it) => {
    if (seen.has(it.external_id)) return false;
    seen.add(it.external_id);
    return true;
  });

  if (unique.length === 0) {
    banner('shelf-jp: 取れる作品が見つかりません。マイページか「お気に入り」で実行してみてください', 'err');
    return;
  }

  banner('shelf-jp: ' + unique.length + ' 件を送信中…');

  // --- POST ---
  fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({ source: 'scrape_jumpplus', items: unique }),
  })
    .then(async (r) => {
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (r.ok) {
        banner('shelf-jp: ' + (json.count ?? unique.length) + ' 件を棚に追加しました', 'ok');
      } else {
        banner('shelf-jp: 失敗 (' + r.status + ') ' + (json.error || text.slice(0, 80)), 'err');
      }
    })
    .catch((e) => {
      banner('shelf-jp: ネットワークエラー — ' + e.message, 'err');
    });
})();`
}
