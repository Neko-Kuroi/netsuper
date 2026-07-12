---
title: Rice Scraper Nuxt
emoji: 🍚
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# rice-scraper-nuxt

AEON NetSuperの店舗商品を、手動入力したキーワードで検索してデータ化するNuxt 3アプリ。

## 構成

```
rice-scraper-nuxt/
├── package.json
├── nuxt.config.ts            # Playwright/sqlite3等をNitroバンドル対象外に設定
├── app.vue                   # フロントUI(検索フォーム・結果テーブル・店舗選択)
│
└── server/
    ├── api/
    │   ├── scrape.get.ts     # GET /api/scrape   (SSEで店舗ごとの結果を配信)
    │   ├── stores.get.ts     # GET /api/stores    (店舗URL一覧を返す。店舗選択UI用)
    │   └── download-db.get.ts# GET /api/download-db (SQLiteファイルをそのままダウンロード)
    │
    └── utils/
        ├── scraperCore.ts    # 純粋関数(URL検証・HTMLパース・店舗リスト取得)
        ├── browserTasks.ts   # Playwright操作(検索実行・商品パース・店舗単位の処理)
        ├── db.ts             # SQLiteセットアップ・保存
        ├── semaphore.ts      # 並列実行数の制御
        ├── config.ts         # DB_NAME等の共有設定(環境変数DB_PATHで上書き可)
        └── types.ts          # 型定義
```

デプロイ用に以下も追加可能(後述):

```
├── Dockerfile                 # Fly.io / HF Spaces共通で使えるベース
├── fly.toml                   # Fly.io設定
└── .github/workflows/
    └── deploy-hf-spaces.yml   # main push時にHF Spacesへ自動デプロイ
```

## セットアップ(ローカル開発)

```bash
cd rice-scraper-nuxt
npm install
npx playwright install --with-deps chromium   # ブラウザ本体+OS依存ライブラリを一括取得
npm run dev
```

`http://localhost:3000` を開く。

> **Codespaces/Docker/Colab等の制限環境で`libatk-1.0.so.0`関連のエラーが出る場合**:
> `postinstall`スクリプトに`playwright install --with-deps chromium`を含めているため、
> `npm install`をやり直すか、上記コマンドを手動実行してください。

## 使い方

1. キーワード欄に検索語を入力(例: `米 5Kg`, `カップ麺`, `トイレットペーパー` など何でも可)
2. 検索対象の店舗を選択
   - **全店舗を検索**: gistの店舗URLリストを一括使用
   - **店舗URLを指定**: テキストエリアに1行1件でURLを貼り付け
   - **店舗を選択**: `/api/stores`で取得した一覧からチェックボックス(テーブル形式・店舗ID表示・絞り込み検索付き)で個別選択
3. 「検索終了後にDBを自動ダウンロード」にチェックを入れておくと、完了と同時にSQLiteファイルがダウンロードされる(チェックしなくても、完了後に手動ダウンロードボタンが表示される)
4. 「検索開始」を押すと、店舗ごとに処理完了次第テーブルへリアルタイム追加される(SSE)
5. 結果はSQLite(デフォルト`rice_scraper.db`、`DB_PATH`環境変数で保存先変更可)に`keyword`列付きで蓄積される

## 元のスクリプトからの主な変更点

| 項目 | 変更前 | 変更後 |
|---|---|---|
| 検索キーワード | `"米 5Kg"` にハードコード | フォーム入力の`keyword`をそのまま`searchOnPage()`へ渡す |
| 5kg判定フィルタ (`is5kgRice`) | 商品名を正規表現でフィルタ | 撤廃。検索キーワード自体が絞り込み条件になるため不要と判断 |
| 実行トリガー | スクリプトのエントリポイントで自動実行 | ユーザーがフォームから起動するAPI呼び出し(`GET /api/scrape`) |
| 結果の受け渡し | `console.log` + DB書き込みのみ | DB書き込みに加え、SSEで店舗ごとに`store_result`イベントを配信しUIへ反映 |
| DBスキーマ | `products`テーブル | `keyword`列を追加し、どの検索語でヒットしたかを履歴として保持 |
| コード構成 | 単一の`.ts`ファイル | `server/utils/`(純粋関数・DB・ブラウザ操作・セマフォ)と`server/api/`(SSEオーケストレーション・店舗一覧・DB配信)に分割 |

## 既知のトラブルと対処(デバッグ履歴)

- **検索実行後にハングして進まない**: `searchOnPage()`が`page.waitForNavigation({waitUntil:'networkidle'})`に依存していたのが原因。AEON netsuperのSPA遷移ではnavigatedイベントが安定して発火せず、常時通信でnetworkidleに到達しないケースがあった。クリック確認のみ行い、結果表示の判定は後段の`getProductElements()`の`waitForSelector('.product-item')`に委ねる方式に変更済み。
- **`Database initialized...`のログの後に無反応**: `chromium.launch()`がroot権限・コンテナ環境でサンドボックス起動に失敗しハングしていた。`args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']`を追加し、加えてDB初期化・ブラウザ起動を`try/catch`で囲みSSEの`fatal_error`イベントとして必ず通知するように修正済み。
- **`error while loading shared libraries: libatk-1.0.so.0`**: Playwrightのブラウザ本体はダウンロードされていても、OS側の依存ライブラリ(apt)が未インストールだと発生。`postinstall`を`nuxt prepare && npx playwright install --with-deps chromium`にして解決。

## デプロイ

このアプリはPlaywright(Chromium本体)・長時間のSSEストリーミング・SQLiteへのファイル書き込みを行うため、**通常のNode.jsサーバーとして動く環境**が必要。

### 非対応: Vercel(サーバーレス)

`apt-get`が存在せずPlaywrightのOS依存ライブラリをインストールできない、関数の実行時間・サイズ制限、SQLiteが永続化されない、という3重の理由で不向き。

### Fly.io(推奨)

`Dockerfile` + `fly.toml`を用意(Debianベースなので`apt-get`が使え、依存ライブラリ問題が起きない)。SQLiteは永続ボリューム(`/data`)にマウントして運用。

```bash
fly apps create <アプリ名>
fly volumes create rice_scraper_data --region nrt --size 1
fly deploy
```

### Hugging Face Spaces(Docker SDK)

ポートは`7860`固定(このファイル冒頭のYAMLフロントマターで指定)。無料枠は再起動でファイルシステムが消えるため、検索履歴を残したい場合はSpace設定でPersistent Storageの有効化が必要。

`main`ブランチへのpushで自動デプロイする場合は`.github/workflows/deploy-hf-spaces.yml`を使用。GitHubリポジトリのSecretsに`HF_TOKEN`・`HF_USERNAME`・`HF_SPACE_NAME`を登録しておくこと。

## 検討したが採用しなかった代替案

- **obscura**(Rust製軽量ヘッドレスブラウザ): 単体バイナリでOS依存ライブラリ問題は回避できるが、検証の結果`page.fill()`/`page.click()`が動作せず不採用
- **Lightpanda**(Zig製軽量ヘッドレスブラウザ): `fill`/`click`/`waitForSelector`等は動作を確認したが、AGPL-3.0ライセンスのため採用は保留中

## 未実装・今後の検討事項

- 検索履歴(過去のkeyword別結果)を横断的に閲覧するAPI/画面(現状はDBファイルを直接見るかダウンロードするのみ)
- Fly.io / HF Spaces双方でのメモリサイジングの実運用での検証(`MAX_CONCURRENT_TASKS=3`での並列Chromium実行を想定し1GB確保しているが未検証)

----
## このリポジトリ、Nuxtを知らない人向け解説

## 0. そもそもNuxtって何？

普通、Webアプリを作ると「フロントエンド（ブラウザに表示される画面）」と「バックエンド（データ処理・DB操作をするサーバー）」を別々に用意して、両方立ち上げて通信させる必要がある。

**Nuxt**はこの2つを1つのプロジェクトにまとめられるフレームワーク。中身は：

- 画面側 → **Vue**（Reactみたいなフロントエンドライブラリ）
- サーバー側 → **Nitro**というNuxt内蔵のサーバーエンジン

最大の特徴は「**ファイルの置き場所がそのままURLになる**」という規約（ファイルベースルーティング）。このリポジトリで言うとこういう対応になっている：

| ファイルパス | 意味 |
|---|---|
| `app.vue` | サイトのトップページそのもの |
| `server/api/scrape.get.ts` | `GET /api/scrape` というAPIエンドポイント |
| `server/api/stores.get.ts` | `GET /api/stores` というAPIエンドポイント |
| `server/api/download-db.get.ts` | `GET /api/download-db` というAPIエンドポイント |
| `server/utils/*.ts` | どこからでも使える共通関数・クラス置き場（ルーティングには関係ない） |

つまり`routes.ts`とか`express.get('/api/scrape', ...)`みたいなルーティング設定コードを一切書かなくても、ファイル名とフォルダ構造だけでAPIが自動的にできる。ファイル名末尾の`.get.ts`は「このAPIはGETメソッドで呼ばれる」という意味（`.post.ts`ならPOST用）。

`npm run dev`を実行すると、この2つ（画面用サーバーとAPIサーバー）が同時に1つのプロセス（`localhost:3000`）として立ち上がる。

---

## 1. アプリ全体が何をするものか

**AEON NetSuper**（イオンネットスーパー）の複数店舗に対して、同じキーワードで一括検索をかけ、ヒットした在庫ありの商品価格を集めてくるツール。

流れはこう：

```
[ブラウザ: app.vue]
    | ① キーワード入力・店舗選択
    ▼
[GET /api/scrape?keyword=...&mode=...]
    | ② サーバー側でPlaywrightがChromiumを操作して
    |   各店舗のページを開き、検索・商品情報を抽出
    ▼
[SQLite DB (rice_scraper.db) に保存]
    | ③ 結果はSSE（後述）でリアルタイムに画面へ返る
    ▼
[GET /api/download-db]  ← 蓄積したDBファイルをまとめてダウンロード
```

---

## 2. `app.vue` （画面側）

Nuxtでは`app.vue`がアプリのエントリーポイント。中は普通のVueコンポーネントで、`<script setup>`の中にロジック、`<template>`の中にHTMLっぽい見た目を書くのが基本形。

このアプリの`app.vue`が持っている主な状態（`ref`＝Vueのリアクティブ変数）：

- `keyword`：検索キーワード
- `mode`：`'all'`（全店舗）/ `'custom'`（URL直接指定）/ `'select'`（gistのリストからチェックボックスで選択）
- `storeList` / `selectedStores`：`mode === 'select'`のときに使う、店舗一覧と選択状態
- `results`：SSEで届いた店舗ごとの検索結果を貯めていく配列
- `progress`：`{ completed, total }`の進捗表示用

検索を始めると`EventSource`（後述のSSE受信用ブラウザAPI）を開いて、サーバーからのイベントを`results`に追記していく。

---

## 3. サーバー側の主要ファイル

### `server/utils/scraperCore.ts` — 純粋関数（副作用なしのロジック集）

- `URL_PATTERN`：店舗URLが `https://shop.aeon.com/netsuper/数字14〜15桁` の形かをチェックする正規表現
- `validateUrl(url)`：↑のパターンに一致するURLだけを通す
- `generateUserAgent()`：ランダムなUser-Agent文字列を生成（Firefox/iPhone系は除外して、動作確認済みのChrome UAに固定する保険付き）
- `parseStoreDetailsFromHtml(html)`：Cheerio（サーバー側で動くjQueryみたいなHTML解析ライブラリ）で店舗ページのHTMLから住所や責任者名を正規表現抽出
- `fetchAllStoreUrls()`：GitHub Gistから店舗URL一覧のテキストを取得 → 1行ずつ検証 → 重複排除 → ソートして返す

### `server/utils/browserTasks.ts` — Playwrightでのブラウザ操作

`processStoreUrl()`が1店舗分の処理をまるごと担当する中心関数。中身は5段階：

1. **Navigation**：`page.goto()`で店舗ページへ遷移（`async-retry`で失敗時に指数バックオフしながら最大3回リトライ）
2. **Search**：ページ内の`#search`ボックスにキーワードを入力して`#cx-search-button`をクリック
3. **Product Extraction**：`.product-item`要素（＝検索結果の商品カード）が出るまで待って全部取得
4. **Parsing**：商品名・価格・在庫状況をパース、在庫切れ商品は除外
5. **Save to DB**：残った在庫ありの商品をSQLiteに保存

各ステージが失敗しても例外を投げっぱなしにせず、`{ status: 'error', message: ... }`のような結果オブジェクトを返す設計になっている。これにより「1店舗の失敗が全体の処理を止めない」（`Promise.all`で並列実行している他の店舗の処理は続く）。

`finally`ブロックで必ず`page.close()` / `context.close()`を呼び、3秒待機してからセマフォを解放しているのは、Chromiumのメモリ解放を待つための意図的なウェイトと思われる。

### `server/utils/semaphore.ts` — 同時実行数の制御

Playwrightで店舗ページを何十件も同時に開くとメモリが足りなくなるので、「同時に処理できる件数」を制限する仕組みが**セマフォ**。`scrape.get.ts`の`MAX_CONCURRENT_TASKS`（現在6）が「同時に開けるタブの上限」になっている。

### `server/api/scrape.get.ts` — 全体のオーケストレーション

1. クエリパラメータ（`keyword`, `mode`, `urls`）を受け取る
2. レスポンスヘッダーを`text/event-stream`に設定 → これが**SSE（Server-Sent Events）**という仕組み。普通のAPIは1回のリクエストに1回のレスポンスで終わるが、SSEは接続を張ったまま何度もイベントを送り続けられる。今回は「店舗Aの結果が出た」「店舗Bの結果が出た」...と逐次届けるのに使っている
3. `mode`に応じて対象URLリストを決定（`custom`なら入力欄のURL、`all`なら`fetchAllStoreUrls()`でgistから取得）
4. SQLite DBを開き、Chromiumを起動（`--no-sandbox`等のフラグはColab/Docker環境での起動失敗を避けるため）
5. 各URLに対して`processStoreUrl()`を並列実行し、完了するたびに`send('store_result', ...)`でSSEイベントを送信
6. 全部終わったら`send('done', ...)`を送ってレスポンスを閉じる

### `server/api/stores.get.ts` / `server/api/download-db.get.ts`

- `stores.get.ts`：`fetchAllStoreUrls()`をそのままJSONで返すだけ。`app.vue`の「店舗を選択」モードでチェックボックスに並べる店舗一覧を取ってくるのに使う
- `download-db.get.ts`：蓄積した`rice_scraper.db`ファイルをそのままストリームでダウンロードさせる。`Content-Disposition: attachment`ヘッダーでブラウザにファイル保存ダイアログを出させている

---

## 4. 用語まとめ（最短版）

| 用語 | 一言で言うと |
|---|---|
| Nuxt | Vue＋サーバーを1つにまとめたフレームワーク |
| `server/api/*.get.ts` | ファイル名がそのままAPIのURLとメソッドになる |
| SSE (Server-Sent Events) | サーバーからブラウザへ一方向に何度もイベントを送り続ける仕組み |
| Playwright | コードでブラウザ（Chromium）を自動操作するライブラリ |
| Cheerio | サーバー側でHTMLをjQueryのように解析するライブラリ |
| セマフォ | 同時に実行できる処理数を制限する仕組み |

---

## 5. SSE（Server-Sent Events）の仕組みそのもの

### 5-1. 普通のHTTP通信との違い

普通のAPI（`fetch('/api/xxx')`）は、こういう1往復で完結する：

```
ブラウザ → リクエスト送信 → サーバー
ブラウザ ← レスポンス1個 ← サーバー
（接続終了）
```

SSEは、**接続を張ったまま、サーバーが好きなタイミングで何度もデータを送り続けられる**仕組み：

```
ブラウザ → リクエスト送信（1回だけ）→ サーバー
ブラウザ ← イベント1 ←────────────── サーバー
ブラウザ ← イベント2 ←────────────── サーバー
ブラウザ ← イベント3 ←────────────── サーバー
         ...（サーバーが res.end() するまで続く）
ブラウザ ← 接続終了 ←──────────────── サーバー
```

これを実現しているのは特別なプロトコルではなく、**普通のHTTPレスポンスを「終わらせずに書き足し続けている」だけ**。裏側の仕組みとしては「レスポンスのContent-Lengthを指定しない＋接続を切らない」という、HTTP/1.1のチャンク転送に近い挙動を利用している。

### 5-2. サーバー側で何をしているか（`scrape.get.ts`の実装ベース）

```ts
setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
});

const res = event.node.res;
const send = (type: string, data: unknown) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
};
```

ポイントごとに解説：

- **`Content-Type: text/event-stream`**：これがSSEであることをブラウザに伝えるための唯一の必須ヘッダー。ブラウザ側の`EventSource`はこのヘッダーを見て「これはSSEストリームだ」と認識する
- **`Connection: keep-alive`**：接続を使い回す（＝閉じない）よう伝える
- **`X-Accel-Buffering: no`**：Nginx等のリバースプロキシが「レスポンスを溜めてからまとめて送る」バッファリングをする場合があり、それを無効化する指定。これがないと、SSEのイベントがリアルタイムに届かず、プロキシ側で溜め込まれてからドカッと届くことがある
- **`res.write(...)`（`res.end()`ではない）**：`write`は「データを送るがまだ終わらない」、`end`は「これで終了」。SSEでは`res.end()`を呼ぶまで接続が生き続けるので、`processStoreUrl`が終わるたびに`write`だけを呼んでいる。全部終わった後の`finally`ブロックで初めて`res.end()`を呼んでいる

### 5-3. SSEのメッセージフォーマット

`res.write`で書き込んでいる文字列の形式そのものがSSE仕様で決まっている：

```
event: store_result
data: {"storeUrl":"...","products":[...],"completed":3,"total":10}

```
（最後に空行が1つ必要 — `\n\n`）

- `event: xxx` → このイベントの種類（省略すると`message`という既定の種類になる）
- `data: xxx` → 本体データ（複数行にしたければ`data:`を複数回書ける）
- 空行（`\n\n`） → 「1つのイベントの終わり」を示す区切り。これがないとブラウザ側でイベントの切れ目が分からない

このリポジトリでは`init`（開始）、`store_result`（1店舗分の結果）、`done`（全終了）、`fatal_error`（致命的エラー）の4種類のイベント名を使い分けている。

### 5-4. ブラウザ側（`app.vue`）での受信

ブラウザ側は`EventSource`という、SSE専用の組み込みAPIを使う（`fetch`ではない）：

```js
const es = new EventSource(`/api/scrape?keyword=${keyword}&mode=${mode}`)

es.addEventListener('store_result', (e) => {
  const data = JSON.parse(e.data)
  results.value.push(data)
})

es.addEventListener('done', (e) => {
  es.close()
})
```

`EventSource`は`event: xxx`で指定された種類ごとにリスナーを登録でき、`e.data`に`data: ...`の中身が文字列で入ってくる（JSONなら自分で`JSON.parse`する必要がある）。

### 5-5. SSEの地味に重要な特性

- **一方向のみ**：サーバー→ブラウザの一方通行。ブラウザから追加でデータを送りたければ、SSEとは別に普通のリクエストを送る必要がある（双方向が要るならWebSocketの出番）
- **自動再接続**：`EventSource`は接続が切れると、ブラウザが自動的に再接続を試みる（これは`fetch`にはない挙動）。ただしこのアプリでは`done`受信時に明示的に`es.close()`しているので、正常終了時に意図せず再接続することはない
- **HTTP/1.1だと同時接続数の上限に注意**：ブラウザは1オリジンあたり同時にHTTP接続を張れる数に上限がある（HTTP/1.1だと6本程度）ため、同じページで複数のSSE接続を同時に開くタブをたくさん開いていると詰まることがある。HTTP/2なら基本的にこの制限は緩和される
- **テキストベース**：`data:`に入れられるのは文字列のみ。バイナリを送りたい場合はBase64などにエンコードする必要がある（このアプリはJSON文字列だけなので問題なし）

### 5-6. なぜWebSocketではなくSSEを選んだと考えられるか

このアプリの通信は「サーバー側が複数店舗のスクレイピング結果を、完了した順にブラウザへ流す」という一方向の用途のみ。ブラウザから途中で追加の指示を送る必要がないため、双方向通信ができる代わりに実装が複雑なWebSocketより、シンプルで`fetch`感覚に近いSSEの方が適している、という選択と考えられる。
