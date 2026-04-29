import { type NextRequest } from 'next/server'
import { env } from '@/lib/env'

/**
 * GET /bm/jumpplus — returns the bookmarklet payload script.
 *
 * Loaded as `<script src="/bm/jumpplus?t=<token>">` from a bookmarklet
 * the user has saved. The script runs in the Jump+ origin, scrapes the
 * current /my DOM, and POSTs the harvested items to /api/import on
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
  // Runs in the Jump+ page context. Jump+ keeps the user's reading
  // history client-side in localStorage under the key "history_manager"
  // (max 20 items). Read it, normalise into shelf-jp's import shape,
  // POST to /api/import.
  return `(() => {
  const TOKEN = ${JSON.stringify(args.token)};
  const API = ${JSON.stringify(args.apiUrl)};
  const BANNER_ID = '__shelf_bm_banner';

  const banner = (msg, kind) => {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      el.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:12px 18px;border-radius:10px;font:600 13px/1.4 system-ui,sans-serif;color:#fff;background:#1a1614;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:340px;';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'err' ? '#7a2030' : kind === 'ok' ? '#1f5b3a' : '#1a1614';
    el.textContent = msg;
    if (kind === 'ok' || kind === 'err') {
      setTimeout(() => el.remove(), 6000);
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

  // --- Read localStorage.history_manager ---
  const raw = localStorage.getItem('history_manager');
  if (!raw) {
    banner('shelf-jp: history_manager が空です。Jump+ で何か1話読んでから再実行してください', 'err');
    return;
  }
  let history;
  try {
    history = JSON.parse(raw);
  } catch (e) {
    banner('shelf-jp: history_manager の JSON パースに失敗 — ' + e.message, 'err');
    return;
  }
  if (!Array.isArray(history) || history.length === 0) {
    banner('shelf-jp: history_manager が空配列です', 'err');
    return;
  }

  // --- Map to shelf-jp import items, dedup by series id ---
  const seen = new Set();
  const items = [];
  for (const h of history) {
    const series = h && h.series ? h.series : null;
    const episode = h && h.episode ? h.episode : null;
    const seriesId = series && series.id;
    if (!seriesId || seen.has(seriesId)) continue;
    seen.add(seriesId);

    const consumedAt = (() => {
      const ts = (episode && episode.createAt) || h.createdAt || null;
      if (!ts) return new Date().toISOString();
      return new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toISOString();
    })();

    items.push({
      category: 'comic',
      external_id: String(seriesId),
      title: (series && series.title) || (episode && episode.title) || '(unknown)',
      creator: episode && episode.title ? String(episode.title) : null,
      cover_image_url: series && series.thumbnailUrl ? String(series.thumbnailUrl) : null,
      source_url: episode && episode.permaLink ? String(episode.permaLink) : null,
      consumed_at: consumedAt,
      metadata: {
        series_id: seriesId,
        episode_id: episode && episode.id ? String(episode.id) : null,
        episode_title: episode && episode.title ? String(episode.title) : null,
      },
    });
  }

  if (items.length === 0) {
    banner('shelf-jp: 取り込める履歴がありませんでした', 'err');
    return;
  }

  banner('shelf-jp: ' + items.length + ' 件を送信中…');

  // --- POST ---
  fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({ source: 'scrape_jumpplus', items: items }),
  })
    .then(async (r) => {
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (r.ok) {
        banner('shelf-jp: ' + (json.count ?? items.length) + ' 件を棚に追加しました', 'ok');
      } else {
        banner('shelf-jp: 失敗 (' + r.status + ') ' + (json.error || text.slice(0, 80)), 'err');
      }
    })
    .catch((e) => {
      banner('shelf-jp: ネットワークエラー — ' + e.message, 'err');
    });
})();`
}
