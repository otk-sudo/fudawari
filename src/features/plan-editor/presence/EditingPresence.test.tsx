import { act, render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { expectInDocumentOrder } from "@/test/dom-order";
import { PlanEditor } from "../PlanEditor";
import {
  ADMIN,
  COLLAB,
  createFakeRepository,
  expectTextNotShown,
  expectTextShown,
  fixClock,
  LATEST_EVENT_ID,
  makeData,
  restoreClock,
  selectStage,
  switchToCreate,
  textContaining,
} from "../test-helpers";
import type { PlanEditorData } from "../types";
import type { PresenceConnection, PresenceConnectOptions, PresenceConnector, PresencePeer } from "./types";

// 編集中の表示（要件 3.7「編集中の人」、roadmap T3-9、plan-v1 の PR-12）
//
// 定義画面（PlanEditor）に connectPresence（Presence のチャンネルにつなぐ関数）の偽物を渡して描く。
// 偽物は、画面が渡した onPeersChange を呼んで「他の人が入った・抜けた」を起こす（自分を除くのは Supabase の実装の役目。
// supabase-presence.test.ts で確かめる）。
// - 既存の更新のときだけ、開いたイベントのチャンネルにつなぎ、自分の表示名と表示中の海域（選んでいる段階の海域）を渡す
// - 他の人がいれば 1 人 1 行で「（名前）も編集中（E3 を表示中）」を出し、抜けたら消す
// - 段階を選び直して表示中の海域が変わったら、つなぎ直さずに setArea で送り直す
// - 画面を閉じたら（部品が外れたら）leave で抜ける
// - 新規作成中は出さない
//
// テストで決めたこと（親の確認用）
// - 複数人は 1 人 1 行で、「編集できる人」の並び（管理者を先に、追加した順）に並べる
//   （モックは 1 人だけの絵。並べ方を変えるなら「複数人は「編集できる人」の並びで 1 人 1 行に出す」のテストだけを直す）
// テストで決めていないこと（親が決める）
// - 表示中の海域がない人（段階がない）の出し方、新規作成に切り替えたときにチャンネルから抜けるか、終了したイベントで出すか
//
// PR-12b（Codex #21-4301315092・レビュー P5）で足したこと
// - 表示名は、送られてきた値（PresencePeer.displayName）ではなく、編集できる人の一覧（利用者の ID → 表示名）から引く。
//   一覧にいない利用者の ID の人は出さない（v1 での対策。送る値は誰でも書けるため）
// - 編集中の人の入れ物に aria-live="polite" を付け、誰もいなくても入れ物は描く（出入りを読み上げる）

/** 偽物のつなぎ先の 1 回分 */
interface FakeConnection extends PresenceConnection {
  readonly options: PresenceConnectOptions;
  readonly setArea: Mock<(areaName: string | null) => void>;
  readonly leave: Mock<() => void>;
}

interface FakePresence {
  readonly connect: Mock<PresenceConnector>;
  readonly connections: FakeConnection[];
  /** 最後につないだチャンネルで、他の人がこうなったことにする */
  readonly emit: (peers: readonly PresencePeer[]) => void;
}

function createFakePresence(): FakePresence {
  const connections: FakeConnection[] = [];
  const connect = vi.fn<PresenceConnector>((options) => {
    const connection: FakeConnection = {
      options,
      setArea: vi.fn<(areaName: string | null) => void>(),
      leave: vi.fn<() => void>(),
    };
    connections.push(connection);
    return connection;
  });
  const emit = (peers: readonly PresencePeer[]): void => {
    const last = connections.at(-1);
    if (last === undefined) throw new Error("まだつないでいません");
    act(() => {
      last.options.onPeersChange(peers);
    });
  };
  return { connect, connections, emit };
}

const AKANE: PresencePeer = { userId: "user-a", displayName: "協力者A", areaName: "E3" };
const BETTY: PresencePeer = { userId: "user-b", displayName: "協力者B", areaName: "E2" };

interface Rendered {
  user: UserEvent;
  presence: FakePresence;
  unmount: () => void;
}

/** 定義画面を、編集中の表示の偽物つきで描き、読み込みが済むまで待つ */
async function renderWithPresence(data: PlanEditorData = makeData()): Promise<Rendered> {
  const user = userEvent.setup();
  const presence = createFakePresence();
  const { unmount } = render(<PlanEditor repository={createFakeRepository(data)} connectPresence={presence.connect} />);
  await screen.findByRole("region", { name: "攻略の流れ" });
  return { user, presence, unmount };
}

/** つなぐまで待ち、その 1 回分を返す */
async function connected(presence: FakePresence): Promise<FakeConnection> {
  await vi.waitFor(() => {
    expect(presence.connect).toHaveBeenCalledTimes(1);
  });
  return presence.connections[0] as FakeConnection;
}

describe("編集中の表示（定義画面）", () => {
  beforeEach(() => {
    fixClock();
  });

  afterEach(() => {
    restoreClock();
  });

  it("既存の更新では、開いたイベントのチャンネルに、自分の表示名と表示中の海域（最初に選ばれている段階の E1）でつなぐ", async () => {
    // 実行
    const { presence } = await renderWithPresence(makeData({ user: ADMIN }));

    // 検証
    const connection = await connected(presence);
    expect(connection.options).toMatchObject({
      eventId: LATEST_EVENT_ID,
      displayName: "テスト管理者",
      areaName: "E1",
    });
  });

  it("協力者も、自分の表示名でつなぐ", async () => {
    // 実行
    const { presence } = await renderWithPresence(makeData({ user: COLLAB }));

    // 検証
    const connection = await connected(presence);
    expect(connection.options).toMatchObject({ eventId: LATEST_EVENT_ID, displayName: "協力者A" });
  });

  it("他に誰もいなければ「も編集中」を出さない", async () => {
    // 準備
    const { presence } = await renderWithPresence();
    await connected(presence);

    // 実行
    presence.emit([]);

    // 検証
    expectTextNotShown("も編集中");
  });

  it("他の人が入ると「（名前）も編集中（E3 を表示中）」を出し、抜けると消す", async () => {
    // 準備
    const { presence } = await renderWithPresence();
    await connected(presence);

    // 実行・検証：入る
    presence.emit([AKANE]);
    expectTextShown("協力者Aも編集中（E3 を表示中）");

    // 実行・検証：抜ける
    presence.emit([]);
    expectTextNotShown("協力者Aも編集中");
  });

  it("他の人が表示中の海域を変えると、表示も変わる", async () => {
    // 準備
    const { presence } = await renderWithPresence();
    await connected(presence);
    presence.emit([AKANE]);

    // 実行
    presence.emit([{ ...AKANE, areaName: "E1" }]);

    // 検証
    expectTextShown("協力者Aも編集中（E1 を表示中）");
    expectTextNotShown("E3 を表示中");
  });

  it("2 人いれば、2 人とも 1 人 1 行で出す", async () => {
    // 準備
    const { presence } = await renderWithPresence();
    await connected(presence);

    // 実行
    presence.emit([AKANE, BETTY]);

    // 検証
    expectTextShown("協力者Aも編集中（E3 を表示中）");
    expectTextShown("協力者Bも編集中（E2 を表示中）");
    // 1 人 1 行：それぞれの文を持つ最も内側の要素が別々で、片方がもう片方を含まない
    const akaneLine = screen.getByText(textContaining("協力者Aも編集中"));
    const bettyLine = screen.getByText(textContaining("協力者Bも編集中"));
    expect(akaneLine.contains(bettyLine) || bettyLine.contains(akaneLine)).toBe(false);
  });

  it("複数人は「編集できる人」の並び（管理者を先に、追加した順）で出す", async () => {
    // 準備（編集できる人の並び：テスト管理者・協力者A・協力者B。ログイン中は協力者A ではなく管理者）
    const { presence } = await renderWithPresence(makeData({ user: ADMIN }));
    await connected(presence);

    // 実行：届いた順は協力者B・協力者A
    presence.emit([BETTY, AKANE]);

    // 検証
    expectInDocumentOrder([
      screen.getByText(textContaining("協力者Aも編集中")),
      screen.getByText(textContaining("協力者Bも編集中")),
    ]);
  });

  it("段階を選び直して表示中の海域が変わったら、つなぎ直さずに海域を送り直す", async () => {
    // 準備
    const { user, presence } = await renderWithPresence();
    const connection = await connected(presence);

    // 実行
    await selectStage(user, "E3", "ゲージ4");

    // 検証
    expect(connection.setArea).toHaveBeenLastCalledWith("E3");
    expect(presence.connect).toHaveBeenCalledTimes(1);
    expect(connection.leave).not.toHaveBeenCalled();
  });

  it("画面を閉じたら（部品が外れたら）チャンネルから抜ける", async () => {
    // 準備
    const { presence, unmount } = await renderWithPresence();
    const connection = await connected(presence);
    expect(connection.leave).not.toHaveBeenCalled();

    // 実行
    unmount();

    // 検証
    expect(connection.leave).toHaveBeenCalled();
  });

  it("新規作成に切り替えると「も編集中」を出さない", async () => {
    // 準備
    const { user, presence } = await renderWithPresence();
    await connected(presence);
    presence.emit([AKANE]);
    expectTextShown("協力者Aも編集中（E3 を表示中）");

    // 実行
    await switchToCreate(user);

    // 検証
    expectTextNotShown("も編集中");
  });

  it("最新のイベントがなく新規作成から始まる管理者は、つながず何も出さない", async () => {
    // 実行
    const { presence } = await renderWithPresence(makeData({ latestEvent: null }));

    // 検証
    expect(presence.connect).not.toHaveBeenCalled();
    expectTextNotShown("も編集中");
  });

  describe("PR-12b：表示名は編集できる人の一覧から引く（Codex #21-4301315092）", () => {
    it("送られてきた表示名ではなく、利用者の ID で引いた編集できる人の表示名を出す", async () => {
      // 準備
      const { presence } = await renderWithPresence();
      await connected(presence);

      // 実行：user-a（編集できる人の協力者A）が、違う表示名を送ってきた
      presence.emit([{ userId: "user-a", displayName: "なりすまし", areaName: "E3" }]);

      // 検証
      expectTextShown("協力者Aも編集中（E3 を表示中）");
      expectTextNotShown("なりすまし");
    });

    it("編集できる人の一覧にいない利用者の ID の人は出さない（一覧にいる人は出す）", async () => {
      // 準備
      const { presence } = await renderWithPresence();
      await connected(presence);

      // 実行
      presence.emit([{ userId: "user-stranger", displayName: "知らない人", areaName: "E1" }, AKANE]);

      // 検証
      expectTextShown("協力者Aも編集中（E3 を表示中）");
      expectTextNotShown("知らない人");
      expect(screen.getAllByText(textContaining("も編集中"))).toHaveLength(1);
    });
  });

  describe("PR-12b：編集中の人の読み上げ（レビュー P5）", () => {
    /** aria-live="polite" の要素 */
    function politeRegions(): Element[] {
      return [...document.querySelectorAll('[aria-live="polite"]')];
    }

    it("編集中の人の入れ物に aria-live=\"polite\" を付け、誰もいないときも入れ物を描いておく（出入りで同じ入れ物の中身が変わる）", async () => {
      // 準備：誰もいない
      const { presence } = await renderWithPresence();
      await connected(presence);
      presence.emit([]);
      const regionsWhenEmpty = politeRegions();

      // 実行：入る
      presence.emit([AKANE]);

      // 検証：行は aria-live="polite" の入れ物の中にあり、その入れ物は誰もいないときからあった
      const line = screen.getByText(textContaining("協力者Aも編集中"));
      const live = line.closest('[aria-live="polite"]');
      expect(live, "「も編集中」の行を囲む aria-live=\"polite\" の入れ物").not.toBeNull();
      expect(regionsWhenEmpty).toContain(live);

      // 実行：抜ける
      presence.emit([]);

      // 検証：入れ物は残り、中身は消える
      expect(live).toBeInTheDocument();
      expect(live).not.toHaveTextContent("も編集中");
    });
  });
});
