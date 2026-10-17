// ビルドの前に最新イベントの公開定義を Supabase から取得するかの判断（scripts/fetch-latest-definition.ts の入口。docs/design/database.md 6 章）
//
// - 環境変数 FETCH_LATEST_DEFINITION は、未設定・"0"・"1" だけを認める。"1" なら取得し、未設定・"0" なら取得を飛ばして
//   追跡しているテスト用の定義を使う（手元・CI）。それ以外の値は設定の誤りとして止める（"true" などの書き間違いで、取得したつもりが
//   テスト用の定義のまま公開されないため）。
// - Cloudflare Pages の本番のビルド（CF_PAGES が "1" かつ CF_PAGES_BRANCH が本番のブランチ "release"。要件 13.1 の D2）では、
//   FETCH_LATEST_DEFINITION が "1" でなければ止める（設定の漏れでテスト用の定義を本番に出さないため）。
// - 環境変数は引数で受け取る純粋な関数にする（テストでは値を渡すだけ。入口は process.env を渡す）。

/** Cloudflare Pages の本番のブランチ（要件 13.1 の D2） */
export const PRODUCTION_BRANCH = "release";

/** 判断に使う環境変数（process.env をそのまま渡せる） */
export type DefinitionFetchEnv = Readonly<Record<string, string | undefined>>;

/** 判断の結果 */
export type DefinitionFetchDecision =
  /** 取得する */
  | { kind: "fetch" }
  /** 取得を飛ばし、追跡しているテスト用の定義を使う。message は表示する文 */
  | { kind: "skip"; message: string }
  /** 設定の誤り。message は理由（入口は表示して終了コード 1 で止める） */
  | { kind: "error"; message: string };

/** 公開定義の取得をするかを、環境変数から決める */
export function decideDefinitionFetch(env: DefinitionFetchEnv): DefinitionFetchDecision {
  const value = env.FETCH_LATEST_DEFINITION;
  if (value !== undefined && value !== "0" && value !== "1") {
    return {
      kind: "error",
      message:
        `環境変数 FETCH_LATEST_DEFINITION の値 ${JSON.stringify(value)} は使えません。` +
        "取得するなら 1、取得しないなら 0 にするか、設定を外してください",
    };
  }
  if (value === "1") return { kind: "fetch" };

  if (env.CF_PAGES === "1" && env.CF_PAGES_BRANCH === PRODUCTION_BRANCH) {
    return {
      kind: "error",
      message:
        `Cloudflare Pages の本番のビルド（${PRODUCTION_BRANCH} ブランチ）では、環境変数 FETCH_LATEST_DEFINITION を 1 にしてください` +
        `（いまは ${value === undefined ? "未設定" : JSON.stringify(value)}）。テスト用の定義を本番に出さないよう止めました`,
    };
  }

  return {
    kind: "skip",
    message: "公開定義の取得を飛ばしました（FETCH_LATEST_DEFINITION が 1 ではない。追跡しているテスト用の定義を使います）",
  };
}
