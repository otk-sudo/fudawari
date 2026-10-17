// 編集中の表示のつなぎ先を、使うときに初めて読み込む入れ物（lazy-repository.ts と同じ方針）。
// supabase-js（大きい）は、管理者・協力者が定義画面で既存のイベントを開いたときに初めて読み込む
import type { PresenceConnection, PresenceConnector } from "./types";

/**
 * Supabase の Presence につなぐ PresenceConnector（部品を裏で読み込んでからつなぐ）。
 * 読み込みの前の setArea は、つなぐときの海域に反映する。読み込みの前に leave したら、つながない。
 * 部品を読み込めなければ何もしない（編集中の表示が出ないだけ）
 */
export const connectPresenceLazily: PresenceConnector = (options) => {
  let inner: PresenceConnection | null = null;
  let areaName = options.areaName;
  let left = false;

  import("./supabase-presence").then(
    (loaded) => {
      if (left) return;
      inner = loaded.connectSupabasePresence({ ...options, areaName });
    },
    () => {
      // 読み込めなかったときは出さない
    },
  );

  return {
    setArea(next) {
      areaName = next;
      inner?.setArea(next);
    },
    leave() {
      left = true;
      inner?.leave();
      inner = null;
    },
  };
};
