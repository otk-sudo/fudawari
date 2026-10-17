-- 定義画面の「編集中」の表示（Realtime の Presence）を、管理者・協力者だけに限る（roadmap T3-9。設計は docs/design/database.md の 5 章）
--
-- - 画面は「plan-editor:（イベント ID）」の private チャンネルで参加する。private のチャンネルは realtime.messages の RLS で許可を決める。
-- - 判定は can_use_editor_presence(topic) にまとめ、ポリシーから呼ぶ（判定の中身を pgTAP で確かめられるようにする）。
-- - 公開のチャンネルでは誰でも参加できるため、本番では Realtime の設定「Allow public access」を切る（運用の手順。docs/plan-v1.md 6.5）。

create function public.can_use_editor_presence(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_topic like 'plan-editor:%', false)
     and coalesce(public.app_role() in ('admin', 'collab'), false)
$$;

revoke execute on function public.can_use_editor_presence(text) from public, anon;
grant execute on function public.can_use_editor_presence(text) to authenticated;

create policy editor_presence_select on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and public.can_use_editor_presence((select realtime.topic()))
  );

create policy editor_presence_insert on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and public.can_use_editor_presence((select realtime.topic()))
  );
