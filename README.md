# shelf-jp

消費コンテンツの足跡を、自動で集めて棚にする日本向け Web サービス（Phase 1 — Spotify OAuth + 認証 + 棚UI）。

## スタック

- Next.js 16 (App Router, Turbopack) + React 19.2 + TypeScript
- Tailwind CSS 4 + CSS Modules（棚UI）
- Supabase（Postgres + Auth + RLS）
- Spotify Web API（user-read-recently-played + user-library-read）

## Phase 1 で動くもの

| FR | 機能 |
|---|---|
| FR-1 | メールマジックリンク + Google OAuth ログイン |
| FR-2 | Spotify OAuth + 再生履歴 (50件) + Saved Tracks (200件) |
| FR-3 | 同期ログ (sync_logs)、エラー時 status=error（指数バックオフは Phase 1.5） |
| FR-4 | `/u/[username]` で「ぜんぶ」ビュー (2x3 grid)、未連携セルは CTA |
| FR-5 | ヘッダー stats (曲/ライブ/本/視聴) + カテゴリタブ |

## セットアップ手順

### 1. 依存

```bash
npm install
```

### 2. Supabase プロジェクトを作る

[supabase.com](https://supabase.com/dashboard) で新規プロジェクト → **Settings → API Keys**（新パネル）から取得:

- `Project URL`（Settings → API） → `NEXT_PUBLIC_SUPABASE_URL`
- `Publishable key` (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `Secret key` (`sb_secret_…`) → `SUPABASE_SECRET_KEY`

> 旧 `anon` / `service_role` (JWT) もまだ使えるが、新キーの方がローテーション・失効が個別にできて推奨。

### 3. マイグレーション

Supabase ダッシュボードの SQL Editor で `supabase/migrations/0001_initial.sql` を実行。または Supabase CLI で:

```bash
supabase db push
```

### 4. Google OAuth (Supabase Auth)

Supabase Dashboard → **Authentication → Providers → Google** を有効化。Google Cloud Console で OAuth クライアントを作り、Authorized redirect URI に `https://YOUR_PROJECT.supabase.co/auth/v1/callback` を登録。

### 5. Spotify Developer App

[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) で新規アプリ作成。

- **Redirect URIs** に `http://127.0.0.1:3000/api/spotify/callback` を登録
  - ⚠ Spotify は 2024-11 以降 `localhost` を Redirect URI として **拒否**します。必ず明示的なループバック IP (`127.0.0.1` または `[::1]`) を使う。本番は HTTPS 必須
- 「Which API/SDKs are you planning to use?」では **Web API** だけ ON
- Client ID / Client Secret を取得

### 6. .env.local

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 出力された 64 文字を TOKEN_ENCRYPTION_KEY に
```

`.env.local` を埋める:

```
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
APP_URL=http://127.0.0.1:3000
TOKEN_ENCRYPTION_KEY=<64 hex>
```

### 7. 起動

```bash
npm run dev
```

→ http://127.0.0.1:3000  （`localhost` ではなく必ずこの IP でアクセス。Spotify OAuth が同じ origin で帰ってくるため）

## 主なルート

| ルート | 役割 |
|---|---|
| `/` | ランディング（ログイン済なら自分の棚へリダイレクト） |
| `/login` | Magic Link / Google ログイン |
| `/auth/callback` | Supabase Auth コールバック |
| `/u/[username]` | 棚（ぜんぶビュー + カテゴリタブ） |
| `/settings/connections` | 連携状態の確認 + 即時同期ボタン |
| `/api/spotify/connect` | Spotify OAuth 開始 |
| `/api/spotify/callback` | Spotify OAuth コールバック → 初回同期 |
| `/api/spotify/sync` (POST) | 手動同期 |

## ディレクトリ

```
src/
├ app/
│  ├ api/spotify/{connect,callback,sync}/route.ts
│  ├ auth/callback/route.ts
│  ├ login/{page,login-form}.tsx
│  ├ settings/connections/{page,connection-actions}.tsx
│  ├ u/[username]/page.tsx
│  └ layout.tsx, page.tsx, globals.css
├ components/shelf/
│  ├ Shelf.tsx
│  └ shelf.module.css
├ lib/
│  ├ supabase/{server,browser,admin}.ts
│  ├ spotify/{auth,api,sync}.ts
│  ├ env.ts
│  └ crypto.ts
└ proxy.ts                  # Next 16 では旧 middleware.ts はこの名前

supabase/migrations/0001_initial.sql
```

## セキュリティメモ

- `connections.credentials_encrypted` は AES-256-GCM で暗号化（`bytea` 列に保存）。`TOKEN_ENCRYPTION_KEY` を漏らすとトークンが復号できる
- `Secret key` (`sb_secret_…`) は絶対にクライアント側に出さない (`src/lib/supabase/admin.ts` は `import 'server-only'` 済み)
- RLS により `items` / `connections` などはユーザー本人しか書けない
- `users` と `items` は **公開棚を実現するため select のみ全ユーザー許可**。フォロー機能や非公開棚を入れるときは ALTER POLICY する

## 次のフェーズ

- Phase 2: Gmail OAuth + Amazon Schema.org JSON-LD パース、個別カテゴリビュー詳細
- Phase 3: Share Sheet 受信（モバイルアプリ／PWA）+ ロック画面 PNG 書き出し
- Phase 4: 月次 Recap + 試用 + Go/NoGo 判定
