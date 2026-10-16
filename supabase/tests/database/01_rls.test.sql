-- RLS（読み取り）と表への直接の書き込みの禁止
-- 設計：docs/design/database.md の 3 章の表
--   anon：app_state・published_definitions だけ読める（ほかの表は SELECT の権限がなく 42501）
--   権限なしのログイン利用者：profiles は自分の行だけ（行がないので 0 件）。events・drafts・save_logs は 0 件
--   協力者・管理者：profiles 全行・events・drafts・save_logs・published_definitions・app_state を読める
--   removed_accounts（外したアカウント）：anon・authenticated とも権限がなく、管理者でも読めない（42501）
--   どの役も表に直接 insert／update／delete できない（書き込みの権限を与えていないため 42501）
-- 注意：結果の並べ替え（order by）をすると TAP の番号の順が乱れるため、まとめて確かめる select では並べ替えない
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- 演じ分けの補助（pg_temp に作るので rollback で消える）
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

grant execute on function pg_temp.act_as(uuid), pg_temp.act_as_anon() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、協力者 3333…、権限なしのログイン利用者 4444…（profiles に行がない）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'rls-admin@fudawari.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'rls-collab@fudawari.invalid', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'rls-collab2@fudawari.invalid', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'rls-outsider@fudawari.invalid', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab'),
  ('33333333-3333-4333-8333-333333333333', '協力者テスト2', 'collab');

insert into public.events (id, name, starts_at, ends_at, created_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'RLS テストのイベント',
   now() - interval '10 days', now() + interval '30 days', '11111111-1111-4111-8111-111111111111');

update public.app_state set latest_event_id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into public.drafts (event_id, version, content, updated_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 1, '{"schemaVersion": 1}'::jsonb,
   '11111111-1111-4111-8111-111111111111');

insert into public.published_definitions (event_id, version_label, content, draft_version, published_by) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '2026/10/01 版', '{"schemaVersion": 1}'::jsonb, 1,
   '11111111-1111-4111-8111-111111111111');

insert into public.save_logs (event_id, user_id, user_name, kind, map_label, summary) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '管理者テスト', 'save', 'E1', 'RLS テストの記録');

-- ---------------------------------------------------------------------------
-- 1. anon（未ログイン）（30 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();

select is((select count(*) from public.app_state), 1::bigint, 'anon は app_state を読める');
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'anon は app_state から最新イベントの ID を読める'
);
select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  'anon は published_definitions を読める'
);

-- 読めない表（SELECT の権限がない）（5 件）
select throws_ok(
  format('select count(*) from public.%I', t),
  '42501', null,
  format('anon は %s を読めない（権限なし）', t)
)
from unnest(array['profiles', 'events', 'drafts', 'save_logs', 'removed_accounts']) as t;

select is(public.app_role(), null::text, 'anon の app_role() は null');

-- 直接の書き込み（insert 7 件・update 7 件・delete 7 件）
select throws_ok(
  format('insert into public.%I default values', t),
  '42501', null,
  format('anon は %s に直接 insert できない', t)
)
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs', 'removed_accounts'
]) as t;

select throws_ok(
  format('update public.%I set %I = %I where false', v.t, v.c, v.c),
  '42501', null,
  format('anon は %s を直接 update できない', v.t)
)
from (values
  ('profiles', 'display_name'),
  ('events', 'name'),
  ('app_state', 'latest_event_id'),
  ('drafts', 'version'),
  ('published_definitions', 'version_label'),
  ('save_logs', 'summary'),
  ('removed_accounts', 'removed_at')
) as v (t, c);

select throws_ok(
  format('delete from public.%I where false', t),
  '42501', null,
  format('anon は %s から直接 delete できない', t)
)
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs', 'removed_accounts'
]) as t;

reset role;

-- ---------------------------------------------------------------------------
-- 2. 権限なしのログイン利用者（8 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select is(
  (select count(*) from public.profiles),
  0::bigint,
  '権限なしのログイン利用者は profiles を読めない（自分の行だけ読めるが、行がない）'
);
select is((select count(*) from public.events), 0::bigint, '権限なしのログイン利用者は events を読めない');
select is((select count(*) from public.drafts), 0::bigint, '権限なしのログイン利用者は drafts を読めない');
select is((select count(*) from public.save_logs), 0::bigint, '権限なしのログイン利用者は save_logs を読めない');
select is((select count(*) from public.app_state), 1::bigint, '権限なしのログイン利用者は app_state を読める');
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '権限なしのログイン利用者は最新イベントの ID を読める'
);
select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '権限なしのログイン利用者は published_definitions を読める'
);
select is(public.app_role(), null::text, '権限なしのログイン利用者の app_role() は null');

reset role;

-- ---------------------------------------------------------------------------
-- 3. 協力者（7 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*) from public.profiles
   where user_id in ('11111111-1111-4111-8111-111111111111',
                     '22222222-2222-4222-8222-222222222222',
                     '33333333-3333-4333-8333-333333333333')),
  3::bigint,
  '協力者は profiles の全行（ほかの人の行も）を読める'
);
select is(
  (select count(*) from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '協力者は events を読める'
);
select is(
  (select count(*) from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '協力者は drafts を読める'
);
select is(
  (select count(*) from public.save_logs where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '協力者は save_logs を読める'
);
select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '協力者は published_definitions を読める'
);
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '協力者は app_state を読める'
);
select is(public.app_role(), 'collab', '協力者の app_role() は collab');

reset role;

-- ---------------------------------------------------------------------------
-- 4. 管理者（8 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select is(
  (select count(*) from public.profiles
   where user_id in ('11111111-1111-4111-8111-111111111111',
                     '22222222-2222-4222-8222-222222222222',
                     '33333333-3333-4333-8333-333333333333')),
  3::bigint,
  '管理者は profiles の全行を読める'
);
select is(
  (select count(*) from public.events where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '管理者は events を読める'
);
select is(
  (select count(*) from public.drafts where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '管理者は drafts を読める'
);
select is(
  (select count(*) from public.save_logs where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '管理者は save_logs を読める'
);
select is(
  (select count(*) from public.published_definitions where event_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  '管理者は published_definitions を読める'
);
select is(
  (select latest_event_id from public.app_state),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  '管理者は app_state を読める'
);
select is(public.app_role(), 'admin', '管理者の app_role() は admin');
select throws_ok(
  $$ select count(*) from public.removed_accounts $$,
  '42501', null,
  '管理者（authenticated）でも removed_accounts は読めない（権限なし）'
);

-- ---------------------------------------------------------------------------
-- 5. ログインした人（最も強い管理者で確かめる）も表に直接書き込めない（insert 7 件・update 7 件・delete 7 件）
--    書き込みの権限は役（authenticated）ごとなので、協力者・権限なしの人も同じ
--    （協力者の登録も profiles への直接の insert ではなく register_collaborator を通す）
-- ---------------------------------------------------------------------------
select throws_ok(
  format('insert into public.%I default values', t),
  '42501', null,
  format('ログインした人（管理者）も %s に直接 insert できない', t)
)
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs', 'removed_accounts'
]) as t;

select throws_ok(
  format('update public.%I set %I = %I where false', v.t, v.c, v.c),
  '42501', null,
  format('ログインした人（管理者）も %s を直接 update できない', v.t)
)
from (values
  ('profiles', 'display_name'),
  ('events', 'name'),
  ('app_state', 'latest_event_id'),
  ('drafts', 'version'),
  ('published_definitions', 'version_label'),
  ('save_logs', 'summary'),
  ('removed_accounts', 'removed_at')
) as v (t, c);

select throws_ok(
  format('delete from public.%I where false', t),
  '42501', null,
  format('ログインした人（管理者）も %s から直接 delete できない', t)
)
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs', 'removed_accounts'
]) as t;

reset role;

select * from finish();
rollback;
