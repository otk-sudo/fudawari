// 保存の記録を Supabase の save_logs 表から読む（docs/design/database.md 2.6・3 章、roadmap T3-10）
//
// - 読むのは RLS で読める save_logs 表だけ（書き込みは save_draft・publish_definition の RPC が行う。ここでは書かない）
// - 保存した人の名前は、保存した時点の表示名を複写した user_name を使う（profiles とは突き合わせない。外された人の記録も名前が残る）
// - v1 では、開いたイベントの記録を新しい順にすべて読み、絞り込み・8 件ずつの表示は画面側（view.ts）で行う
// - 失敗の理由の文は定義の保管庫（supabase-repository.ts）と同じ。この部品は supabase-js を読み込むので、画面は lazy.ts から遅延読み込みする
import { asInteger, asRows, asString, invalidResponse, requireClient, run, toJstIso } from "../supabase-repository";
import type { SaveLogEntry, SaveLogKind } from "./types";

const SAVE_LOG_COLUMNS = "id, created_at, user_name, kind, map_label, summary";

function asKind(value: unknown): SaveLogKind {
  if (value !== "save" && value !== "publish") throw invalidResponse();
  return value;
}

function asStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function toEntry(row: Record<string, unknown>): SaveLogEntry {
  return {
    id: asInteger(row.id),
    createdAt: toJstIso(row.created_at),
    userName: asString(row.user_name),
    kind: asKind(row.kind),
    mapLabel: asStringOrNull(row.map_label),
    summary: asString(row.summary),
  };
}

/** イベントの保存の記録を新しい順（created_at の新しい順、同じなら id の大きい順）にすべて読む（SaveLogLoader の Supabase の実装） */
export async function loadSaveLogs(eventId: string): Promise<SaveLogEntry[]> {
  const client = requireClient();
  const data = await run(
    client
      .from("save_logs")
      .select(SAVE_LOG_COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  );
  return asRows(data).map(toEntry);
}
