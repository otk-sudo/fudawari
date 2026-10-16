-- 札割りプランナーの DB の初版（roadmap T3-3。設計は docs/design/database.md）
--
-- - 表への書き込みは、すべて RPC（security definer の関数）を通す。表には直接の INSERT／UPDATE／DELETE の権限を与えない。
-- - 読み取りは RLS で権限ごとに絞る。anon・authenticated には読める表の SELECT だけを与える（Supabase の既定の権限は明示の REVOKE で外す）。
-- - ログインは、管理者が発行した ID とパスワード（Supabase Auth のメール＋パスワード。ID は内部で「ID@fudawari.invalid」の形）。
--   アカウントは管理者の画面が作り、register_collaborator で協力者にする（U3。2026-10-17 変更）。
-- - 例外のコードは FD001〜FD011（設計書 4.1）。画面は supabase-js の error.code で出し分ける。

-- ===========================================================================
-- 表
-- ===========================================================================

-- 管理者・協力者（行がない人は一般利用者）
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'collab')),
  created_at timestamptz not null default now(),
  last_edited_at timestamptz,
  last_edited_note text
);

-- イベント（名前・期間の正）
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

-- アプリの状態（1 行だけ）。最新＝最後に「公開して最新にした」イベント（U18）
create table public.app_state (
  id boolean primary key default true check (id),
  latest_event_id uuid references public.events (id)
);

insert into public.app_state (id) values (true);

-- 共有の下書き（イベントごとに 1 つ）。version は保存のたびに 1 増える
create table public.drafts (
  event_id uuid primary key references public.events (id) on delete cascade,
  version integer not null default 1,
  content jsonb not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

-- 公開版
create table public.published_definitions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  version_label text not null,
  content jsonb not null,
  draft_version integer not null,
  published_by uuid not null,
  published_at timestamptz not null default now()
);

create index published_definitions_event_idx
  on public.published_definitions (event_id, published_at desc);

-- 保存の記録（外された人の記録も残すため user_id は FK にせず、名前を複写する）
create table public.save_logs (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id),
  user_id uuid,
  user_name text not null,
  kind text not null check (kind in ('save', 'publish')),
  map_label text,
  summary text not null,
  created_at timestamptz not null default now()
);

create index save_logs_event_idx on public.save_logs (event_id, created_at desc, id desc);

-- ===========================================================================
-- 表の権限と RLS（読み取り。書き込みのポリシーは作らない）
-- ===========================================================================

revoke all on table
  public.profiles,
  public.events,
  public.app_state,
  public.drafts,
  public.published_definitions,
  public.save_logs
from public, anon, authenticated;

-- 保存の記録の id（identity 列）のシーケンスにも、既定で付く権限を外す（書き込みは RPC だけ）
revoke all on sequence public.save_logs_id_seq from public, anon, authenticated;

grant select on table public.app_state, public.published_definitions to anon, authenticated;
grant select on table
  public.profiles,
  public.events,
  public.drafts,
  public.save_logs
to authenticated;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.app_state enable row level security;
alter table public.drafts enable row level security;
alter table public.published_definitions enable row level security;
alter table public.save_logs enable row level security;

-- 自分の権限（'admin'／'collab'）。行がない・未ログインなら null。RLS の判定に使う
create function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

revoke execute on function public.app_role() from public;
grant execute on function public.app_role() to anon, authenticated;

create policy app_state_select on public.app_state
  for select to anon, authenticated using (true);

create policy published_definitions_select on public.published_definitions
  for select to anon, authenticated using (true);

-- 権限なしのログイン利用者は自分の行だけ（権限の確認用）。協力者・管理者は全行
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.app_role() is not null);

create policy events_select on public.events
  for select to authenticated using (public.app_role() is not null);

create policy drafts_select on public.drafts
  for select to authenticated using (public.app_role() is not null);

create policy save_logs_select on public.save_logs
  for select to authenticated using (public.app_role() is not null);

-- ===========================================================================
-- 内部の補助（RPC の中からだけ使う。外からは実行できない）
-- ===========================================================================

-- 例外を投げる（コードは FD001〜FD011）
create function public._raise(p_code text, p_message text)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  raise exception using errcode = p_code, message = p_message;
end;
$$;

-- ログインしていて、許された権限を持つことを確かめ、権限を返す（なければ FD001）
-- 自分の profiles の行を FOR KEY SHARE でロックする。協力者を外す操作（行の削除）は、実行中の保存・公開が終わるまで待つ
-- （外した後に保存がコミットされ、記録が残らない、を防ぐ）。FOR KEY SHARE は同じ人の保存どうし・表示名の更新とは衝突しない。
-- ロックの順は、自分の profiles → app_state → イベント → 下書き
create function public._require_role(p_allowed text[] default array['admin', 'collab'])
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    perform public._raise('FD001', 'ログインしてください');
  end if;
  select role into v_role from public.profiles where user_id = auth.uid() for key share;
  if v_role is null or not (v_role = any (p_allowed)) then
    perform public._raise('FD001', 'この操作をする権限がありません');
  end if;
  return v_role;
end;
$$;

-- 更新できるイベントかを確かめる（設計書 4.2 の「更新できるイベント」）
--   ない → FD009、終了 → FD002、
--   協力者：最新のイベント以外 → FD003、管理者：最新でも未公開でもない → FD003
-- 確かめた状態が書き込みまで変わらないよう、app_state とイベントの行を共有ロックする（トランザクションの終わりまで）。
-- 最新の切り替え（publish_definition が app_state を排他ロック）と、イベントの名前・期間の更新（update_event_meta が
-- イベントの行を排他ロック）は、確かめてから書くまでの間に割り込めない。
-- ロックの順は、どの RPC でも app_state → イベント → 下書き（デッドロックを避ける）
create function public._check_editable_event(p_event_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_latest uuid;
begin
  select latest_event_id into v_latest from public.app_state for share;
  select * into v_event from public.events where id = p_event_id for share;
  if not found then
    perform public._raise('FD009', 'イベントが見つかりません');
  end if;
  -- 終了の判定は、ロックを取った後の実際の時刻で行う（now() はトランザクションの開始時刻のため、ロックを待つ間に終了日時を
  -- 過ぎても更新できてしまう）
  if v_event.ends_at is not null and v_event.ends_at <= clock_timestamp() then
    perform public._raise('FD002', 'このイベントは終了しているため更新できません');
  end if;
  if v_latest is not distinct from p_event_id then
    return;
  end if;
  if p_role = 'admin'
     and not exists (select 1 from public.published_definitions where event_id = p_event_id) then
    return;
  end if;
  perform public._raise('FD003', '最新のイベントではないため更新できません');
end;
$$;

-- 定義の文書の最低限の形（オブジェクトで schemaVersion が 1）を確かめる（違えば FD005）
create function public._check_document(p_content jsonb)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  if p_content is null
     or jsonb_typeof(p_content) <> 'object'
     or (p_content -> 'schemaVersion') is distinct from '1'::jsonb then
    perform public._raise('FD005', '定義の文書の形が正しくありません');
  end if;
end;
$$;

-- 保存の記録（[{ "mapLabel": 文字列か null, "summary": 空でない文字列 }]）の形を確かめる（違えば FD005）
create function public._check_logs(p_logs jsonb)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  if p_logs is null or jsonb_typeof(p_logs) <> 'array' then
    perform public._raise('FD005', '保存の記録は配列で渡してください');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_logs) as l (item)
    where jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item -> 'summary') is distinct from 'string'
       or btrim(item ->> 'summary') = ''
       or (item ? 'mapLabel' and jsonb_typeof(item -> 'mapLabel') not in ('string', 'null'))
  ) then
    perform public._raise('FD005', '保存の記録の形が正しくありません');
  end if;
end;
$$;

-- 日時を日本時間の "YYYY-MM-DDTHH:MI:SS+09:00" にする（公開定義 JSON の形）
create function public._jst_text(p_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
$$;

revoke execute on function
  public._raise(text, text),
  public._require_role(text[]),
  public._check_editable_event(uuid, text),
  public._check_document(jsonb),
  public._check_logs(jsonb),
  public._jst_text(timestamptz)
from public, anon, authenticated;

-- ===========================================================================
-- RPC（書き込み）
-- ===========================================================================

-- 下書きを保存する。版が違えば保存せず、今の内容を返す（画面で 3 方向マージする）
create function public.save_draft(
  p_event_id uuid,
  p_base_version integer,
  p_content jsonb,
  p_logs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._require_role();
  v_uid uuid := auth.uid();
  v_draft public.drafts%rowtype;
  v_version integer;
begin
  perform public._check_editable_event(p_event_id, v_role);
  perform public._check_document(p_content);
  perform public._check_logs(p_logs);

  select * into v_draft from public.drafts where event_id = p_event_id for update;
  if not found then
    perform public._raise('FD009', '下書きが見つかりません');
  end if;
  -- 同じ下書きを別の人が保存中だと、上の行ロックで待つ。待つ間に終了日時を過ぎていないか、ロックの後にもう一度確かめる
  if exists (
    select 1 from public.events
    where id = p_event_id and ends_at is not null and ends_at <= clock_timestamp()
  ) then
    perform public._raise('FD002', 'このイベントは終了しているため更新できません');
  end if;

  if v_draft.version is distinct from p_base_version then
    return jsonb_build_object(
      'status', 'conflict',
      'version', v_draft.version,
      'content', v_draft.content,
      'updatedByName', coalesce(
        (select display_name from public.profiles where user_id = v_draft.updated_by),
        '不明'
      ),
      'updatedAt', v_draft.updated_at
    );
  end if;

  update public.drafts
  set version = version + 1, content = p_content, updated_by = v_uid, updated_at = now()
  where event_id = p_event_id
  returning version into v_version;

  insert into public.save_logs (event_id, user_id, user_name, kind, map_label, summary)
  select p_event_id, v_uid, p.display_name, 'save', l.item ->> 'mapLabel', l.item ->> 'summary'
  from jsonb_array_elements(p_logs) with ordinality as l (item, n)
  cross join (select display_name from public.profiles where user_id = v_uid) as p
  order by l.n;

  update public.profiles
  set last_edited_at = now(), last_edited_note = '下書きを保存'
  where user_id = v_uid;

  return jsonb_build_object('status', 'saved', 'version', v_version);
end;
$$;

-- 下書きを公開する。p_make_latest なら最新のイベントを切り替える（管理者だけ）
create function public.publish_definition(
  p_event_id uuid,
  p_base_version integer,
  p_make_latest boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._require_role();
  v_uid uuid := auth.uid();
  v_make_latest boolean := coalesce(p_make_latest, false);
  v_event public.events%rowtype;
  v_draft public.drafts%rowtype;
  v_latest uuid;
  v_now timestamptz;
  v_today date;
  v_label text;
  v_content jsonb;
  v_id uuid;
begin
  if v_make_latest and v_role <> 'admin' then
    perform public._raise('FD001', '最新のイベントを切り替えられるのは管理者だけです');
  end if;
  -- 最新の切り替えを公開の終わりまで止めるため、先に app_state を排他ロックする（ロックの順は app_state → イベント → 下書き）
  select latest_event_id into v_latest from public.app_state for update;
  perform public._check_editable_event(p_event_id, v_role);
  if v_latest is distinct from p_event_id and not v_make_latest then
    perform public._raise('FD003', '最新のイベントではないため、最新にせずに公開することはできません');
  end if;

  -- 公開版を入れるまでイベントの名前・期間が変わらないよう、行をロックしたまま読む（_check_editable_event で共有ロック済み）
  select * into v_event from public.events where id = p_event_id for share;
  select * into v_draft from public.drafts where event_id = p_event_id for update;
  if not found then
    perform public._raise('FD009', '下書きが見つかりません');
  end if;

  -- 公開日時・版の日付・版の表示は、ロックを取った後の 1 つの時刻から決める（日付の変わり目でロックを待っても食い違わない）
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Tokyo')::date;
  v_label := to_char(v_today, 'YYYY/MM/DD') || ' 版';
  if v_draft.version is distinct from p_base_version then
    perform public._raise('FD004', '下書きが更新されています。読み直してから公開してください');
  end if;

  -- イベントの名前・期間は events 表を正とし、版の日付は公開した日（日本時間）にする
  v_content := jsonb_set(
    v_draft.content,
    '{event}',
    jsonb_build_object(
      'id', v_event.id::text,
      'name', v_event.name,
      'startAt', public._jst_text(v_event.starts_at),
      'endAt', case when v_event.ends_at is null then null else public._jst_text(v_event.ends_at) end,
      'versionDate', to_char(v_today, 'YYYY-MM-DD')
    )
  );

  -- 公開日時は v_now（トランザクションの開始時刻ではなく、app_state のロックを取った後の時刻。公開の順と並びを合わせる）
  insert into public.published_definitions (event_id, version_label, content, draft_version, published_by, published_at)
  values (p_event_id, v_label, v_content, v_draft.version, v_uid, v_now)
  returning id into v_id;

  insert into public.save_logs (event_id, user_id, user_name, kind, map_label, summary)
  select p_event_id, v_uid, display_name, 'publish', null, '公開（' || v_label || '）'
  from public.profiles
  where user_id = v_uid;

  if v_make_latest then
    update public.app_state set latest_event_id = p_event_id where id;
  end if;

  update public.profiles
  set last_edited_at = now(), last_edited_note = '公開'
  where user_id = v_uid;

  return jsonb_build_object(
    'status', 'published',
    'id', v_id,
    'versionLabel', v_label,
    'versionDate', to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

-- イベントと下書き（版 1）を作る。初期の文書は画面が作る（createDefinition）
create function public.create_event(
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_content jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  perform public._require_role(array['admin']);
  v_uid := auth.uid();
  if p_name is null or btrim(p_name) = '' then
    perform public._raise('FD005', 'イベント名を入れてください');
  end if;
  if p_starts_at is null then
    perform public._raise('FD005', '開始日時を入れてください');
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    perform public._raise('FD005', '終了日時は開始日時より後にしてください');
  end if;
  if p_ends_at is not null and p_ends_at <= clock_timestamp() then
    perform public._raise('FD005', '終了日時は今より後にしてください');
  end if;
  perform public._check_document(p_content);

  insert into public.events (name, starts_at, ends_at, created_by)
  values (btrim(p_name), p_starts_at, p_ends_at, v_uid)
  returning id into v_id;

  -- 画面はイベント ID を知らないまま初期の文書を作るので、下書きの event.id を作ったイベントの ID に書き直す
  insert into public.drafts (event_id, version, content, updated_by)
  values (
    v_id,
    1,
    p_content || jsonb_build_object(
      'event',
      coalesce(p_content -> 'event', '{}'::jsonb) || jsonb_build_object('id', v_id::text)
    ),
    v_uid
  );

  return v_id;
end;
$$;

-- イベントの名前・開始日時・終了日時を更新する（協力者は終了日時だけ）
create function public.update_event_meta(
  p_event_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public._require_role();
  v_event public.events%rowtype;
begin
  -- 同じイベントを 2 人が同時に更新しても、共有ロックからの格上げで行き詰まらないよう、
  -- 確かめる前にイベントの行を排他ロックしておく（ロックの順は app_state → イベント）
  perform 1 from public.app_state for share;
  select * into v_event from public.events where id = p_event_id for update;
  perform public._check_editable_event(p_event_id, v_role);

  if v_role = 'collab'
     and (p_name is distinct from v_event.name or p_starts_at is distinct from v_event.starts_at) then
    perform public._raise('FD001', '協力者が変えられるのは終了日時だけです');
  end if;
  if p_name is null or btrim(p_name) = '' then
    perform public._raise('FD005', 'イベント名を入れてください');
  end if;
  if p_starts_at is null then
    perform public._raise('FD005', '開始日時を入れてください');
  end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    perform public._raise('FD005', '終了日時は開始日時より後にしてください');
  end if;
  if p_ends_at is not null and p_ends_at <= clock_timestamp() then
    perform public._raise('FD005', '終了日時は今より後にしてください');
  end if;

  update public.events
  set name = btrim(p_name), starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_event_id;
end;
$$;

-- 管理者が発行したアカウント（auth.users にいる人）を協力者にする
--   管理者だけ。相手が auth.users にいない → FD009、すでに profiles に行がある（管理者を含む） → FD010、
--   表示名が空・メールが @fudawari.invalid で終わらない → FD005
create function public.register_collaborator(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_role(array['admin']);
  if p_display_name is null or btrim(p_display_name) = '' then
    perform public._raise('FD005', '表示名を入れてください');
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    perform public._raise('FD009', 'アカウントが見つかりません');
  end if;
  if exists (select 1 from public.profiles where user_id = p_user_id) then
    perform public._raise('FD010', 'すでに定義を編集できる権限があります');
  end if;
  -- ID の形（ID@fudawari.invalid）のアカウントだけを協力者にする（実在のメールアドレスのアカウントを入れない。
  -- 発行した本人のアカウントかどうかは、画面が自分の signUp で返った user ID を渡すことで決まる）
  if not exists (
    select 1 from auth.users where id = p_user_id and lower(email) like '%@fudawari.invalid'
  ) then
    perform public._raise('FD005', 'ID の形のアカウントではありません');
  end if;
  insert into public.profiles (user_id, display_name, role)
  values (p_user_id, btrim(p_display_name), 'collab');
exception
  when unique_violation then
    perform public._raise('FD010', 'すでに定義を編集できる権限があります');
  when foreign_key_violation then
    perform public._raise('FD009', 'アカウントが見つかりません');
end;
$$;

-- 協力者を外す（管理者は外せない。自分自身も）
create function public.remove_collaborator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role text;
begin
  perform public._require_role(array['admin']);
  select role into v_target_role from public.profiles where user_id = p_user_id for update;
  if not found then
    perform public._raise('FD009', '協力者が見つかりません');
  end if;
  if v_target_role = 'admin' then
    perform public._raise('FD011', '管理者は外せません');
  end if;
  delete from public.profiles where user_id = p_user_id;
end;
$$;

-- 自分の表示名を更新する
create function public.touch_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    perform public._raise('FD001', 'ログインしてください');
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    perform public._raise('FD005', '表示名がありません');
  end if;
  update public.profiles set display_name = btrim(p_display_name) where user_id = auth.uid();
  if not found then
    perform public._raise('FD001', 'この操作をする権限がありません');
  end if;
end;
$$;

-- RPC は authenticated だけが実行できる（既定で付く権限をいったんすべて取り消してから、authenticated に与える）
revoke execute on function
  public.save_draft(uuid, integer, jsonb, jsonb),
  public.publish_definition(uuid, integer, boolean),
  public.create_event(text, timestamptz, timestamptz, jsonb),
  public.update_event_meta(uuid, text, timestamptz, timestamptz),
  public.register_collaborator(uuid, text),
  public.remove_collaborator(uuid),
  public.touch_profile(text)
from public, anon, authenticated;

grant execute on function
  public.save_draft(uuid, integer, jsonb, jsonb),
  public.publish_definition(uuid, integer, boolean),
  public.create_event(text, timestamptz, timestamptz, jsonb),
  public.update_event_meta(uuid, text, timestamptz, timestamptz),
  public.register_collaborator(uuid, text),
  public.remove_collaborator(uuid),
  public.touch_profile(text)
to authenticated;
