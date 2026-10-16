-- 表示名を自分で書き換えられないこと（なりすましの防止）
-- ※ ファイル名は以前の touch_profile のテストのままだが、touch_profile は削除した
--   （協力者が自分の表示名をほかの人の名前に書き換えて、なりすませるため。表示名は管理者が register_collaborator で決める）
-- ここでは「touch_profile がない」ことと、「協力者が自分の profiles の行を直接書き換えられない」ことを確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

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

grant execute on function pg_temp.act_as(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'name-admin@fudawari.invalid', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'name-collab@fudawari.invalid', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

-- ---------------------------------------------------------------------------
-- 1. touch_profile はない（どの引数の形でも）（1 件）
-- ---------------------------------------------------------------------------
select hasnt_function('public'::name, 'touch_profile'::name, 'touch_profile はない（自分の表示名を書き換える RPC がない）');

-- ---------------------------------------------------------------------------
-- 2. 協力者は自分の profiles の行を直接書き換えられない（42501）（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ update public.profiles set display_name = '管理者テスト'
     where user_id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  '協力者は自分の表示名を直接書き換えられない（ほかの人の名前を名乗れない）'
);
select throws_ok(
  $$ update public.profiles set role = 'admin'
     where user_id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  '協力者は自分の権限を直接書き換えられない（管理者になれない）'
);

reset role;

select is(
  (select display_name || '：' || role from public.profiles
   where user_id = '22222222-2222-4222-8222-222222222222'),
  '協力者テスト：collab',
  '書き換えを拒否された協力者の表示名と権限は変わらない'
);

select * from finish();
rollback;
