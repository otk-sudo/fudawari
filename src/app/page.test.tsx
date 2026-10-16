import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// `@/` の別名が Vitest でも解決できることを兼ねて確かめるため、別名で読み込む
import HomePage from "@/app/page";
import { setRole } from "@/features/auth";
import { resetLatestDefinitionCache } from "@/lib/definition";
import {
  failNetwork,
  type FetchMock,
  holdFetch,
  requestedPaths,
  respondWithDefinition,
  respondWithStatus,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { cloneSummer2026Definition } from "@/test/fixtures";

// テスト用の 2026夏イベは 2026-08-07 12:00（日本時間）開始・終了日時は未定（src/test/fixtures/summer2026Definition.ts）
/** 2026夏イベの開催中の時刻 */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");
/** 2026夏イベの開始前の時刻 */
const BEFORE_START = new Date("2026-08-01T12:00:00+09:00");

/** 静的ファイルの置き場所（public/data/latest-definition.json） */
const LATEST_DEFINITION = "/data/latest-definition.json";

// 終了したイベント（2026-09-01 11:00 終了）の定義
function endedDefinitionJson(): string {
  const ended = cloneSummer2026Definition();
  ended.event.endAt = "2026-09-01T11:00:00+09:00";
  return JSON.stringify(ended);
}

// ホームが公開定義を取得し、その結果が画面に反映されるまで待つ。
// 「出さない」ことを確かめるテストが、読み込む前の画面を見て通ってしまわないように、
// ホームが静的ファイルを取得したことを確かめてから、応答の処理（本文の読み取り・検証・描画）が済むまで待つ
async function waitUntilDefinitionLoaded(fetchMock: FetchMock): Promise<void> {
  await waitFor(() => expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]));
  await act(async () => {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

describe("トップ画面", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetLatestDefinitionCache();
    setRole("user");
    // 取得は差し替える（既定はテスト用の 2026夏イベを返す）。今の時刻は Date だけを決める（タイマーは本物のまま）
    fetchMock = stubFetch();
    respondWithDefinition(fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WHILE_RUNNING);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLatestDefinitionCache();
    setRole("user");
  });

  it("見出し「札割りプランナー」を表示する", () => {
    // 準備・実行
    render(<HomePage />);

    // 検証
    expect(
      screen.getByRole("heading", { level: 1, name: "札割りプランナー" }),
    ).toBeInTheDocument();
  });

  describe("「開催中：（イベント名）」（公開定義の読み込み。T2-3）", () => {
    it("最新イベントが開催中なら、静的ファイルの定義を読み、「開催中：2026夏イベ」を出す", async () => {
      // 準備：beforeEach のとおり（2026夏イベ、開催中の時刻）

      // 実行
      render(<HomePage />);

      // 検証
      expect(await screen.findByText(/開催中：2026夏イベ/)).toBeInTheDocument();
      expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]);
    });

    it("取得するのは静的ファイル 1 つだけ（Supabase などほかへは通信しない）", async () => {
      // 準備・実行
      render(<HomePage />);
      await screen.findByText(/開催中：2026夏イベ/);

      // 検証：fetch はすべて同じサイト（画面と同じオリジン）の /data/latest-definition.json への 1 回だけ
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input] = fetchMock.mock.calls[0];
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      expect(url.origin).toBe(window.location.origin);
      expect(url.pathname).toBe(LATEST_DEFINITION);
    });

    it("読み込み中は「開催中：」を出さない", async () => {
      // 準備：応答を待たせる
      holdFetch(fetchMock);

      // 実行
      render(<HomePage />);

      // 検証：取得を始めたことを確かめてから、まだ出ていないことを見る
      await waitFor(() => expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]));
      expect(screen.getByRole("heading", { level: 1, name: "札割りプランナー" })).toBeInTheDocument();
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("最新イベントの開始前なら「開催中：」を出さない", async () => {
      // 準備
      vi.setSystemTime(BEFORE_START);

      // 実行
      render(<HomePage />);
      await waitUntilDefinitionLoaded(fetchMock);

      // 検証
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("最新イベントが終了していれば「開催中：」を出さない", async () => {
      // 準備：2026-09-01 に終了したイベント、今は 2026-10-16
      fetchMock.mockImplementation(async () => textResponse(endedDefinitionJson()));

      // 実行
      render(<HomePage />);
      await waitUntilDefinitionLoaded(fetchMock);

      // 検証
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it.each([
      ["404", (mock: FetchMock) => respondWithStatus(mock, 404)],
      ["ネットワークの失敗", (mock: FetchMock) => failNetwork(mock)],
      ["壊れた JSON", (mock: FetchMock) => mock.mockImplementation(async () => textResponse("{ broken"))],
      [
        "検証の失敗",
        (mock: FetchMock) => {
          const broken = cloneSummer2026Definition();
          broken.event.name = "";
          mock.mockImplementation(async () => textResponse(JSON.stringify(broken)));
        },
      ],
    ])("読み込みに失敗（%s）したら「開催中：」を出さない", async (_label, arrange) => {
      // 準備
      arrange(fetchMock);

      // 実行
      render(<HomePage />);
      await waitUntilDefinitionLoaded(fetchMock);

      // 検証：画面は出ている（失敗で落ちない）。「開催中：」はない
      expect(screen.getByRole("heading", { level: 1, name: "札割りプランナー" })).toBeInTheDocument();
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("協力者には、最新イベントが開催中ならイベント定義の説明を「開催中イベントの札・段階・特効を更新」にする", async () => {
      // 準備
      setRole("collab");

      // 実行
      render(<HomePage />);

      // 検証
      const tile = await screen.findByRole("link", {
        name: /^イベント定義.*開催中イベントの札・段階・特効を更新/,
      });
      expect(tile).toHaveAttribute("href", "/definition");
    });
  });
});
