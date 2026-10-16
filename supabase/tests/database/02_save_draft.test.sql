-- save_draft（共有の下書きの保存と版の衝突）
-- 設計：docs/design/database.md の 4.2（save_draft）と「更新できるイベント」、4.1（例外のコード）
-- roadmap T3-3：協力者は最新・未終了のイベントの下書きだけを更新できる／開いたときと版が違う保存は拒否される／
--               外された協力者はすぐに更新できなくなる
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

-- ---------------------------------------------------------------------------
-- 補助（pg_temp に作るので rollback で消える）
-- ---------------------------------------------------------------------------
-- 演じ分け
create function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.act_as_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

-- authenticated の役だが sub（ログインした人の ID）がない
create function pg_temp.act_as_no_sub() returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
end;
$$;

-- RPC の戻り値を覚えておいた値（lives_ok の中で set_config しておく。失敗して値がなければ null）
create function pg_temp.got(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('fd_test.' || p_name, true), '')
$$;

-- 定義の文書（公開定義 JSON と同じ形）。段階名で中身を見分ける
create function pg_temp.doc(p_stage_name text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'event', jsonb_build_object(
      'id', 'draft-copy', 'name', '下書きの写し',
      'startAt', '2000-01-01T00:00:00+09:00', 'endAt', null, 'versionDate', '2000-01-01'),
    'areas', jsonb_build_array(jsonb_build_object('id', 'area-1', 'name', 'E1')),
    'fudas', jsonb_build_array(
      jsonb_build_object('id', 'fuda-1', 'name', '札A', 'color', '#3366cc', 'gameNumber', 1)),
    'stages', jsonb_build_array(jsonb_build_object(
      'id', 'stage-1', 'areaId', 'area-1', 'name', p_stage_name, 'fudaId', 'fuda-1',
      'importance', 'normal', 'boosts', jsonb_build_array()))
  )
$$;

grant execute on function
  pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.act_as_no_sub(),
  pg_temp.got(text), pg_temp.doc(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、協力者 3333…（途中で外す）、権限なしのログイン利用者 4444…
--   イベント …01：最新・公開済み・未終了（下書きの版 3）
--            …02：未公開・最新でない（下書きの版 1）
--            …03：公開済み・最新でない・未終了（下書きの版 1）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'save-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'save-collab@example.test', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'save-collab2@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'save-outsider@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab'),
  ('33333333-3333-4333-8333-333333333333', '協力者テスト2', 'collab');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
   now() - interval '10 days', now() + interval '30 days', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '未公開の新しいイベント',
   now() + interval '20 days', null, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '古いイベント',
   now() - interval '100 days', null, '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by, updated_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 3, pg_temp.doc('最初の内容'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 1, pg_temp.doc('新しいイベントの内容'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 1, pg_temp.doc('古いイベントの内容'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 day');

insert into public.published_definitions (event_id, version_label, content, draft_version, published_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026/10/01 版', pg_temp.doc('最初の内容'), 3,
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '2026/06/01 版', pg_temp.doc('古いイベントの内容'), 1,
   '11111111-1111-4111-8111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. 版が同じなら保存される（協力者・最新のイベント）（11 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select set_config('fd_test.saved', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 3,
       pg_temp.doc('協力者の内容'),
       '[{"mapLabel": "E2", "summary": "E2 ゲージ3 の大事さを「難所」→「重要」"},
         {"mapLabel": null, "summary": "札「札B」を追加"}]'::jsonb
     )::text, true) $$,
  '協力者は最新のイベントの下書きを、開いたときと同じ版なら保存できる'
);

reset role;

select is(pg_temp.got('saved')::jsonb ->> 'status', 'saved', '保存できたときは status が saved');
select is((pg_temp.got('saved')::jsonb ->> 'version')::integer, 4, '保存できたときは新しい版（元の版 + 1）を返す');
select is(
  (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  4,
  '保存すると下書きの版が 1 増える'
);
select is(
  (select content from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  pg_temp.doc('協力者の内容'),
  '保存すると下書きの内容が渡した文書になる'
);
select is(
  (select updated_by from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  '保存すると下書きの保存した人が呼んだ人になる'
);
select ok(
  (select updated_at from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001')
    > now() - interval '1 hour',
  '保存すると下書きの保存日時が今になる'
);
select is(
  (select count(*) from public.save_logs
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000001' and kind = 'save'),
  2::bigint,
  '保存の記録が p_logs の件数（2 件）だけ入る'
);
select results_eq(
  $$ select user_id, user_name, map_label, summary
     from public.save_logs
     where event_id = 'aaaaaaaa-0000-4000-8000-000000000001' and kind = 'save'
     order by id $$,
  $$ values
       ('22222222-2222-4222-8222-222222222222'::uuid, '協力者テスト'::text, 'E2'::text,
        'E2 ゲージ3 の大事さを「難所」→「重要」'::text),
       ('22222222-2222-4222-8222-222222222222'::uuid, '協力者テスト'::text, null::text,
        '札「札B」を追加'::text) $$,
  '保存の記録には、保存した人の ID・表示名・海域・文が p_logs の順に入る'
);
select is(
  (select last_edited_note from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  '下書きを保存',
  '保存した人の「最後に定義を編集」の文が「下書きを保存」になる'
);
select ok(
  (select last_edited_at from public.profiles where user_id = '22222222-2222-4222-8222-222222222222')
    > now() - interval '1 hour',
  '保存した人の「最後に定義を編集」の日時が今になる'
);

-- ---------------------------------------------------------------------------
-- 2. 版が違えば保存されず、今の版・内容・保存した人を返す（9 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select lives_ok(
  $$ select set_config('fd_test.conflict', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 3,
       pg_temp.doc('協力者2の内容'),
       '[{"mapLabel": "E1", "summary": "衝突する保存"}]'::jsonb
     )::text, true) $$,
  '開いたときと版が違う保存は、エラーにせず衝突の結果を返す'
);

reset role;

select is(pg_temp.got('conflict')::jsonb ->> 'status', 'conflict', '版が違うときは status が conflict');
select is((pg_temp.got('conflict')::jsonb ->> 'version')::integer, 4, '版が違うときは今の版を返す');
select is(pg_temp.got('conflict')::jsonb -> 'content', pg_temp.doc('協力者の内容'), '版が違うときは今の下書きの内容を返す');
select is(
  pg_temp.got('conflict')::jsonb ->> 'updatedByName',
  '協力者テスト',
  '版が違うときは最後に保存した人の表示名（updatedByName）を返す'
);
select ok(
  abs(extract(epoch from (
    (pg_temp.got('conflict')::jsonb ->> 'updatedAt')::timestamptz
    - (select updated_at from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001')
  ))) < 1,
  '版が違うときは最後に保存した日時（updatedAt）を返す'
);
select is(
  (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  4,
  '版が違う保存では下書きの版が変わらない'
);
select is(
  (select content from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  pg_temp.doc('協力者の内容'),
  '版が違う保存では下書きの内容が変わらない'
);
select is(
  (select count(*) from public.save_logs where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2::bigint,
  '版が違う保存では保存の記録が増えない'
);

-- ---------------------------------------------------------------------------
-- 3. 最後に保存した人が外されていれば、衝突の結果の表示名は「不明」（2 件）
--    （profiles に行がない人 4444… が保存したことにする）
-- ---------------------------------------------------------------------------
update public.drafts
set updated_by = '44444444-4444-4444-8444-444444444444'
where event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.conflict_unknown', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 3, pg_temp.doc('管理者の内容'), '[]'::jsonb
     )::text, true) $$,
  '管理者も版が違う保存では衝突の結果を受け取る'
);

reset role;

select is(
  pg_temp.got('conflict_unknown')::jsonb ->> 'updatedByName',
  '不明',
  '最後に保存した人が外されていれば updatedByName は「不明」'
);

-- ---------------------------------------------------------------------------
-- 4. 記録が空の配列でも保存できる（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select set_config('fd_test.saved_no_logs', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 4, pg_temp.doc('記録なしの内容'), '[]'::jsonb
     )::text, true) $$,
  '記録（p_logs）が空の配列でも保存できる'
);

reset role;

select is((pg_temp.got('saved_no_logs')::jsonb ->> 'version')::integer, 5, '記録が空でも版は 1 増える');
select is(
  (select count(*) from public.save_logs where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2::bigint,
  '記録が空の配列なら保存の記録は増えない'
);

-- ---------------------------------------------------------------------------
-- 5. 更新できるイベント（6 件）
--    管理者：最新と未公開のイベント。協力者：最新のイベントだけ
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.saved_new_event', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000002', 1, pg_temp.doc('管理者が新しいイベントを編集'), '[]'::jsonb
     )::text, true) $$,
  '管理者は未公開の新しいイベント（最新でない）の下書きを保存できる'
);
select is(pg_temp.got('saved_new_event')::jsonb ->> 'status', 'saved', '管理者の未公開のイベントの保存は status が saved');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000003', 1, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD003', null,
  '管理者でも、最新でも未公開でもない古いイベントの下書きは保存できない（FD003）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-0000000000ff', 1, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD009', null,
  'ないイベントの下書きは保存できない（FD009）'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000002', 2, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD003', null,
  '協力者は未公開の新しいイベント（最新でない）の下書きを保存できない（FD003）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000003', 1, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD003', null,
  '協力者は最新でない古いイベントの下書きを保存できない（FD003）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 6. 権限がない人（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD001', null,
  '権限なしのログイン利用者は下書きを保存できない（FD001）'
);

select pg_temp.act_as_no_sub();

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD001', null,
  'ログインした人の ID（sub）がなければ下書きを保存できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5,
       '{"schemaVersion": 1}'::jsonb, '[]'::jsonb) $$,
  '42501', null,
  'anon は save_draft を実行できない（実行権限なし）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 7. 入力が不正（FD005）。版は今の版（5）に合わせ、ほかの理由で失敗しないようにする（8 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, '[]'::jsonb, '[]'::jsonb) $$,
  'FD005', null,
  '文書が配列（オブジェクトでない）なら保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, '"文字列"'::jsonb, '[]'::jsonb) $$,
  'FD005', null,
  '文書が文字列（オブジェクトでない）なら保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, null, '[]'::jsonb) $$,
  'FD005', null,
  '文書が null なら保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5,
       pg_temp.doc('x') || '{"schemaVersion": 2}'::jsonb, '[]'::jsonb) $$,
  'FD005', null,
  'schemaVersion が 2 なら保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5,
       pg_temp.doc('x') - 'schemaVersion', '[]'::jsonb) $$,
  'FD005', null,
  'schemaVersion がなければ保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5,
       pg_temp.doc('x'), '{"mapLabel": "E1", "summary": "配列でない"}'::jsonb) $$,
  'FD005', null,
  '記録（p_logs）が配列でなければ保存できない（FD005）'
);
select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 5, pg_temp.doc('x'), null) $$,
  'FD005', null,
  '記録（p_logs）が null なら保存できない（FD005）'
);

reset role;

select is(
  (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  5,
  '入力が不正な保存では下書きの版が変わらない'
);

-- ---------------------------------------------------------------------------
-- 8. 開始前でも、最新なら協力者は保存できる（U18）（2 件）
-- ---------------------------------------------------------------------------
update public.events
set starts_at = now() + interval '1 day', ends_at = now() + interval '30 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select set_config('fd_test.saved_before_start', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 5, pg_temp.doc('開始前の内容'), '[]'::jsonb
     )::text, true) $$,
  '開始前のイベントでも、最新なら協力者は下書きを保存できる（U18）'
);

reset role;

select is((pg_temp.got('saved_before_start')::jsonb ->> 'version')::integer, 6, '開始前の保存でも版が 1 増える');

-- ---------------------------------------------------------------------------
-- 9. 外された協力者はすぐに保存できなくなる（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select lives_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 6, pg_temp.doc('外す前の内容'), '[]'::jsonb) $$,
  '外す前の協力者は下書きを保存できる'
);

reset role;

-- 協力者を外す＝profiles の行を消す（設計 2.1）
delete from public.profiles where user_id = '33333333-3333-4333-8333-333333333333';

select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 7, pg_temp.doc('外した後の内容'), '[]'::jsonb) $$,
  'FD001', null,
  '外された協力者は、直後の保存で拒否される（FD001）'
);

reset role;

select is(
  (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  7,
  '外された協力者の保存では下書きの版が変わらない'
);

-- ---------------------------------------------------------------------------
-- 10. 終了したイベントは保存できない（FD002）（2 件）
-- ---------------------------------------------------------------------------
update public.events
set starts_at = now() - interval '2 days', ends_at = now() - interval '1 hour'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 7, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD002', null,
  '協力者は終了したイベント（最新）の下書きを保存できない（FD002）'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 7, pg_temp.doc('x'), '[]'::jsonb) $$,
  'FD002', null,
  '管理者も終了したイベントの下書きを保存できない（FD002）'
);

reset role;

select * from finish();
rollback;
