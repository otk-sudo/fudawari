-- register_collaborator（管理者が発行したアカウントを協力者にする）
-- ※ ファイル名は以前の招待のテストのままだが、中身は register_collaborator のテスト（招待の仕組みはやめた）
-- ログインの方式：管理者が ID とパスワードを発行して相手に伝える（個人情報を使わない）。
--   Supabase Auth のメール＋パスワードで、ID は内部で「<ID>@fudawari.invalid」の形（メールは送らない）。
--   管理者の画面が supabase.auth.signUp でアカウントを作り、そのあとこの RPC で協力者にする
-- 仕様（親の指示 2026-10-17）：
--   管理者だけ（協力者・権限なし・sub なしは FD001、anon は 42501）。
--   p_user_id が auth.users にない → FD009。すでに profiles に行がある → FD010。表示名が null・空・空白だけ → FD005。
--   成功すると profiles に role 'collab'・display_name（前後の空白を除く）で入る
-- 注意：FD009・FD010・FD005 の確かめる順は決まっていないため、1 つの理由だけで失敗する呼び方で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

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
--   管理者が発行したばかりのアカウント（auth.users だけにいて profiles に行がない）5555…・6666…・7777…
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'reg-admin@fudawari.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'reg-collab@fudawari.invalid', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'reg-outsider@fudawari.invalid', 'authenticated', 'authenticated'),
  ('55555555-5555-4555-8555-555555555555', 'reg-new1@fudawari.invalid', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'reg-new2@fudawari.invalid', 'authenticated', 'authenticated'),
  ('77777777-7777-4777-8777-777777777777', 'reg-new3@fudawari.invalid', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

-- ---------------------------------------------------------------------------
-- 1. 管理者は発行したアカウントを協力者にできる（4 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.register_collaborator('55555555-5555-4555-8555-555555555555', '  新しい協力者  ') $$,
  '管理者は auth.users にいて profiles に行がない人を協力者にできる'
);

reset role;

select is(
  (select role from public.profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  'collab',
  '登録した人の権限は協力者（collab）'
);
select is(
  (select display_name from public.profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  '新しい協力者',
  '登録した人の表示名は、渡した名前の前後の空白を除いたもの'
);

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select is(public.app_role(), 'collab', '登録された人は直後から app_role() が collab になる');

reset role;

-- ---------------------------------------------------------------------------
-- 2. すでに profiles に行がある人は登録できない（FD010）。権限・表示名は変わらない（5 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.register_collaborator('55555555-5555-4555-8555-555555555555', 'もう一度登録') $$,
  'FD010', null,
  '登録済みの協力者をもう一度登録できない（FD010）'
);
select throws_ok(
  $$ select public.register_collaborator('22222222-2222-4222-8222-222222222222', '協力者の別名') $$,
  'FD010', null,
  '既にいる協力者を登録できない（FD010）'
);
select throws_ok(
  $$ select public.register_collaborator('11111111-1111-4111-8111-111111111111', '管理者の別名') $$,
  'FD010', null,
  '管理者（自分を含む）を協力者として登録できない（権限を下げられない）（FD010）'
);

reset role;

select is(
  (select role from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'),
  'admin',
  '登録を拒否された管理者は管理者のまま'
);
select is(
  (select display_name from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  '協力者テスト',
  '登録を拒否された協力者の表示名は変わらない'
);

-- ---------------------------------------------------------------------------
-- 3. auth.users にいない人は登録できない（FD009）（1 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.register_collaborator('99999999-9999-4999-8999-999999999999', 'いない人') $$,
  'FD009', null,
  'auth.users にいない ID は登録できない（FD009）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. 表示名が null・空・空白だけなら登録できない（FD005）（4 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.register_collaborator('66666666-6666-4666-8666-666666666666', null) $$,
  'FD005', null,
  '表示名が null なら登録できない（FD005）'
);
select throws_ok(
  $$ select public.register_collaborator('66666666-6666-4666-8666-666666666666', '') $$,
  'FD005', null,
  '表示名が空なら登録できない（FD005）'
);
select throws_ok(
  $$ select public.register_collaborator('66666666-6666-4666-8666-666666666666', '   ') $$,
  'FD005', null,
  '表示名が空白だけなら登録できない（FD005）'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '66666666-6666-4666-8666-666666666666'),
  0::bigint,
  '表示名が不正な登録では profiles の行ができない'
);

-- ---------------------------------------------------------------------------
-- 5. 管理者以外は登録できない（5 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.register_collaborator('77777777-7777-4777-8777-777777777777', '協力者が登録する人') $$,
  'FD001', null,
  '協力者はほかの人を協力者にできない（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.register_collaborator('77777777-7777-4777-8777-777777777777', '権限なしの人が登録する人') $$,
  'FD001', null,
  '権限なしのログイン利用者はほかの人を協力者にできない（FD001）'
);

select pg_temp.act_as_no_sub();

select throws_ok(
  $$ select public.register_collaborator('77777777-7777-4777-8777-777777777777', 'sub なしで登録する人') $$,
  'FD001', null,
  'ログインした人の ID（sub）がなければ登録できない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.register_collaborator('77777777-7777-4777-8777-777777777777', 'anon が登録する人') $$,
  '42501', null,
  'anon は register_collaborator を実行できない（実行権限なし）'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '77777777-7777-4777-8777-777777777777'),
  0::bigint,
  '管理者以外の登録では profiles の行ができない'
);

-- ---------------------------------------------------------------------------
-- 6. 権限なしの人は自分を協力者にできない（自分で権限を上げる経路がない）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.register_collaborator('44444444-4444-4444-8444-444444444444', '自分を登録') $$,
  'FD001', null,
  '権限なしのログイン利用者は自分自身を協力者にできない（FD001）'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '44444444-4444-4444-8444-444444444444'),
  0::bigint,
  '自分を登録しようとした人は協力者にならない'
);

-- ---------------------------------------------------------------------------
-- 7. 外した協力者は、同じアカウントでもう一度登録できる（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.remove_collaborator('55555555-5555-4555-8555-555555555555') $$,
  '管理者は登録した協力者を外せる'
);
select lives_ok(
  $$ select public.register_collaborator('55555555-5555-4555-8555-555555555555', '戻ってきた協力者') $$,
  '外した協力者は、同じアカウントでもう一度協力者にできる'
);

reset role;

select is(
  (select role || '：' || display_name from public.profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  'collab：戻ってきた協力者',
  'もう一度登録した人は、新しい表示名の協力者になる'
);

select * from finish();
rollback;
