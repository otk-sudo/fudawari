# 運用手順書（roadmap T4-3）

札割りプランナーを本番で動かすための手順。秘密の値（パスワード、Deploy Hook の URL、DB の接続文字列）は、この文書にも会話にも書かず、各サービスの画面に直接入れる。

## 1. 本番の構成

| 役割 | 置き場所 | 備考 |
|---|---|---|
| 画面（静的書き出し） | Cloudflare Pages（`fudawari.pages.dev`）。本番のブランチは `release`（要件 13.1 の D2） | プレビューのビルドは止めている |
| DB・ログイン・編集中の表示 | Supabase（プロジェクト ID `rmnamozfvmevfyytuhgm`、東京）。管理者・協力者だけが使う | 無料プランは約 7 日アクセスがないと停止する（4 章） |
| CI と本番の DB の更新 | GitHub Actions（`.github/workflows/ci.yml`）。`release` への push で、すべての検査が通った後に `supabase db push` で本番の DB にマイグレーションを適用する（ジョブ「本番の DB へマイグレーションを適用」） | 秘密の値は GitHub の production 環境（`SUPABASE_DB_URL`） |
| 一般向けの公開定義 | ビルドの前（prebuild）に Supabase から最新イベントの公開版を読み、`public/data/latest-definition.json` に書き出す（`docs/design/database.md` 6 章） | Cloudflare の Production の環境変数 `FETCH_LATEST_DEFINITION=1` が必要 |

本番への反映は「main → release のマージ」で行う。release への push はユーザーの許可を得て親が行う（要件 13.1）。

## 2. 最初の本番反映（1 回だけ）

### 2.1 先に済ませるアカウント操作（`docs/plan-v1.md` 6.5）

まず、済んでいるはずの設定を確かめる。

- Cloudflare Pages → 設定 → ビルド → ブランチの制御：本番のブランチが `release` になっている（D2。最初は main で作ったため。2026-10-16 に release に変更済みのはず）。プレビューのビルドは止めたまま。
- ③ GitHub のリポジトリ → Settings → Environments に `production` 環境があり、その秘密の値 `SUPABASE_DB_URL`（本番の DB の接続文字列）が入っている。`release` からだけ読めるように、環境の Deployment branches を `release` に絞る。これがないと 2.2 のマイグレーションの適用が「SUPABASE_DB_URL がありません」で止まる。

そのうえで、次を行う。

1. ④ Supabase の Authentication → Sign In / Providers → Email：有効のまま「Confirm email」を OFF にする。
2. ⑥ Cloudflare Pages → 設定 → 変数とシークレット（Production）：
   - `NEXT_PUBLIC_SUPABASE_URL`（Supabase の Project URL）
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（Supabase の API Keys の publishable key。`sb_publishable_` で始まる公開用のキー。secret key は入れない）
   - `FETCH_LATEST_DEFINITION` = `1`（本番のビルドでこれがないと、テスト用の定義を出さないようビルドが止まる）
3. ⑨ Supabase の Realtime → Settings：「Allow public access」を切る（編集中の表示を管理者・協力者だけにする。画面は private のチャンネルを使う）。

### 2.2 release への反映

1. 親が main を release にマージして push する（ユーザーの許可を得てから）。
2. GitHub Actions が検査の後に本番の DB へマイグレーションを適用する。Actions の画面で「本番の DB へマイグレーションを適用」が成功したことを確かめる。
3. **Cloudflare のビルドとマイグレーションの順番は保証されない。** 初回は特に失敗しやすい。 Cloudflare は push と同時にビルドを始めるため、DB にまだ表がない間に公開定義を読みに行き、「app_state の取得に失敗しました」で止まる。前の版がそのまま公開され続けるので害はない。手順 2 が成功した後に、Cloudflare Pages → デプロイ → 失敗したデプロイの「再試行」（Retry deployment）を押す。
   - 2 回目以降の release でも、Cloudflare は push と同時にビルドするので、新しい画面がマイグレーションより先に公開されうる。DB を変える release は 2.5 の順で出す。
4. 公開されたイベントがまだないので、ビルドは公開定義のファイルを消して成功し、一般の画面は「イベントの定義を読み込めませんでした」の表示になる。最初の管理者がイベントを作って公開すると直る（2.4）。

### 2.3 最初の管理者の登録（⑧）

1. Supabase の Authentication → Users → Add user → Create new user：
   - Email：`（決めた ID）@fudawari.invalid`（ID は英小文字・数字・ハイフンで 3〜32 文字。個人の情報は使わない）
   - Password：決めたパスワード（ユーザーが保管する）
   - 「Auto Confirm User」を ON
2. Supabase の SQL Editor で、次の SQL の ID と表示名を書き換えて実行する（作ったアカウントを管理者にする）。

   ```sql
   insert into public.profiles (user_id, display_name, role)
   select id, '管理者の表示名', 'admin'
   from auth.users
   where email = 'ID@fudawari.invalid';
   ```

3. 本番の画面の「ログイン」で、その ID とパスワードでログインし、左メニューに「定義」「協力者」が出ることを確かめる。
4. 協力者は、管理者が協力者の画面で ID とパスワードを発行する（相手には別の手段で伝える）。

### 2.4 最初のイベントの公開

1. 管理者で定義画面を開き、「新規作成」でイベント名・開始日時・終了日時を入れ、札・段階・特効を作って「下書きを保存」する。
2. 「公開して最新にする」を押す。
3. Deploy Hook と Webhook（⑦、3 章）を設定していれば、数分で Cloudflare が再ビルドし、一般の画面に反映される。設定前なら、Cloudflare Pages → デプロイ → 最新のデプロイの「再試行」で手動で反映する。

### 2.5 DB を変える release の出し方（2 回目以降）

1. マイグレーションは「足す → 切り替え → 消す」に分け、古い画面のままでも動く「足すだけ」の変更を先に作る（CLAUDE.md の方針）。
2. 足すだけのマイグレーションを含む版を main → release で出し、GitHub Actions の「本番の DB へマイグレーションを適用」が成功したことを確かめる。
3. その後に、新しい表・列・RPC を使う画面を含む版を出す。
4. 適用が失敗したら、Supabase の停止（4 章）や秘密の値を確かめて Actions を再実行する。画面が先に出て動かない場合は、5 章のとおり前のコードに戻す。

## 3. 公開の自動反映（⑦ Deploy Hook と Database Webhook。U7）

1. Cloudflare Pages → 設定 → ビルド → デプロイフック → 追加：名前は任意（例 `publish`）、ブランチは `release`。表示された URL は秘密の値なので、どこにも貼らずに次の手順で使う。
2. Supabase の Database → Webhooks → Create a new hook：
   - Table：`public.published_definitions`
   - Events：Insert だけ
   - Type：HTTP Request、Method：POST、URL：手順 1 の URL
3. 管理者で「変更を公開する」を押し、Cloudflare Pages のデプロイの一覧に新しいビルドが出て、数分後に一般の画面に反映されることを確かめる。

## 4. Supabase の停止と再開（Resume）

- 無料プランは約 7 日アクセスがないと停止する。停止すると、管理者・協力者の画面の読み込み、公開の自動反映、本番のビルド（公開定義の取得）、release への push のマイグレーションが失敗する。一般の画面は、最後にビルドした公開定義で動き続ける。
- 失敗の文に「Supabase のプロジェクトが停止していないか確かめてください」が出たら、Supabase のダッシュボードでプロジェクトを開き、「Resume project」（再開）を押す（ユーザーが行う）。再開には数分かかる。
- 再開した後、失敗したものをやり直す：Cloudflare のビルドは「再試行」、GitHub Actions は該当の実行の「Re-run jobs」。

## 5. デプロイの戻し方

- **画面**：Cloudflare Pages → デプロイ → 戻したい過去のデプロイ → 「このデプロイにロールバック」。ビルドはしないので、すぐに切り替わる。
  - 注意：公開定義（`latest-definition.json`）と艦船マスタ（`ship-master.json`）もビルドのときに作られて同じデプロイに入っている。そのデプロイの後に公開した定義や新しい艦は、ロールバックで古いものに戻る。応急の処置として使い、すぐに次の手順で今のデータのまま前のコードを出し直す。
  - 前のコードを今のデータで出し直す：main で問題のコミットを revert（取り消しのコミット）して main → release で出す。ビルドのときに最新の公開定義と艦船マスタを読み直すので、データは新しいままになる。
- **公開定義の誤り**：定義画面で正しい内容に直して「変更を公開する」（公開版は増えるだけで消えない。最新の公開版が使われる）。急ぐときは上の画面のロールバックで前のデプロイに戻してもよい。
- **DB**：マイグレーションは前にだけ進める。戻すときは、元に戻す内容の新しいマイグレーションを足して main → release で出す。本番の DB を手で書き換えない（例外は 7 章の終了日時の延長だけ）。

## 6. 艦船マスタの更新

- 艦船マスタ（`public/data/ship-master.json`）は、ビルドのたびに `scripts/generate-ship-master.ts` が `https://raw.githubusercontent.com/Tibowl/api_start2/master/start2.json` から作る（800 隻未満・必要な項目がないときはビルドを止める）。リポジトリには入れない。
- 新しい艦が実装されたら、Cloudflare Pages の最新のデプロイを「再試行」するだけで最新のマスタになる（公開を押しても同じく再ビルドされる）。
- 取得先が止まっている・形が変わったときはビルドが失敗し、前の版が公開され続ける。`docs/research/import-and-master.md` を見て対応する。

## 7. イベント開始前の確認項目

1. Supabase が停止していない（ダッシュボードで Active。4 章）。
2. 管理者でログインできる。協力者のアカウントを発行済み。
3. 定義画面で新しいイベントを作り、イベント名・開始日時・終了日時（終了日時を過ぎると編集できなくなる）を確かめる。
4. 札・段階・大事さ・特効を入れて「公開して最新にする」を押し、数分後に一般の画面のヘッダーのイベント名と、割り振り・一覧の札が新しいイベントになっていることを確かめる。
5. 攻略中に特効が分かったら、協力者・管理者が定義を直して「変更を公開する」。
6. 終了日時が延びたら、**今の終了日時を過ぎる前に**定義画面で直す。終了日時を過ぎると、管理者でも定義画面から更新できない（U18）。
   - 過ぎてしまった場合は、v1 では管理者が Supabase の SQL Editor で終了日時を直す（U18 で決めた例外。5 章の「本番の DB を手で書き換えない」の唯一の例外）。`update public.events set ends_at = '2026-11-30T12:00:00+09:00' where id = '（イベント ID）';` のように、対象のイベントの ID を確かめてから 1 行だけ直す。直した後は定義画面で終了日時が変わったことを確かめ、「変更を公開する」で一般の画面にも反映する。

## 8. よくある失敗と対処

| 症状 | 原因と対処 |
|---|---|
| Cloudflare のビルドが「公開定義の取得に失敗しました：FETCH_LATEST_DEFINITION が…」で止まる | Production の環境変数 `FETCH_LATEST_DEFINITION` が `1` でない。2.1 の ⑥ を確かめる |
| ビルドが「app_state の取得に失敗しました」で止まる | Supabase の停止（4 章）、または初回でマイグレーションの前（2.2 の 3） |
| ビルドが「…最新のイベント（…）の公開版がありません」で止まる | RLS の設定の誤りかデータの不整合。最近のマイグレーションを確かめる |
| GitHub Actions の「本番の DB へマイグレーションを適用」が失敗する | Supabase の停止、または `SUPABASE_DB_URL` の秘密の値の誤り |
| 定義画面で「ログインし直してください」が出る | セッションの期限切れ。ログインし直す |
| 「編集中」の表示が出ない | ⑨ のあとに画面を開き直したか、ログイン中か、Realtime の設定を確かめる（表示が出ないだけで、保存と衝突の確認は動く） |
