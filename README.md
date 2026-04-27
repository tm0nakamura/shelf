# shelf-jp

消費コンテンツの足跡を、自動で集めて棚にする日本向け Web サービス（Phase 1 — Spotify OAuth + 認証 + 棚UI）。

## スタック

- Next.js 16 (App Router, Turbopack) + React 19.2 + TypeScript
- Tailwind CSS 4 + CSS Modules（棚UI）
- Supabase（Postgres + Auth + RLS）
- Spotify Web API（user-read-recently-played + user-library-read）

## 実装済み機能

| FR | 機能 |
|---|---|
| FR-1 | メールマジックリンク + Google OAuth ログイン |
| FR-2 | Spotify OAuth + 再生履歴 (50件) + Saved Tracks (200件)  ※Spotify が Web API に Premium 必須化したため UI は休眠 |
| FR-3 | 同期ログ (sync_logs)、エラー時 status=error |
| FR-4 | `/u/[username]` で「ぜんぶ」ビュー (2x3 grid)、未連携セルは CTA |
| FR-5 | ヘッダー stats + カテゴリタブ |
| **FR-6** | **Gmail OAuth + Amazon Schema.org Order JSON-LD パース → book / comic / film / music / game に自動分類** |
| FR-9 | カテゴリ自動判定（Amazon 商品名・URL・画像 URL からヒューリスティック） |

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

### 5. Google Cloud（Gmail API）

[Google Cloud Console](https://console.cloud.google.com) で：

1. **新規プロジェクト作成**（既存があれば流用可）
2. **APIs & Services → Library → Gmail API → Enable**
3. **APIs & Services → OAuth consent screen**
   - User Type: External
   - App name: `shelf-jp` 等
   - スコープ追加: `.../auth/gmail.readonly`
   - テストユーザー: 自分の Google アカウントを追加（Verified 化前は必須）
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `http://127.0.0.1:3000/api/gmail/callback`
5. 作成された Client ID / Client Secret を `.env.local` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に貼る

> Supabase Auth の Google ログインで使う OAuth クライアントとは**別物**です。混同注意。

### 6. （オプション）Spotify Developer App

Spotify Web API は 2024-11 から **開発者本人 Premium 必須**。Premium 加入者のみ：

[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) で新規アプリ作成。

- **Redirect URIs** に `http://127.0.0.1:3000/api/spotify/callback` を登録（`localhost` は拒否されるため必ず IP）
- Web API のみ ON
- Client ID / Client Secret を `.env.local` に

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
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
SPOTIFY_CLIENT_ID=          # Premium ユーザーのみ
SPOTIFY_CLIENT_SECRET=
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
| `/api/gmail/connect` | Gmail OAuth 開始 |
| `/api/gmail/callback` | Gmail OAuth コールバック → 初回同期 (Amazon メール 6ヶ月分) |
| `/api/gmail/sync` (POST) | Gmail 手動同期 |
| `/api/spotify/connect` | Spotify OAuth 開始（Premium 必須） |
| `/api/spotify/callback` | Spotify OAuth コールバック |
| `/api/spotify/sync` (POST) | Spotify 手動同期 |

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
