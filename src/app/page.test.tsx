import { act, cleanup, render, type RenderResult, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// `@/` の別名が Vitest でも解決できることを兼ねて確かめるため、別名で読み込む
import HomePage from "@/app/page";
import { SettingsDialog } from "@/components/SettingsDialog";
import { closeSettingsDialog, openSettingsDialog } from "@/components/settings-dialog-store";
import { setRole } from "@/features/auth";
import { SettingsContent } from "@/features/settings";
import { resetLatestDefinitionCache, useLatestDefinition } from "@/lib/definition";
import { resetPlanDataCache, usePlanData } from "@/lib/plan";
import type { FudawariStorage } from "@/lib/storage";
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
import { cloneSummer2026Definition, summer2026Ships } from "@/test/fixtures";
import { cleanupTestStorages, importInput, openTestStorage } from "@/test/plan-storage";

// テスト用の 2026夏イベは 2026-08-07 12:00（日本時間）開始・終了日時は未定（src/test/fixtures/summer2026Definition.ts）
/** 2026夏イベの開始日時 */
const START_AT = new Date("2026-08-07T12:00:00+09:00");
/** 2026夏イベの開催中の時刻 */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");
/** 2026夏イベの開始前の時刻 */
const BEFORE_START = new Date("2026-08-01T12:00:00+09:00");
/** 終了したイベントにするときの終了日時（今〔WHILE_RUNNING〕より前） */
const ENDED_AT = "2026-09-01T11:00:00+09:00";

/** 静的ファイルの置き場所（public/data/latest-definition.json） */
const LATEST_DEFINITION = "/data/latest-definition.json";

/** 読み込みに失敗したときの警告の書き出し（ほかの画面と同じ） */
const LOAD_FAILED = "イベントの定義を読み込めませんでした";
/** 読み込みに失敗したときに警告に書く次の行動 */
const RELOAD_ADVICE = "ページを再読み込みしてください";

// 協力者・管理者のイベント定義のタイルの説明（要件 3.1、U18）
/** 協力者：最新のイベントが終了していない（開始前を含む） */
const COLLAB_NOTE_UPDATABLE = "最新イベントの札・段階・特効を更新";
/** 協力者：最新のイベントが終了している */
const COLLAB_NOTE_ENDED = "更新できるイベントがありません（最新のイベントは終了しました）";
/** 協力者：定義の読み込み中 */
const COLLAB_NOTE_CHECKING = "イベントの情報を確認しています";
/** 協力者：定義の読み込みの失敗（読み込めなかったことが分かる文言。言い回しは実装に任せ、要点だけを確かめる） */
const COLLAB_NOTE_LOAD_FAILED = /読み込めませんでした/;
/** 管理者（状態によらず同じ） */
const ADMIN_NOTE = "札・段階・特効の設定、新規イベントの作成";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** setTimeout・setInterval に渡せる待ち時間の上限（2^31−1 ミリ秒、約 24.8 日）。超えるとすぐに呼ばれてしまう */
const MAX_TIMER_DELAY = 2 ** 31 - 1;

/** 基準の時刻から ms だけずらした時刻 */
function shift(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** 終了日時を決めた 2026夏イベの定義を返すようにする */
function respondWithEndAt(fetchMock: FetchMock, endAt: string): void {
  const definition = cloneSummer2026Definition();
  definition.event.endAt = endAt;
  respondWithDefinition(fetchMock, definition);
}

/** 確認用の部品が出す文の書き出し */
const PROBE_LABEL = "確認用：定義の読み込みの状態＝";

/**
 * 共有している読み込みの状態（useLatestDefinition）を文字で出す、テストだけで使う確認用の部品。
 * ホームと一緒に描き、読み込みが成功または失敗の状態になったことを確かめてから「出ない」ことを見るために使う
 * （ホームと同じ状態を共有するため、取得は増えない）
 */
function DefinitionStatusProbe(): ReactNode {
  const state = useLatestDefinition();
  return <p>{`${PROBE_LABEL}${state.status}`}</p>;
}

/** ホームを確認用の部品と一緒に描く */
function renderHomePage(): RenderResult {
  return render(
    <>
      <HomePage />
      <DefinitionStatusProbe />
    </>,
  );
}

/**
 * 読み込みが指定の状態（成功・失敗）になるまで待つ（renderHomePage で描いたとき）。
 * 状態が変わったことを確かめてから、その結果を受けた描き直し（effect とそこからの描き直し）を済ませる
 */
async function waitForDefinition(status: "success" | "error"): Promise<void> {
  expect(await screen.findByText(`${PROBE_LABEL}${status}`)).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
  });
}

/** 偽の時計を ms だけ進める（その間に期限が来るタイマーを動かし、描き直しを済ませる） */
async function advanceTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** 「管理」の区分のイベント定義のタイル（名前は「タイトル＋説明」になるため、タイトルの前方一致で探す） */
function getDefinitionTile(): HTMLElement {
  return screen.getByRole("link", { name: /^イベント定義/ });
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

      // 実行：読み込みが成功の状態になるまで待つ
      renderHomePage();
      await waitForDefinition("success");

      // 検証
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("最新イベントが終了していれば「開催中：」を出さない", async () => {
      // 準備：2026-09-01 に終了したイベント、今は 2026-10-16
      respondWithEndAt(fetchMock, ENDED_AT);

      // 実行：読み込みが成功の状態になるまで待つ
      renderHomePage();
      await waitForDefinition("success");

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

      // 実行：読み込みが失敗の状態になるまで待つ
      renderHomePage();
      await waitForDefinition("error");

      // 検証：画面は出ている（失敗で落ちない）。「開催中：」はない
      expect(screen.getByRole("heading", { level: 1, name: "札割りプランナー" })).toBeInTheDocument();
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });
  });

  describe("時刻の境目での描き直し（ホームを開いたまま、最新イベントの開始日時・終了日時をまたぐ）", () => {
    beforeEach(() => {
      // 境目で描き直すタイマーも偽にする。Testing Library の待ち（findBy など）が止まらないよう、
      // 偽の時計は実際の時間に合わせても進める（shouldAdvanceTime）。境目は数分以上先に置くので、そのずれは結果に響かない
      vi.useFakeTimers({
        toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
        shouldAdvanceTime: true,
      });
    });

    afterEach(() => {
      // 監視（spyOn）を外してから本物のタイマーに戻す（逆の順だと偽のタイマーが残る）
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("開始前に開いていて開始日時を過ぎたら、描き直して「開催中：2026夏イベ」を出す", async () => {
      // 準備：開始の 1 時間前に開き、読み込みを済ませる
      vi.setSystemTime(shift(START_AT, -HOUR));
      renderHomePage();
      await waitForDefinition("success");
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 実行：開始の 1 分前まで進める
      await advanceTime(HOUR - MINUTE);

      // 検証：まだ出さない（早まって出さない）
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 実行：開始日時を過ぎるまで進める（開始の 1 分後）
      await advanceTime(2 * MINUTE);

      // 検証
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();
    });

    it("開催中に開いていて終了日時を過ぎたら、描き直して「開催中：」を消す", async () => {
      // 準備：2026-09-01 11:00 に終了するイベント。終了の 1 時間前に開き、読み込みを済ませる
      respondWithEndAt(fetchMock, ENDED_AT);
      vi.setSystemTime(shift(new Date(ENDED_AT), -HOUR));
      renderHomePage();
      await waitForDefinition("success");
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();

      // 実行：終了の 1 分前まで進める
      await advanceTime(HOUR - MINUTE);

      // 検証：まだ消さない
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();

      // 実行：終了日時を過ぎるまで進める（終了の 1 分後）
      await advanceTime(2 * MINUTE);

      // 検証
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("開始前に開いたまま開始日時と終了日時を続けてまたぐと、出してから消す（境目ごとにタイマーを仕掛け直す）", async () => {
      // 準備：開始の 3 時間後に終了するイベント。開始の 1 時間前に開く
      respondWithEndAt(fetchMock, "2026-08-07T15:00:00+09:00");
      vi.setSystemTime(shift(START_AT, -HOUR));
      renderHomePage();
      await waitForDefinition("success");
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 実行・検証：開始の 1 時間後（開催中）
      await advanceTime(2 * HOUR);
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();

      // 実行・検証：終了の 1 時間後（終了）
      await advanceTime(3 * HOUR);
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("協力者には、開いたまま終了日時を過ぎたら、イベント定義の説明を「更新できるイベントがありません（最新のイベントは終了しました）」に変える", async () => {
      // 準備：終了の 1 時間前に協力者で開く
      setRole("collab");
      respondWithEndAt(fetchMock, ENDED_AT);
      vi.setSystemTime(shift(new Date(ENDED_AT), -HOUR));
      renderHomePage();
      await waitForDefinition("success");
      expect(getDefinitionTile()).toHaveTextContent(COLLAB_NOTE_UPDATABLE);

      // 実行：終了の 1 時間後まで進める
      await advanceTime(2 * HOUR);

      // 検証
      const tile = getDefinitionTile();
      expect(tile).toHaveTextContent(COLLAB_NOTE_ENDED);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_UPDATABLE);
    });

    it("境目が setTimeout の上限（約 24.8 日）より先でも、上限を超える待ち時間を渡さず、早まって出さず、境目を過ぎたら出す", async () => {
      // 準備：開始の 25 日前に開く（25 日は上限の 2^31−1 ミリ秒を超える）。ページが仕掛けるタイマーの待ち時間を記録する
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      vi.setSystemTime(shift(START_AT, -25 * DAY));
      renderHomePage();
      await waitForDefinition("success");
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 検証：上限を超える待ち時間を渡していない（超えるとすぐに呼ばれ、早まって描き直したり、描き直しが止まらなくなったりする）
      const delays = [...setTimeoutSpy.mock.calls, ...setIntervalSpy.mock.calls].map(([, delay]) =>
        Number(delay ?? 0),
      );
      expect(delays.filter((delay) => delay > MAX_TIMER_DELAY)).toEqual([]);

      // 実行・検証：少し進めても、まだ出さない
      await advanceTime(MINUTE);
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 実行・検証：上限を過ぎ、開始の 1 分前まで進めても、まだ出さない
      await advanceTime(25 * DAY - 2 * MINUTE);
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();

      // 実行・検証：開始日時を過ぎたら出す（開始の 1 分後）
      await advanceTime(2 * MINUTE);
      expect(screen.getByText(/開催中：2026夏イベ/)).toBeInTheDocument();
    });

    it("画面を外したら、境目のタイマーを残さない", async () => {
      // 準備：開始の 1 時間前に開き、読み込みを済ませる（次の境目は開始日時）
      vi.setSystemTime(shift(START_AT, -HOUR));
      const { unmount } = renderHomePage();
      await waitForDefinition("success");

      // 実行
      unmount();

      // 検証：待っているタイマーがない
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("読み込みの失敗の表示（ほかの画面と同じ警告。T2-3）", () => {
    it.each([
      ["404", (mock: FetchMock) => respondWithStatus(mock, 404), "404"],
      ["ネットワークの失敗", (mock: FetchMock) => failNetwork(mock), "通信に失敗しました"],
      [
        "壊れた JSON",
        (mock: FetchMock) => mock.mockImplementation(async () => textResponse("{ broken")),
        "JSON として読めません",
      ],
      [
        "検証の失敗",
        (mock: FetchMock) => {
          const broken = cloneSummer2026Definition();
          broken.event.name = "";
          mock.mockImplementation(async () => textResponse(JSON.stringify(broken)));
        },
        "event.name：空にはできません",
      ],
    ])(
      "読み込みに失敗（%s）したら、警告（role=\"alert\"）に「イベントの定義を読み込めませんでした」、理由、次の行動「ページを再読み込みしてください」を出す",
      async (_label, arrange, reason) => {
        // 準備
        arrange(fetchMock);

        // 実行
        render(<HomePage />);

        // 検証
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(LOAD_FAILED);
        expect(alert).toHaveTextContent(reason);
        expect(alert).toHaveTextContent(RELOAD_ADVICE);
      },
    );

    it("読み込めたら警告を出さない", async () => {
      // 準備・実行：読み込みが成功の状態になるまで待つ
      renderHomePage();
      await waitForDefinition("success");

      // 検証
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("読み込み中は警告を出さない", async () => {
      // 準備：応答を待たせる
      holdFetch(fetchMock);

      // 実行
      render(<HomePage />);

      // 検証：取得を始めたことを確かめてから、まだ出ていないことを見る
      await waitFor(() => expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("「管理」の区分のイベント定義のタイルの説明（要件 3.1、U18）", () => {
    it("協力者には、最新イベントが開催中なら「最新イベントの札・段階・特効を更新」にする", async () => {
      // 準備
      setRole("collab");

      // 実行
      renderHomePage();
      await waitForDefinition("success");

      // 検証
      const tile = getDefinitionTile();
      expect(tile).toHaveTextContent(COLLAB_NOTE_UPDATABLE);
      expect(tile).toHaveAttribute("href", "/definition");
    });

    it("協力者には、最新イベントの開始前でも（終了していなければ）「最新イベントの札・段階・特効を更新」にする。「開催中：」は出さない", async () => {
      // 準備
      setRole("collab");
      vi.setSystemTime(BEFORE_START);

      // 実行
      renderHomePage();
      await waitForDefinition("success");

      // 検証
      expect(getDefinitionTile()).toHaveTextContent(COLLAB_NOTE_UPDATABLE);
      expect(screen.queryByText(/開催中：/)).not.toBeInTheDocument();
    });

    it("協力者には、最新イベントが終了していれば「更新できるイベントがありません（最新のイベントは終了しました）」にする", async () => {
      // 準備：2026-09-01 に終了したイベント、今は 2026-10-16
      setRole("collab");
      respondWithEndAt(fetchMock, ENDED_AT);

      // 実行
      renderHomePage();
      await waitForDefinition("success");

      // 検証
      const tile = getDefinitionTile();
      expect(tile).toHaveTextContent(COLLAB_NOTE_ENDED);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_UPDATABLE);
    });

    it("協力者には、定義の読み込み中は「イベントの情報を確認しています」にする", async () => {
      // 準備：応答を待たせる
      setRole("collab");
      holdFetch(fetchMock);

      // 実行
      render(<HomePage />);
      await waitFor(() => expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]));

      // 検証
      const tile = getDefinitionTile();
      expect(tile).toHaveTextContent(COLLAB_NOTE_CHECKING);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_UPDATABLE);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_ENDED);
    });

    it("協力者には、定義の読み込みに失敗したら、読み込めなかったことが分かる説明にする", async () => {
      // 準備
      setRole("collab");
      respondWithStatus(fetchMock, 404);

      // 実行
      renderHomePage();
      await waitForDefinition("error");

      // 検証
      const tile = getDefinitionTile();
      expect(tile).toHaveTextContent(COLLAB_NOTE_LOAD_FAILED);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_UPDATABLE);
      expect(tile).not.toHaveTextContent(COLLAB_NOTE_CHECKING);
    });

    it.each([
      ["終了後", (mock: FetchMock) => respondWithEndAt(mock, ENDED_AT), "success"],
      ["読み込みの失敗", (mock: FetchMock) => respondWithStatus(mock, 404), "error"],
    ] as const)(
      "管理者には、最新イベントが%sでも「札・段階・特効の設定、新規イベントの作成」のまま",
      async (_label, arrange, status) => {
        // 準備
        setRole("admin");
        arrange(fetchMock);

        // 実行
        renderHomePage();
        await waitForDefinition(status);

        // 検証
        expect(getDefinitionTile()).toHaveTextContent(ADMIN_NOTE);
      },
    );

    it("管理者には、定義の読み込み中も「札・段階・特効の設定、新規イベントの作成」のまま", async () => {
      // 準備：応答を待たせる
      setRole("admin");
      holdFetch(fetchMock);

      // 実行
      render(<HomePage />);
      await waitFor(() => expect(requestedPaths(fetchMock)).toEqual([LATEST_DEFINITION]));

      // 検証
      expect(getDefinitionTile()).toHaveTextContent(ADMIN_NOTE);
    });
  });

  // PR-14（T4-2 の点検の M1）：ヘッダーの補足に「開催中：（イベント名） ／ 最終取り込み M/D HH:mm」（モック Home.dc.html、要件 3.1）。
  // 最終取り込みはブラウザ内の保存（共有の札割りのデータと同じ保存先。getPlanStorage・usePlanData のどちらから読んでもよい）から読む。
  // 取り込んでいなければ「最終取り込み」は出さない。開催中でなければ「開催中：」と区切りの「／」は出さない。
  // 補足の文は 1 つの要素でも分かれていてもよい（ヘッダー〔h1 を含む <header>〕の文字で確かめる）
  describe("「最終取り込み M/D HH:mm」（PR-14：T4-2 の点検の M1）", () => {
    /** 取り込んだ日時（端末の時刻帯で 2026-10-15 20:40）。端末の時刻帯に左右されないよう、端末の時刻で作ってから ISO 8601 にする */
    const IMPORTED_AT = new Date(2026, 9, 15, 20, 40).toISOString();
    /** 画面に出る最終取り込み */
    const LAST_IMPORT = /最終取り込み\s*10\/15\s+20:40/;
    /** 最新イベントの ID（"2026-summer"） */
    const EVENT_ID = cloneSummer2026Definition().event.id;

    let storage: FudawariStorage;

    beforeEach(() => {
      storage = openTestStorage("fudawari-home-test").storage;
      resetPlanDataCache({ storage });
    });

    afterEach(async () => {
      cleanup();
      resetPlanDataCache();
      await cleanupTestStorages();
    });

    /** ホームのヘッダー（h1「札割りプランナー」を含む <header>） */
    function getHomeHeader(): HTMLElement {
      const header = screen.getByRole("heading", { level: 1, name: "札割りプランナー" }).closest("header");
      if (header === null) throw new Error("h1 を含む <header> がありません");
      return header;
    }

    /** 確認用：共有の札割りのデータ（usePlanData）の状態を文字で出す（ホームと同じ保存先を読み終えたかを確かめる） */
    function PlanStatusProbe(): ReactNode {
      const state = useLatestDefinition();
      const definition = state.status === "success" ? state.definition : null;
      const plan = usePlanData(definition?.event.id ?? null, definition?.fudas.map((fuda) => fuda.id) ?? []);
      return <p>{`確認用：札割りのデータ＝${plan.status}`}</p>;
    }

    /**
     * ホームを確認用の部品と一緒に描き、定義と保存先（最終取り込み）を読み終えるまで待つ。
     * ホームが保存先から直接読んでも、共有の札割りのデータから読んでもよいよう、確認用の部品が読み終え、
     * 保存先の最終取り込みの読み取りがすべて終わってから、その結果を受けた描き直しを済ませる
     */
    async function renderHomeAndWaitForData(): Promise<void> {
      const loadLastImport = vi.spyOn(storage, "loadLastImport");
      render(
        <>
          <HomePage />
          <DefinitionStatusProbe />
          <PlanStatusProbe />
        </>,
      );
      await waitForDefinition("success");
      expect(await screen.findByText("確認用：札割りのデータ＝ready")).toBeInTheDocument();
      await act(async () => {
        await Promise.allSettled(loadLastImport.mock.results.map((result) => result.value as Promise<unknown>));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it("開催中で取り込み済みなら、ヘッダーに「開催中：2026夏イベ ／ 最終取り込み 10/15 20:40」を出す", async () => {
      // 準備：取り込みを保存しておく（beforeEach のとおり開催中の時刻）
      await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));

      // 実行
      render(<HomePage />);

      // 検証
      await waitFor(() =>
        expect(getHomeHeader()).toHaveTextContent(/開催中：2026夏イベ\s*／\s*最終取り込み\s*10\/15\s+20:40/),
      );
    });

    it("最新イベントが終了していて取り込み済みなら、「最終取り込み 10/15 20:40」だけを出す（「開催中：」と前の「／」は出さない）", async () => {
      // 準備：2026-09-01 に終了したイベント、今は 2026-10-16。取り込みを保存しておく
      respondWithEndAt(fetchMock, ENDED_AT);
      await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));

      // 実行
      render(<HomePage />);

      // 検証
      await waitFor(() => expect(getHomeHeader()).toHaveTextContent(LAST_IMPORT));
      expect(getHomeHeader()).not.toHaveTextContent(/開催中：/);
      expect(getHomeHeader()).not.toHaveTextContent(/／\s*最終取り込み/);
    });

    it("取り込んでいなければ「最終取り込み」を出さない（「開催中：2026夏イベ」だけで、後ろに「／」を付けない）", async () => {
      // 準備：何も保存していない

      // 実行：定義と保存先を読み終えるまで待つ
      await renderHomeAndWaitForData();

      // 検証
      expect(getHomeHeader()).toHaveTextContent(/開催中：2026夏イベ/);
      expect(getHomeHeader()).not.toHaveTextContent(/最終取り込み/);
      expect(getHomeHeader()).not.toHaveTextContent(/開催中：2026夏イベ\s*／/);
    });

    // PR-14 のレビュー P3・Codex 4301735604：ホームは共有の札割りのデータ（usePlanData）を使わず、最終取り込みだけを保存先から直接読む
    // （設定の useStoredLastImport と同じ形）。定義を読めないときも出す。ホームを開いただけでは割り当てを書き換えない
    it("最新イベントの定義を読み込めなくても、取り込み済みならヘッダーに「最終取り込み 10/15 20:40」を出す（「開催中：」は出さない）", async () => {
      // 準備：定義は 404。取り込みを保存しておく
      respondWithStatus(fetchMock, 404);
      await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));

      // 実行
      render(<HomePage />);

      // 検証
      await waitFor(() => expect(getHomeHeader()).toHaveTextContent(LAST_IMPORT));
      expect(getHomeHeader()).not.toHaveTextContent(/開催中：/);
      expect(screen.getByRole("alert")).toHaveTextContent(LOAD_FAILED);
    });

    it("ホームを開いただけでは割り当てを書き換えない（定義から消えた札の割り当ても控えに戻さず、保存もしない）", async () => {
      // 準備：取り込みと、定義にない札（removed-fuda）に置いた割り当てを保存しておく
      const assignments = { hatsushimo: "s31", tone: "removed-fuda" };
      await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
      await storage.saveAssignments(EVENT_ID, assignments);
      const returnOrphaned = vi.spyOn(storage, "returnOrphanedAssignments");
      const saveAssignments = vi.spyOn(storage, "saveAssignments");

      // 実行：最終取り込みが出るまで待ち、少し置く
      render(<HomePage />);
      await waitFor(() => expect(getHomeHeader()).toHaveTextContent(LAST_IMPORT));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // 検証
      expect(returnOrphaned).not.toHaveBeenCalled();
      expect(saveAssignments).not.toHaveBeenCalled();
      expect(await storage.loadAssignments(EVENT_ID)).toEqual(assignments);
    });

    it("取り込んだ艦娘データを削除した後（最終取り込みの記録がない）も「最終取り込み」を出さない", async () => {
      // 準備：取り込んでから削除しておく
      await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
      await storage.clearImportedShips();

      // 実行
      await renderHomeAndWaitForData();

      // 検証
      expect(getHomeHeader()).toHaveTextContent(/開催中：2026夏イベ/);
      expect(getHomeHeader()).not.toHaveTextContent(/最終取り込み/);
    });

    // PR-14b（PR-14 の再レビュー M1'）：ホームを開いたまま設定のウィンドウで取り込んだ艦娘データを削除して閉じたら、
    // ヘッダーの「最終取り込み」を消す。直し方は親が決めた（設定のウィンドウが閉じたら〔settings-dialog-store の購読〕、
    // 最終取り込みを保存先から読み直す想定）。設定のウィンドウ（全画面で 1 つ）は、レイアウトと同じくホームと一緒に描く
    describe("設定のウィンドウとのつながり（PR-14b：再レビュー M1'）", () => {
      afterEach(() => {
        closeSettingsDialog();
      });

      /** ホームと設定のウィンドウ（中身つき）を描き、ヘッダーに最終取り込みが出るまで待つ */
      async function renderHomeWithSettings(): Promise<UserEvent> {
        const user = userEvent.setup();
        render(
          <>
            <HomePage />
            <SettingsDialog>
              <SettingsContent />
            </SettingsDialog>
          </>,
        );
        await waitFor(() => expect(getHomeHeader()).toHaveTextContent(LAST_IMPORT));
        return user;
      }

      /** 設定のウィンドウを開き、「データ」の最終取り込みの行を読み終えるまで待つ */
      async function openSettingsAndWaitForData(): Promise<HTMLElement> {
        act(() => {
          openSettingsDialog();
        });
        const dialog = await screen.findByRole("dialog", { name: "設定" });
        await waitFor(() => expect(dialog).toHaveTextContent(/最終取り込み\s*10\/15\s+20:40/));
        return dialog;
      }

      /** 設定のウィンドウを閉じ、閉じ終わるまで待つ */
      async function closeSettings(): Promise<void> {
        act(() => {
          closeSettingsDialog();
        });
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "設定" })).not.toBeInTheDocument());
      }

      it("ホームを開いたまま、設定のウィンドウで「取り込んだ艦娘データを削除」→「削除する」→ 閉じると、ヘッダーの「最終取り込み」が消える", async () => {
        // 準備：取り込みを保存し、ホームに最終取り込みが出ている
        await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
        const user = await renderHomeWithSettings();

        // 実行：設定のウィンドウで削除して、閉じる
        const dialog = await openSettingsAndWaitForData();
        await user.click(within(dialog).getByRole("button", { name: "削除する" }));
        const confirm = await screen.findByRole("alertdialog");
        await user.click(within(confirm).getByRole("button", { name: "削除する" }));
        await waitFor(async () => expect(await storage.loadLastImport()).toBeNull());
        await waitFor(() => expect(dialog).toHaveTextContent("取り込んだ艦娘データはありません"));
        await closeSettings();

        // 検証：「最終取り込み」は消え、「開催中：2026夏イベ」は残る（後ろに「／」を付けない）
        await waitFor(() => expect(getHomeHeader()).not.toHaveTextContent(/最終取り込み/));
        expect(getHomeHeader()).toHaveTextContent(/開催中：2026夏イベ/);
        expect(getHomeHeader()).not.toHaveTextContent(/開催中：2026夏イベ\s*／/);
      });

      it("ホームを開いたまま、設定のウィンドウで何も変えずに閉じても、ヘッダーの「最終取り込み 10/15 20:40」はそのまま（守り）", async () => {
        // 準備
        await storage.saveImport(importInput(summer2026Ships, { importedAt: IMPORTED_AT }));
        await renderHomeWithSettings();

        // 実行：開いて、何も変えずに閉じる（読み直しが済むまで少し置く）
        await openSettingsAndWaitForData();
        await closeSettings();
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });

        // 検証
        expect(getHomeHeader()).toHaveTextContent(/開催中：2026夏イベ\s*／\s*最終取り込み\s*10\/15\s+20:40/);
      });
    });
  });
});
