# rice-scraper-nuxt

AEON NetSuperの店舗商品を、手動入力したキーワードで検索してデータ化するNuxt 3アプリ。

## セットアップ

```bash
cd rice-scraper-nuxt
npm install
npx playwright install chromium
npm run dev
```

`http://localhost:3000` を開く。

## 使い方

1. キーワード欄に検索語を入力（例: `米 5Kg`, `カップ麺`, `トイレットペーパー` など何でも可）
2. 「全店舗を検索」（gistのURLリストを使用）か「店舗URLを指定」（1行1件でURLを貼り付け）を選択
3. 「検索開始」を押すと、店舗ごとに処理完了次第テーブルへリアルタイム追加される
4. 結果はSQLite（`rice_scraper.db`）に `keyword` 列付きで蓄積される。過去の検索履歴を見たい場合はDBを直接参照するか、必要なら一覧APIを別途追加できる

## 元のスクリプトからの主な変更点

| 項目 | 変更前 | 変更後 |
|---|---|---|
| 検索キーワード | `"米 5Kg"` にハードコード | フォーム入力の`keyword`をそのまま`searchOnPage()`へ渡す |
| 5kg判定フィルタ (`is5kgRice`) | 商品名を正規表現でフィルタ | 撤廃。検索キーワード自体が絞り込み条件になるため不要と判断 |
| 実行トリガー | スクリプトのエントリポイントで自動実行 | ユーザーがフォームから起動するAPI呼び出し（`GET /api/scrape`） |
| 結果の受け渡し | `console.log` + DB書き込みのみ | DB書き込みに加え、SSEで店舗ごとに`store_result`イベントを配信しUIへ反映 |
| DBスキーマ | `products`テーブル | `keyword`列を追加し、どの検索語でヒットしたかを履歴として保持 |
| コード構成 | 単一の`.ts`ファイル | `server/utils/`（純粋関数・DB・ブラウザ操作・セマフォ）と`server/api/scrape.get.ts`（SSEオーケストレーション）に分割 |

## 未実装・今後の検討事項

- 検索履歴（過去のkeyword別結果）を閲覧するAPI/画面
- 店舗リストのUI上での複数選択（現状はテキストエリアへのURL貼り付けのみ）
- Nuxt/NitroはNode.jsサーバーとして起動する前提（Playwrightがnativeバイナリを要するため、Edge/Serverlessデプロイは非対応）