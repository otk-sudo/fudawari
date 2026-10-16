import { AuthApiError } from "@supabase/supabase-js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setRole,
  type SignInFailure,
  type SignInResult,
  signIn,
  signOut,
  useAccount,
  useRole,
} from "@/features/auth";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  authFailure,
  authNetworkError,
  calledSupabaseMethods,
  failedQuery,
  type FakeSupabase,
  installFakeSupabase,
  networkFailure,
  type SupabaseEnvName,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// ログイン・ログアウト（U3、docs/design/database.md 2.1.1）
// - ID は「ID@fudawari.invalid」に変えて auth.signInWithPassword に渡す
// - ログインできたら自分の profiles の行（role・display_name）を読み、権限・表示名・ID を持つ。行がなければ「権限がない」でログアウトする
// - ログアウトは auth.signOut を呼び、一般利用者に戻す
// 読み込み直したときの権限の復元は persistence.test.tsx で確かめる

/** 管理者（ID とパスワードでログインできる） */
const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

/** 協力者 */
const TARO = {
  loginId: "taro-01",
  password: "taro-pass-000001",
  userId: "user-taro",
  displayName: "太郎",
  role: "collab",
} as const;

/** ログインはできるが profiles に行がない人（権限なし） */
const GUEST = { loginId: "guest-01", password: "guest-pass-00001", userId: "user-guest" } as const;

describe("ログイン・ログアウト（@/features/auth の signIn・signOut・useAccount・useRole）", () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    // 前のテストのログインを残さない（偽物を入れてからログアウトし、記録を消してから入れ直す）
    localStorage.clear();
    stubSupabaseEnv();
    installFakeSupabase();
    resetSupabaseClient();
    await signOut();
    setRole("user");
    localStorage.clear();

    fake = installFakeSupabase();
    resetSupabaseClient();
    addManager(fake, ADMIRAL);
    addManager(fake, TARO);
    fake.server.accounts.push({
      userId: GUEST.userId,
      email: `${GUEST.loginId}@fudawari.invalid`,
      password: GUEST.password,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  describe("signIn：ID とパスワードでログインする", () => {
    it("ID を「ID@fudawari.invalid」に変えて、パスワードと一緒に auth.signInWithPassword に渡す", async () => {
      // 準備・実行
      await signIn(TARO.loginId, TARO.password);

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: "taro-01@fudawari.invalid", password: TARO.password }),
      );
    });

    it("自分の profiles の行が管理者なら、権限・表示名・ID を返し、useRole・useAccount が管理者に切り替わる", async () => {
      // 準備：ログインする前から権限を使っている部品がある
      const { result: role } = renderHook(() => useRole());
      const { result: account } = renderHook(() => useAccount());
      expect(role.current).toBe("user");
      expect(account.current).toBeNull();

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(ADMIRAL.loginId, ADMIRAL.password);
      });

      // 検証
      const expected = { role: "admin", displayName: "提督", loginId: "admiral" };
      expect(result).toEqual({ ok: true, account: expected });
      expect(role.current).toBe("admin");
      expect(account.current).toEqual(expected);
    });

    it("協力者の行なら協力者になる（読むのは profiles の自分の行で、ほかの人の行と取り違えない）", async () => {
      // 準備：profiles には管理者の行もある
      const { result: account } = renderHook(() => useAccount());

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(TARO.loginId, TARO.password);
      });

      // 検証
      expect(fake.main.from).toHaveBeenCalledWith("profiles");
      expect(result).toEqual({
        ok: true,
        account: { role: "collab", displayName: "太郎", loginId: "taro-01" },
      });
      expect(account.current).toEqual({ role: "collab", displayName: "太郎", loginId: "taro-01" });
    });

    it.each([
      ["2 文字", "ab"],
      ["英大文字を含む", "Taro-01"],
      ["下線を含む", "taro_01"],
      ["空", ""],
    ])("ID の形式が違えば（%s）、Supabase に何も頼まずに invalid-id を返す", async (_label, loginId) => {
      // 準備・実行
      const result = await signIn(loginId, TARO.password);

      // 検証
      expect(result).toEqual({ ok: false, reason: "invalid-id" });
      expect(calledSupabaseMethods(fake)).toEqual([]);
    });

    it("ID かパスワードが違えば invalid-credentials を返し、一般利用者のまま", async () => {
      // 準備
      const { result: role } = renderHook(() => useRole());

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(TARO.loginId, "wrong-password-01");
      });

      // 検証：ログインを試したうえで、断られている
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
      expect(role.current).toBe("user");
    });

    it("ログインできても profiles に自分の行がなければ no-permission を返し、ログアウトする（auth.signOut）。一般利用者のまま", async () => {
      // 準備
      const { result: role } = renderHook(() => useRole());

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(GUEST.loginId, GUEST.password);
      });

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, reason: "no-permission" });
      expect(fake.main.auth.signOut).toHaveBeenCalled();
      expect(role.current).toBe("user");
    });

    it.each<[string, SupabaseEnvName]>([
      ["URL", "NEXT_PUBLIC_SUPABASE_URL"],
      ["公開キー", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ])("接続先の環境変数（%s）がなければ not-configured を返し、クライアントを作らない", async (_label, name) => {
      // 準備
      stubSupabaseEnvWithout(name);

      // 実行
      const result = await signIn(TARO.loginId, TARO.password);

      // 検証
      expect(result).toEqual({ ok: false, reason: "not-configured" });
      expect(calledSupabaseMethods(fake)).toEqual([]);
    });

    it("ログインの通信に失敗したら（AuthRetryableFetchError）network を返し、一般利用者のまま", async () => {
      // 準備
      fake.main.auth.signInWithPassword.mockResolvedValueOnce(authFailure(authNetworkError()));
      const { result: role } = renderHook(() => useRole());

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(TARO.loginId, TARO.password);
      });

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, reason: "network" });
      expect(role.current).toBe("user");
    });

    it("ログインの呼び出しが例外を投げても、例外を外に出さず network を返す", async () => {
      // 準備
      fake.main.auth.signInWithPassword.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      // 実行
      const result = await signIn(TARO.loginId, TARO.password);

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, reason: "network" });
    });

    it("自分の行の読み取りが通信に失敗したら network を返し、一般利用者のまま", async () => {
      // 準備：ログインは通るが、profiles の読み取りが通信の失敗になる
      fake.main.from.mockImplementationOnce(() => failedQuery(networkFailure()));
      const { result: role } = renderHook(() => useRole());

      // 実行
      let result: SignInResult | undefined;
      await act(async () => {
        result = await signIn(TARO.loginId, TARO.password);
      });

      // 検証
      expect(fake.main.from).toHaveBeenCalledWith("profiles");
      expect(result).toEqual({ ok: false, reason: "network" });
      expect(role.current).toBe("user");
    });
  });

  describe("signOut：ログアウトする", () => {
    it("auth.signOut を呼び、一般利用者に戻す（useAccount は null）", async () => {
      // 準備：管理者でログインしておく
      const { result: role } = renderHook(() => useRole());
      const { result: account } = renderHook(() => useAccount());
      await act(async () => {
        await signIn(ADMIRAL.loginId, ADMIRAL.password);
      });
      expect(role.current).toBe("admin");

      // 実行
      await act(async () => {
        await signOut();
      });

      // 検証
      expect(fake.main.auth.signOut).toHaveBeenCalled();
      expect(role.current).toBe("user");
      expect(account.current).toBeNull();
    });

    it.each([
      ["失敗を返しても", (f: FakeSupabase) => f.main.auth.signOut.mockResolvedValueOnce({ error: authNetworkError() })],
      ["例外を投げても", (f: FakeSupabase) => f.main.auth.signOut.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ])("auth.signOut が%s、この画面では一般利用者に戻す", async (_label, breakSignOut) => {
      // 準備
      const { result: role } = renderHook(() => useRole());
      await act(async () => {
        await signIn(ADMIRAL.loginId, ADMIRAL.password);
      });
      expect(role.current).toBe("admin");
      breakSignOut(fake);

      // 実行
      await act(async () => {
        await signOut();
      });

      // 検証
      expect(fake.main.auth.signOut).toHaveBeenCalled();
      expect(role.current).toBe("user");
    });

    it("このブラウザのセッションだけを終える（auth.signOut に scope: \"local\" を渡す。レビュー対応）", async () => {
      // 準備
      expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);

      // 実行
      await signOut();

      // 検証
      expect(fake.main.auth.signOut).toHaveBeenCalledWith(expect.objectContaining({ scope: "local" }));
    });
  });

  // レビュー対応（親の決定 4）：Auth が別の人に切り替わった後で失敗したら、前にログインしていた人の権限も残さない
  describe("ログイン中に別の ID で signIn して、Auth が切り替わった後で失敗したとき", () => {
    /** ページを読み込み直したときと同じように、モジュールを読み直した新しい権限の入口を返す */
    async function reloadAuth(): Promise<typeof import("@/features/auth")> {
      vi.resetModules();
      return import("@/features/auth");
    }

    it.each<[string, (f: FakeSupabase) => Promise<SignInResult>, SignInFailure]>([
      [
        "profiles に行がない（no-permission）",
        () => signIn(GUEST.loginId, GUEST.password),
        "no-permission",
      ],
      [
        "profiles の読み取りが通信に失敗した（network）",
        (f: FakeSupabase) => {
          f.main.from.mockImplementationOnce(() => failedQuery(networkFailure()));
          return signIn(TARO.loginId, TARO.password);
        },
        "network",
      ],
      [
        "profiles の読み取りが例外を投げた（network）",
        (f: FakeSupabase) => {
          f.main.from.mockImplementationOnce(() => {
            throw new TypeError("Failed to fetch");
          });
          return signIn(TARO.loginId, TARO.password);
        },
        "network",
      ],
    ])(
      "%s：前に保存した管理者の権限も消し、一般利用者に戻す（読み込み直しても一般利用者）",
      async (_label, signInAgain, reason) => {
        // 準備：管理者でログインしている
        const { result: role } = renderHook(() => useRole());
        const { result: account } = renderHook(() => useAccount());
        await act(async () => {
          expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
        });
        expect(role.current).toBe("admin");

        // 実行：別の ID でログインし直して、Auth が切り替わった後で失敗する
        let result: SignInResult | undefined;
        await act(async () => {
          result = await signInAgain(fake);
        });

        // 検証：失敗の理由と、この画面の権限
        expect(result).toEqual({ ok: false, reason });
        expect(role.current).toBe("user");
        expect(account.current).toBeNull();
        // 検証：読み込み直しても、前の管理者の権限は戻らない
        const fresh = await reloadAuth();
        const { result: freshRole } = renderHook(() => fresh.useRole());
        await act(async () => {});
        expect(freshRole.current).toBe("user");
      },
    );
  });

  // 親の決定 11 のうち、ログインにかかわるもの（実装済み。テストで固定する）
  describe("決めてあったが、テストがなかったもの", () => {
    it("ID の前後の空白は除いてからログインする", async () => {
      // 準備・実行
      const result = await signIn(`  ${TARO.loginId}  `, TARO.password);

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: "taro-01@fudawari.invalid" }),
      );
      expect(result).toEqual({
        ok: true,
        account: { role: "collab", displayName: "太郎", loginId: "taro-01" },
      });
    });

    it.each([
      ["429（回数の制限）", () => new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")],
      ["500（サーバーの障害）", () => new AuthApiError("Unexpected failure", 500, "unexpected_failure")],
    ])("ID・パスワードの間違い以外の Auth の失敗（%s）は network（通信の失敗と同じ扱い）", async (_label, makeError) => {
      // 準備
      fake.main.auth.signInWithPassword.mockResolvedValueOnce(authFailure(makeError()));

      // 実行
      const result = await signIn(TARO.loginId, TARO.password);

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, reason: "network" });
    });
  });
});
