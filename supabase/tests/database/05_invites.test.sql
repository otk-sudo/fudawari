-- 招待：create_invite・accept_invite・revoke_invite
-- 設計：docs/design/database.md の 2.7（invites）、4.2（create_invite・revoke_invite・accept_invite）、4.1（例外のコード）
--   accept_invite の確かめる順：未ログイン FD001 → 既に権限がある FD010 → コードが合わない FD009 →
--                               取り消し済み FD008 → 使用済み FD006 → 期限切れ FD007
-- roadmap T3-3：招待は 1 回だけ、期限内だけ使える。取り消した招待は使えない
-- 招待のコードのハッシュは encode(extensions.digest(コード, 'sha256'), 'hex')。テストでは直接 invites に入れた招待も使う
-- 注意：anon は RPC の実行権限がないため 42501（permission denied）で確かめる
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

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

create function pg_temp.got(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('fd_test.' || p_name, true), '')
$$;

-- 招待のコードのハッシュ（SHA-256 の 16 進）
create function pg_temp.code_hash(p_code text) returns text
language sql stable as $$
  select encode(extensions.digest(p_code, 'sha256'::text), 'hex')
$$;

grant execute on function
  pg_temp.act_as(uuid), pg_temp.act_as_anon(), pg_temp.act_as_no_sub(),
  pg_temp.got(text), pg_temp.code_hash(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- テストのデータ（postgres のまま入れる）
--   管理者 1111…、協力者 2222…、権限なしのログイン利用者 4444…（招待を受ける人 5555…・6666…・7777… も権限なし）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'invite-admin@example.test', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'invite-collab@example.test', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'invite-outsider@example.test', 'authenticated', 'authenticated'),
  ('55555555-5555-4555-8555-555555555555', 'invitee1@example.test', 'authenticated', 'authenticated'),
  ('66666666-6666-4666-8666-666666666666', 'invitee2@example.test', 'authenticated', 'authenticated'),
  ('77777777-7777-4777-8777-777777777777', 'invitee3@example.test', 'authenticated', 'authenticated');

insert into public.profiles (user_id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', '管理者テスト', 'admin'),
  ('22222222-2222-4222-8222-222222222222', '協力者テスト', 'collab');

-- 直接入れる招待（コードが分かっている）
insert into public.invites (id, code_hash, created_by, expires_at, used_by, used_at, revoked_at) values
  -- 有効（権限がある人の FD010 を確かめたあと、7777… が使う）
  ('bbbbbbbb-0000-4000-8000-000000000001', pg_temp.code_hash('test-code-valid'),
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day', null, null, null),
  -- 期限切れ
  ('bbbbbbbb-0000-4000-8000-000000000002', pg_temp.code_hash('test-code-expired'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 minute', null, null, null),
  -- 取り消し済み
  ('bbbbbbbb-0000-4000-8000-000000000003', pg_temp.code_hash('test-code-revoked'),
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day', null, null, now() - interval '1 hour'),
  -- 取り消し済み かつ 期限切れ（取り消しを先に確かめる）
  ('bbbbbbbb-0000-4000-8000-000000000004', pg_temp.code_hash('test-code-revoked-expired'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 minute', null, null, now() - interval '2 hours'),
  -- 使用済み かつ 期限切れ（使用済みを先に確かめる）
  ('bbbbbbbb-0000-4000-8000-000000000005', pg_temp.code_hash('test-code-used-expired'),
   '11111111-1111-4111-8111-111111111111', now() - interval '1 minute',
   '22222222-2222-4222-8222-222222222222', now() - interval '2 hours', null),
  -- revoke_invite で取り消す（有効）
  ('bbbbbbbb-0000-4000-8000-000000000006', pg_temp.code_hash('test-code-to-revoke'),
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day', null, null, null),
  -- 1 日前に取り消し済み（もう一度取り消しても日時は変わらない）
  ('bbbbbbbb-0000-4000-8000-000000000007', pg_temp.code_hash('test-code-pre-revoked'),
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day', null, null, now() - interval '1 day'),
  -- 使用済み（取り消せない）
  ('bbbbbbbb-0000-4000-8000-000000000008', pg_temp.code_hash('test-code-used'),
   '11111111-1111-4111-8111-111111111111', now() + interval '1 day',
   '22222222-2222-4222-8222-222222222222', now() - interval '1 hour', null);

-- ===========================================================================
-- create_invite
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. 管理者は招待を作れ、コードはこのときだけ返る（7 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.inv24', public.create_invite('24 hours')::text, true) $$,
  '管理者は 24 時間の招待を作れる'
);

reset role;

select ok(
  coalesce((pg_temp.got('inv24')::jsonb ->> 'code') ~ '^[A-Za-z0-9_-]{32}$', false),
  '招待のコードは URL に使える 32 文字（base64url）'
);
select ok(
  abs(extract(epoch from (
    (pg_temp.got('inv24')::jsonb ->> 'expiresAt')::timestamptz - (now() + interval '24 hours')
  ))) < 60,
  '戻り値の expiresAt は今から 24 時間後'
);
select is(
  (select code_hash from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid),
  pg_temp.code_hash(pg_temp.got('inv24')::jsonb ->> 'code'),
  '招待の行の code_hash はコードの SHA-256 の 16 進（コード自体は保存しない）'
);
select is(
  (select created_by from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid),
  '11111111-1111-4111-8111-111111111111'::uuid,
  '招待の行の created_by は作った管理者'
);
select ok(
  abs(extract(epoch from (
    (select expires_at from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid)
    - (now() + interval '24 hours')
  ))) < 60,
  '招待の行の expires_at は今から 24 時間後'
);
select ok(
  (select used_by is null and used_at is null and revoked_at is null
   from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid),
  '作った招待は未使用・未取り消し'
);

-- ---------------------------------------------------------------------------
-- 2. 期限は 3 日・7 日も選べる（4 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select set_config('fd_test.inv3d', public.create_invite('3 days')::text, true) $$,
  '管理者は 3 日の招待を作れる'
);
select lives_ok(
  $$ select set_config('fd_test.inv7d', public.create_invite('7 days')::text, true) $$,
  '管理者は 7 日の招待を作れる'
);

reset role;

select ok(
  abs(extract(epoch from (
    (select expires_at from public.invites where id = (pg_temp.got('inv3d')::jsonb ->> 'id')::uuid)
    - (now() + interval '3 days')
  ))) < 60,
  '3 日の招待の expires_at は今から 3 日後'
);
select ok(
  abs(extract(epoch from (
    (select expires_at from public.invites where id = (pg_temp.got('inv7d')::jsonb ->> 'id')::uuid)
    - (now() + interval '7 days')
  ))) < 60,
  '7 日の招待の expires_at は今から 7 日後'
);

-- ---------------------------------------------------------------------------
-- 3. 期限の選択肢以外は FD005（4 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.create_invite('1 day') $$,
  'FD005', null,
  '期限が選択肢（24 hours・3 days・7 days）にない「1 day」なら招待を作れない（FD005）'
);
select throws_ok(
  $$ select public.create_invite('30 days') $$,
  'FD005', null,
  '期限が 30 日なら招待を作れない（無期限に近い期限は選べない）（FD005）'
);
select throws_ok(
  $$ select public.create_invite('') $$,
  'FD005', null,
  '期限が空なら招待を作れない（FD005）'
);
select throws_ok(
  $$ select public.create_invite(null) $$,
  'FD005', null,
  '期限が null なら招待を作れない（FD005）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. 管理者以外は招待を作れない（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.create_invite('24 hours') $$,
  'FD001', null,
  '協力者は招待を作れない（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.create_invite('24 hours') $$,
  'FD001', null,
  '権限なしのログイン利用者は招待を作れない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.create_invite('24 hours') $$,
  '42501', null,
  'anon は create_invite を実行できない（実行権限なし）'
);

reset role;

-- ===========================================================================
-- accept_invite
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5. 作った招待のコードで受けると協力者になり、招待が使用済みになる（6 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select lives_ok(
  $$ select public.accept_invite(pg_temp.got('inv24')::jsonb ->> 'code', '招待された人') $$,
  '権限なしのログイン利用者は、有効な招待のコードで招待を受けられる'
);

reset role;

select is(
  (select role from public.profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  'collab',
  '招待を受けた人は協力者になる'
);
select is(
  (select display_name from public.profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  '招待された人',
  '招待を受けた人の表示名は渡したもの'
);
select is(
  (select used_by from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid),
  '55555555-5555-4555-8555-555555555555'::uuid,
  '受けた招待の used_by は受けた人'
);
select ok(
  (select used_at is not null from public.invites where id = (pg_temp.got('inv24')::jsonb ->> 'id')::uuid),
  '受けた招待の used_at が入る（使用済み）'
);

select pg_temp.act_as('55555555-5555-4555-8555-555555555555');

select is(public.app_role(), 'collab', '招待を受けた人の app_role() は collab');

reset role;

-- ---------------------------------------------------------------------------
-- 6. 同じコードの 2 回目は使えない（FD006）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select public.accept_invite(pg_temp.got('inv24')::jsonb ->> 'code', '2 人目') $$,
  'FD006', null,
  '使用済みの招待のコードは、別の人でも使えない（FD006）'
);

reset role;

select is(
  (select count(*) from public.profiles where user_id = '66666666-6666-4666-8666-666666666666'),
  0::bigint,
  '使用済みの招待を使おうとした人は協力者にならない'
);

-- ---------------------------------------------------------------------------
-- 7. 期限切れ・取り消し済み・違うコード（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select public.accept_invite('test-code-expired', '期限切れを使う人') $$,
  'FD007', null,
  '期限切れの招待は使えない（FD007）'
);
select throws_ok(
  $$ select public.accept_invite('test-code-revoked', '取り消し済みを使う人') $$,
  'FD008', null,
  '取り消し済みの招待は使えない（FD008）'
);
select throws_ok(
  $$ select public.accept_invite('no-such-code', '違うコードの人') $$,
  'FD009', null,
  'どの招待とも合わないコードは使えない（FD009）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 8. 既に権限がある人は招待を受けられない（FD010）。招待は使われないまま（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.accept_invite('test-code-valid', '協力者テスト') $$,
  'FD010', null,
  '既に協力者の人は招待を受けられない（FD010）'
);

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.accept_invite('test-code-valid', '管理者テスト') $$,
  'FD010', null,
  '管理者は招待を受けられない（FD010）'
);

reset role;

select ok(
  (select used_by is null and used_at is null
   from public.invites where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  '既に権限がある人が受けようとした招待は使われないまま'
);

-- ---------------------------------------------------------------------------
-- 9. 確かめる順（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.accept_invite('no-such-code', '協力者テスト') $$,
  'FD010', null,
  '既に権限がある人なら、コードが合わなくても FD010（権限を先に確かめる）'
);

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select public.accept_invite('test-code-revoked-expired', '順を確かめる人') $$,
  'FD008', null,
  '取り消し済みで期限切れの招待は FD008（取り消しを期限より先に確かめる）'
);
select throws_ok(
  $$ select public.accept_invite('test-code-used-expired', '順を確かめる人') $$,
  'FD006', null,
  '使用済みで期限切れの招待は FD006（使用済みを期限より先に確かめる）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 10. 未ログイン（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as_no_sub();

select throws_ok(
  $$ select public.accept_invite('test-code-valid', 'ログインしていない人') $$,
  'FD001', null,
  'ログインした人の ID（sub）がなければ招待を受けられない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.accept_invite('test-code-valid', 'anon') $$,
  '42501', null,
  'anon は accept_invite を実行できない（実行権限なし）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 11. 直接入れた有効な招待も、コードで受けられる（ハッシュの作り方がテストと同じ）（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('77777777-7777-4777-8777-777777777777');

select lives_ok(
  $$ select public.accept_invite('test-code-valid', '3 人目') $$,
  'コードの SHA-256 の 16 進が code_hash と一致する招待を受けられる'
);

reset role;

select is(
  (select role from public.profiles where user_id = '77777777-7777-4777-8777-777777777777'),
  'collab',
  '直接入れた招待を受けた人も協力者になる'
);

-- ===========================================================================
-- revoke_invite
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 12. 管理者は招待を取り消せ、取り消した招待は使えない（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000006') $$,
  '管理者はまだ使われていない招待を取り消せる'
);

reset role;

select ok(
  (select revoked_at is not null from public.invites where id = 'bbbbbbbb-0000-4000-8000-000000000006'),
  '取り消した招待の revoked_at が入る'
);

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');

select throws_ok(
  $$ select public.accept_invite('test-code-to-revoke', '取り消された招待を使う人') $$,
  'FD008', null,
  'revoke_invite で取り消した招待は使えない（FD008）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 13. 取り消し済みの招待をもう一度取り消してもそのまま（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select lives_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000007') $$,
  '取り消し済みの招待をもう一度取り消してもエラーにならない'
);

reset role;

select is(
  (select revoked_at from public.invites where id = 'bbbbbbbb-0000-4000-8000-000000000007'),
  now() - interval '1 day',
  '取り消し済みの招待をもう一度取り消しても、取り消した日時は変わらない'
);

-- ---------------------------------------------------------------------------
-- 14. 使用済み・ない招待は取り消せない（2 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000008') $$,
  'FD006', null,
  '使用済みの招待は取り消せない（FD006）'
);
select throws_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-0000000000ff') $$,
  'FD009', null,
  'ない招待は取り消せない（FD009）'
);

reset role;

-- ---------------------------------------------------------------------------
-- 15. 管理者以外は取り消せない（3 件）
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'FD001', null,
  '協力者は招待を取り消せない（FD001）'
);

select pg_temp.act_as('44444444-4444-4444-8444-444444444444');

select throws_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'FD001', null,
  '権限なしのログイン利用者は招待を取り消せない（FD001）'
);

select pg_temp.act_as_anon();

select throws_ok(
  $$ select public.revoke_invite('bbbbbbbb-0000-4000-8000-000000000001') $$,
  '42501', null,
  'anon は revoke_invite を実行できない（実行権限なし）'
);

reset role;

select * from finish();
rollback;
