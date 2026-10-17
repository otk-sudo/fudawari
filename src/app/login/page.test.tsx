import { AuthApiError } from "@supabase/supabase-js";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import { setRole, signOut, useAccount, useRole } from "@/features/auth";
import { resetSupabaseClient } from "@/lib/supabase";
import {
  addManager,
  authFailure,
  authNetworkError,
  calledSupabaseMethods,
  type FakeAuthResponse,
  type FakeSupabase,
  installFakeSupabase,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";
import { createDeferred } from "@/test/deferred";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// 画面の移動（next/navigation の useRouter）を見張る。push・replace のどちらで移ってもよい
const navigation = vi.hoisted(() => ({ navigate: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({
    push: navigation.navigate,
    replace: navigation.navigate,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/login",
}));

// 管理者・協力者のログイン（/login。U3・U14、要件 2.1・2.3）
// - 一般の画面からはリンクしない単独の画面。ID・パスワードの欄と「ログイン」
// - ログインできたらホーム（/）へ移る
// - 失敗の理由：ID の形式／ID かパスワードが違う／権限がない／設定がない／通信の失敗

const TARO = {
  loginId: "taro-01",
  password: "taro-pass-000001",
  userId: "user-taro",
  displayName: "太郎",
  role: "collab",
} as const;

/** ログインはできるが profiles に行がない人（権限なし） */
const GUEST = { loginId: "guest-01", password: "guest-pass-00001", userId: "user-guest" } as const;

function idField(): HTMLElement {
  return screen.getByRole("textbox", { name: /^ID/ });
}

function passwordField(): HTMLElement {
  return screen.getByLabelText(/^パスワード/);
}

function loginButton(): HTMLElement {
  return screen.getByRole("button", { name: "ログイン" });
}

/** ID とパスワードを入れて「ログイン」を押す */
async function submit(user: UserEvent, loginId: string, password: string): Promise<void> {
  if (loginId !== "") await user.type(idField(), loginId);
  if (password !== "") await user.type(passwordField(), password);
  await user.click(loginButton());
}

describe("ログインの画面（/login）", () => {
  let fake: FakeSupabase;

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
    addManager(fake, TARO);
    fake.server.accounts.push({
      userId: GUEST.userId,
      email: `${GUEST.loginId}@fudawari.invalid`,
      password: GUEST.password,
    });
    navigation.navigate.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("見出し「管理者・協力者のログイン」、ID とパスワード（伏せ字）の欄、「ログイン」ボタンがある", () => {
    // 準備・実行
    render(<LoginPage />);

    // 検証
    expect(
      screen.getByRole("heading", { level: 1, name: "管理者・協力者のログイン" }),
    ).toBeInTheDocument();
    expect(idField()).toBeInTheDocument();
    expect(passwordField()).toHaveAttribute("type", "password");
    expect(loginButton()).toBeInTheDocument();
  });

  it("開いただけでは Supabase に何も頼まない", async () => {
    // 準備・実行
    render(<LoginPage />);
    await screen.findByRole("heading", { level: 1, name: "管理者・協力者のログイン" });

    // 検証
    expect(loginButton()).toBeInTheDocument();
    expect(fake.main.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(fake.main.from).not.toHaveBeenCalled();
    expect(fake.main.rpc).not.toHaveBeenCalled();
  });

  it("正しい ID とパスワードでログインすると、「ID@fudawari.invalid」で signInWithPassword を呼び、権限を切り替えてホーム（/）へ移る", async () => {
    // 準備
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行
    await submit(user, TARO.loginId, TARO.password);

    // 検証
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("/"));
    expect(fake.main.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "taro-01@fudawari.invalid", password: TARO.password }),
    );
    expect(renderHook(() => useRole()).result.current).toBe("collab");
    expect(renderHook(() => useAccount()).result.current).toEqual({
      role: "collab",
      displayName: "太郎",
      loginId: "taro-01",
    });
  });

  it("パスワードの欄で Enter を押してもログインする", async () => {
    // 準備
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(idField(), TARO.loginId);

    // 実行
    await user.type(passwordField(), `${TARO.password}{Enter}`);

    // 検証
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("/"));
  });

  it("ID の形式が違えば、理由（英小文字・数字・ハイフンの 3〜32 文字）を出し、通信しない", async () => {
    // 準備
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行
    await submit(user, "Taro", TARO.password);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/英小文字・数字・ハイフン/);
    expect(alert).toHaveTextContent(/3〜32/);
    expect(calledSupabaseMethods(fake)).toEqual([]);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("ID かパスワードが違えば「ID かパスワードが違います」を出し、ホームへ移らない", async () => {
    // 準備
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行
    await submit(user, TARO.loginId, "wrong-password-01");

    // 検証
    expect(await screen.findByRole("alert")).toHaveTextContent(/ID\s*かパスワードが違/);
    expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(renderHook(() => useRole()).result.current).toBe("user");
  });

  it("ログインできても権限（profiles の行）がなければ「定義を編集する権限がありません」を出してログアウトし、一般利用者のまま", async () => {
    // 準備
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行
    await submit(user, GUEST.loginId, GUEST.password);

    // 検証
    expect(await screen.findByRole("alert")).toHaveTextContent(/定義を編集する権限がありません/);
    expect(fake.main.auth.signOut).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(renderHook(() => useRole()).result.current).toBe("user");
  });

  it("接続先の設定（環境変数）がなければ「ログインの設定がありません」を出し、通信しない", async () => {
    // 準備
    stubSupabaseEnvWithout("NEXT_PUBLIC_SUPABASE_URL");
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行（設定がないことを開いたときに出して、欄やボタンを使えなくしてもよい）
    await submit(user, TARO.loginId, TARO.password);

    // 検証
    expect(await screen.findByRole("alert")).toHaveTextContent(/ログインの設定がありません/);
    expect(calledSupabaseMethods(fake)).toEqual([]);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("通信に失敗したら「通信に失敗しました」を出し、ホームへ移らない", async () => {
    // 準備
    fake.main.auth.signInWithPassword.mockResolvedValueOnce(authFailure(authNetworkError()));
    const user = userEvent.setup();
    render(<LoginPage />);

    // 実行
    await submit(user, TARO.loginId, TARO.password);

    // 検証
    expect(await screen.findByRole("alert")).toHaveTextContent(/通信に失敗/);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("失敗した後に正しいパスワードで入れ直せば、ログインできて前の理由は消える", async () => {
    // 準備：一度パスワードを間違える
    const user = userEvent.setup();
    render(<LoginPage />);
    await submit(user, TARO.loginId, "wrong-password-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(/ID\s*かパスワードが違/);

    // 実行：パスワードを入れ直してログインする
    await user.clear(passwordField());
    await user.type(passwordField(), TARO.password);
    await user.click(loginButton());

    // 検証
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("/"));
    expect(screen.queryByText(/ID\s*かパスワードが違/)).not.toBeInTheDocument();
  });

  // レビュー対応（親の決定 1）：書き出した HTML（JavaScript が動く前）では送れない。送っても URL にパスワードが出ない
  describe("書き出した HTML（hydration の前と後）", () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    /** ビルドのときと同じく、ログインの画面を HTML に書き出して、画面に置く（React はまだ動いていない） */
    function placeStaticHtml(): HTMLDivElement {
      const placed = document.createElement("div");
      placed.innerHTML = renderToString(<LoginPage />);
      document.body.appendChild(placed);
      container = placed;
      return placed;
    }

    afterEach(async () => {
      if (root !== null) {
        const mounted = root;
        await act(async () => {
          mounted.unmount();
        });
      }
      root = null;
      container?.remove();
      container = null;
    });

    it("書き出した HTML では「ログイン」ボタンが押せず、フォームは method=\"post\"（JavaScript の前に送っても URL にパスワードが出ない）", () => {
      // 準備・実行
      const placed = placeStaticHtml();

      // 検証
      expect(within(placed).getByRole("button", { name: "ログイン" })).toBeDisabled();
      const form = placed.querySelector("form");
      expect(form).not.toBeNull();
      expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
    });

    it("書き出した HTML でパスワードの欄に Enter を押しても、フォームは送られない（暗黙の送信も起きない）", async () => {
      // 準備：送られた回数を数える（jsdom は画面の移動をしないので、送られたら止めて数える）
      const user = userEvent.setup();
      const placed = placeStaticHtml();
      const form = placed.querySelector("form");
      if (form === null) throw new Error("フォームがない");
      let submitted = 0;
      form.addEventListener("submit", (event) => {
        submitted += 1;
        event.preventDefault();
      });

      // 実行
      await user.type(within(placed).getByLabelText(/^パスワード/), "secret-password{Enter}");

      // 検証
      expect(submitted).toBe(0);
    });

    it("書き出した HTML に重ねる（hydration）と、食い違いのエラーを出さずに「ログイン」ボタンが押せるようになる", async () => {
      // 準備
      const placed = placeStaticHtml();
      const onRecoverableError = vi.fn();

      // 実行
      await act(async () => {
        root = hydrateRoot(placed, <LoginPage />, { onRecoverableError });
      });

      // 検証
      await waitFor(() =>
        expect(within(placed).getByRole("button", { name: "ログイン" })).toBeEnabled(),
      );
      expect(onRecoverableError).not.toHaveBeenCalled();
    });
  });

  // 親の決定 11 のうち、ログインの画面にかかわるもの（実装済み。テストで固定する）
  describe("決めてあったが、テストがなかったもの", () => {
    it("ID の前後の空白は除いてからログインする", async () => {
      // 準備
      const user = userEvent.setup();
      render(<LoginPage />);

      // 実行
      await submit(user, `  ${TARO.loginId}  `, TARO.password);

      // 検証
      await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("/"));
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: "taro-01@fudawari.invalid" }),
      );
    });

    it("ログインの途中で「ログイン」をもう一度押しても、ログインは 1 回だけ（二重送信を防ぐ）", async () => {
      // 準備：Auth の応答を待たせる
      const user = userEvent.setup();
      const answer = createDeferred<FakeAuthResponse>();
      fake.main.auth.signInWithPassword.mockReturnValueOnce(answer.promise);
      render(<LoginPage />);
      await user.type(idField(), TARO.loginId);
      await user.type(passwordField(), TARO.password);

      // 実行
      await user.click(loginButton());
      await user.click(loginButton());

      // 検証
      expect(fake.main.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      answer.resolve({ data: { user: null, session: null }, error: null });
      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    it.each([
      ["429（回数の制限）", () => new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")],
      ["500（サーバーの障害）", () => new AuthApiError("Unexpected failure", 500, "unexpected_failure")],
    ])("ID・パスワードの間違い以外の Auth の失敗（%s）は、通信の失敗と同じ文を出す", async (_label, makeError) => {
      // 準備
      fake.main.auth.signInWithPassword.mockResolvedValueOnce(authFailure(makeError()));
      const user = userEvent.setup();
      render(<LoginPage />);

      // 実行
      await submit(user, TARO.loginId, TARO.password);

      // 検証
      expect(await screen.findByRole("alert")).toHaveTextContent(/通信に失敗/);
      expect(navigation.navigate).not.toHaveBeenCalled();
    });
  });
});
