// 割り振り画面の中身（AssignScreen）の、控えの仮想スクロールとドラッグ＆ドロップの前提の画面テスト
// （roadmap T2-8・PR-06、要件 3.3「控え」「ドラッグ＆ドロップ」、モック Assign.dc.html）
//
// jsdom はレイアウトをしないので、ドラッグ＆ドロップの操作そのもの（移動・入れ替え・控えへ戻す・落とす先の強調・
// 「ここに移動」「⇄ 入れ替え」）と、600 隻での速さは Playwright（e2e/assign-dnd.spec.ts・e2e/assign-many-ships.spec.ts）で確かめる。
// ここで確かめること
// - 仮想スクロール：大きさを測れるとき（src/test/virtual-layout.ts の simulateTrayLayout で大きさを返させる）は、
//   600 隻でも見える範囲の分の艦カードだけを描き、スクロールすると描く艦カードが入れ替わる。
//   区切りの見出しは、スクロールでその位置を過ぎても描いたまま（上に固定）で、押すと折りたためる。
//   折りたたんだ区切りの艦は描かず、後ろの区切りが詰めて描かれる。
//   フォーカスした艦カード（キーボードで Tab して来たカードなど）は、スクロールで見える範囲の外に出ても描き続け、フォーカスを失わない
//   （PR-06 のレビュー P2）
// - 大きさを測れないとき（jsdom の既定）は、控えの行をすべて描く（今の画面テストはこの前提で通っている）
// - ドラッグの部品を付けても、艦カードを包む要素（li）はボタンにも Tab で止まる所にもならない（キーボードでのドラッグは作らない。
//   クリックの「ここに置く」が代わり）。ドラッグしていなければ、落とす先の強調・「ここに移動」・「⇄ 入れ替え」を出さない。
//   dnd-kit の既定の英語の操作説明・読み上げを画面に出さない
//
// テスト用データ
// - 600 隻：createBulkShips(600)（仮マスタの 37 種の艦を順に繰り返す。個体 ID は "bulk-0001" から）。割り当てはなし（全艦が控え）。
//   初めは「特効のある艦だけ」が ON なので、特効のない 涼風改二・あきつ丸改（16 隻ずつ）を除く 568 隻を出す（「568 / 600隻」）。
//   Lv は 1・38・75・112・149 の 5 通りなので、並び順「Lv」では「Lv 140 以上」「Lv 110 以上」「Lv 70 以上」「Lv 30 以上」「Lv 1 以上」の
//   5 区切り（113〜114 隻ずつ）になる。並び順「名前」では「名前順」の 1 区切り（568 隻）
// - それ以外：モックの所持艦 31 隻（summer2026Ships）と一覧の割り当て（AssignScreen.test.tsx と同じ）
//
// 部品の探し方（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { AssignScreen } from "@/features/assign/AssignScreen";
import type { SaveAssignments } from "@/features/assign/assign-store";
import type { TrayOptionsInit } from "@/features/assign/tray";
import { getCard, getColumn, getGroupHeader, getTray, trayCountPattern } from "@/test/assign-screen";
import {
  createBulkShips,
  summer2026Assignments,
  summer2026Definition,
  summer2026MasterEntries,
  summer2026Ships,
} from "@/test/fixtures";
import { DEFAULT_TRAY_LAYOUT, scrollTrayList, simulateTrayLayout } from "@/test/virtual-layout";

// ---- テスト用のデータ ----

/** 仮マスタの索引 */
const MASTER = createShipMaster(summer2026MasterEntries);
/** 600 隻（全艦が控え） */
const BULK_SHIPS = createBulkShips(600);

/**
 * 大きさを測れるときに描いてよい艦カードの数の上限。
 * 見える範囲 600px ÷ 行 32px ≒ 19 行に、前後に余分に描く行（overscan）と固定した見出しを足しても十分に収まる数にする。
 * 568 隻をすべて描けば超える
 */
const MAX_RENDERED_CARDS = 100;

/** 描いた艦カードの数が上限以下であることを確かめるときの説明 */
const VIRTUALIZED = `描いた艦カードが ${MAX_RENDERED_CARDS} 枚以下（見える範囲 ${DEFAULT_TRAY_LAYOUT.viewportHeight}px・行 ${DEFAULT_TRAY_LAYOUT.rowHeight}px の分だけ）であること`;

// ---- 補助 ----

interface RenderOptions {
  ships?: readonly OwnedShip[];
  assignments?: AssignmentMap;
  trayInit?: TrayOptionsInit;
}

/** 割り振り画面の中身を描く（定義・マスタはテスト用データ。保存の関数は偽物で、すぐに成功する） */
function renderAssignScreen(options: RenderOptions = {}) {
  const save = vi.fn<SaveAssignments>(() => Promise.resolve());
  const user = userEvent.setup();
  const view = render(
    <AssignScreen
      definition={summer2026Definition}
      master={MASTER}
      ships={options.ships ?? summer2026Ships}
      initialAssignments={options.assignments ?? summer2026Assignments}
      save={save}
      returnedCount={0}
      trayInit={options.trayInit}
    />,
  );
  return { ...view, user, save };
}

/** 控えの一覧（role="tabpanel"。仮想スクロールのスクロールする要素） */
function getTrayList(): HTMLElement {
  return within(getTray()).getByRole("tabpanel");
}

/** 控えに描いている艦カード（data-ship-uid を持つ要素。DOM の順） */
function renderedTrayCards(): HTMLElement[] {
  return [...getTray().querySelectorAll<HTMLElement>("[data-ship-uid]")];
}

/** 控えに描いている艦カードの個体 ID */
function renderedTrayUids(): string[] {
  return renderedTrayCards().map((card) => card.dataset.shipUid ?? "");
}

/** 控えに描いている艦カードのうち、Lv が level のもの（カードの文字の「Lv149」など） */
function renderedTrayCardsWithLevel(level: number): HTMLElement[] {
  const pattern = new RegExp(`Lv\\s*${level}(?!\\d)`);
  return renderedTrayCards().filter((card) => pattern.test(card.textContent ?? ""));
}

/** 控えに描いている艦カードが、見える範囲の分だけ（上限以下・1 枚以上）であることを確かめる */
function expectVirtualized(): void {
  const count = renderedTrayCards().length;
  expect(count, `${VIRTUALIZED}（いま ${count} 枚）`).toBeLessThanOrEqual(MAX_RENDERED_CARDS);
  expect(count, "控えに艦カードを 1 枚以上描いていること").toBeGreaterThan(0);
}

// ---- テスト ----

describe("割り振り画面の控えの仮想スクロール（PR-06）", () => {
  describe("大きさを測れるとき（simulateTrayLayout：見える範囲 600px・行 32px）", { timeout: 30_000 }, () => {
    let restoreLayout: () => void = () => {};

    beforeEach(() => {
      restoreLayout = simulateTrayLayout();
    });

    afterEach(() => {
      restoreLayout();
    });

    it("600 隻の控えでも、描く艦カードは見える範囲の分だけで、表示数は「568 / 600隻」のまま、一覧の先頭（最初の区切りの見出しと艦）を描く", () => {
      // 準備・実行
      renderAssignScreen({ ships: BULK_SHIPS, assignments: {} });

      // 検証
      expect(getTray()).toHaveTextContent(trayCountPattern(568, 600));
      expectVirtualized();
      // 並び順は艦型。最初の区切りは大和型（大和改二重 16 隻）
      expect(getGroupHeader("大和型")).toHaveAttribute("aria-expanded", "true");
      expect(renderedTrayCards().some((card) => card.textContent?.includes("大和改二重"))).toBe(true);
    });

    it("控えの一覧をスクロールすると、描く艦カードが見える範囲のものに入れ替わる（一覧の先頭の艦は描かなくなる）", async () => {
      // 準備：並び順「名前」（「名前順」の 1 区切り・568 隻）
      renderAssignScreen({ ships: BULK_SHIPS, assignments: {}, trayInit: { sort: "name" } });
      expectVirtualized();
      const firstUid = renderedTrayUids()[0];

      // 実行：一覧の中ほど（6000px）までスクロールする
      await scrollTrayList(getTrayList(), 6000);

      // 検証
      expect(renderedTrayUids(), `一覧の先頭の艦（${firstUid}）を描かなくなること`).not.toContain(firstUid);
      expectVirtualized();
    });

    it("スクロールで区切りの見出しの位置を過ぎても、その区切りの見出しは描いたまま（上に固定）で、押すと折りたたみ、もう一度押すと開く", async () => {
      // 準備：並び順「名前」（「名前順」の 1 区切り・568 隻）で、一覧の中ほどまでスクロールする
      const { user } = renderAssignScreen({ ships: BULK_SHIPS, assignments: {}, trayInit: { sort: "name" } });
      expectVirtualized();
      const firstUid = renderedTrayUids()[0];
      await scrollTrayList(getTrayList(), 6000);
      expect(renderedTrayUids(), "前提：スクロールして一覧の先頭の艦を描かなくなっていること").not.toContain(firstUid);

      // 検証：見出し「名前順」は描いたまま
      expect(getGroupHeader("名前順")).toHaveAttribute("aria-expanded", "true");

      // 実行・検証：折りたたむと、控えに艦カードを描かない（見出しは残る）
      await user.click(getGroupHeader("名前順"));
      expect(getGroupHeader("名前順")).toHaveAttribute("aria-expanded", "false");
      expect(renderedTrayCards()).toHaveLength(0);

      // 実行・検証：もう一度押すと開き、艦カードを（見える範囲の分だけ）描く
      await user.click(getGroupHeader("名前順"));
      expect(getGroupHeader("名前順")).toHaveAttribute("aria-expanded", "true");
      expectVirtualized();
    });

    it("フォーカスした控えの艦カードは、スクロールで見える範囲の外に出ても描いたままで、フォーカスを失わない（PR-06 のレビュー P2）", async () => {
      // 準備：並び順「名前」（「名前順」の 1 区切り・568 隻）で、一覧の先頭の艦カードにフォーカスする（Tab で来たときと同じ）
      renderAssignScreen({ ships: BULK_SHIPS, assignments: {}, trayInit: { sort: "name" } });
      const firstCard = renderedTrayCards()[0];
      const firstUid = firstCard.dataset.shipUid;
      act(() => firstCard.focus());
      expect(firstCard, "前提：先頭の艦カードにフォーカスがあること").toHaveFocus();

      // 実行：一覧の中ほど（6000px）までスクロールする（先頭の艦カードは見える範囲の外）
      await scrollTrayList(getTrayList(), 6000);

      // 検証：フォーカスした艦カードは描いたまま（同じ要素）で、フォーカスもそのまま。ほかの行は見える範囲の分だけ
      expect(renderedTrayUids(), `フォーカスした艦（${firstUid}）を描いたままにすること`).toContain(firstUid);
      expect(firstCard.isConnected, "フォーカスした艦カードの要素を外さないこと").toBe(true);
      expect(firstCard).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      expectVirtualized();
    });

    it("先頭の区切りを折りたたむと、その区切りの艦は描かず、次の区切りの見出しと艦を詰めて描く（見える範囲の分だけ）", async () => {
      // 準備：並び順「Lv」（Lv 140 以上・Lv 110 以上・…の 5 区切り）
      const { user } = renderAssignScreen({ ships: BULK_SHIPS, assignments: {}, trayInit: { sort: "lv" } });
      expectVirtualized();
      expect(renderedTrayCardsWithLevel(149).length, "前提：先頭の区切りの艦（Lv149）を描いていること").toBeGreaterThan(0);

      // 実行
      await user.click(getGroupHeader("Lv 140 以上"));

      // 検証
      expect(getGroupHeader("Lv 140 以上")).toHaveAttribute("aria-expanded", "false");
      expect(renderedTrayCardsWithLevel(149)).toHaveLength(0);
      expect(getGroupHeader("Lv 110 以上")).toHaveAttribute("aria-expanded", "true");
      expect(renderedTrayCardsWithLevel(112).length, "次の区切りの艦（Lv112）を描くこと").toBeGreaterThan(0);
      expectVirtualized();

      // 実行・検証：開き直すと、先頭の区切りの艦をまた描く
      await user.click(getGroupHeader("Lv 140 以上"));
      expect(renderedTrayCardsWithLevel(149).length).toBeGreaterThan(0);
      expectVirtualized();
    });
  });

  describe("大きさを測れないとき（jsdom の既定）", () => {
    it("控えの行をすべて描く（今の画面テストの前提。100 隻をすべて出す条件なら、艦カードも 100 枚）", async () => {
      // 準備
      const { user } = renderAssignScreen({ ships: createBulkShips(100), assignments: {} });

      // 実行：「リセット」で「特効のある艦だけ」を外し、100 隻すべてを出す
      await user.click(within(getTray()).getByRole("button", { name: "リセット" }));

      // 検証
      expect(getTray()).toHaveTextContent(trayCountPattern(100, 100));
      expect(renderedTrayCards()).toHaveLength(100);
    });
  });
});

describe("割り振り画面のドラッグ＆ドロップの前提（PR-06。操作そのものは Playwright で確かめる）", () => {
  it("艦カードを包む要素（控えと札の列の li）は、ボタンにも Tab で止まる所にもならない（キーボードでのドラッグは作らない）", () => {
    // 準備・実行
    renderAssignScreen();

    // 検証：控えの利根改二・札の列の時雨改二
    for (const card of [getCard(getTray(), "利根改二"), getCard(getColumn("連合艦隊"), "時雨改二")]) {
      const item = card.closest("li");
      if (item === null) throw new Error("艦カードが li に包まれていない");
      expect(item).not.toHaveAttribute("role", "button");
      expect(item.tabIndex, "艦カードを包む li が Tab で止まらないこと").toBeLessThan(0);
    }
    // 名前に艦名を含むボタンは、艦カードそのものだけ
    expect(screen.getAllByRole("button", { name: /利根改二/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /時雨改二/ })).toHaveLength(1);
  });

  it("ドラッグしていないときは、落とす先の強調（data-drop-highlight）・「ここに移動」・「⇄ 入れ替え」を出さない（艦を選んでも出さない）", async () => {
    // 準備
    const { user, container } = renderAssignScreen();

    /** 強調と表示がないことを確かめる */
    const expectNoDropHints = (): void => {
      expect(container.querySelectorAll('[data-drop-highlight="true"]')).toHaveLength(0);
      expect(screen.queryByText("ここに移動")).not.toBeInTheDocument();
      // ヘッダーの操作の説明（「…カードに重ねると入れ替え」）には当てない
      expect(screen.queryByText(/⇄\s*入れ替え/)).not.toBeInTheDocument();
    };
    expectNoDropHints();

    // 実行：艦を選ぶ（ドラッグではない）
    await user.click(getCard(getTray(), "利根改二"));

    // 検証
    expectNoDropHints();
  });

  it("dnd-kit の既定の英語の操作説明・読み上げを画面に出さない（出すなら日本語にする）", () => {
    // 準備・実行
    const { container } = renderAssignScreen();

    // 検証：画面に見えない読み上げ用の文も含めて調べる
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/draggable|droppable|space bar|arrow keys|press escape|picked up|was dropped/i);
    for (const element of container.querySelectorAll("[aria-roledescription]")) {
      expect(element.getAttribute("aria-roledescription") ?? "").not.toMatch(/drag/i);
    }
  });
});
