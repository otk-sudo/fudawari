// 保存の記録の読み取りを、使うときに初めて読み込む入れ物（lazy-repository.ts と同じ方針）。
// supabase-js（大きい）は、管理者・協力者が「保存の記録を見る」を押したときに初めて読み込む
import type { SaveLogLoader } from "./types";

const MSG_MODULE_FAILED = "通信に失敗しました（画面の部品を読み込めませんでした）。ページを再読み込みしてください";

/** Supabase の save_logs から読む SaveLogLoader（呼ばれたときに部品を読み込む。失敗したら次に呼んだときに読み直す） */
export const loadSaveLogsLazily: SaveLogLoader = async (eventId) => {
  let loaded: typeof import("./supabase-save-logs");
  try {
    loaded = await import("./supabase-save-logs");
  } catch {
    throw new Error(MSG_MODULE_FAILED);
  }
  return loaded.loadSaveLogs(eventId);
};
