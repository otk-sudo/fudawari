// イベント定義の保管庫（DefinitionRepository）の Supabase の実装（PR-11b。docs/design/database.md 3・4 章）。
//
// いまはテストを先に書くための空の入れ物で、どの関数も「未実装」で失敗する。
// 期待する振る舞いは supabase-repository.test.ts に書いてある（実装の担当が中身を書く）。
import type { DefinitionRepository } from "./types";

const NOT_IMPLEMENTED = "未実装（PR-11b）";

function notImplemented(): Promise<never> {
  return Promise.reject(new Error(NOT_IMPLEMENTED));
}

/** イベント定義の保管庫（Supabase の実装）を作る。クライアントは各操作を呼んだときに作る */
export function createSupabaseDefinitionRepository(): DefinitionRepository {
  return {
    load: notImplemented,
    saveDraft: notImplemented,
    publish: notImplemented,
    createEvent: notImplemented,
    updateEventMeta: notImplemented,
    loadEventContent: notImplemented,
  };
}
