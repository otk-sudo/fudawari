// Supabase の定義の保管庫を、使うときに初めて読み込む入れ物。
// supabase-js（大きい）は、定義画面を管理者・協力者が開いて保管庫を呼んだときに初めて読み込む
// （一般利用者が /definition を開いても、拒否の表示だけで supabase-js を読み込まない）
import type { DefinitionRepository } from "./types";

const MSG_MODULE_FAILED = "通信に失敗しました（画面の部品を読み込めませんでした）。ページを再読み込みしてください";

/** Supabase の保管庫を遅延読み込みする保管庫を作る。作っただけでは何も読み込まない */
export function createLazySupabaseDefinitionRepository(): DefinitionRepository {
  let loaded: Promise<DefinitionRepository> | null = null;

  /** Supabase の保管庫を読み込む（失敗したら、次に呼んだときに読み直す） */
  const repository = (): Promise<DefinitionRepository> => {
    if (loaded === null) {
      loaded = import("./supabase-repository").then(
        (module) => module.createSupabaseDefinitionRepository(),
        () => {
          loaded = null;
          throw new Error(MSG_MODULE_FAILED);
        },
      );
    }
    return loaded;
  };

  return {
    load: async () => (await repository()).load(),
    saveDraft: async (input) => (await repository()).saveDraft(input),
    publish: async (input) => (await repository()).publish(input),
    createEvent: async (input) => (await repository()).createEvent(input),
    updateEventMeta: async (input) => (await repository()).updateEventMeta(input),
    loadEventContent: async (eventId) => (await repository()).loadEventContent(eventId),
  };
}
