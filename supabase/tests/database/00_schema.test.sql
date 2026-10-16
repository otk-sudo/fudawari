-- DB の土台：表・列の型・RLS の有効化・関数の戻り値と security definer・関数の実行権限・初期データ・表の制約
-- 設計：docs/design/database.md の 2 章（表）・3 章（RLS）・4 章（RPC）
-- ログインは管理者が発行する ID とパスワード（Supabase Auth のメール＋パスワード）。招待（invites 表・招待の RPC）はない
-- 注意：結果の並べ替え（order by）をすると TAP の番号の順が乱れるため、まとめて確かめる select では並べ替えない
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(103);

-- ---------------------------------------------------------------------------
-- 1. 表がある（6 件）
-- ---------------------------------------------------------------------------
select has_table('public'::name, t::name, format('%s 表がある', t))
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs'
]) as t;

-- ---------------------------------------------------------------------------
-- 2. 列と型（設計 2 章の表のとおり。34 件）
-- ---------------------------------------------------------------------------
select col_type_is('public'::name, v.t::name, v.c::name, v.typ, format('%s.%s の型が %s', v.t, v.c, v.typ))
from (values
  ('profiles', 'user_id', 'uuid'),
  ('profiles', 'display_name', 'text'),
  ('profiles', 'role', 'text'),
  ('profiles', 'created_at', 'timestamp with time zone'),
  ('profiles', 'last_edited_at', 'timestamp with time zone'),
  ('profiles', 'last_edited_note', 'text'),
  ('events', 'id', 'uuid'),
  ('events', 'name', 'text'),
  ('events', 'starts_at', 'timestamp with time zone'),
  ('events', 'ends_at', 'timestamp with time zone'),
  ('events', 'created_by', 'uuid'),
  ('events', 'created_at', 'timestamp with time zone'),
  ('app_state', 'id', 'boolean'),
  ('app_state', 'latest_event_id', 'uuid'),
  ('drafts', 'event_id', 'uuid'),
  ('drafts', 'version', 'integer'),
  ('drafts', 'content', 'jsonb'),
  ('drafts', 'updated_by', 'uuid'),
  ('drafts', 'updated_at', 'timestamp with time zone'),
  ('published_definitions', 'id', 'uuid'),
  ('published_definitions', 'event_id', 'uuid'),
  ('published_definitions', 'version_label', 'text'),
  ('published_definitions', 'content', 'jsonb'),
  ('published_definitions', 'draft_version', 'integer'),
  ('published_definitions', 'published_by', 'uuid'),
  ('published_definitions', 'published_at', 'timestamp with time zone'),
  ('save_logs', 'id', 'bigint'),
  ('save_logs', 'event_id', 'uuid'),
  ('save_logs', 'user_id', 'uuid'),
  ('save_logs', 'user_name', 'text'),
  ('save_logs', 'kind', 'text'),
  ('save_logs', 'map_label', 'text'),
  ('save_logs', 'summary', 'text'),
  ('save_logs', 'created_at', 'timestamp with time zone')
) as v (t, c, typ);

-- ---------------------------------------------------------------------------
-- 3. すべての表で RLS が有効（6 件）
-- ---------------------------------------------------------------------------
select ok(
  coalesce(
    (select c.relrowsecurity
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t),
    false
  ),
  format('%s 表で RLS が有効', t)
)
from unnest(array[
  'profiles', 'events', 'app_state', 'drafts', 'published_definitions', 'save_logs'
]) as t;

-- ---------------------------------------------------------------------------
-- 4. 関数の引数・戻り値（8 件）と security definer（8 件）
-- ---------------------------------------------------------------------------
select function_returns('public'::name, v.f::name, v.args::name[], v.ret, format('%s(%s) があり、%s を返す', v.f, array_to_string(v.args, ', '), v.ret))
from (values
  ('app_role', array[]::text[], 'text'),
  ('save_draft', array['uuid', 'integer', 'jsonb', 'jsonb'], 'jsonb'),
  ('publish_definition', array['uuid', 'integer', 'boolean'], 'jsonb'),
  ('create_event', array['text', 'timestamp with time zone', 'timestamp with time zone', 'jsonb'], 'uuid'),
  ('update_event_meta', array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone'], 'void'),
  ('register_collaborator', array['uuid', 'text'], 'void'),
  ('remove_collaborator', array['uuid'], 'void'),
  ('touch_profile', array['text'], 'void')
) as v (f, args, ret);

select is_definer('public'::name, v.f::name, v.args::name[], format('%s は security definer', v.f))
from (values
  ('app_role', array[]::text[]),
  ('save_draft', array['uuid', 'integer', 'jsonb', 'jsonb']),
  ('publish_definition', array['uuid', 'integer', 'boolean']),
  ('create_event', array['text', 'timestamp with time zone', 'timestamp with time zone', 'jsonb']),
  ('update_event_meta', array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone']),
  ('register_collaborator', array['uuid', 'text']),
  ('remove_collaborator', array['uuid']),
  ('touch_profile', array['text'])
) as v (f, args);

-- ---------------------------------------------------------------------------
-- 5. 関数の実行権限（設計 4 章：RPC は authenticated だけ。app_role はだれでも。内部の補助はだれも）
--    authenticated（14 件）と anon（14 件）
-- ---------------------------------------------------------------------------
create temporary table fn_privs (f text, args text[], kind text) on commit drop;
insert into fn_privs (f, args, kind) values
  ('app_role', array[]::text[], 'anyone'),
  ('save_draft', array['uuid', 'integer', 'jsonb', 'jsonb'], 'rpc'),
  ('publish_definition', array['uuid', 'integer', 'boolean'], 'rpc'),
  ('create_event', array['text', 'timestamp with time zone', 'timestamp with time zone', 'jsonb'], 'rpc'),
  ('update_event_meta', array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone'], 'rpc'),
  ('register_collaborator', array['uuid', 'text'], 'rpc'),
  ('remove_collaborator', array['uuid'], 'rpc'),
  ('touch_profile', array['text'], 'rpc'),
  ('_raise', array['text', 'text'], 'internal'),
  ('_require_role', array['text[]'], 'internal'),
  ('_check_editable_event', array['uuid', 'text'], 'internal'),
  ('_check_document', array['jsonb'], 'internal'),
  ('_check_logs', array['jsonb'], 'internal'),
  ('_jst_text', array['timestamp with time zone'], 'internal');

select function_privs_are(
  'public'::name, p.f::name, p.args::name[], 'authenticated'::name,
  case when p.kind = 'internal' then '{}'::name[] else array['EXECUTE']::name[] end,
  case when p.kind = 'internal'
    then format('authenticated は内部の補助 %s を実行できない', p.f)
    else format('authenticated は %s を実行できる', p.f)
  end
)
from fn_privs p;

select function_privs_are(
  'public'::name, p.f::name, p.args::name[], 'anon'::name,
  case when p.kind = 'anyone' then array['EXECUTE']::name[] else '{}'::name[] end,
  case when p.kind = 'anyone'
    then format('anon は %s を実行できる', p.f)
    else format('anon は %s を実行できない', p.f)
  end
)
from fn_privs p;

-- ---------------------------------------------------------------------------
-- 6. 招待の仕組みはない（ログインは管理者が発行する ID とパスワードに変えたため）（4 件）
--    残っていると、コードを知る人が自分で協力者になれる経路が残るため、消えていることを確かめる
-- ---------------------------------------------------------------------------
select hasnt_table('public'::name, 'invites'::name, 'invites 表はない');
select hasnt_function('public'::name, 'create_invite'::name, 'create_invite はない');
select hasnt_function('public'::name, 'revoke_invite'::name, 'revoke_invite はない');
select hasnt_function('public'::name, 'accept_invite'::name, 'accept_invite はない（自分で協力者になる経路がない）');

-- ---------------------------------------------------------------------------
-- 7. app_state は初期データの 1 行だけ（2 件）
-- ---------------------------------------------------------------------------
select is((select count(*) from public.app_state), 1::bigint, 'app_state に初期データの 1 行がある');
select is(
  (select count(*) from public.app_state where id and latest_event_id is null),
  1::bigint,
  'app_state の初期の行は id = true、latest_event_id = null'
);

-- ---------------------------------------------------------------------------
-- 8. 表の制約（7 件）
-- ---------------------------------------------------------------------------
-- app_state に 2 行目は入れられない
select throws_ok(
  $$ insert into public.app_state (id) values (false) $$,
  '23514', null,
  'app_state の id は true だけ（false の行は check 制約で入れられない）'
);
select throws_ok(
  $$ insert into public.app_state (id) values (true) $$,
  '23505', null,
  'app_state に 2 行目は入れられない（主キーの重複）'
);

-- profiles：role は admin・collab だけ。user_id は auth.users にいる人だけ
insert into auth.users (id, email, aud, role)
values ('11111111-1111-4111-8111-111111111111', 'schema-admin@fudawari.invalid', 'authenticated', 'authenticated');

select throws_ok(
  $$ insert into public.profiles (user_id, display_name, role)
     values ('11111111-1111-4111-8111-111111111111', '制約テスト', 'guest') $$,
  '23514', null,
  'profiles.role は admin・collab 以外を入れられない'
);
select throws_ok(
  $$ insert into public.profiles (user_id, display_name, role)
     values ('99999999-9999-4999-8999-999999999999', '制約テスト', 'collab') $$,
  '23503', null,
  'profiles.user_id は auth.users にいない人を入れられない'
);

-- events：名前は空白だけにできない。終了日時は開始日時より後
select throws_ok(
  $$ insert into public.events (name, starts_at, ends_at, created_by)
     values ('   ', now(), null, '11111111-1111-4111-8111-111111111111') $$,
  '23514', null,
  'events.name は空白だけにできない'
);
select throws_ok(
  $$ insert into public.events (name, starts_at, ends_at, created_by)
     values ('制約テスト', now(), now(), '11111111-1111-4111-8111-111111111111') $$,
  '23514', null,
  'events.ends_at は starts_at より後でなければならない（同じ日時は不可）'
);

-- save_logs：kind は save・publish だけ
insert into public.events (id, name, starts_at, ends_at, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', '制約テストのイベント', now() - interval '1 day', null,
        '11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ insert into public.save_logs (event_id, user_id, user_name, kind, map_label, summary)
     values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
             '制約テスト', 'delete', null, '制約テスト') $$,
  '23514', null,
  'save_logs.kind は save・publish 以外を入れられない'
);

select * from finish();
rollback;
