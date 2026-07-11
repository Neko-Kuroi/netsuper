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