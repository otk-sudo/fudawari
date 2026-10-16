import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Collaborator,
  type CollaboratorError,
  createSupabaseCollaboratorRepository,
} from "@/features/collaborators";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  authFailure,
  authNetworkError,
  clearSupabaseCalls,
  FAKE_SUPABASE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  failedQuery,
  type FakeAuthResponse,
  type FakeQueryResult,
  type FakeSupabase,
  installFakeSupabase,
  networkFailure,
  postgrestFailure,
  profileRow,
  rpcFailure,
  stubSupabaseEnv,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 協力者の保管庫の Supabase の実装（docs/design/database.md 2.1.1・4 章）
// - 一覧：profiles の全行
// - 発行：保存しない別のクライアント（auth.persistSession: false）で auth.signUp（「ID@fudawari.invalid」）し、
//   返った user ID を、ふだんのクライアント（管理者のログイン）から rpc("register_collaborator", { p_user_id, p_display_name }) に渡す
// - 外す：ふだんのクライアントから rpc("remove_collaborator", { p_user_id })
// - 例外のコード：FD001（権限がない）・FD005（入力が不正）・FD009（見つからない）・FD010（すでに権限がある）・FD011（管理者は外せない）
// レビュー対応（2026-10-17 親の決定 2・3・6・8・9）
// - 発行の前に、ふだんのクライアントに管理者のセッションがあるかを確かめる（なければ signUp せず forbidden）
// - PostgREST の 42501・PGRST301（JWT の期限切れ）・状態コード 401 は forbidden
// - signUp が session なしで成功した（Confirm email が ON）ときは register せず、設定の失敗（config）
// - 発行用のクライアントは使い終わったら破棄する（auth.dispose、なければ signOut({ scope: "local" })）
// - checkSession：ふだんのクライアントにセッションがあるか

/** 画面が作ったことにするパスワード */
const PASSWORD = "Abcdefgh12345678";

const ISSUE_INPUT = { loginId: "hanako-2", displayName: "花子", password: PASSWORD } as const;

/** 偽物の signUp が最初に作るアカウントの user ID */
const FIRST_NEW_USER_ID = "new-user-1";

/** 管理者のアカウント（ふだんのクライアントでログインしておく） */
const ADMIRAL_EMAIL = "admiral@fudawari.invalid";
const ADMIRAL_PASSWORD = "admiral-pass-0001";

/**
 * Confirm email が ON のときの signUp の結果（アカウントは作られるが session がない）。
 * すでにある ID のとき（identities が空）と見分けるため、identities は 1 件ある
 */
function signUpWithoutSession(): FakeAuthResponse {
  return {
    data: {
      user: {
        id: FIRST_NEW_USER_ID,
        email: "hanako-2@fudawari.invalid",
        identities: [{ identity_id: "identity-1", provider: "email" }],
      },
      session: null,
    },
    error: null,
  };
}

/** 新しい失敗の理由「設定の失敗」（実装で CollaboratorError に "config" を足すまでの型合わせ） */
const CONFIG_ERROR = "config" as CollaboratorError;

/** 権限がない・ログインが切れていることを表す PostgREST の失敗（42501・PGRST301・状態コード 401） */
const FORBIDDEN_FAILURES: ReadonlyArray<[string, () => FakeQueryResult]> = [
  ["42501（権限がない）", () => postgrestFailure("42501", 403, "permission denied")],
  ["PGRST301（JWT の期限切れ）", () => postgrestFailure("PGRST301", 401, "JWT expired")],
  ["状態コード 401", () => postgrestFailure("", 401, "Unauthorized")],
];

function byUserId(a: Collaborator, b: Collaborator): number {
  return a.userId < b.userId ? -1 : 1;
}

describe("協力者の保管庫の Supabase の実装（createSupabaseCollaboratorRepository）", () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    stubSupabaseEnv();
    fake = installFakeSupabase();
    resetSupabaseClient();
    fake.server.accounts.push(
      { userId: "user-admiral", email: ADMIRAL_EMAIL, password: ADMIRAL_PASSWORD },
      { userId: "user-akane", email: "akane@fudawari.invalid", password: "akane-pass-00001" },
    );
    fake.server.profiles.push(
      profileRow({
        user_id: "user-admiral",
        display_name: "提督",
        role: "admin",
        created_at: "2026-06-30T15:10:00+00:00",
        last_edited_at: "2026-10-15T12:40:00+00:00",
        last_edited_note: "公開",
      }),
      profileRow({
        user_id: "user-akane",
        display_name: "あかね",
        role: "collab",
        created_at: "2026-07-09T16:30:00+00:00",
        last_edited_at: null,
        last_edited_note: null,
      }),
    );
    // 管理者がふだんのクライアントでログインしている（発行は管理者のセッションがあるときだけ進む。レビュー対応）。呼んだ記録は消しておく
    await fake.main.auth.signInWithPassword({ email: ADMIRAL_EMAIL, password: ADMIRAL_PASSWORD });
    clearSupabaseCalls(fake);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("保管庫を作っただけでは、Supabase のクライアントを作らない", () => {
    // 準備・実行
    createSupabaseCollaboratorRepository();

    // 検証
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  describe("list：編集できる人の一覧", () => {
    it("profiles の全行を、画面の形（userId・displayName・role・createdAt・lastEditedAt・lastEditedNote）にして返す", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.list();

      // 検証
      expect(fake.main.from).toHaveBeenCalledWith("profiles");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect([...result.value].sort(byUserId)).toEqual([
        {
          userId: "user-admiral",
          displayName: "提督",
          role: "admin",
          createdAt: "2026-06-30T15:10:00+00:00",
          lastEditedAt: "2026-10-15T12:40:00+00:00",
          lastEditedNote: "公開",
        },
        {
          userId: "user-akane",
          displayName: "あかね",
          role: "collab",
          createdAt: "2026-07-09T16:30:00+00:00",
          lastEditedAt: null,
          lastEditedNote: null,
        },
      ]);
    });

    it("通信に失敗したら network を返す", async () => {
      // 準備
      fake.main.from.mockImplementation(() => failedQuery(networkFailure()));
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.list();

      // 検証
      expect(fake.main.from).toHaveBeenCalledWith("profiles");
      expect(result).toEqual({ ok: false, error: "network" });
    });
  });

  describe("issue：協力者を追加する（ID とパスワードの発行）", () => {
    it("保存しない別のクライアント（auth.persistSession: false）で、「ID@fudawari.invalid」と画面が作ったパスワードの auth.signUp を呼ぶ", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.createClient).toHaveBeenCalledWith(
        FAKE_SUPABASE_URL,
        FAKE_SUPABASE_PUBLISHABLE_KEY,
        expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
      );
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
      expect(fake.issuing.auth.signUp).toHaveBeenCalledWith(
        expect.objectContaining({ email: "hanako-2@fudawari.invalid", password: PASSWORD }),
      );
    });

    it("作ったアカウントの user ID と表示名で、ふだんのクライアント（管理者のログイン）から register_collaborator を呼び、user ID を返す", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("register_collaborator", {
        p_user_id: FIRST_NEW_USER_ID,
        p_display_name: "花子",
      });
      expect(fake.issuing.rpc).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, value: { userId: FIRST_NEW_USER_ID } });
    });

    it("管理者のログインを変えない（ふだんのクライアントでは signUp・signInWithPassword・signOut を呼ばない）", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(result.ok).toBe(true);
      expect(fake.main.auth.signUp).not.toHaveBeenCalled();
      expect(fake.main.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(fake.main.auth.signOut).not.toHaveBeenCalled();
    });

    it("その ID のアカウントがすでにあれば（signUp の失敗）id-taken を返し、register_collaborator を呼ばない", async () => {
      // 準備：同じ ID のアカウントがある
      fake.server.accounts.push({
        userId: "user-hanako-old",
        email: "hanako-2@fudawari.invalid",
        password: "old-password-0001",
      });
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, error: "id-taken" });
      expect(fake.main.rpc).not.toHaveBeenCalled();
    });

    it("アカウントを作るときの通信に失敗したら network を返し、register_collaborator を呼ばない", async () => {
      // 準備
      fake.issuing.auth.signUp.mockResolvedValueOnce(authFailure(authNetworkError()));
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, error: "network" });
      expect(fake.main.rpc).not.toHaveBeenCalled();
    });

    it.each<[string, CollaboratorError]>([
      ["FD010", "already-registered"],
      ["FD005", "invalid-input"],
      ["FD001", "forbidden"],
    ])("register_collaborator が %s を返したら %s を返す", async (code, error) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure(code));
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("register_collaborator", expect.anything());
      expect(result).toEqual({ ok: false, error });
    });

    it("register_collaborator の通信に失敗したら network を返す", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(networkFailure());
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("register_collaborator", expect.anything());
      expect(result).toEqual({ ok: false, error: "network" });
    });
  });

  describe("remove：協力者を外す", () => {
    it("ふだんのクライアント（管理者のログイン）から remove_collaborator を呼ぶ", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.remove("user-akane");

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: "user-akane" });
      expect(result).toEqual({ ok: true, value: undefined });
      expect(fake.server.profiles.map((row) => row.user_id)).toEqual(["user-admiral"]);
    });

    it("相手が管理者なら（FD011）cannot-remove-admin を返す", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.remove("user-admiral");

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: "user-admiral" });
      expect(result).toEqual({ ok: false, error: "cannot-remove-admin" });
    });

    it("相手が見つからなければ（FD009）not-found を返す", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.remove("user-nobody");

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: "user-nobody" });
      expect(result).toEqual({ ok: false, error: "not-found" });
    });

    it.each<[string, () => ReturnType<typeof networkFailure>, CollaboratorError]>([
      ["権限がない（FD001）なら", () => rpcFailure("FD001"), "forbidden"],
      ["通信に失敗したら", () => networkFailure(), "network"],
    ])("%s %s を返す", async (_label, failure, error) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(failure());
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.remove("user-akane");

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: "user-akane" });
      expect(result).toEqual({ ok: false, error });
    });
  });

  describe("権限がない・ログインが切れているときの PostgREST の失敗は forbidden（レビュー対応）", () => {
    it.each(FORBIDDEN_FAILURES)("一覧の読み取りが %s を返したら forbidden", async (_label, failure) => {
      // 準備
      fake.main.from.mockImplementation(() => failedQuery(failure()));
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.list();

      // 検証
      expect(fake.main.from).toHaveBeenCalledWith("profiles");
      expect(result).toEqual({ ok: false, error: "forbidden" });
    });

    it.each(FORBIDDEN_FAILURES)("register_collaborator が %s を返したら forbidden", async (_label, failure) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(failure());
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("register_collaborator", expect.anything());
      expect(result).toEqual({ ok: false, error: "forbidden" });
    });

    it.each(FORBIDDEN_FAILURES)("remove_collaborator が %s を返したら forbidden", async (_label, failure) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(failure());
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.remove("user-akane");

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: "user-akane" });
      expect(result).toEqual({ ok: false, error: "forbidden" });
    });
  });

  describe("発行の前に、管理者のセッションを確かめる（レビュー対応）", () => {
    it("ふだんのクライアントにログインのセッションがなければ、signUp も register_collaborator も呼ばずに forbidden を返す", async () => {
      // 準備：管理者のセッションが切れている
      await fake.main.auth.signOut();
      clearSupabaseCalls(fake);
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(fake.issuing.auth.signUp).not.toHaveBeenCalled();
      expect(fake.main.rpc).not.toHaveBeenCalled();
      // 確かめるのは、ふだんのクライアントのセッション（getUser か getSession）
      expect(
        fake.main.auth.getUser.mock.calls.length + fake.main.auth.getSession.mock.calls.length,
      ).toBeGreaterThan(0);
    });

    it("管理者のセッションがあれば、そのまま発行する", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(result).toEqual({ ok: true, value: { userId: FIRST_NEW_USER_ID } });
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
    });
  });

  describe("Confirm email が ON のとき（signUp が session なしで成功した）（レビュー対応）", () => {
    it("register_collaborator を呼ばず、設定の失敗（config）を返す", async () => {
      // 準備
      fake.issuing.auth.signUp.mockResolvedValueOnce(signUpWithoutSession());
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, error: CONFIG_ERROR });
      expect(fake.main.rpc).not.toHaveBeenCalled();
    });
  });

  describe("発行用のクライアントの後片付け（レビュー対応）", () => {
    it.each<[string, (f: FakeSupabase) => void]>([
      ["発行できたとき", () => {}],
      [
        "その ID のアカウントがすでにあったとき",
        (f) => {
          f.server.accounts.push({
            userId: "user-old",
            email: "hanako-2@fudawari.invalid",
            password: "old-pass-0000001",
          });
        },
      ],
      [
        "register_collaborator が失敗したとき",
        (f) => {
          f.main.rpc.mockResolvedValueOnce(rpcFailure("FD010"));
        },
      ],
      [
        "signUp の通信に失敗したとき",
        (f) => {
          f.issuing.auth.signUp.mockResolvedValueOnce(authFailure(authNetworkError()));
        },
      ],
    ])("%s も、使い終わった発行用のクライアントを auth.dispose で破棄する", async (_label, prepare) => {
      // 準備
      prepare(fake);
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      await repository.issue(ISSUE_INPUT);

      // 検証
      expect(fake.issuing.auth.signUp).toHaveBeenCalledTimes(1);
      expect(fake.issuing.auth.dispose).toHaveBeenCalled();
      expect(fake.main.auth.dispose).not.toHaveBeenCalled();
    });

    it("auth.dispose がない版の supabase-js なら、発行用のクライアントで signOut({ scope: \"local\" }) を呼ぶ（ふだんのクライアントのログインは変えない）", async () => {
      // 準備：dispose を持たないクライアント
      delete fake.issuing.auth.dispose;
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.issue(ISSUE_INPUT);

      // 検証
      expect(result.ok).toBe(true);
      expect(fake.issuing.auth.signOut).toHaveBeenCalledWith(expect.objectContaining({ scope: "local" }));
      expect(fake.main.auth.signOut).not.toHaveBeenCalled();
    });
  });

  describe("checkSession：ふだんのクライアントにセッションがあるか（レビュー対応）", () => {
    it("ログインのセッションがあれば true", async () => {
      // 準備
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.checkSession?.();

      // 検証
      expect(result).toEqual({ ok: true, value: true });
    });

    it("ログインのセッションがなければ false（Supabase の表は読まない）", async () => {
      // 準備
      await fake.main.auth.signOut();
      clearSupabaseCalls(fake);
      const repository = createSupabaseCollaboratorRepository();

      // 実行
      const result = await repository.checkSession?.();

      // 検証
      expect(result).toEqual({ ok: true, value: false });
      expect(fake.main.from).not.toHaveBeenCalled();
      expect(fake.main.rpc).not.toHaveBeenCalled();
    });
  });
});
