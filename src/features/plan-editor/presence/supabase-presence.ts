// 編集中の表示の Supabase Realtime（Presence）の実装（docs/design/database.md 5 章）
// 【PR-12 の先行テスト用の空の入れ物】中身は実装担当が作る（テスト：supabase-presence.test.ts）
import type { PresenceConnection, PresenceConnectOptions } from "./types";

/** イベントごとの Presence のチャンネルにつなぐ（PresenceConnector の Supabase の実装） */
export function connectSupabasePresence(options: PresenceConnectOptions): PresenceConnection {
  void options;
  return {
    setArea: () => {},
    leave: () => {},
  };
}
