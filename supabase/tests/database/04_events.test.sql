-- create_event（イベントの新規作成）と update_event_meta（名前・開始日時・終了日時の更新）
-- 設計：docs/design/database.md の 4.2（create_event・update_event_meta）と「更新できるイベント」、4.1（例外のコード）
-- roadmap T3-3：新規作成は管理者だけ／協力者はイベント名・開始日時を変えられない
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(48);

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

-- 新規作成で渡す初期の文書（画面の createDefinition が作る想定。E1 だけの空の文書）
create function pg_temp.doc() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'event', jsonb_build_object(
      'id', 'new', 'name', '2027冬イベ（テスト）',
      'startAt', '2000-01-01T00:00:00+09:00', 'endAt', null, 'versionDate', '2000-01-01'),
    'areas', jsonb_build_array(jsonb_build_object('id', 'area-1', 'name', 'E1')),
    'fudas', jsonb_build_array(),
    'stages', jsonb_build_array()
  )
$$;

grant execute on function
  pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.got(text), pg_temp.doc()
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、権限なしのログイン利用者 4444…
--   イベント …01：最新・公開済み・未終了
--            …02：未公開・最新でない
--            …03：公開済み・最新でない・未終了
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'event-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'event-collab@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'event-outsider@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
   now() - interval '10 days', now() + interval '30 days', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '未公開の新しいイベント',
   now() + interval '20 days', null, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '古いイベント',
   now() - interval '100 days', null, '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 1, pg_temp.doc(), '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 1, pg_temp.doc(), '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 1, pg_temp.doc(), '11111111-1111-4111-8111-111111111111');

insert into public.published_definitions (event_id, version_label, content, draft_version, published_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026/10/01 版', pg_temp.doc(), 1,
   '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '2026/06/01 版', pg_temp.doc(), 1,
   '11111111-1111-4111-8111-111111111111');

-- ===========================================================================
-- create_event
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. 管理者はイベントと下書き（版 1）を作れる（10 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.created', public.create_event(
       '2027冬イベ（テスト）', now() + interval '1 day', now() + interval '30 days', pg_temp.doc()
     )::text, true) $$,
  '管理者はイベントを新規作成できる'
);

reset role;

select is(
  (select name from public.events where id = pg_temp.got('created')::uuid),
  '2027冬イベ（テスト）',
  '作ったイベントの名前が渡したものになる'
);
select is(
  (select starts_at from public.events where id = pg_temp.got('created')::uuid),
  now() + interval '1 day',
  '作ったイベントの開始日時が渡したものになる'
);
select is(
  (select ends_at from public.events where id = pg_temp.got('created')::uuid),
  now() + interval '30 days',
  '作ったイベントの終了日時が渡したものになる'
);
select is(
  (select created_by from public.events where id = pg_temp.got('created')::uuid),
  '11111111-1111-4111-8111-111111111111'::uuid,
  '作ったイベントの created_by は作った管理者'
);
select is(
  (select version from public.drafts where event_id = pg_temp.got('created')::uuid),
  1,
  '作ったイベントの下書きの版は 1'
);
select is(
  (select content from public.drafts where event_id = pg_temp.got('created')::uuid),
  pg_temp.doc() || jsonb_build_object(
    'event', (pg_temp.doc() -> 'event') || jsonb_build_object('id', pg_temp.got('created'))
  ),
  '作ったイベントの下書きの内容は渡した文書（event.id だけ作ったイベントの ID に書き直す）'
);
select is(
  (select updated_by from public.drafts where event_id = pg_temp.got('created')::uuid),
  '11111111-1111-4111-8111-111111111111'::uuid,
  '作ったイベントの下書きの保存した人は作った管理者'
);
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '新規作成しただけでは最新のイベントは変わらない（公開して最新にするまで）'
);
select is(
  (select count(*) from public.published_definitions where event_id = pg_temp.got('created')::uuid),
  0::bigint,
  '新規作成しただけでは公開版はない'
);

-- ---------------------------------------------------------------------------
-- 2. 終了日時は未定（null）でも作れる（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.created_no_end', public.create_event(
       '終了日時が未定のイベント', now() + interval '1 day', null, pg_temp.doc()
     )::text, true) $$,
  '終了日時が未定（null）でもイベントを作れる'
);

reset role;

select ok(
  (select ends_at is null from public.events where id = pg_temp.got('created_no_end')::uuid),
  '終了日時が未定なら events.ends_at は null'
);

-- ---------------------------------------------------------------------------
-- 3. 管理者以外は作れない（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.create_event('協力者が作るイベント', now() + interval '1 day', null, pg_temp.doc()) $$,
  'FD001', null,
  '協力者はイベントを新規作成できない（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.create_event('権限なしの人が作るイベント', now() + interval '1 day', null, pg_temp.doc()) $$,
  'FD001', null,
  '権限なしのログイン利用者はイベントを新規作成できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.create_event('anon が作るイベント', now() + interval '1 day', null,
       '{"schemaVersion": 1}'::jsonb) $$,
  '42501', null,
  'anon は create_event を実行できない（実行権限なし）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. 入力が不正（FD005）（8 件）と、そのときイベントが作られないこと（1 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.create_event('', now() + interval '1 day', null, pg_temp.doc()) $$,
  'FD005', null,
  '名前が空ならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event(null, now() + interval '1 day', null, pg_temp.doc()) $$,
  'FD005', null,
  '名前が null ならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('   ', now() + interval '1 day', null, pg_temp.doc()) $$,
  'FD005', null,
  '名前が空白だけならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('不正なイベント', null, null, pg_temp.doc()) $$,
  'FD005', null,
  '開始日時が null ならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('不正なイベント', now() + interval '1 day', now() + interval '1 day', pg_temp.doc()) $$,
  'FD005', null,
  '終了日時が開始日時と同じならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('不正なイベント', now() + interval '2 days', now() + interval '1 day', pg_temp.doc()) $$,
  'FD005', null,
  '終了日時が開始日時より前ならイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('不正なイベント', now() + interval '1 day', null, '[]'::jsonb) $$,
  'FD005', null,
  '文書がオブジェクトでなければイベントを作れない（FD005）'
);
select throws_ok(
  $$ select public.create_event('不正なイベント', now() + interval '1 day', null,
       pg_temp.doc() || '{"schemaVersion": 2}'::jsonb) $$,
  'FD005', null,
  '文書の schemaVersion が 1 でなければイベントを作れない（FD005）'
);

reset role;

select is(
  (select count(*) from public.events where name in ('不正なイベント', '協力者が作るイベント', '権限なしの人が作るイベント')),
  0::bigint,
  '拒否された新規作成ではイベントが作られない'
);

-- ===========================================================================
-- update_event_meta
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5. 協力者は最新のイベントの終了日時だけを変えられる（4 件）
--    名前・開始日時は今の値をそのまま渡す（events を読んで渡す）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '40 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '協力者は最新のイベントの終了日時を変えられる'
);

reset role;

select is(
  (select ends_at from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  now() + interval '40 days',
  '協力者が変えた終了日時が保存される'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, null)
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '協力者は終了日時を消せる（未定にできる）'
);

reset role;

select ok(
  (select ends_at is null from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '終了日時を消すと events.ends_at は null になる'
);

-- ---------------------------------------------------------------------------
-- 6. 協力者は名前・開始日時を変えられない（FD001）（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.update_event_meta(e.id, '協力者が付けた名前', e.starts_at, e.ends_at)
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD001', null,
  '協力者はイベント名を変えられない（FD001）'
);
select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at - interval '1 day', e.ends_at)
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD001', null,
  '協力者は開始日時を変えられない（FD001）'
);

reset role;

select is(
  (select name from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '最新のイベント',
  '協力者が名前を変えようとしても名前は変わらない'
);

-- ---------------------------------------------------------------------------
-- 7. 終了日時が今以前なら変えられない（誤ってロックしない）（FD005）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() - interval '1 minute')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD005', null,
  '終了日時を今より前にはできない（FD005）'
);
select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now())
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD005', null,
  '終了日時をちょうど今にはできない（FD005）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 8. 協力者は最新でないイベントを変えられない（FD003）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '60 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'FD003', null,
  '協力者は未公開の新しいイベント（最新でない）の終了日時を変えられない（FD003）'
);
select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '60 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000003' $$,
  'FD003', null,
  '協力者は最新でない古いイベントの終了日時を変えられない（FD003）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 9. 権限がない人（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
       now() - interval '10 days', now() + interval '50 days') $$,
  'FD001', null,
  '権限なしのログイン利用者はイベントを更新できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
       now() - interval '10 days', now() + interval '50 days') $$,
  '42501', null,
  'anon は update_event_meta を実行できない（実行権限なし）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 10. 管理者は名前・開始日時・終了日時を変えられる（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000001', '管理者が直した名前',
       now() - interval '5 days', now() + interval '20 days') $$,
  '管理者は最新のイベントの名前・開始日時・終了日時を変えられる'
);

reset role;

select is(
  (select name from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '管理者が直した名前',
  '管理者が変えた名前が保存される'
);
select is(
  (select starts_at from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  now() - interval '5 days',
  '管理者が変えた開始日時が保存される'
);

-- ---------------------------------------------------------------------------
-- 11. 管理者が更新できるイベント（3 件）
--     最新と未公開のイベントは更新できる。最新でも未公開でもないイベントは FD003。ないイベントは FD009
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000002', '未公開のイベントの新しい名前',
       now() + interval '21 days', null) $$,
  '管理者は未公開の新しいイベント（最新でない）を更新できる'
);
select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000003', '古いイベント',
       now() - interval '100 days', null) $$,
  'FD003', null,
  '管理者でも、最新でも未公開でもない古いイベントは更新できない（FD003）'
);
select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-0000000000ff', 'ないイベント',
       now() - interval '1 day', null) $$,
  'FD009', null,
  'ないイベントは更新できない（FD009）'
);

-- ---------------------------------------------------------------------------
-- 12. 管理者でも名前を空にはできない（FD005）（1 件）
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000001', '',
       now() - interval '5 days', now() + interval '20 days') $$,
  'FD005', null,
  '名前を空にはできない（FD005）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 13. 終了日時が開始日時以前なら変えられない（FD005）（2 件）
--     開始日時を未来にして、「今以前」とは別の理由で拒否されることを確かめる
-- ---------------------------------------------------------------------------
update public.events
set starts_at = now() + interval '10 days', ends_at = now() + interval '30 days'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '5 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD005', null,
  '終了日時を開始日時より前にはできない（今より後でも）（FD005）'
);
select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, e.starts_at)
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD005', null,
  '終了日時を開始日時と同じにはできない（FD005）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 14. 終了したイベントは変えられない（FD002）（2 件）
-- ---------------------------------------------------------------------------
update public.events
set starts_at = now() - interval '2 days', ends_at = now() - interval '1 hour'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '7 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD002', null,
  '協力者は終了したイベントの終了日時を変えられない（延長は管理者が DB で直す。U18）（FD002）'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.update_event_meta(e.id, e.name, e.starts_at, now() + interval '7 days')
     from public.events e where e.id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'FD002', null,
  '管理者も終了したイベントは変えられない（FD002）'
);

reset role;

select * from finish();
rollback;
