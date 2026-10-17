# fudawari 固有の指示

## 概要
艦これのイベントで、特効を踏まえて「どの艦をどの札に回すか」を計画する Web アプリ（画面上のアプリ名は「札割りプランナー」。U4 で決定）。特効を踏まえて札を決めるのがこのツール、編成を組むのは制空権シミュレータ、という役割分担。一般利用者はログインせずブラウザだけで使い、管理者・協力者はログインしてイベント定義（札・攻略段階・特効）を編集・公開する。

## 正とする文書
- `docs/requirements.md`：要件・決定事項・採用しなかった案・未決事項（U 番号）
- `docs/roadmap.md`：タスク（T 番号）、担当、依存、受入条件、TDD の進め方
- `docs/design/mock/*.dc.html`：画面の最終形。読むのは自由だが変更しない。`Matrix.dc.html` は不採用の旧案。各画面右上の「見え方の確認」はモック専用で、本番には作らない。読み方は `docs/design/mock/README.md`
- `docs/plan-v1.md`：v1（締め切り 2026-10-18 12:00）までの PR・時間割・切り捨て候補
- `docs/research/import-and-master.md`：取り込み形式（制空権シミュ形式）と艦船マスタ（api_start2）の調査結果
- U1〜U24 は 2026-10-16 にすべて決定した（`docs/requirements.md` 13.1）。新しい論点は勝手に決めず、親に戻す

## 技術構成（決定）
Next.js 16（App Router、静的書き出し `output: "export"`）＋ TypeScript 6（strict）／Cloudflare Pages／Supabase（DB・Auth〔管理者が発行する ID とパスワード。U3〕・Realtime。管理者・協力者だけが使う）／Dexie.js（IndexedDB）／dnd-kit／TanStack Virtual／Radix UI（見た目を持たない部品）／Zustand／CSS Modules ＋ CSS 変数／modern-screenshot ＋ Clipboard API／Vitest・Testing Library・fake-indexeddb・Playwright（Chromium）／GitHub Actions。依存の追加・版の変更は親だけが行う。必要なら理由を添えて親に相談する。
- 版の事情：TypeScript は typescript-eslint の対応範囲のため 6.0 系に固定（`~6.0.3`）。jsdom は Node 22.18 で動く 29 系。ESLint は 10 系（eslint-config-next 16.4 が対応。peer の警告は出るが `npm ci` は通る）。Node は `^22.13.0 || ^24.0.0 || >=26.0.0`（ESLint・jsdom・Vitest の対応範囲の重なり）。
- ESLint 10 で動かないルールがあるため、次は有効にしない：`react/jsx-filename-extension`、`react/forward-ref-uses-ref`、`import/no-default-export`・`import/no-named-export`・`import/unambiguous`（ESLint 10 にない context の API を使う）。

## ディレクトリ構成（作成済み：`src/app/`・`src/styles/`・`src/test/`・`e2e/`・`.github/workflows/`。ほかは予定）
```
src/app/          画面（App Router）
src/components/   共通部品（左メニュー、艦カード、ウィンドウ）
src/features/     画面ごとの部品と状態（割り振り、取り込み、差分、定義など）
src/domain/       型と純粋な関数（特効計算、取り込み解析、差分、定義の編集・マージ）
src/lib/          外部との境界（Dexie、Supabase、クリップボード）
src/styles/       theme.css（CSS 変数。`<html data-theme="dark|light">`、なければ端末の設定）、globals.css
src/test/         Vitest の共通の準備（jest-dom、fake-indexeddb、cleanup）。単体テストは対象の隣の *.test.ts(x)
public/data/      最新イベントの公開定義 JSON・艦船マスタ（ビルド時に生成）
scripts/          ビルド時の取得・生成
supabase/migrations/  SQL マイグレーション
e2e/              Playwright
.github/workflows/  CI（ci.yml）
```

## コマンド（npm、Node 22）
- 開発サーバー：`npm run dev`（艦船マスタがなければ、先に predev で生成する。あれば使い回す。最新にするなら `npm run generate:ship-master`）
- 型チェック：`npm run typecheck`（`next typegen && tsc --noEmit`。next-env.d.ts は追跡しないため先に型を生成する）
- Lint：`npm run lint`
- 単体テスト：`npm test`（Vitest）
- 画面テスト：`npm run test:e2e`（Playwright。静的書き出しをビルドして serve で配信し、それに対して実行する）。初めて手元で動かすときは先に `npx playwright install chromium`。ポートはワークツリーごとに自動で変わる（`E2E_PORT` で上書きできる）ので、複数のワークツリーで同時に実行してよい。接続先の環境変数（URL とキー）なしで実行すると協力者・管理者のテスト（e2e/permissions.spec.ts）は飛ばされるので、手元でも動かすときは CI と同じダミーの接続先を付ける（例：`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dummy npm run test:e2e`。通信はテストの偽物が受ける）
- ビルド：`npm run build`（`out/` に静的書き出し。直前の prebuild で、艦船マスタ `public/data/ship-master.json` を Tibowl/api_start2 から生成し〔通信が必要。生成物はコミットしない〕、続けて最新イベントの公開定義 `public/data/latest-definition.json` を取得する〔`FETCH_LATEST_DEFINITION=1` のときだけ〕）。Cloudflare Pages のビルドコマンドも `npm run build`（`npx next build` にするとマスタの生成も公開定義の取得もされない）
- 艦船マスタの生成：`npm run generate:ship-master`。通信できないときに既存のファイルを使い回すなら `SKIP_SHIP_MASTER=1` を付ける（CI・Cloudflare Pages では付けない）。`npm run build` と `npm run test:e2e` も通信が必要
- 公開定義の取得：`npm run fetch:latest-definition`（処理は `src/lib/definition/generateLatestDefinition.ts`、取得するかの判断は `decideDefinitionFetch.ts`。`docs/design/database.md` 6 章）。環境変数 `FETCH_LATEST_DEFINITION` は未設定・`0`・`1` だけを認める。`1` のときだけ、`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` で Supabase から最新イベントの公開版を読み、検証して書き出す（最新のイベントが決まっていなければファイルを消す。取得・検証に失敗したら終了コード 1 でビルドを止める）。未設定・`0`（手元・CI）は取得を飛ばし、追跡しているテスト用の定義をそのまま使う。それ以外の値と、Cloudflare Pages の本番のビルド（`CF_PAGES=1` かつ `CF_PAGES_BRANCH=release`）で `1` でないときは、終了コード 1 でビルドを止める。本番（Cloudflare Pages の Production）の環境変数に `FETCH_LATEST_DEFINITION=1` を足すのはユーザーのアカウント操作。手元で `1` を付けて実行するとテスト用の定義を書き換える（消す）ので、確かめた後は `git restore public/data/latest-definition.json` で戻す。tsx は `.env*` を読まないので、環境変数はシェルで渡す
- DB：Supabase CLI のマイグレーション（`supabase/migrations/`。手元に Docker がないため、DB のテストは CI で動かす）

## このプロジェクト固有の注意
- 一般利用者が貼り付けた艦娘データと札割りは、ブラウザ内（IndexedDB）だけで扱い、サーバーに送らない。一般利用者の画面から Supabase に接続しない。
- 一般向けに配信する静的ファイルは「最新イベントの公開定義 JSON」1 つだけ。札割りできるのは最新のイベントだけで、イベントを選ぶ欄は作らない。
- 権限（一般／協力者／管理者）は Supabase の RLS で強制する。画面で隠すだけにしない。サーバー専用のキーや秘密の値を画面側のコードやリポジトリに置かない。
- 倍率・海域・段階・札は画面に固定で書かず、イベント定義から組み立てる。
- 同名艦は別の個体として扱う。「サブ」の表記は出さず、Lv と運で見分ける。
- ゲームの画像を自前で配信しない。他サイトの文言や配置を丸写ししない。
- UI ライブラリの既製の見た目を使わない（Radix UI は見た目なしの部品だけ）。色はモックの値を CSS 変数にして使い、ダーク／ライトを切り替えられるようにする。
- 取り下げた機能（おすすめ、他札が有利、決めかねリスト、必要隻数の枠、おまかせ案、鍵、札なしの特効艦、履歴メニューなど。`docs/requirements.md` 12 章）は、ユーザーの指示なしに復活させない。
- 計算・解析・マージは `src/domain/` の純粋な関数にし、単体テストで確かめる。
- IndexedDB の保存の形を変えるときは、Dexie のバージョン移行を入れる。DB を壊す変更は「足す → 切り替え → 消す」に分ける。
- Supabase の無料プランは約 7 日アクセスがないと停止する。マイグレーションや定義 JSON の取得が失敗したら、停止していないかを先に確かめる（再開はユーザーが行う）。
- 本番ブランチは `release`（Cloudflare Pages のビルド回数を節約するため。D2）。PR は main にマージし、main → release の取り込みは区切りのよいところで親が PR を作って行う。main へのマージはそのまま本番には出ない。
