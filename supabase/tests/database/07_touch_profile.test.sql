-- touch_profile（ログイン時に Discord の表示名で自分の表示名を更新する）
-- 設計：docs/design/database.md の 2.1（profiles.display_name はログイン時に更新）、2.6（save_logs.user_name は記録した時点の表示名）、
--       4.2（touch_profile：行がある人だけ。行がない → FD001）
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

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

-- authenticated の役だが sub（ログインした人の ID）がない
create function pg_temp.act_as_no_sub() returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
end;
$$;

grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.act_as_no_sub()
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、権限なしのログイン利用者 4444…
--   イベント …01：最新・未終了（名前を変えたあとの保存の記録を確かめる）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'touch-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'touch-collab@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'touch-outsider@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者の古い名前', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者の古い名前', 'collab');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
   now() - interval '10 days', now() + interval '30 days', '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 1, '{"schemaVersion": 1}'::jsonb,
   '11111111-1111-4111-8111-111111111111');

-- 名前を変える前の記録
insert into public.save_logs (event_id, user_id, user_name, kind, map_label, summary) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   '協力者の古い名前', 'save', 'E1', '名前を変える前の保存');

-- ---------------------------------------------------------------------------
-- 1. 協力者は自分の表示名を変えられる（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select public.touch_profile('協力者の新しい名前') $$,
  '協力者は自分の表示名を更新できる'
);

reset role;

select is(
  (select display_name from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  '協力者の新しい名前',
  '協力者の表示名が渡したものになる'
);
select is(
  (select role from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  'collab',
  '表示名を更新しても権限は変わらない'
);

-- ---------------------------------------------------------------------------
-- 2. 管理者も自分の表示名を変えられる（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.touch_profile('管理者の新しい名前') $$,
  '管理者は自分の表示名を更新できる'
);

reset role;

select is(
  (select display_name from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'),
  '管理者の新しい名前',
  '管理者の表示名が渡したものになる'
);

-- ---------------------------------------------------------------------------
-- 3. profiles に行がない人は FD001。行は作られない（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.touch_profile('権限なしの人の名前') $$,
  'FD001', null,
  'profiles に行がない人（権限なし）は表示名を更新できない（FD001）'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '44444444-4444-4444-8444-444444444444'),
  0::bigint,
  '行がない人が touch_profile を呼んでも profiles の行は作られない（権限は増えない）'
);

-- ---------------------------------------------------------------------------
-- 4. 未ログイン（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as_no_sub();

select throws_ok(
  $$ select public.touch_profile('ログインしていない人の名前') $$,
  'FD001', null,
  'ログインした人の ID（sub）がなければ表示名を更新できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.touch_profile('anon の名前') $$,
  '42501', null,
  'anon は touch_profile を実行できない（実行権限なし）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. 保存の記録の名前は記録した時点のもの（3 件）
-- ---------------------------------------------------------------------------
select is(
  (select user_name from public.save_logs
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000001' and summary = '名前を変える前の保存'),
  '協力者の古い名前',
  '表示名を変えても、変える前の保存の記録の名前は変わらない'
);

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 1, '{"schemaVersion": 1}'::jsonb,
       '[{"mapLabel": null, "summary": "名前を変えた後の保存"}]'::jsonb) $$,
  '表示名を変えた協力者が下書きを保存できる'
);

reset role;

select is(
  (select user_name from public.save_logs
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000001' and summary = '名前を変えた後の保存'),
  '協力者の新しい名前',
  '表示名を変えた後の保存の記録には新しい名前が入る'
);

select * from finish();
rollback;
