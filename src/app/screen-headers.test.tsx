import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssignPage from "@/app/assign/page";
import DriftPage from "@/app/drift/page";
import ListPage from "@/app/list/page";
import { resetLatestDefinitionCache } from "@/lib/definition";
import {
  failNetwork,
  type FetchMock,
  requestedPaths,
  respondWithDefinition,
  respondWithStatus,
  stubFetch,
  textResponse,
} from "@/test/definition-fetch";
import { cloneSummer2026Definition } from "@/test/fixtures";

// 各画面のヘッダーの最新イベント名と、読み込みに失敗したときの理由の表示（roadmap T2-3、要件 3.0・3.2・3.3・3.5）
// - ヘッダーには最新イベント名だけを出す（イベントを選ぶ欄は置かない）。モックでは画面名の右の札型の表示
// - 読み込み・検証に失敗したら、画面に理由を出す（例「イベントの定義を読み込めませんでした（理由）」）

/** 静的ファイルの置き場所（public/data/latest-definition.json） */
const LATEST_DEFINITION = "/data/latest-definition.json";

/** 失敗したときの文の書き出し */
const LOAD_FAILED = "イベントの定義を読み込めませんでした";
/** 失敗したときに警告に書く次の行動 */
const RELOAD_ADVICE = "ページを再読み込みしてください";
/** イベント名の前に付ける、画面には出さない（視覚的に隠した）読み上げ用の文 */
const EVENT_NAME_PREFIX = "最新イベント：";

const SCREENS: ReadonlyArray<{ name: string; heading: string; Page: () => ReactNode }> = [
  { name: "一覧", heading: "札割り一覧", Page: ListPage },
  { name: "割り振り", heading: "割り振り", Page: AssignPage },
  { name: "差分", heading: "計画と実際の札", Page: DriftPage },
];

// 画面名（h1）を含むヘッダー帯
function headerOf(heading: string): HTMLElement {
  const title = screen.getByRole("heading", { level: 1, name: heading });
  const header = title.closest("header");
  if (header === null) {
    throw new Error(`見出し「${heading}」を含むヘッダーがない`);
  }
  return header;
}

describe.each(SCREENS)("$name の画面（見出し「$heading」）のヘッダー", ({ heading, Page }) => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    resetLatestDefinitionCache();
    fetchMock = stubFetch();
    // 今の時刻は Date だけを決める（タイマーは本物のまま）
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLatestDefinitionCache();
  });

  it("静的ファイルの定義を読み、ヘッダーに最新イベント名「2026夏イベ」を出す（理由の表示は出さない）", async () => {
    // 準備
    respondWithDefinition(fetchMock);

    // 実行
    render(<Page />);

    // 検証
    expect(await within(headerOf(heading)).findByText("2026夏イベ")).toBeInTheDocument();
    expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("最新イベントが終了していても、ヘッダーに最新イベント名を出す（開催中かどうかで出し分けない）", async () => {
    // 準備：2026-09-01 に終了したイベント、今は 2026-10-16
    const ended = cloneSummer2026Definition();
    ended.event.endAt = "2026-09-01T11:00:00+09:00";
    fetchMock.mockImplementation(async () => textResponse(JSON.stringify(ended)));

    // 実行
    render(<Page />);

    // 検証
    expect(await within(headerOf(heading)).findByText("2026夏イベ")).toBeInTheDocument();
  });

  it("404 なら、画面に「イベントの定義を読み込めませんでした」と理由（状態コード 404）を出す", async () => {
    // 準備
    respondWithStatus(fetchMock, 404);

    // 実行
    render(<Page />);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LOAD_FAILED);
    expect(alert).toHaveTextContent("404");
    expect(within(headerOf(heading)).queryByText("2026夏イベ")).not.toBeInTheDocument();
  });

  it("ネットワークの失敗なら、画面に「イベントの定義を読み込めませんでした」を出す", async () => {
    // 準備
    failNetwork(fetchMock);

    // 実行
    render(<Page />);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LOAD_FAILED);
  });

  it("検証に失敗したら、画面に「イベントの定義を読み込めませんでした」と検証の誤り（場所と理由）を出す", async () => {
    // 準備：イベント名が空の定義（検証の誤りの文は「event.name：空にはできません」）
    const broken = cloneSummer2026Definition();
    broken.event.name = "";
    fetchMock.mockImplementation(async () => textResponse(JSON.stringify(broken)));

    // 実行
    render(<Page />);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LOAD_FAILED);
    expect(alert).toHaveTextContent("event.name：空にはできません");
  });

  it("壊れた JSON なら、画面に「イベントの定義を読み込めませんでした」と理由（JSON として読めない）を出す", async () => {
    // 準備
    fetchMock.mockImplementation(async () => textResponse("{ broken"));

    // 実行
    render(<Page />);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LOAD_FAILED);
    expect(alert).toHaveTextContent("JSON として読めません");
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
  ])("読み込みに失敗（%s）したら、警告に次の行動「ページを再読み込みしてください」を書く", async (_label, arrange) => {
    // 準備
    arrange(fetchMock);

    // 実行
    render(<Page />);

    // 検証
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(LOAD_FAILED);
    expect(alert).toHaveTextContent(RELOAD_ADVICE);
  });

  describe("イベント名の読み上げ", () => {
    it("イベント名の前に、画面には出さない「最新イベント：」を付け、読み上げでは「最新イベント：2026夏イベ」になる", async () => {
      // 準備
      respondWithDefinition(fetchMock);

      // 実行
      render(<Page />);

      // 検証：イベント名だけの要素（完全一致）は今までどおり探せる
      const header = headerOf(heading);
      expect(await within(header).findByText("2026夏イベ")).toBeInTheDocument();
      // 「最新イベント：」の要素がある。読み上げから外していない（視覚的に隠すだけ。隠し方は画面テストで確かめる）
      const prefix = within(header).getByText(EVENT_NAME_PREFIX);
      expect(prefix).not.toHaveAttribute("aria-hidden", "true");
      expect(prefix).toBeVisible();
      // 文書の順で「最新イベント：」の直後にイベント名が続く（読み上げの順）
      expect(header).toHaveTextContent(`${EVENT_NAME_PREFIX}2026夏イベ`);
    });

    it("読み込めないときは「最新イベント：」も出さない（名前のない「最新イベント：」を読み上げない）", async () => {
      // 準備
      respondWithStatus(fetchMock, 404);

      // 実行
      render(<Page />);
      await screen.findByRole("alert");

      // 検証
      expect(within(headerOf(heading)).queryByText(EVENT_NAME_PREFIX)).not.toBeInTheDocument();
    });
  });
});
