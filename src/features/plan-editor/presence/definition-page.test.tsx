import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRole } from "@/features/auth";
import { resetSupabaseClient } from "@/lib/supabase";
import { stubFetch } from "@/test/definition-fetch";
import { respondWithShipMaster } from "@/test/ship-master-fetch";
import {
  addManager,
  calledSupabaseMethods,
  draftRow,
  eventRow,
  type FakeRealtimeChannel,
  type FakeSupabase,
  installFakeSupabase,
  profileRow,
  saveLogRow,
  setLatestEvent,
  stubSupabaseEnv,
} from "@/test/supabase-fake";
import { DefinitionPageContent } from "../DefinitionPageContent";
import { expectTextShown, fixClock, makeDoc, restoreClock } from "../test-helpers";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// /definition のページの中身（DefinitionPageContent）への PR-12 の差し込み（plan-v1 4 章：差し込み口は「保存の記録を見る」と「編集中」の 2 か所）
// - 管理者・協力者が開いたら、本物の部品（Supabase の Presence・save_logs の読み取り）が偽物の Supabase を通して動く
//   （ページが loadSaveLogs・connectPresence を渡し忘れていないこと）
// - 一般利用者が開いても、Supabase のクライアントを作らず、チャンネルも作らない（既存の守りを壊さない）

const ADMIRAL = {
  loginId: "admiral",
  password: "admiral-pass-0001",
  userId: "user-admiral",
  displayName: "提督",
  role: "admin",
} as const;

const SUMMER_ID = "2026-summer";

/** 偽物のサーバーに、人（提督・あかね）・最新のイベント（2026夏イベ・下書きは版 7）と保存の記録 2 件を入れる */
function seed(fake: FakeSupabase): void {
  addManager(fake, ADMIRAL);
  // PR-12b：編集中の表示は、編集できる人の一覧（profiles）にいる人だけを出すため、他の人（あかね）も協力者として入れておく
  fake.server.profiles.push(profileRow({ user_id: "user-akane", display_name: "あかね", role: "collab" }));
  fake.server.events.push(
    eventRow({ id: SUMMER_ID, name: "2026夏イベ", starts_at: "2026-08-07T03:00:00+00:00", ends_at: null }),
  );
  setLatestEvent(fake, SUMMER_ID);
  fake.server.drafts.push(
    draftRow({
      event_id: SUMMER_ID,
      version: 7,
      content: makeDoc(),
      updated_by: ADMIRAL.userId,
      updated_at: "2026-10-15T13:40:00+00:00",
    }),
  );
  fake.server.saveLogs.push(
    saveLogRow({
      id: 2,
      event_id: SUMMER_ID,
      user_id: ADMIRAL.userId,
      user_name: ADMIRAL.displayName,
      kind: "save",
      map_label: "E2",
      summary: "E2 ゲージ3 の大事さを「難所」→「重要」",
      created_at: "2026-10-15T13:40:00+00:00",
    }),
    saveLogRow({
      id: 1,
      event_id: SUMMER_ID,
      user_id: ADMIRAL.userId,
      user_name: ADMIRAL.displayName,
      kind: "save",
      map_label: "E1",
      summary: "E1〜E3 の札と段階を作成",
      created_at: "2026-08-04T10:55:00+00:00",
    }),
  );
}

/** 裏で進む処理を待つ */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("定義のページへの編集中・保存の記録の差し込み（DefinitionPageContent）", () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    fixClock();
    fake = installFakeSupabase();
    stubSupabaseEnv();
    resetSupabaseClient();
    seed(fake);
    respondWithShipMaster(stubFetch());
  });

  afterEach(() => {
    setRole("user");
    restoreClock();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("管理者が開いたとき", () => {
    beforeEach(async () => {
      // ログインしている（偽物のクライアントのセッションに提督が入り、保存した権限は管理者）
      await fake.main.auth.signInWithPassword({ email: `${ADMIRAL.loginId}@fudawari.invalid`, password: ADMIRAL.password });
      setRole("admin");
    });

    /** ページを描き、定義画面が出るまで待つ */
    async function renderPage(): Promise<{ unmount: () => void }> {
      const rendered = render(<DefinitionPageContent />);
      await screen.findByRole("region", { name: "攻略の流れ" }, { timeout: 5000 });
      return rendered;
    }

    /** 最初に作られた Realtime のチャンネル（作られて参加するまで待つ） */
    async function joinedChannel(): Promise<FakeRealtimeChannel> {
      await vi.waitFor(() => {
        expect(fake.main.channels.length).toBeGreaterThan(0);
        expect(fake.main.channels[0]?.track).toHaveBeenCalled();
      });
      return fake.main.channels[0] as FakeRealtimeChannel;
    }

    it("最新のイベントの Presence のチャンネルに、自分の ID・表示名・表示中の海域を送り、他の人が入ると「も編集中」を出す", async () => {
      // 準備
      await renderPage();

      // 実行
      const channel = await joinedChannel();
      channel.putPeer("user-akane", { userId: "user-akane", displayName: "あかね", areaName: "E3" });

      // 検証
      expect(channel.name).toContain(SUMMER_ID);
      expect(channel.trackedPayloads().at(-1)).toMatchObject({
        userId: ADMIRAL.userId,
        displayName: ADMIRAL.displayName,
        areaName: "E1",
      });
      await vi.waitFor(() => {
        expectTextShown("あかねも編集中（E3 を表示中）");
      });
    });

    it("ページを閉じると Presence のチャンネルから抜ける", async () => {
      // 準備
      const { unmount } = await renderPage();
      const channel = await joinedChannel();

      // 実行
      unmount();
      await settle();

      // 検証
      expect(channel.state).toBe("closed");
    });

    it("「保存の記録を見る」で、save_logs から読んだ記録をウィンドウに出す", async () => {
      // 準備
      const user = userEvent.setup();
      await renderPage();

      // 実行
      await user.click(screen.getByRole("button", { name: "保存の記録を見る" }));
      const dialog = await screen.findByRole("dialog", { name: /共有の下書きの記録/ });

      // 検証
      expect(await within(dialog).findByText(/E2 ゲージ3 の大事さを「難所」→「重要」/)).toBeInTheDocument();
      expect(within(dialog).getByText(/E1〜E3 の札と段階を作成/)).toBeInTheDocument();
      expect(fake.main.from).toHaveBeenCalledWith("save_logs");
    });
  });

  it("一般利用者が開いても、Supabase のクライアントを作らず、チャンネルも作らない", async () => {
    // 準備
    setRole("user");

    // 実行
    render(<DefinitionPageContent />);
    await settle();

    // 検証
    expect(screen.getByText(/このページは管理者・協力者のみ使えます/)).toBeInTheDocument();
    expect(calledSupabaseMethods(fake)).toEqual([]);
  });
});
