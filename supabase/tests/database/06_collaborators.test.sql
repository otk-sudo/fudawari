-- remove_collaborator（協力者を外す）と、外された協力者がすぐに更新できなくなること
-- 設計：docs/design/database.md の 2.1（profiles。外す＝行を削除する）、4.2（remove_collaborator）、4.1（例外のコード）
-- roadmap T3-3：協力者の管理は管理者だけ／外された協力者はすぐに更新できなくなる
-- 要件 2.1：管理者は自分自身を外せない
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

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
  pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.got(text), pg_temp.doc(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、管理者 6666…（2 人目）、協力者 2222…（外す）、協力者 3333…、権限なしのログイン利用者 4444…
--   イベント …01：最新・公開済み・未終了（下書きの版 1）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'collab-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'collab-collab@example.test', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'collab-collab2@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'collab-outsider@example.test', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'collab-admin2@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '外される協力者', 'collab'),
  ('33333333-3333-4333-8333-333333333333', '協力者テスト2', 'collab'),
  ('66666666-6666-4666-8666-666666666666', '管理者テスト2', 'admin');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
   now() - interval '10 days', now() + interval '30 days', '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 1, pg_temp.doc('最初の内容'), '11111111-1111-4111-8111-111111111111');

insert into public.published_definitions (event_id, version_label, content, draft_version, published_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026/10/01 版', pg_temp.doc('最初の内容'), 1,
   '11111111-1111-4111-8111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. 外す前の協力者は下書きを保存できる（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select lives_ok(
  $$ select set_config('fd_test.before_remove', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 1, pg_temp.doc('外される協力者の内容'),
       '[{"mapLabel": "E1", "summary": "外される前の保存"}]'::jsonb
     )::text, true) $$,
  '外す前の協力者は下書きを保存できる'
);

reset role;

select is(pg_temp.got('before_remove')::jsonb ->> 'status', 'saved', '外す前の協力者の保存は status が saved');

-- ---------------------------------------------------------------------------
-- 2. 管理者は協力者を外せる（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.remove_collaborator('22222222-2222-4222-8222-222222222222') $$,
  '管理者は協力者を外せる'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  0::bigint,
  '外した協力者の profiles の行がなくなる'
);

-- ---------------------------------------------------------------------------
-- 3. 外された協力者は、直後から更新も閲覧もできない（6 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.save_draft('aaaaaaaa-0000-4000-8000-000000000001', 2, pg_temp.doc('外された後の内容'), '[]'::jsonb) $$,
  'FD001', null,
  '外された協力者は、直後の下書きの保存で拒否される（FD001）'
);
select throws_ok(
  $$ select public.publish_definition('aaaaaaaa-0000-4000-8000-000000000001', 2, false) $$,
  'FD001', null,
  '外された協力者は公開できない（FD001）'
);
select throws_ok(
  $$ select public.update_event_meta('aaaaaaaa-0000-4000-8000-000000000001', '最新のイベント',
       now() - interval '10 days', now() + interval '40 days') $$,
  'FD001', null,
  '外された協力者は終了日時を変えられない（FD001）'
);
select is(public.app_role(), null::text, '外された協力者の app_role() は null');
select is((select count(*) from public.events), 0::bigint, '外された協力者は events を読めない');
select is((select count(*) from public.drafts), 0::bigint, '外された協力者は drafts を読めない');

reset role;

-- ---------------------------------------------------------------------------
-- 4. 外された協力者のこれまでの記録は残る（1 件）
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.save_logs
   where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'
     and user_id = '22222222-2222-4222-8222-222222222222' and user_name = '外される協力者'),
  1::bigint,
  '外された協力者の保存の記録は、名前とともに残る'
);

-- ---------------------------------------------------------------------------
-- 5. 外された人が最後に保存した下書きと衝突すると、保存した人は「不明」（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.conflict_removed', public.save_draft(
       'aaaaaaaa-0000-4000-8000-000000000001', 1, pg_temp.doc('管理者の古い版からの保存'), '[]'::jsonb
     )::text, true) $$,
  '管理者が古い版から保存すると衝突の結果を受け取る'
);

reset role;

select is(
  pg_temp.got('conflict_removed')::jsonb ->> 'updatedByName',
  '不明',
  '最後に保存した人が外されていれば updatedByName は「不明」'
);

-- ---------------------------------------------------------------------------
-- 6. 管理者は外せない（自分自身も）（FD011）（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.remove_collaborator('11111111-1111-4111-8111-111111111111') $$,
  'FD011', null,
  '管理者は自分自身を外せない（FD011）'
);
select throws_ok(
  $$ select public.remove_collaborator('66666666-6666-4666-8666-666666666666') $$,
  'FD011', null,
  '管理者はほかの管理者を外せない（FD011）'
);

reset role;

select is(
  (select count(*) from public.profiles
   where user_id in ('11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666')
     and role = 'admin'),
  2::bigint,
  '外せなかった管理者は管理者のまま'
);

-- ---------------------------------------------------------------------------
-- 7. いない人は外せない（FD009）（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.remove_collaborator('22222222-2222-4222-8222-222222222222') $$,
  'FD009', null,
  '外し済みの協力者をもう一度外そうとすると FD009'
);
select throws_ok(
  $$ select public.remove_collaborator('44444444-4444-4444-8444-444444444444') $$,
  'FD009', null,
  '権限なしのログイン利用者（profiles に行がない人）は外せない（FD009）'
);
select throws_ok(
  $$ select public.remove_collaborator('99999999-9999-4999-8999-999999999999') $$,
  'FD009', null,
  'どこにもいない人は外せない（FD009）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 8. 管理者以外は協力者を外せない（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('33333333-3333-4333-8333-333333333333');

select throws_ok(
  $$ select public.remove_collaborator('33333333-3333-4333-8333-333333333333') $$,
  'FD001', null,
  '協力者は協力者を外せない（自分も含む）（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.remove_collaborator('33333333-3333-4333-8333-333333333333') $$,
  'FD001', null,
  '権限なしのログイン利用者は協力者を外せない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.remove_collaborator('33333333-3333-4333-8333-333333333333') $$,
  '42501', null,
  'anon は remove_collaborator を実行できない（実行権限なし）'
);

reset role;

select * from finish();
rollback;
