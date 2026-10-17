import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DefinitionPage from "@/app/definition/page";
import { setRole, signIn, signOut, useRole } from "@/features/auth";
import {
  boostGroupNamed,
  expectTextNotShown,
  expectTextShown,
  selectStage,
} from "@/features/plan-editor/test-helpers";
import { resetShipMasterCache } from "@/lib/ship-master";
import { resetSupabaseClient } from "@/lib/supabase";
import { type FetchMock, respondWithStatus, stubFetch } from "@/test/definition-fetch";
import { summer2026Definition, summer2026MasterEntries } from "@/test/fixtures";
import { respondWithShipMaster, shipMasterFileOf } from "@/test/ship-master-fetch";
import {
  addManager,
  calledSupabaseMethods,
  clearSupabaseCalls,
  draftRow,
  eventRow,
  type FakeSupabase,
  installFakeSupabase,
  publishedDefinitionRow,
  setLatestEvent,
  stubSupabaseEnv,
} from "@/test/supabase-fake";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// イベント定義のページ（/definition。要件 2.3・3.7、PR-11b）
// 権限ごとの中身は src/features/plan-editor/DefinitionScreen.test.tsx、編集の操作は PlanEditor.*.test.tsx で確かめる。
// ここでは、ページが
// - 一般利用者には拒否の表示を出し、Supabase を使わないこと
// - ログイン中の協力者・管理者には、Supabase の保管庫（createSupabaseDefinitionRepository）で読み込んで定義画面を出すこと
// - 艦船マスタ（useShipMaster）の「改装段階を問わない艦名」を knownShipNames として渡すこと（マスタが読めなければ渡さない）
// - Supabase のセッションがなければ（期限切れ・別のタブでのログアウトなど）、保存した権限を消し、
//   「ログインし直してください」と /login への案内を出すこと（PR-10b の協力者画面と同じ扱い）
// を、偽物の Supabase と、差し替えた fetch（艦船マスタ）で確かめる。

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

const DENIED = "このページは管理者・協力者のみ使えます";

/**
 * 偽物のサーバーに、最新のイベント（2026夏イベ）を入れる。
 * 下書きは版 7（あかねが 2026/10/15 22:40 に保存。updated_at は PostgREST の返す形〔秒の小数つき〕）、公開版は 2026/08/04 版
 */
function seedLatestEvent(fake: FakeSupabase): void {
  fake.server.events.push(
    eventRow({
      id: summer2026Definition.event.id,
      name: "2026夏イベ",
      starts_at: "2026-08-07T03:00:00+00:00",
      ends_at: null,
      created_at: "2026-07-20T10:00:00.123456+00:00",
    }),
  );
  setLatestEvent(fake, summer2026Definition.event.id);
  fake.server.drafts.push(
    draftRow({
      event_id: summer2026Definition.event.id,
      version: 7,
      content: summer2026Definition,
      updated_by: AKANE.userId,
      updated_at: "2026-10-15T13:40:00.345678+00:00",
    }),
  );
  fake.server.publishedDefinitions.push(
    publishedDefinitionRow({
      id: "pub-summer-0804",
      event_id: summer2026Definition.event.id,
      version_label: "2026/08/04 版",
      content: summer2026Definition,
      draft_version: 7,
      published_at: "2026-08-04T11:10:00.5+00:00",
    }),
  );
}

/** E2 ゲージ3 の特効グループ「連合艦隊C」の艦名のうち、テスト用の艦船マスタ（改装段階を問わない艦名）にないもの（並び順） */
function rengoCShipsMissingFromMaster(): string[] {
  const known = new Set(summer2026MasterEntries.map((entry) => entry.baseName));
  const stage = summer2026Definition.stages.find((s) => s.id === "E2-3");
  const group = stage?.boosts.find((g) => g.name === "連合艦隊C");
  if (group === undefined) throw new Error("テスト用の定義に特効グループがありません");
  return group.shipNames.filter((name) => !known.has(name));
}

describe("イベント定義のページ（/definition）", () => {
  let fake: FakeSupabase;
  let fetchMock: FetchMock;

  /** ID とパスワードでログインする（保存した権限と、Supabase のセッションの両方ができる）。呼んだ記録は消す */
  async function signInAs(account: { loginId: string; password: string }): Promise<void> {
    await act(async () => {
      expect((await signIn(account.loginId, account.password)).ok).toBe(true);
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
    seedLatestEvent(fake);

    resetShipMasterCache();
    fetchMock = stubFetch();
    respondWithShipMaster(fetchMock, shipMasterFileOf());
  });

  afterEach(() => {
    // 部品を外してから、共有の読み込みの状態を捨て、差し替えを戻す
    cleanup();
    resetShipMasterCache();
    setRole("user");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("一般利用者が URL を直接開くと、見出し「イベント定義」と「このページは管理者・協力者のみ使えます」を出す", () => {
    // 準備
    setRole("user");

    // 実行
    render(<DefinitionPage />);

    // 検証
    expect(screen.getByRole("heading", { level: 1, name: "イベント定義" })).toBeInTheDocument();
    expect(screen.getByText(/このページは管理者・協力者のみ使えます/)).toBeInTheDocument();
  });

  it("一般利用者が開いても、Supabase のクライアントを作らず、通信しない", async () => {
    // 準備
    setRole("user");

    // 実行
    render(<DefinitionPage />);
    await act(async () => {});

    // 検証
    expect(screen.getByText(/このページは管理者・協力者のみ使えます/)).toBeInTheDocument();
    expect(calledSupabaseMethods(fake)).toEqual([]);
  });

  it("管理者でログインして開くと、Supabase から読み込み、ログイン中の人・最新のイベント・公開中の版・共有の下書きを出す", async () => {
    // 準備
    await signInAs(ADMIRAL);

    // 実行
    render(<DefinitionPage />);

    // 検証
    expect(await screen.findByRole("region", { name: "攻略の流れ" })).toBeInTheDocument();
    expectTextShown("ログイン中：提督（管理者）");
    expectTextShown("更新するイベント：", "2026夏イベ（最新）");
    expectTextShown("公開中：2026/08/04 版");
    expectTextShown("共有の下書き：", "2026/10/15 22:40 にあかねが保存");
    expect(screen.getByRole("radio", { name: "新規作成" })).toBeInTheDocument();
    expect(fake.main.from).toHaveBeenCalledWith("drafts");
  });

  it("協力者でログインして開くと、Supabase から読み込み、協力者の表示で定義画面を出す", async () => {
    // 準備
    await signInAs(AKANE);

    // 実行
    render(<DefinitionPage />);

    // 検証
    expect(await screen.findByRole("region", { name: "攻略の流れ" })).toBeInTheDocument();
    expectTextShown("ログイン中：あかね（協力者）");
    expectTextShown("協力者は最新イベントの更新だけができます。新規作成は管理者が行います");
    expect(screen.queryByRole("radio", { name: "新規作成" })).not.toBeInTheDocument();
    expectTextNotShown(DENIED);
  });

  it("艦船マスタを読めたら、マスタの改装段階を問わない艦名にない艦名だけを警告する（瑞鳳・潮のように改装後の名前でマスタにある艦は警告しない）", async () => {
    // 準備
    const user = userEvent.setup();
    const missing = rengoCShipsMissingFromMaster();
    expect(missing, "テストの前提：マスタにない艦名がある").not.toEqual([]);
    await signInAs(ADMIRAL);
    render(<DefinitionPage />);
    await screen.findByRole("region", { name: "攻略の流れ" });

    // 実行
    await selectStage(user, "E2", "ゲージ3");

    // 検証
    await waitFor(() => {
      expect(within(boostGroupNamed("連合艦隊C")).getByText(/艦船マスタにない艦名/)).toHaveTextContent(
        `艦船マスタにない艦名：${missing.join("、")}（`,
      );
    });
  });

  it("艦船マスタを読めなければ、知らない艦名の警告を出さない（定義画面は使える）", async () => {
    // 準備
    const user = userEvent.setup();
    respondWithStatus(fetchMock, 404);
    await signInAs(ADMIRAL);
    render(<DefinitionPage />);
    await screen.findByRole("region", { name: "攻略の流れ" });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // 実行
    await selectStage(user, "E2", "ゲージ3");
    await act(async () => {});

    // 検証
    expect(boostGroupNamed("連合艦隊C")).toBeInTheDocument();
    expectTextNotShown("艦船マスタにない艦名");
  });

  it("保存した権限は管理者でも、Supabase のセッションがなければ、保存した権限を消して「ログインし直してください」と /login への案内を出し、イベントを読まない", async () => {
    // 準備：管理者でログインした後で、Supabase のセッションだけが切れた（期限切れ・別のタブでのログアウトなど）
    await signInAs(ADMIRAL);
    await fake.main.auth.signOut();
    clearSupabaseCalls(fake);
    const { result: role } = renderHook(() => useRole());
    expect(role.current).toBe("admin");

    // 実行
    render(<DefinitionPage />);

    // 検証：案内
    expect(await screen.findByText(/ログインし直してください/)).toBeInTheDocument();
    const loginLink = screen.getAllByRole("link").find((link) => link.getAttribute("href") === "/login");
    expect(loginLink).toBeDefined();
    // 検証：保存した権限を消し、一般利用者に戻る。案内は拒否の表示に切り替えない
    await waitFor(() => {
      expect(role.current).toBe("user");
    });
    expect(screen.getByText(/ログインし直してください/)).toBeInTheDocument();
    expectTextNotShown(DENIED);
    // 検証：イベント・下書きは読まない
    const tables = fake.main.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain("events");
    expect(tables).not.toContain("drafts");
    expect(screen.queryByRole("region", { name: "攻略の流れ" })).not.toBeInTheDocument();
  });
});
