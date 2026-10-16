# DB 設計（Supabase / Postgres）

roadmap の T3-2。要件は `docs/requirements.md`（特に 2.3 権限、3.7 イベント定義、3.8 協力者、5 データの流れ、13.1 決定事項）。作成：2026-10-16 親。

**定義の文書**（`drafts.content`・`published_definitions.content` の jsonb）は、PR-02 の型 `PublicDefinition`（`src/domain/definition/types.ts`）と同じ形にする：`{ schemaVersion: 1, event: { id, name, startAt, endAt, versionDate }, areas: [{ id, name }], fudas: [{ id, name, color, gameNumber }], stages: [{ id, areaId, name, fudaId, importance, boosts: [{ id, name, multiplier, shipNames }] }] }`。並び順は配列の順。
- イベントの名前・開始日時・終了日時の正は `events` 表。下書きの `content.event` は表示用の写しで、`publish_definition` が公開するときに `events` 表の値と版の日付（`versionDate`）で書き直してから公開版に保存する。
- 画面は保存・公開の前に `validatePublicDefinition` で検証する。DB 側では `schemaVersion = 1` とオブジェクトであることだけを確かめる。

## 1. 方針

- **DB を使うのは管理者・協力者だけ**。一般利用者の画面は Supabase に通信しない（静的 JSON とブラウザ内保存）。
- **定義の中身（海域・段階・札・特効グループ）は、テーブルに分けず JSON 文書（jsonb）として持つ**。
  - 理由：共有の下書きの 3 方向マージを画面側で文書単位に行う（B 案）、公開版をそのまま静的 JSON に書き出す、締め切りまでの作業量を減らす。
  - 文書の形は公開定義 JSON の型（`src/domain/definition/`）と同じにし、画面側で検証してから保存する。DB 側では最低限の形（オブジェクトであること、版の整合）だけを確かめる。
- **表への書き込みは、すべて RPC（`security definer` の Postgres 関数）を通す**。表には直接の INSERT／UPDATE／DELETE の権限を与えない。RPC の中で、呼び出した人の権限と業務の制限（最新・未終了のイベントだけ、など）を確かめる。読み取りは RLS で権限ごとに絞る。
- 日時は `timestamptz` で持ち、画面では日本時間で表示する。

## 2. 表

### 2.1 `profiles`（管理者・協力者）
| 列 | 型 | 説明 |
|---|---|---|
| user_id | uuid PK（auth.users.id） | |
| display_name | text not null | Discord の表示名（ログイン時に更新） |
| role | text not null check (role in ('admin','collab')) | |
| created_at | timestamptz not null default now() | 追加した日 |
| last_edited_at | timestamptz | 最後に定義を編集した日時（下書きの保存・公開で更新） |
| last_edited_note | text | 例「特効を更新」 |

- 行がない人＝一般利用者（ログインしていても権限なし）。
- 協力者を外す＝行を削除する（これまでの編集の記録は `save_logs` に残る。名前は記録側に複写しておく）。
- 最初の管理者は、本番で一度 Discord でログインしたあと、SQL で行を入れる（運用手順書）。

### 2.2 `events`（イベント）
| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| name | text not null | 例「2026夏イベ」 |
| starts_at | timestamptz not null | 開始日時（分まで） |
| ends_at | timestamptz | 終了日時（任意。null は未定） |
| created_by | uuid not null | |
| created_at | timestamptz not null default now() | |

- **終了**＝`ends_at` が null でなく、`ends_at <= now()`。終了したイベントは RPC で更新を拒否する。

### 2.3 `app_state`（1 行だけ）
| 列 | 型 | 説明 |
|---|---|---|
| id | boolean PK default true check (id) | 1 行に限る |
| latest_event_id | uuid references events | 最新＝最後に「公開して最新にした」イベント（U18） |

### 2.4 `drafts`（共有の下書き。イベントごとに 1 つ）
| 列 | 型 | 説明 |
|---|---|---|
| event_id | uuid PK references events on delete cascade | |
| version | integer not null default 1 | 保存のたびに 1 増える（衝突の確認に使う） |
| content | jsonb not null | 定義の文書（公開定義 JSON と同じ形） |
| updated_by | uuid not null | |
| updated_at | timestamptz not null default now() | |

### 2.5 `published_definitions`（公開版）
| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | |
| event_id | uuid not null references events | |
| version_label | text not null | 版の日付の表示（例「2026/08/04 版」） |
| content | jsonb not null | 公開した時点の定義の文書（イベント名・期間も含めて書き出す） |
| draft_version | integer not null | 公開したときの下書きの版 |
| published_by | uuid not null | |
| published_at | timestamptz not null default now() | |

- 一般向けの静的 JSON は「`app_state.latest_event_id` のイベントの、最新の `published_definitions`」1 つ。

### 2.6 `save_logs`（保存の記録）
| 列 | 型 | 説明 |
|---|---|---|
| id | bigint PK generated always as identity | |
| event_id | uuid not null references events | |
| user_id | uuid | 外された人でも残すため FK にしない |
| user_name | text not null | 記録した時点の表示名 |
| kind | text not null check (kind in ('save','publish')) | 下書き保存／公開 |
| map_label | text | 絞り込み用の海域（例「E2」）。公開は null |
| summary | text not null | 例「E2 ゲージ3 の大事さを「難所」→「重要」」 |
| created_at | timestamptz not null default now() | |

- 記録の文は、保存時の差分から画面側で作って RPC に渡す（要件 3.7 の【提案】）。
- 「保存の記録を見る」は新しい順に 8 件ずつ取る（`created_at desc, id desc` のカーソル）。

### 2.7 `invites`（招待）
| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | |
| code_hash | text not null unique | 招待コードの SHA-256（コード自体は保存しない） |
| created_by | uuid not null | |
| expires_at | timestamptz not null | 発行から 24 時間／3 日／7 日 |
| used_by | uuid | |
| used_at | timestamptz | |
| revoked_at | timestamptz | |
| created_at | timestamptz not null default now() | |

- 「招待中」＝ `used_at is null and revoked_at is null and expires_at > now()`。

## 3. RLS（読み取り）

すべての表で RLS を有効にする。書き込みのポリシーは作らない（RPC だけが書く）。

| 表 | anon（未ログイン） | 権限なしのログイン利用者 | 協力者 | 管理者 |
|---|---|---|---|---|
| profiles | × | 自分の行だけ（権限の確認用） | 全行（「編集できる人」の表示） | 全行 |
| events | × | × | 全行 | 全行 |
| app_state | ○（最新イベントの ID） | ○ | ○ | ○ |
| drafts | × | × | 全行 | 全行 |
| published_definitions | ○（公開済みのデータ。ビルド時の取得に使う） | ○ | ○ | ○ |
| save_logs | × | × | 全行 | 全行 |
| invites | × | × | × | 全行 |

- 判定には `public.app_role()`（`profiles` から自分の role を返す `security definer` 関数）を使う。`current_role` は SQL の予約語と重なるため使わない。
- 表の権限：`anon`・`authenticated` には、上の表で読める表の SELECT だけを与える（`auto_expose_new_tables = false` のため、与えないと読めない）。
- ビルド時の取得は anon キーで `app_state` と `published_definitions` を読む。サーバー専用のキー（service_role）はビルドにも画面にも置かない。

## 4. RPC（書き込み）

すべて `security definer`、`set search_path = public`。最初に `app_role()` で権限を確かめ、条件に合わなければ例外を返す。実行の権限は `authenticated` だけに与える（`anon`・`public` からは取り消す）。

### 4.1 例外のコード（SQLSTATE）

画面は supabase-js の `error.code` で出し分ける。`message` は日本語の説明。

| コード | 意味 |
|---|---|
| FD001 | 権限がない（未ログイン、一般利用者、協力者が管理者だけの操作をした、協力者が名前・開始日時を変えようとした） |
| FD002 | イベントが終了している（`ends_at <= now()`） |
| FD003 | 更新できるイベントではない（協力者：最新のイベント以外。管理者：最新でも未公開でもないイベント。最新でないイベントを `p_make_latest = false` で公開しようとした） |
| FD004 | 版が違う（`publish_definition` の `p_base_version` が今の下書きの版と違う） |
| FD005 | 入力が不正（文書がオブジェクトでない・`schemaVersion` が 1 でない、日時の前後、期限の選択肢、記録が配列でない など） |
| FD006 | 招待が使用済み |
| FD007 | 招待の期限切れ |
| FD008 | 招待が取り消し済み |
| FD009 | 見つからない（イベント・招待・協力者） |
| FD010 | 既に権限がある人が招待を受けようとした |
| FD011 | 管理者は外せない（自分自身も） |

### 4.2 関数

| 関数 | 呼べる人 | 内容と戻り値 |
|---|---|---|
| `app_role() returns text` | だれでも（anon も） | 自分の `profiles.role`（'admin'／'collab'）。行がない・未ログインなら null。RLS の判定に使う |
| `save_draft(p_event_id uuid, p_base_version integer, p_content jsonb, p_logs jsonb) returns jsonb` | 協力者・管理者 | `p_base_version` が今の版と同じなら `content` を保存して版を 1 増やし、`p_logs`（`[{ "mapLabel": "E2" または null, "summary": "…" }]`。空の配列も可）を 1 件ずつ `save_logs`（kind 'save'）に入れ、`{ "status": "saved", "version": 新しい版 }` を返す。違えば保存せず `{ "status": "conflict", "version": 今の版, "content": 今の内容, "updatedByName": 保存した人の表示名（外された人なら "不明"）, "updatedAt": 日時 }` を返す（画面で 3 方向マージする）。終了 → FD002、更新できない → FD003、文書の形 → FD005 |
| `publish_definition(p_event_id uuid, p_base_version integer, p_make_latest boolean) returns jsonb` | 協力者・管理者（`p_make_latest = true` は管理者だけ。協力者なら FD001） | 下書きの版が `p_base_version` と同じなら、下書きの `content` の `event` を `events` 表の値で書き直して（`id`＝イベント ID の文字列、`name`、`startAt`・`endAt`＝日本時間の "YYYY-MM-DDTHH:MI:SS+09:00"（未定は null）、`versionDate`＝公開した日の日本時間の "YYYY-MM-DD"）`published_definitions` に保存し（`version_label`＝"YYYY/MM/DD 版"）、記録（kind 'publish'、`map_label` は null、文「公開（YYYY/MM/DD 版）」）を入れる。`p_make_latest` なら `app_state.latest_event_id` を切り替える。戻り値 `{ "status": "published", "id": 公開版の ID, "versionLabel": "…", "versionDate": "YYYY-MM-DD" }`。版が違う → FD004、終了 → FD002、最新でないのに `p_make_latest = false` → FD003 |
| `create_event(p_name text, p_starts_at timestamptz, p_ends_at timestamptz, p_content jsonb) returns uuid` | 管理者 | イベントと下書き（版 1、`content` は `p_content`）を作り、イベント ID を返す。初期の文書（元にするイベントからのコピー・E1 だけの空の文書）は画面が `createDefinition`（PR-09）で作る。名前が空・`p_ends_at <= p_starts_at`・文書の形 → FD005 |
| `update_event_meta(p_event_id uuid, p_name text, p_starts_at timestamptz, p_ends_at timestamptz) returns void` | 協力者（終了日時だけ）・管理者 | 名前・開始日時・終了日時を更新する。終了 → FD002、更新できない → FD003、協力者が名前か開始日時を今と違う値にした → FD001、名前が空・終了日時が開始日時以前・終了日時が今以前（誤ってロックしない） → FD005。終了日時の null（未定）は可 |
| `create_invite(p_expires_in text) returns jsonb` | 管理者 | 招待コード（URL に使える 32 文字。乱数 24 バイトを base64url にしたもの）を作り、SHA-256 の 16 進を `code_hash` に保存して、`{ "id": 招待の ID, "code": コード, "expiresAt": 期限 }` を返す（コードはこのときだけ）。`p_expires_in` は '24 hours'／'3 days'／'7 days' だけ。ほか → FD005 |
| `revoke_invite(p_invite_id uuid) returns void` | 管理者 | 取り消す（取り消し済みならそのまま）。ない → FD009、使用済み → FD006 |
| `accept_invite(p_code text, p_display_name text) returns void` | ログイン済みで権限なしの人 | 招待の行をロックして確かめ、有効なら `profiles` に協力者（表示名 `p_display_name`）として入れ、使用済み（`used_by`・`used_at`）にする。未ログイン → FD001、既に権限がある → FD010、コードが合わない → FD009、取り消し済み → FD008、使用済み → FD006、期限切れ → FD007（この順に確かめる） |
| `remove_collaborator(p_user_id uuid) returns void` | 管理者 | 協力者の行を消す。ない → FD009、相手が管理者（自分を含む） → FD011 |
| `touch_profile(p_display_name text) returns void` | ログイン済み（行がある人） | 表示名を更新する。行がない → FD001 |

- **更新できるイベント**：協力者は `app_state.latest_event_id` のイベントだけ。管理者は、最新のイベントと、まだ公開していない（`published_definitions` に行がない）イベント（U18）。どちらも終了していないこと。
- 保存・公開をしたら、`profiles.last_edited_at` を今に、`last_edited_note` を「下書きを保存」か「公開」にする。
- 新規作成は管理者だけ。

## 5. リアルタイム（編集中の表示）

- 表は使わず、Supabase Realtime の Presence で「イベント ID ごとのチャンネル」に、表示名と表示中の海域を載せる（T3-9）。

## 6. 公開から一般の画面への反映（U7）

1. `publish_definition` が `published_definitions` に行を入れる。
2. Supabase の Database Webhook（`published_definitions` の INSERT）が Cloudflare Pages の Deploy Hook を呼ぶ（アカウント操作 ⑦）。
3. Cloudflare Pages が再ビルドする。ビルドの最初に `scripts/` の取得処理が anon キーで最新イベントの公開版を読み、`public/data/` に静的 JSON を書き出す。
4. Supabase が停止していて取得できないときは、理由を表示してビルドを失敗させる（古い JSON のまま公開しない）。

## 7. テスト（U20）

- CI（GitHub Actions）でローカルの Supabase を起動し、マイグレーションを空の DB に適用してから（`supabase db reset`）、権限ごとの可否を pgTAP で確かめる（`supabase test db`。テストは `supabase/tests/database/*.test.sql`）。ログインした人は `auth.users` にテスト用の行を入れ、`set local role authenticated` と `request.jwt.claims` の `sub` で演じる。
- 確かめること：roadmap T3-3 の受入条件（未ログインは公開版の読み取りだけ、協力者の制限、版の衝突、招待の 1 回限り・期限・取り消し、外された協力者はすぐ更新できない）。
- 手元の PC に Docker がないため、手元では DB のテストを動かさず CI で確かめる。

## 8. 決めたこと（2026-10-17 親）

- DB のテストは pgTAP で書く。
- 招待コードは乱数 24 バイトの base64url（32 文字）。
- 新規作成の初期の文書は画面で作り、`create_event` に渡す（元にするイベントの読み取りは RLS で協力者・管理者に許している）。
- 版の日付は公開した日（日本時間）。画面からは渡さない。
