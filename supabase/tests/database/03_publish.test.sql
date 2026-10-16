-- publish_definition（下書きの公開と、最新のイベントの切り替え）
-- 設計：docs/design/database.md の 4.2（publish_definition）と「更新できるイベント」、4.1（例外のコード）
--   公開版の content.event は events 表の値で書き直す：id＝イベント ID の文字列、name、
--   startAt・endAt＝日本時間の "YYYY-MM-DDTHH:MI:SS+09:00"（未定は null）、versionDate＝公開した日の日本時間の "YYYY-MM-DD"
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

-- ---------------------------------------------------------------------------
-- 補助（pg_temp に作るので rollback で消える）
-- ---------------------------------------------------------------------------
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

create function pg_temp.got(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('fd_test.' || p_name, true), '')
$$;

-- 今日（公開した日）の日本時間の日付
create function pg_temp.today_jst(p_format text) returns text
language sql stable as $$
  select to_char(now() at time zone 'Asia/Tokyo', p_format)
$$;

-- 下書きの文書。event は古い写し（公開時に events 表の値で書き直されることを確かめる）
create function pg_temp.doc(p_stage_name text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'event', jsonb_build_object(
      'id', 'stale-id', 'name', '古い写しの名前',
      'startAt', '2000-01-01T00:00:00+09:00', 'endAt', null, 'versionDate', '2000-01-01'),
    'areas', jsonb_build_array(jsonb_build_object('id', 'area-1', 'name', 'E1')),
    'fudas', jsonb_build_array(
      jsonb_build_object('id', 'fuda-1', 'name', '札A', 'color', '#3366cc', 'gameNumber', 1)),
    'stages', jsonb_build_array(jsonb_build_object(
      'id', 'stage-1', 'areaId', 'area-1', 'name', p_stage_name, 'fudaId', 'fuda-1',
      'importance', 'hard',
      'boosts', jsonb_build_array(jsonb_build_object(
        'id', 'boost-1', 'name', '連合艦隊C', 'multiplier', 1.27, 'shipNames', jsonb_build_array('時雨')))))
  )
$$;

grant execute on function
  pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.got(text), pg_temp.today_jst(text), pg_temp.doc(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、権限なしのログイン利用者 4444…
--   イベント …01：最新・公開済み・未終了（下書きの版 3）。開始・終了は日本時間への変換を確かめる固定の日時
--            …02：未公開・最新でない・終了日時は未定（下書きの版 1）
--            …03：公開済み・最新でない・未終了（下書きの版 2）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'pub-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'pub-collab@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'pub-outsider@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  -- 開始 2026-01-02 03:04 UTC ＝ 2026-01-02 12:04 JST、終了 2099-12-31 18:30 UTC ＝ 2100-01-01 03:30 JST（日付をまたぐ）
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026秋イベ（公開テスト）',
   '2026-01-02 03:04:00+00', '2099-12-31 18:30:00+00', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '2027冬イベ（未公開）',
   '2026-02-01 00:00:00+09', null, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '古いイベント',
   '2025-01-01 00:00:00+09', null, '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 3, pg_temp.doc('最新のイベントの段階'),
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 1, pg_temp.doc('新しいイベントの段階'),
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 2, pg_temp.doc('古いイベントの段階'),
   '11111111-1111-4111-8111-111111111111');

insert into public.published_definitions (event_id, version_label, content, draft_version, published_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026/10/01 版', pg_temp.doc('最新のイベントの段階'), 2,
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '2025/06/01 版', pg_temp.doc('古いイベントの段階'), 2,
   '11111111-1111-4111-8111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. 協力者が最新のイベントを公開する（最新は切り替えない）（18 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select set_config('fd_test.pub', public.publish_definition(
       'aaaaaaaa-0000-4000-8000-000000000001', 3, false
     )::text, true) $$,
  '協力者は最新のイベントを、下書きと同じ版なら公開できる'
);

reset role;

-- 戻り値
select is(pg_temp.got('pub')::jsonb ->> 'status', 'published', '公開できたときは status が published');
select is(
  pg_temp.got('pub')::jsonb ->> 'versionDate',
  pg_temp.today_jst('YYYY-MM-DD'),
  '戻り値の versionDate は公開した日（日本時間）の YYYY-MM-DD'
);
select is(
  pg_temp.got('pub')::jsonb ->> 'versionLabel',
  pg_temp.today_jst('YYYY/MM/DD') || ' 版',
  '戻り値の versionLabel は「YYYY/MM/DD 版」'
);

-- 公開版の行（戻り値の id で探す）
select is(
  (select event_id from public.published_definitions where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '戻り値の id の公開版の行ができ、イベントが公開したイベントになる'
);
select is(
  (select draft_version from public.published_definitions where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  3,
  '公開版の draft_version は公開したときの下書きの版'
);
select is(
  (select published_by from public.published_definitions where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  '22222222-2222-4222-8222-222222222222'::uuid,
  '公開版の published_by は公開した人'
);
select is(
  (select version_label from public.published_definitions where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  pg_temp.today_jst('YYYY/MM/DD') || ' 版',
  '公開版の version_label は「YYYY/MM/DD 版」'
);

-- 公開版の content.event は events 表の値で書き直される
select is(
  (select content -> 'event' ->> 'id' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  'aaaaaaaa-0000-4000-8000-000000000001',
  '公開版の content.event.id はイベント ID の文字列'
);
select is(
  (select content -> 'event' ->> 'name' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  '2026秋イベ（公開テスト）',
  '公開版の content.event.name は events 表の名前'
);
select is(
  (select content -> 'event' ->> 'startAt' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  '2026-01-02T12:04:00+09:00',
  '公開版の content.event.startAt は events 表の開始日時を日本時間にしたもの'
);
select is(
  (select content -> 'event' ->> 'endAt' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  '2100-01-01T03:30:00+09:00',
  '公開版の content.event.endAt は events 表の終了日時を日本時間にしたもの（日付をまたぐ）'
);
select is(
  (select content -> 'event' ->> 'versionDate' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  pg_temp.today_jst('YYYY-MM-DD'),
  '公開版の content.event.versionDate は公開した日（日本時間）'
);
select is(
  (select content - 'event' from public.published_definitions
   where id = (pg_temp.got('pub')::jsonb ->> 'id')::uuid),
  (select content - 'event' from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '公開版の content の event 以外（海域・札・段階など）は下書きのまま'
);

-- 記録・最新・編集した人・下書き
select results_eq(
  $$ select user_id, user_name, map_label, summary
     from public.save_logs
     where event_id = 'aaaaaaaa-0000-4000-8000-000000000001' and kind = 'publish' $$,
  $$ values ('22222222-2222-4222-8222-222222222222'::uuid, '協力者テスト'::text, null::text,
             '公開（' || to_char(now() at time zone 'Asia/Tokyo', 'YYYY/MM/DD') || ' 版）') $$,
  '公開の記録（kind publish）が 1 件入る（海域は null、文は「公開（YYYY/MM/DD 版）」）'
);
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'p_make_latest = false の公開では最新のイベントは変わらない'
);
select is(
  (select last_edited_note from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  '公開',
  '公開した人の「最後に定義を編集」の文が「公開」になる'
);
select is(
  (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  3,
  '公開しても下書きの版は変わらない（編集中のほかの人の保存を衝突させない）'
);

-- ---------------------------------------------------------------------------
-- 2. 版が違えば公開できない（FD004）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 2, false) $$,
  'FD004', null,
  '下書きの版が p_base_version と違えば公開できない（FD004）'
);

reset role;

select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  2::bigint,
  '版が違う公開では公開版の行が増えない（はじめからある 1 件と、1. の公開の 1 件のまま）'
);

-- ---------------------------------------------------------------------------
-- 3. 権限（5 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 3, true) $$,
  'FD001', null,
  '協力者は p_make_latest = true で公開できない（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 3, false) $$,
  'FD001', null,
  '権限なしのログイン利用者は公開できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 3, false) $$,
  '42501', null,
  'anon は publish_definition を実行できない（実行権限なし）'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-0000000000ff', 1, false) $$,
  'FD009', null,
  'ないイベントは公開できない（FD009）'
);

reset role;

select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '協力者の p_make_latest = true が拒否されても最新のイベントは変わらない'
);

-- ---------------------------------------------------------------------------
-- 4. 最新でないイベント（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000002', 1, false) $$,
  'FD003', null,
  '最新でない（未公開の）イベントを p_make_latest = false で公開できない（FD003）'
);
select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000003', 2, false) $$,
  'FD003', null,
  '最新でも未公開でもない古いイベントを p_make_latest = false で公開できない（FD003）'
);
select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000003', 2, true) $$,
  'FD003', null,
  '管理者でも、最新でも未公開でもない古いイベントは p_make_latest = true でも公開できない（FD003）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. 管理者が未公開の新しいイベントを公開して最新にする（5 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000002', 1, true) $$,
  '管理者は未公開の新しいイベントを p_make_latest = true で公開できる'
);

reset role;

select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000002'::uuid,
  'p_make_latest = true で公開すると app_state.latest_event_id がそのイベントに切り替わる'
);
select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  1::bigint,
  '新しいイベントの公開版の行ができる'
);
select is(
  (select jsonb_typeof(content -> 'event' -> 'endAt') from public.published_definitions
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  'null',
  '終了日時が未定なら公開版の content.event.endAt は null'
);
select is(
  (select count(*) from public.save_logs
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000002' and kind = 'publish'
     and user_id = '11111111-1111-4111-8111-111111111111' and user_name = '管理者テスト'),
  1::bigint,
  '管理者の公開でも公開の記録が入る'
);

-- ---------------------------------------------------------------------------
-- 6. 最新が切り替わったあと（2 件）
--    前の最新（…01）は最新でも未公開でもないので、協力者・管理者とも公開できない。新しい最新（…02）は協力者も公開できる
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 3, false) $$,
  'FD003', null,
  '最新が切り替わったあと、協力者は前の最新のイベントを公開できない（FD003）'
);
select lives_ok(
  $$ select public.publish_definition(
       'aaaaaaaa-0000-4000-8000-000000000002',
       (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
       false) $$,
  '最新が切り替わったあと、協力者は新しい最新のイベントを公開できる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 7. 終了したイベントは公開できない（FD002）（2 件）
-- ---------------------------------------------------------------------------
update public.events
set starts_at = now() - interval '2 days', ends_at = now() - interval '1 hour'
where id = 'aaaaaaaa-0000-4000-8000-000000000002';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.publish_definition(
       'aaaaaaaa-0000-4000-8000-000000000002',
       (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
       false) $$,
  'FD002', null,
  '協力者は終了したイベント（最新）を公開できない（FD002）'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.publish_definition(
       'aaaaaaaa-0000-4000-8000-000000000002',
       (select version from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
       false) $$,
  'FD002', null,
  '管理者も終了したイベントを公開できない（FD002）'
);

reset role;

select * from finish();
rollback;
