import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CollaboratorsPage from "@/app/collaborators/page";
import { type Role, setRole, signIn, signOut, useRole } from "@/features/auth";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  calledSupabaseMethods,
  clearSupabaseCalls,
  FAKE_SUPABASE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 協力者の画面（/collaborators。要件 3.8、モック Collaborators.dc.html、roadmap T3-5）
// 画面・保管庫（Supabase の実装）・偽物の Supabase をつないで確かめる。
// - ヘッダー：h1「協力者」、「管理者専用」、「イベント定義を編集できる人を管理します」
// - 管理者以外は拒否の表示だけで、Supabase のクライアントを作らない
// - 発行：保存しない別のクライアントでアカウントを作り、管理者のログインのまま register_collaborator で協力者にする。
//   その ID とパスワードでログインすると協力者になる
// - 外す：確認してから remove_collaborator

const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

const AKANE = {
  loginId: "akane",
  password: "akane-pass-00001",
  userId: "user-akane",
  displayName: "あかね",
  role: "collab",
} as const;

const ALPHANUMERIC_16 = /^[A-Za-z0-9]{16}$/;

/** 偽物の signUp が最初に作るアカウントの user ID */
const FIRST_NEW_USER_ID = "new-user-1";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRow(name: string): Promise<HTMLElement> {
  return screen.findByRole("row", { name: new RegExp(escapeRegExp(name)) });
}

function queryRow(name: string): HTMLElement | null {
  return screen.queryByRole("row", { name: new RegExp(escapeRegExp(name)) });
}

/** value を画面に出している部品（文字として、または入力欄の値として） */
function elementsShowing(value: string): Element[] {
  const texts = screen.queryAllByText(new RegExp(escapeRegExp(value)));
  const fields = Array.from(document.querySelectorAll("input, textarea")).filter(
    (field) =>
      (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
      field.value === value,
  );
  return [...texts, ...fields];
}

/** ID と表示名を入れて「発行する」を押す */
async function issue(user: UserEvent, loginId: string, displayName: string): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: /^ID/ }), loginId);
  await user.type(screen.getByRole("textbox", { name: /^表示名/ }), displayName);
  await user.click(screen.getByRole("button", { name: "発行する" }));
}

describe("協力者の画面（/collaborators）", () => {
  let fake: FakeSupabase;

  /**
   * 管理者としてログインする（保存した権限と、Supabase のセッションの両方ができる）。呼んだ記録は消す。
   * レビュー対応で、開いたときに Supabase のセッションを確かめるようになったため、setRole("admin") だけでは管理者の画面にならない
   */
  async function signInAsAdmiral(): Promise<void> {
    await act(async () => {
      expect((await signIn(ADMIRAL.loginId, ADMIRAL.password)).ok).toBe(true);
    });
    clearSupabaseCalls(fake);
  }

  beforeEach(async () => {
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
    addManager(fake, AKANE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it.each<Role>(["user", "collab"])(
    "権限が %s なら、見出し「協力者」と拒否の表示だけを出し、Supabase のクライアントを作らない",
    async (role) => {
      // 準備
      setRole(role);

      // 実行
      render(<CollaboratorsPage />);

      // 検証
      expect(screen.getByRole("heading", { level: 1, name: "協力者" })).toBeInTheDocument();
      expect(await screen.findByText("このページは管理者のみ使えます")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(calledSupabaseMethods(fake)).toEqual([]);
    },
  );

  it("管理者が開くと、ヘッダー（協力者・管理者専用・説明）と、profiles の全員の表を出す", async () => {
    // 準備
    await signInAsAdmiral();

    // 実行
    render(<CollaboratorsPage />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: "協力者" })).toBeInTheDocument();
    expect(screen.getByText("管理者専用")).toBeInTheDocument();
    expect(screen.getByText("イベント定義を編集できる人を管理します")).toBeInTheDocument();
    expect(await findRow("提督")).toBeInTheDocument();
    expect(await findRow("あかね")).toBeInTheDocument();
    expect(fake.main.from).toHaveBeenCalledWith("profiles");
  });

  it("ID と表示名を入れて発行すると、保存しない別のクライアントでアカウントを作り、管理者のログインのまま register_collaborator で協力者にして、パスワードを出す", async () => {
    // 準備
    const user = userEvent.setup();
    await signInAsAdmiral();
    render(<CollaboratorsPage />);
    await findRow("提督");

    // 実行
    await issue(user, "hanako-2", "花子");

    // 検証：アカウントは保存しない別のクライアントで作る
    await waitFor(() => expect(fake.main.rpc).toHaveBeenCalledWith("register_collaborator", {
      p_user_id: FIRST_NEW_USER_ID,
      p_display_name: "花子",
    }));
    expect(fake.createClient).toHaveBeenCalledWith(
      FAKE_SUPABASE_URL,
      FAKE_SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    );
    expect(fake.issuing.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "hanako-2@fudawari.invalid",
        password: expect.stringMatching(ALPHANUMERIC_16),
      }),
    );
    // 検証：管理者のログインはそのまま（ふだんのクライアントでアカウントを作らない・別のクライアントで登録しない）
    expect(fake.main.auth.signUp).not.toHaveBeenCalled();
    expect(fake.main.auth.signOut).not.toHaveBeenCalled();
    expect(fake.issuing.rpc).not.toHaveBeenCalled();
    // 検証：作ったパスワードを出し、表に加える
    const password = fake.issuing.auth.signUp.mock.calls[0]?.[0].password ?? "";
    expect(password).toMatch(ALPHANUMERIC_16);
    expect(await screen.findByText(/パスワードはこの画面を閉じると二度と表示できません/)).toBeInTheDocument();
    expect(elementsShowing(password)).not.toEqual([]);
    expect(await findRow("花子")).toBeInTheDocument();
  });

  it("発行した ID と、画面に出たパスワードでログインすると、協力者になる", async () => {
    // 準備：管理者が発行する
    const user = userEvent.setup();
    await signInAsAdmiral();
    render(<CollaboratorsPage />);
    await findRow("提督");
    await issue(user, "hanako-2", "花子");
    await screen.findByText(/パスワードはこの画面を閉じると二度と表示できません/);
    const password = fake.issuing.auth.signUp.mock.calls[0]?.[0].password ?? "";
    expect(password).toMatch(ALPHANUMERIC_16);
    expect(elementsShowing(password)).not.toEqual([]);

    // 実行：発行された ID とパスワードでログインする
    const result = await signIn("hanako-2", password);

    // 検証
    expect(result).toEqual({
      ok: true,
      account: { role: "collab", displayName: "花子", loginId: "hanako-2" },
    });
  });

  it("「外す」を確認してから押すと remove_collaborator を呼び、表から消す", async () => {
    // 準備
    const user = userEvent.setup();
    await signInAsAdmiral();
    render(<CollaboratorsPage />);
    const row = await findRow("あかね");

    // 実行
    await user.click(within(row).getByRole("button", { name: /外す/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /あかね\s*を外すことを確認しました/ }));
    await user.click(within(dialog).getByRole("button", { name: /外す/ }));

    // 検証
    await waitFor(() =>
      expect(fake.main.rpc).toHaveBeenCalledWith("remove_collaborator", { p_user_id: AKANE.userId }),
    );
    await waitFor(() => expect(queryRow("あかね")).not.toBeInTheDocument());
    expect(queryRow("提督")).toBeInTheDocument();
  });

  // レビュー対応（親の決定 6）
  it("保存した権限は管理者でも、Supabase のセッションがなければ、保存した権限を消して「ログインし直してください」と /login への案内を出し、一覧を読まない", async () => {
    // 準備：管理者でログインした後で、Supabase のセッションだけが切れた（期限切れ・別のタブでのログアウトなど）
    await signInAsAdmiral();
    await fake.main.auth.signOut();
    clearSupabaseCalls(fake);
    const { result: role } = renderHook(() => useRole());
    expect(role.current).toBe("admin");

    // 実行
    render(<CollaboratorsPage />);

    // 検証：案内
    expect(await screen.findByText(/ログインし直してください/)).toBeInTheDocument();
    const loginLink = screen
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/login");
    expect(loginLink).toBeDefined();
    // 検証：一覧は読まない
    expect(fake.main.from).not.toHaveBeenCalled();
    expect(fake.main.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // 検証：保存した権限を消し、一般利用者に戻る（読み込み直しても一般利用者）
    await waitFor(() => expect(role.current).toBe("user"));
    vi.resetModules();
    const fresh = await import("@/features/auth");
    const { result: freshRole } = renderHook(() => fresh.useRole());
    await act(async () => {});
    expect(freshRole.current).toBe("user");
  });

  // レビュー対応（親の決定 2）
  it("発行を押したときに管理者のセッションが切れていたら、アカウントを作らずに、管理者でログインし直す案内を出す", async () => {
    // 準備：開いた時点ではログインしている
    const user = userEvent.setup();
    await signInAsAdmiral();
    render(<CollaboratorsPage />);
    await findRow("提督");
    await waitFor(() => expect(screen.getByRole("button", { name: "発行する" })).toBeEnabled());
    // 準備：その後でセッションが切れる
    await fake.main.auth.signOut();
    clearSupabaseCalls(fake);

    // 実行
    await issue(user, "hanako-2", "花子");

    // 検証
    expect(await screen.findByRole("alert")).toHaveTextContent(/管理者でログインし直してください/);
    expect(fake.issuing.auth.signUp).not.toHaveBeenCalled();
    expect(fake.main.rpc).not.toHaveBeenCalled();
  });
});
