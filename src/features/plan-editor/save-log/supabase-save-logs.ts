// 保存の記録を Supabase の save_logs 表から読む（docs/design/database.md 2.6・3 章）
// 【PR-12 の先行テスト用の空の入れ物】中身は実装担当が作る（テスト：supabase-save-logs.test.ts）
import type { SaveLogEntry } from "./types";

/** イベントの保存の記録を新しい順にすべて読む（SaveLogLoader の Supabase の実装） */
export async function loadSaveLogs(eventId: string): Promise<SaveLogEntry[]> {
  void eventId;
  throw new Error("未実装（PR-12）");
}
