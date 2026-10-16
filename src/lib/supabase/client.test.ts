import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIssuingSupabaseClient,
  getSupabaseClient,
  resetSupabaseClient,
} from "@/lib/supabase";
import {
  FAKE_SUPABASE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  type FakeSupabase,
  installFakeSupabase,
  type SupabaseEnvName,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// クライアントの入口（docs/design/database.md 2.1.1）
// - ふだんのクライアント：ログインしたセッションをブラウザに保存する。1 つだけ作って使い回す
// - 協力者のアカウントを作るための別のクライアント：セッションを保存しない（auth.persistSession: false）。管理者のログインを変えない
// - どちらも、設定（環境変数）がなければ作らない

const MISSING_ENV_CASES: ReadonlyArray<[string, SupabaseEnvName]> = [
  ["URL がない", "NEXT_PUBLIC_SUPABASE_URL"],
  ["公開キーがない", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
];

/** createClient の n 回目の呼び出しの設定（第 3 引数） */
function optionsOfCall(fake: FakeSupabase, index: number): unknown {
  return fake.createClient.mock.calls[index]?.[2];
}

describe("Supabase のクライアントの入口（@/lib/supabase）", () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = installFakeSupabase();
    resetSupabaseClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getSupabaseClient：ふだんのクライアント", () => {
    it.each(MISSING_ENV_CASES)("%sときは null を返し、クライアントを作らない", (_label, name) => {
      // 準備
      stubSupabaseEnvWithout(name);

      // 実行
      const client = getSupabaseClient();

      // 検証
      expect(client).toBeNull();
      expect(fake.createClient).not.toHaveBeenCalled();
    });

    it("設定があれば、環境変数の URL と公開キーでクライアントを作って返す", () => {
      // 準備
      stubSupabaseEnv();

      // 実行
      const client = getSupabaseClient();

      // 検証
      expect(client).toBe(fake.main);
      expect(fake.createClient).toHaveBeenCalledTimes(1);
      // 第 3 引数（設定）は渡しても渡さなくてもよい。URL と公開キーだけを見る
      expect(fake.createClient.mock.calls[0]?.slice(0, 2)).toEqual([
        FAKE_SUPABASE_URL,
        FAKE_SUPABASE_PUBLISHABLE_KEY,
      ]);
    });

    it("ふだんのクライアントは、セッションを保存しない設定（auth.persistSession: false）にしない（読み込み直してもログインが続く）", () => {
      // 準備
      stubSupabaseEnv();

      // 実行
      getSupabaseClient();

      // 検証
      expect(fake.createClient).toHaveBeenCalledTimes(1);
      // 設定を渡さない（既定は保存する）か、persistSession を false 以外にする
      expect(optionsOfCall(fake, 0) ?? {}).not.toMatchObject({ auth: { persistSession: false } });
    });

    it("ふだんのクライアントは、URL の中のログインの情報を読まない（auth.detectSessionInUrl: false。レビュー対応）", () => {
      // 準備
      stubSupabaseEnv();

      // 実行
      getSupabaseClient();

      // 検証
      expect(fake.createClient).toHaveBeenCalledTimes(1);
      expect(optionsOfCall(fake, 0) ?? {}).toMatchObject({ auth: { detectSessionInUrl: false } });
    });

    it("2 回呼んでも、作るのは 1 回で同じクライアントを返す", () => {
      // 準備
      stubSupabaseEnv();

      // 実行
      const first = getSupabaseClient();
      const second = getSupabaseClient();

      // 検証
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(fake.createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("createIssuingSupabaseClient：協力者のアカウントを作るための別のクライアント", () => {
    it.each(MISSING_ENV_CASES)("%sときは null を返し、クライアントを作らない", (_label, name) => {
      // 準備
      stubSupabaseEnvWithout(name);

      // 実行
      const client = createIssuingSupabaseClient();

      // 検証
      expect(client).toBeNull();
      expect(fake.createClient).not.toHaveBeenCalled();
    });

    it("同じ URL と公開キーで、セッションを保存しない設定（auth.persistSession: false）のクライアントを作る", () => {
      // 準備
      stubSupabaseEnv();

      // 実行
      const client = createIssuingSupabaseClient();

      // 検証
      expect(client).toBe(fake.issuing);
      expect(fake.createClient).toHaveBeenCalledWith(
        FAKE_SUPABASE_URL,
        FAKE_SUPABASE_PUBLISHABLE_KEY,
        expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
      );
    });

    it("ふだんのクライアントとは別のものを返す（管理者のログインのセッションを使わない・変えない）", () => {
      // 準備
      stubSupabaseEnv();
      const main = getSupabaseClient();

      // 実行
      const issuing = createIssuingSupabaseClient();

      // 検証
      expect(main).not.toBeNull();
      expect(issuing).not.toBeNull();
      expect(issuing).not.toBe(main);
    });
  });
});
