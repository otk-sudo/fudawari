-- 定義画面の「編集中」の表示（Realtime の Presence）を、管理者・協力者だけに限る
-- 設計：docs/design/database.md の 3.1（Realtime の private チャンネル）
--   チャンネル名は「plan-editor:（イベント ID）」。画面は private のチャンネルで参加する
--   realtime.messages のポリシーは、判定の関数 can_use_editor_presence(topic) を使う
--   管理者・協力者：plan-editor: で始まるチャンネルだけ true
--   権限なしのログイン利用者・anon：false。ほかの名前のチャンネルも false
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

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
-- テストのデータ：管理者 1111…、協力者 2222…、権限なしのログイン利用者 4444…（profiles に行がない）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'presence-admin@fudawari.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'presence-collab@fudawari.invalid', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'presence-outsider@fudawari.invalid', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

-- ---------------------------------------------------------------------------
-- ポリシーがあること（Presence の読み取りと送信）
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_policies
          where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'editor_presence_select' and cmd = 'SELECT'
            and roles = '{authenticated}'),
  'realtime.messages に、authenticated の SELECT のポリシー editor_presence_select がある'
);

select ok(
  exists (select 1 from pg_policies
          where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'editor_presence_insert' and cmd = 'INSERT'
            and roles = '{authenticated}'),
  'realtime.messages に、authenticated の INSERT のポリシー editor_presence_insert がある'
);

select ok(
  (select qual from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'editor_presence_select')
    like '%can_use_editor_presence%',
  'SELECT のポリシーは can_use_editor_presence で判定する'
);

select ok(
  (select with_check from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'editor_presence_insert')
    like '%can_use_editor_presence%',
  'INSERT のポリシーは can_use_editor_presence で判定する'
);

-- ---------------------------------------------------------------------------
-- 判定の関数
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is(public.can_use_editor_presence('plan-editor:aaaaaaaa-0000-4000-8000-000000000001'), true,
  '管理者は plan-editor: のチャンネルを使える');
select is(public.can_use_editor_presence('other-room'), false,
  '管理者でも、ほかの名前のチャンネルは使えない');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is(public.can_use_editor_presence('plan-editor:aaaaaaaa-0000-4000-8000-000000000001'), true,
  '協力者は plan-editor: のチャンネルを使える');
select is(public.can_use_editor_presence(null), false,
  'チャンネル名がなければ使えない');

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');
select is(public.can_use_editor_presence('plan-editor:aaaaaaaa-0000-4000-8000-000000000001'), false,
  '権限なしのログイン利用者は使えない');

reset role;

select pg_temp.act_as_anon();
select throws_ok(
  $$ select public.can_use_editor_presence('plan-editor:aaaaaaaa-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'anon は判定の関数を実行できない（ポリシーは authenticated だけ）'
);

reset role;

select ok(
  not has_function_privilege('public', 'public.can_use_editor_presence(text)', 'execute'),
  'PUBLIC には判定の関数の実行権限がない'
);

select * from finish();
rollback;
