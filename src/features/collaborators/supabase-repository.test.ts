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
  FAKE_SUPABASE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  failedQuery,
  type FakeSupabase,
  installFakeSupabase,
  networkFailure,
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

/** 画面が作ったことにするパスワード */
const PASSWORD = "Abcdefgh12345678";

const ISSUE_INPUT = { loginId: "hanako-2", displayName: "花子", password: PASSWORD } as const;

/** 偽物の signUp が最初に作るアカウントの user ID */
const FIRST_NEW_USER_ID = "new-user-1";

function byUserId(a: Collaborator, b: Collaborator): number {
  return a.userId < b.userId ? -1 : 1;
}

describe("協力者の保管庫の Supabase の実装（createSupabaseCollaboratorRepository）", () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    stubSupabaseEnv();
    fake = installFakeSupabase();
    resetSupabaseClient();
    fake.server.accounts.push(
      { userId: "user-admiral", email: "admiral@fudawari.invalid", password: "admiral-pass-0001" },
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
});
