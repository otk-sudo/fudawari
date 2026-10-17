// ビルドの前の公開定義の取得をするか（scripts/fetch-latest-definition.ts の入口の判断。PR-13a のレビュー M2）のテスト
// 環境変数を引数で渡し、取得する／飛ばす／設定の誤りで止める、を確かめる
import { describe, expect, it } from "vitest";
import { decideDefinitionFetch, type DefinitionFetchEnv } from "./decideDefinitionFetch";

/** Cloudflare Pages の本番のビルドの環境変数（本番のブランチは release。要件 13.1 の D2） */
const CF_PRODUCTION: DefinitionFetchEnv = { CF_PAGES: "1", CF_PAGES_BRANCH: "release" };

describe("decideDefinitionFetch（公開定義の取得をするか）", () => {
  it("FETCH_LATEST_DEFINITION が 1 なら取得する", () => {
    expect(decideDefinitionFetch({ FETCH_LATEST_DEFINITION: "1" })).toEqual({ kind: "fetch" });
  });

  it.each<[string, DefinitionFetchEnv]>([
    ["未設定", {}],
    ["0", { FETCH_LATEST_DEFINITION: "0" }],
  ])("FETCH_LATEST_DEFINITION が %s なら、取得を飛ばし、テスト用の定義を使うと伝える（手元・CI）", (_label, env) => {
    const decision = decideDefinitionFetch(env);

    expect(decision.kind).toBe("skip");
    expect(decision.kind === "skip" ? decision.message : "").toContain("公開定義の取得を飛ばしました");
  });

  it.each(["", "true", "yes", " 1", "1 ", "2", "TRUE"])(
    "FETCH_LATEST_DEFINITION が未設定・0・1 以外（%j）なら、変数の名前と今の値を入れた設定の誤りにする",
    (value) => {
      const decision = decideDefinitionFetch({ FETCH_LATEST_DEFINITION: value });

      expect(decision.kind).toBe("error");
      const message = decision.kind === "error" ? decision.message : "";
      expect(message).toContain("FETCH_LATEST_DEFINITION");
      expect(message).toContain(JSON.stringify(value));
    },
  );

  it("Cloudflare Pages の本番のビルドで FETCH_LATEST_DEFINITION が 1 なら取得する", () => {
    expect(decideDefinitionFetch({ ...CF_PRODUCTION, FETCH_LATEST_DEFINITION: "1" })).toEqual({ kind: "fetch" });
  });

  it.each<[string, DefinitionFetchEnv]>([
    ["未設定", CF_PRODUCTION],
    ["0", { ...CF_PRODUCTION, FETCH_LATEST_DEFINITION: "0" }],
  ])(
    "Cloudflare Pages の本番のビルドで FETCH_LATEST_DEFINITION が %s なら、テスト用の定義を本番に出さないよう設定の誤りにする",
    (_label, env) => {
      const decision = decideDefinitionFetch(env);

      expect(decision.kind).toBe("error");
      const message = decision.kind === "error" ? decision.message : "";
      expect(message).toContain("FETCH_LATEST_DEFINITION");
      expect(message).toContain("release");
    },
  );

  it.each<[string, DefinitionFetchEnv]>([
    ["Cloudflare Pages の本番でないブランチ（プレビュー）", { CF_PAGES: "1", CF_PAGES_BRANCH: "main" }],
    ["Cloudflare Pages でない（CF_PAGES がない）のに CF_PAGES_BRANCH が release", { CF_PAGES_BRANCH: "release" }],
    ["CF_PAGES が 1 でない", { CF_PAGES: "0", CF_PAGES_BRANCH: "release" }],
  ])("%s なら、FETCH_LATEST_DEFINITION が未設定でも取得を飛ばす", (_label, env) => {
    expect(decideDefinitionFetch(env).kind).toBe("skip");
  });
});
