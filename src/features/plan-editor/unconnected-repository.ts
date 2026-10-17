// まだ DB（Supabase）に接続していない定義の保管庫（PR-11a の仮）。
// どの関数も「まだ DB に接続していません」という理由で失敗する。PR-11b で画面は Supabase の保管庫（lazy-repository.ts）に替えたため、いまはどこからも使っていない。
import type { DefinitionRepository } from "./types";

const NOT_CONNECTED = "まだ DB に接続していません";

function notConnected(): Promise<never> {
  return Promise.reject(new Error(NOT_CONNECTED));
}

/** まだ DB に接続していない保管庫（どの関数も失敗する） */
export const unconnectedRepository: DefinitionRepository = {
  load: notConnected,
  saveDraft: notConnected,
  publish: notConnected,
  createEvent: notConnected,
  updateEventMeta: notConnected,
  loadEventContent: notConnected,
};
