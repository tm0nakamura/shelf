# shelf-jp local scrapers

Per-service scrapers that run on **your own machine** and POST results to
shelf-jp's `/api/import` endpoint. Useful for services that have neither
a public API nor parseable purchase emails (Jump+, Filmarks, 読書メーター, …).

> **重要**: ここに置くスクレイパーは **個人マシンで自分のアカウントを対象にした
> 個人利用** だけを想定しています。各サービスの利用規約は事前に必ず確認してください。
> サーバー(Vercel)上での実行は想定していません — 認証情報がローカルから出ない設計です。

## 仕組み

```
[このマシン]                      [Vercel]
─────────────                    ─────────
 Playwright                      shelf-jp
 (Chromium + persistent profile)  /api/import
   │                                  ▲
   │ scrape DOM                       │
   ├──────────────────────────────────┤
   │  POST /api/import                │
   │   Authorization: Bearer ...      │
   │   { source, items: [...] }       │
   └──────────────────────────────────┘
```

- ログインは Chromium の永続プロファイル (`./.profile/`) に保存。**初回だけ手動ログイン**、以降は cookie 流用
- shelf-jp 側は `IMPORT_API_TOKEN` で認証、`IMPORT_USER_ID` で書き込み先ユーザを固定
- このディレクトリの `node_modules` / `.profile` / `.env` は git ignore 済み

## セットアップ

### 1. shelf-jp(Vercel) 側に env を 2 つ追加

```bash
# 共有秘密。生成例:
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Vercel Settings → Environment Variables:
- `IMPORT_API_TOKEN` = （生成した24バイト文字列）
- `IMPORT_USER_ID` = 自分の users.id (Supabase の Authentication → Users で確認)

env 追加後 Redeploy を忘れずに。

### 2. このディレクトリで依存をインストール

```bash
cd scripts/scrape
npm install
npm run install-browsers     # Chromium を ~/.cache/ms-playwright に取得
```

### 3. ローカル env を作る

```bash
cp .env.example .env
```

`.env` を編集：
```
SHELF_API_URL=https://shelf-wine.vercel.app
SHELF_IMPORT_TOKEN=（Vercel に入れたのと同じ値）
SHELF_USER_DATA_DIR=./.profile
```

### 4. Jump+ に初回ログイン（一度だけ）

```bash
npm run jumpplus:login
```

→ ブラウザが立ち上がるので `https://shonenjumpplus.com/login` で **手動でログイン** → そのままブラウザを閉じる。`.profile/` にセッション cookie が保存される。

### 5. 取り込みを実行

```bash
npm run jumpplus
```

→ ヘッドレス Chromium がマイページを開いてスクレイプ → 結果を `/api/import` に POST → shelf-jp の棚に「漫画」カテゴリのアイテムが並ぶ。

## 自動化（任意）

### macOS (launchd)
`~/Library/LaunchAgents/jp.shelf.scrape.plist` を作って 1 日 1 回実行。

### Linux (cron)
```
0 9 * * * cd /path/to/shelf-jp/scripts/scrape && /usr/local/bin/npm run jumpplus >> ./scrape.log 2>&1
```

### Windows (Task Scheduler)
タスクスケジューラで `npm run jumpplus` を日次実行。

## 既知の限界

- **Jump+ の DOM が変わると壊れる**: `jumpplus.mjs` の `extractFromMypage` 関数の selector を実物に合わせて調整する必要あり。最初は `HEADED=1 npm run jumpplus` で実物を見ながらデバッグ
- **2FA 設定中は動かない**: 永続プロファイルでは突破できないため、2FA はオフにするか諦める
- **rate limit**: 1 日 1 回まで。サービスの「人間らしくない頻度」検知に当たらないように

## 別サービスを追加する

1. このディレクトリに `<service>.mjs` を作る
2. `package.json` の `scripts` に `"<service>": "node --env-file=.env <service>.mjs"` を足す
3. `pushItems({ source: 'scrape_<service>', items: [...] })` で送る

`source` は `scrape_*` で始めるルール（shelf-jp の `/api/import` zod が `^[a-z0-9_]+$` を許容）。
