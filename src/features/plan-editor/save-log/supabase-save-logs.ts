// 保存の記録を Supabase の save_logs 表から読む（docs/design/database.md 2.6・3 章、roadmap T3-10）
//
// - 読むのは RLS で読める save_logs 表だけ（書き込みは save_draft・publish_definition の RPC が行う。ここでは書かない）
// - 保存した人の名前は、保存した時点の表示名を複写した user_name を使う（profiles とは突き合わせない。外された人の記録も名前が残る）。
//   「誰が」の絞り込みで同じ表示名の人を見分けるため、user_id（null もある）も返す
// - v1 では、開いたイベントの記録を新しい順にすべて読み、絞り込み・8 件ずつの表示は画面側（view.ts）で行う。
//   PostgREST は 1 回に返す行数に上限（max_rows。既定 1000）があるため、1000 件ずつ range で読み、返った件数が 1000 未満になるまでくり返す。
//   途中で失敗したら、途中までの記録は返さずに全体を失敗にする
// - 失敗の理由の文は定義の保管庫（supabase-repository.ts）と同じ。この部品は supabase-js を読み込むので、画面は lazy.ts から遅延読み込みする
import { asInteger, asRows, asString, invalidResponse, requireClient, run, toJstIso } from "../supabase-repository";
import type { SaveLogEntry, SaveLogKind } from "./types";

const SAVE_LOG_COLUMNS = "id, created_at, user_id, user_name, kind, map_label, summary";

/** 1 回に読む件数（PostgREST の max_rows の既定と同じ） */
const PAGE_ROWS = 1000;

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
    userId: asStringOrNull(row.user_id),
    userName: asString(row.user_name),
    kind: asKind(row.kind),
    mapLabel: asStringOrNull(row.map_label),
    summary: asString(row.summary),
  };
}

/** イベントの保存の記録を新しい順（created_at の新しい順、同じなら id の大きい順）にすべて読む（SaveLogLoader の Supabase の実装） */
export async function loadSaveLogs(eventId: string): Promise<SaveLogEntry[]> {
  const client = requireClient();
  const entries: SaveLogEntry[] = [];
  // 読んでいる間に新しい記録が足されると、次のページに同じ記録がずれて入ることがあるので、id で 1 つにする
  const seen = new Set<number>();
  for (let from = 0; ; from += PAGE_ROWS) {
    const data = await run(
      client
        .from("save_logs")
        .select(SAVE_LOG_COLUMNS)
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE_ROWS - 1),
    );
    const rows = asRows(data);
    for (const entry of rows.map(toEntry)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    if (rows.length < PAGE_ROWS) return entries;
  }
}
