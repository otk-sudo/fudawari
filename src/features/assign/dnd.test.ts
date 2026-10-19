// 割り振り画面のドラッグ＆ドロップの決まりごと（dnd.ts。roadmap T2-8・PR-06、要件 3.3「ドラッグ＆ドロップ」、モック Assign.dc.html）の単体テスト
//
// ここで確かめること（PR-06 のレビュー M2・M1・M3、Codex の指摘 dnd.ts:89・DraggableShipItem.tsx:56）
// - parseDropId：落とす先の ID（"tray"・"ship:個体 ID"・"fuda:札 ID"）を読む。それ以外は null
// - dropOutcomeOf：落とした結果（札へ移す・入れ替える・控えへ戻す・変わらない）。
//   自分自身・同じ札の艦どうし・控えの艦どうしに重ねたときは変わらない（none）
// - dropFeedbackOf：ドラッグ中の札の列・控えの強調と「ここに移動」
// - createDragAnnouncements：読み上げの 4 種の文（つかんだ・上にある・落とした・やめた）。
//   同じ場所の艦どうし（同じ札・控えどうし）に重ねたときは「離すと入れ替えます」と読み上げない（落とした結果と同じ判定で決める）
// - detectDropTarget：ポインターの下の艦カードを札の列・控えより優先する。控えの一覧の見える範囲（clip）の外のカードには当てない。
//   控えの一覧の一番上に固定した区切りの見出し（cover）の上では、その下に隠れた艦カードに当てず、控えとして扱う
//
// detectDropTarget に渡す落とす先は偽物（dnd-kit の DroppableContainer の形）で、画面上の矩形は droppableRects と
// 要素の getBoundingClientRect（vi.spyOn で返させる）で決める。
//
// 艦カードの落とす先に付けるデータ（useDroppable の data。ShipDropData）の約束（実装の担当向け）
// - clip：当たりを取る範囲を、この要素の見える範囲に限る（控えの一覧のスクロールする要素。今の形のまま）
// - cover（PR-06 のレビューで足す）：このカードの上に重なって隠す要素（控えの一覧の一番上に固定した区切りの見出し）。
//   ポインターがこの要素の見える範囲（getBoundingClientRect）の中にあれば、このカードには当てない
//   （ほかに当たるもの＝控えの落とす先があれば、そちらを返す）。札の列のカードなど、隠す要素がなければ null か省略
//
// テスト用の艦と札（個体 ID → 今いる札。null は控え）
// - 利根改二 tone・浜波改 hamanami：控え
// - 時雨改二 shigure2・北上改二 kitakami：連合艦隊（rengo）
// - 不知火改二 shiranui：ウルシー攻撃部隊（ulithi）
import type { Active, ClientRect, DroppableContainer, Over, UniqueIdentifier } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShipUid } from "@/domain/ship/types";
import {
  createDragAnnouncements,
  createDropTargetDetector,
  detectDropTarget,
  dragIdOf,
  type DragLookup,
  dropFeedbackOf,
  dropOutcomeOf,
  fudaDropIdOf,
  parseDropId,
  shipDropIdOf,
  TRAY_DROP_ID,
} from "./dnd";

// ---- テスト用のデータ ----

/** 艦の個体 ID → 艦名 */
const SHIP_NAMES: Readonly<Record<string, string>> = {
  tone: "利根改二",
  hamanami: "浜波改",
  shigure2: "時雨改二",
  kitakami: "北上改二",
  shiranui: "不知火改二",
};

/** 札 ID → 札名 */
const FUDA_NAMES: Readonly<Record<string, string>> = {
  rengo: "連合艦隊",
  ulithi: "ウルシー攻撃部隊",
  sixth: "第六艦隊",
};

/** 艦の個体 ID → 今いる札の ID（控えの艦はキーがない） */
const PLACES: Readonly<Record<string, string>> = {
  shigure2: "rengo",
  kitakami: "rengo",
  shiranui: "ulithi",
};

/** 画面の情報（艦名・札名・今いる札） */
const LOOKUP: DragLookup = {
  shipName: (uid) => SHIP_NAMES[uid] ?? "艦",
  fudaName: (fudaId) => FUDA_NAMES[fudaId] ?? "札",
  placeOf: (uid) => PLACES[uid] ?? null,
};

// ---- 偽の dnd-kit の値 ----

/** 画面上の矩形（dnd-kit の ClientRect） */
function rectOf(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** ドラッグしている艦（dnd-kit の Active） */
function activeOf(uid: ShipUid): Active {
  return { id: dragIdOf(uid), data: { current: undefined }, rect: { current: { initial: null, translated: null } } };
}

/** ポインターの下の落とす先（dnd-kit の Over）。id が null なら落とす先の外 */
function overOf(id: UniqueIdentifier | null): Over | null {
  return id === null ? null : { id, rect: rectOf(0, 0, 100, 100), disabled: false, data: { current: undefined } };
}

/** 偽の落とす先（dnd-kit の DroppableContainer）と、その画面上の矩形 */
interface FakeDroppable {
  readonly container: DroppableContainer;
  readonly rect: ClientRect;
}

/** 偽の落とす先を作る（data は useDroppable の data） */
function droppableOf(id: string, rect: ClientRect, data?: Record<string, unknown>): FakeDroppable {
  return {
    container: {
      id,
      key: id,
      data: { current: data },
      disabled: false,
      node: { current: null },
      rect: { current: rect },
    },
    rect,
  };
}

/** getBoundingClientRect が rect を返す要素（控えの一覧のスクロールする要素・固定した見出しの代わり） */
function elementWithRect(rect: ClientRect): HTMLElement {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(rect.left, rect.top, rect.width, rect.height),
  );
  return element;
}

/** detectDropTarget を、偽の落とす先とポインターの位置で呼び、当たった落とす先の ID を順に返す */
function detect(droppables: readonly FakeDroppable[], pointer: { x: number; y: number } | null): UniqueIdentifier[] {
  const collisions = detectDropTarget({
    active: activeOf("tone"),
    collisionRect: pointer === null ? rectOf(0, 0, 0, 0) : rectOf(pointer.x, pointer.y, 0, 0),
    droppableRects: new Map(droppables.map(({ container, rect }) => [container.id, rect])),
    droppableContainers: droppables.map(({ container }) => container),
    pointerCoordinates: pointer,
  });
  return collisions.map((collision) => collision.id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- テスト ----

describe("parseDropId（落とす先の ID を読む）", () => {
  it("控えの ID は控えとして読む", () => {
    expect(parseDropId(TRAY_DROP_ID)).toEqual({ kind: "tray" });
  });

  it("艦カードの ID は、その艦の個体 ID として読む（個体 ID に「:」を含んでもそのまま）", () => {
    expect(parseDropId(shipDropIdOf("shigure2"))).toEqual({ kind: "ship", uid: "shigure2" });
    expect(parseDropId("ship:a:b")).toEqual({ kind: "ship", uid: "a:b" });
  });

  it("札の列の ID は、その札の ID として読む", () => {
    expect(parseDropId(fudaDropIdOf("rengo"))).toEqual({ kind: "fuda", fudaId: "rengo" });
  });

  it("落とす先がない（null・undefined）、数の ID、ドラッグする艦の ID、知らない形の ID は null", () => {
    expect(parseDropId(null)).toBeNull();
    expect(parseDropId(undefined)).toBeNull();
    expect(parseDropId(42)).toBeNull();
    expect(parseDropId(dragIdOf("tone"))).toBeNull();
    expect(parseDropId("trays")).toBeNull();
    expect(parseDropId("")).toBeNull();
  });
});

describe("dropOutcomeOf（落とした結果）", () => {
  it("控えの艦を札の列に落とすと、その札へ移す", () => {
    expect(dropOutcomeOf(LOOKUP, "tone", { kind: "fuda", fudaId: "rengo" })).toEqual({ kind: "move", fudaId: "rengo" });
  });

  it("札の艦を別の札の列に落とすと、その札へ移す", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "fuda", fudaId: "sixth" })).toEqual({
      kind: "move",
      fudaId: "sixth",
    });
  });

  it("札の艦を今いる札の列に落としても変わらない", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "fuda", fudaId: "rengo" })).toEqual({ kind: "none" });
  });

  it("札の艦を控えに落とすと、控えへ戻す", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "tray" })).toEqual({ kind: "return" });
  });

  it("控えの艦を控えに落としても変わらない", () => {
    expect(dropOutcomeOf(LOOKUP, "tone", { kind: "tray" })).toEqual({ kind: "none" });
  });

  it("札の艦を別の札の艦に重ねて落とすと、入れ替える", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "ship", uid: "shiranui" })).toEqual({
      kind: "swap",
      targetUid: "shiranui",
    });
  });

  it("札の艦を控えの艦に重ねて落としても、控えの艦を札の艦に重ねて落としても、入れ替える", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "ship", uid: "tone" })).toEqual({ kind: "swap", targetUid: "tone" });
    expect(dropOutcomeOf(LOOKUP, "tone", { kind: "ship", uid: "shigure2" })).toEqual({
      kind: "swap",
      targetUid: "shigure2",
    });
  });

  it("自分自身に落としても変わらない（札の艦でも控えの艦でも）", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "ship", uid: "shigure2" })).toEqual({ kind: "none" });
    expect(dropOutcomeOf(LOOKUP, "tone", { kind: "ship", uid: "tone" })).toEqual({ kind: "none" });
  });

  it("同じ札の艦どうしで重ねて落としても変わらない", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", { kind: "ship", uid: "kitakami" })).toEqual({ kind: "none" });
  });

  it("控えの艦どうしで重ねて落としても変わらない", () => {
    expect(dropOutcomeOf(LOOKUP, "tone", { kind: "ship", uid: "hamanami" })).toEqual({ kind: "none" });
  });

  it("落とす先がなければ変わらない", () => {
    expect(dropOutcomeOf(LOOKUP, "shigure2", null)).toEqual({ kind: "none" });
  });
});

describe("dropFeedbackOf（ドラッグ中の強調と「ここに移動」）", () => {
  const NOTHING = { highlightedFudaId: null, moveHintFudaId: null, trayHighlighted: false };

  it("ドラッグしていない、または落とす先の外なら、何も強調しない", () => {
    expect(dropFeedbackOf(LOOKUP, null, { kind: "fuda", fudaId: "rengo" })).toEqual(NOTHING);
    expect(dropFeedbackOf(LOOKUP, "tone", null)).toEqual(NOTHING);
  });

  it("札の列の上では、その列を強調し、ドラッグした艦がその列にいなければ「ここに移動」を出す", () => {
    expect(dropFeedbackOf(LOOKUP, "tone", { kind: "fuda", fudaId: "rengo" })).toEqual({
      highlightedFudaId: "rengo",
      moveHintFudaId: "rengo",
      trayHighlighted: false,
    });
    expect(dropFeedbackOf(LOOKUP, "shiranui", { kind: "fuda", fudaId: "rengo" })).toEqual({
      highlightedFudaId: "rengo",
      moveHintFudaId: "rengo",
      trayHighlighted: false,
    });
  });

  it("ドラッグした艦が今いる札の列の上では、列を強調するが「ここに移動」は出さない", () => {
    expect(dropFeedbackOf(LOOKUP, "shigure2", { kind: "fuda", fudaId: "rengo" })).toEqual({
      highlightedFudaId: "rengo",
      moveHintFudaId: null,
      trayHighlighted: false,
    });
  });

  it("控えの上では、札の艦をドラッグしているときだけ控えを強調する", () => {
    expect(dropFeedbackOf(LOOKUP, "shigure2", { kind: "tray" })).toEqual({ ...NOTHING, trayHighlighted: true });
    expect(dropFeedbackOf(LOOKUP, "tone", { kind: "tray" })).toEqual(NOTHING);
  });

  it("札の艦のカードの上では、そのカードのいる札の列を強調し、「ここに移動」は出さない", () => {
    expect(dropFeedbackOf(LOOKUP, "tone", { kind: "ship", uid: "shiranui" })).toEqual({
      ...NOTHING,
      highlightedFudaId: "ulithi",
    });
  });

  it("控えの艦のカードの上では、札の列も控えも強調しない", () => {
    expect(dropFeedbackOf(LOOKUP, "shigure2", { kind: "ship", uid: "tone" })).toEqual(NOTHING);
  });
});

describe("createDragAnnouncements（読み上げの文）", () => {
  const announcements = createDragAnnouncements(LOOKUP);

  describe("つかんだとき（onDragStart）", () => {
    it("艦名で「（艦名）をつかみました」と読み上げる", () => {
      expect(announcements.onDragStart({ active: activeOf("tone") })).toBe("利根改二をつかみました");
    });
  });

  describe("落とす先の上に来たとき（onDragOver）", () => {
    it("札の列の上では「（札名）の上にあります」", () => {
      expect(announcements.onDragOver({ active: activeOf("tone"), over: overOf(fudaDropIdOf("rengo")) })).toBe(
        "連合艦隊の上にあります",
      );
    });

    it("控えの上では「控えの上にあります」", () => {
      expect(announcements.onDragOver({ active: activeOf("shigure2"), over: overOf(TRAY_DROP_ID) })).toBe(
        "控えの上にあります",
      );
    });

    it("落とす先の外では「落とす先の外にあります」", () => {
      expect(announcements.onDragOver({ active: activeOf("tone"), over: overOf(null) })).toBe("落とす先の外にあります");
    });

    it("別の札の艦のカードの上では、相手の艦名と「離すと入れ替えます」を読み上げる", () => {
      expect(announcements.onDragOver({ active: activeOf("shigure2"), over: overOf(shipDropIdOf("shiranui")) })).toBe(
        "不知火改二の上にあります。離すと入れ替えます",
      );
    });

    it("札の艦と控えの艦の間で重ねたときも「離すと入れ替えます」を読み上げる", () => {
      expect(announcements.onDragOver({ active: activeOf("tone"), over: overOf(shipDropIdOf("shigure2")) })).toBe(
        "時雨改二の上にあります。離すと入れ替えます",
      );
    });

    it("自分自身のカードの上では「元の位置にあります」", () => {
      expect(announcements.onDragOver({ active: activeOf("shigure2"), over: overOf(shipDropIdOf("shigure2")) })).toBe(
        "元の位置にあります",
      );
    });

    it("同じ札の艦のカードの上では「入れ替え」を読み上げない（落としても変わらないため）", () => {
      const text = announcements.onDragOver({ active: activeOf("shigure2"), over: overOf(shipDropIdOf("kitakami")) });
      expect(text).toEqual(expect.any(String));
      expect(text).not.toContain("入れ替え");
    });

    it("控えの艦どうしでカードの上に来たときも「入れ替え」を読み上げない（落としても変わらないため）", () => {
      const text = announcements.onDragOver({ active: activeOf("tone"), over: overOf(shipDropIdOf("hamanami")) });
      expect(text).toEqual(expect.any(String));
      expect(text).not.toContain("入れ替え");
    });
  });

  describe("落としたとき（onDragEnd）", () => {
    it("札へ移したら「（艦名）を（札名）に移しました」", () => {
      expect(announcements.onDragEnd({ active: activeOf("tone"), over: overOf(fudaDropIdOf("rengo")) })).toBe(
        "利根改二を連合艦隊に移しました",
      );
    });

    it("控えへ戻したら「（艦名）を控えに戻しました」", () => {
      expect(announcements.onDragEnd({ active: activeOf("shigure2"), over: overOf(TRAY_DROP_ID) })).toBe(
        "時雨改二を控えに戻しました",
      );
    });

    it("入れ替えたら「（艦名）と（相手の艦名）を入れ替えました」", () => {
      expect(announcements.onDragEnd({ active: activeOf("shigure2"), over: overOf(shipDropIdOf("shiranui")) })).toBe(
        "時雨改二と不知火改二を入れ替えました",
      );
    });

    it("変わらない落とし方（落とす先の外・自分自身・今いる札・同じ札の艦・控えの艦どうし）では「（艦名）は動かしませんでした」", () => {
      const cases: [ShipUid, UniqueIdentifier | null][] = [
        ["shigure2", null],
        ["shigure2", shipDropIdOf("shigure2")],
        ["shigure2", fudaDropIdOf("rengo")],
        ["shigure2", shipDropIdOf("kitakami")],
        ["tone", shipDropIdOf("hamanami")],
        ["tone", TRAY_DROP_ID],
      ];
      for (const [uid, overId] of cases) {
        expect(announcements.onDragEnd({ active: activeOf(uid), over: overOf(overId) }), `${uid} → ${String(overId)}`).toBe(
          `${SHIP_NAMES[uid]}は動かしませんでした`,
        );
      }
    });
  });

  describe("やめたとき（onDragCancel）", () => {
    it("「（艦名）のドラッグをやめました」", () => {
      expect(announcements.onDragCancel({ active: activeOf("tone"), over: null })).toBe("利根改二のドラッグをやめました");
    });
  });
});

describe("detectDropTarget（落とす先の判定）", () => {
  // 画面の配置（px）：控え（x 0〜300）の中に、控えの一覧（y 100〜500。スクロールする要素）。
  // 札の列「連合艦隊」（x 320〜520・y 0〜600）。艦カードは幅 280・高さ 40
  const TRAY = droppableOf(TRAY_DROP_ID, rectOf(0, 0, 300, 600));
  const RENGO = droppableOf(fudaDropIdOf("rengo"), rectOf(320, 0, 200, 600));
  const LIST_RECT = rectOf(0, 100, 300, 400);

  it("ポインターの下に何もなければ、何にも当たらない", () => {
    expect(detect([TRAY, RENGO], { x: 900, y: 900 })).toEqual([]);
  });

  it("ポインターの位置が分からなければ、何にも当たらない", () => {
    expect(detect([TRAY, RENGO], null)).toEqual([]);
  });

  it("札の列の空いている所では、札の列に当たる", () => {
    expect(detect([TRAY, RENGO], { x: 400, y: 20 })).toEqual([fudaDropIdOf("rengo")]);
  });

  it("札の列の中の艦カードの上では、札の列より艦カードを優先し、艦カードだけを返す", () => {
    const shigure2 = droppableOf(shipDropIdOf("shigure2"), rectOf(330, 60, 180, 40), { clip: null });
    expect(detect([TRAY, RENGO, shigure2], { x: 400, y: 80 })).toEqual([shipDropIdOf("shigure2")]);
  });

  it("控えの一覧の見える範囲の中の艦カードの上では、控えより艦カードを優先する", () => {
    const list = elementWithRect(LIST_RECT);
    const tone = droppableOf(shipDropIdOf("tone"), rectOf(10, 200, 280, 40), { clip: list });
    expect(detect([TRAY, RENGO, tone], { x: 100, y: 220 })).toEqual([shipDropIdOf("tone")]);
  });

  it("控えの一覧の見える範囲の外（スクロールで隠れた行）の艦カードには当てず、控えに当たる", () => {
    // 一覧の上端（y 100）より上に回り込んだ行（前後に余分に描いた行）。控えの見出しの辺り（y 80）を指す
    const list = elementWithRect(LIST_RECT);
    const hidden = droppableOf(shipDropIdOf("hamanami"), rectOf(10, 60, 280, 40), { clip: list });
    expect(detect([TRAY, RENGO, hidden], { x: 100, y: 80 })).toEqual([TRAY_DROP_ID]);
  });

  it("控えの一覧の一番上に固定した区切りの見出しの上では、その下に隠れた艦カードに当てず、控えに当たる", () => {
    // 固定した見出し（y 100〜128）の下に、一覧の見える範囲の中の行（y 96〜136）が隠れている
    const list = elementWithRect(LIST_RECT);
    const pinnedHeader = elementWithRect(rectOf(0, 100, 300, 28));
    const hidden = droppableOf(shipDropIdOf("hamanami"), rectOf(10, 96, 280, 40), { clip: list, cover: pinnedHeader });
    expect(detect([TRAY, RENGO, hidden], { x: 100, y: 114 })).toEqual([TRAY_DROP_ID]);
  });

  it("固定した区切りの見出しの外（すぐ下）では、隠す要素を渡した艦カードにも当たる", () => {
    const list = elementWithRect(LIST_RECT);
    const pinnedHeader = elementWithRect(rectOf(0, 100, 300, 28));
    const tone = droppableOf(shipDropIdOf("tone"), rectOf(10, 96, 280, 40), { clip: list, cover: pinnedHeader });
    expect(detect([TRAY, RENGO, tone], { x: 100, y: 132 })).toEqual([shipDropIdOf("tone")]);
  });
});

// PR #45 の独立レビュー：画面の上に留めたヘッダー帯の上で離すと、その下に隠れた札の列・艦カードに落ちていた
describe("createDropTargetDetector（ヘッダー帯など、上に重なって隠す要素の上では落とす先なし）", () => {
  // 画面の配置（px）：ヘッダー帯（y 0〜51。画面の上に留めてある）。その下に、ページのスクロールで札の列「連合艦隊」
  // （x 320〜520・y -200〜400）と、その中の時雨改二のカード（y 30〜70。上の 21px がヘッダー帯に隠れる）がある
  const RENGO = droppableOf(fudaDropIdOf("rengo"), rectOf(320, -200, 200, 600));
  const SHIGURE = droppableOf(shipDropIdOf("shigure2"), rectOf(330, 30, 180, 40), { clip: null });

  /** 隠す要素を渡して作った判定で、当たった落とす先の ID を返す */
  function detectWith(blockers: readonly (Element | null)[], pointer: { x: number; y: number }): UniqueIdentifier[] {
    const detector = createDropTargetDetector(() => blockers);
    const droppables = [RENGO, SHIGURE];
    return detector({
      active: activeOf("tone"),
      collisionRect: rectOf(pointer.x, pointer.y, 0, 0),
      droppableRects: new Map(droppables.map(({ container, rect }) => [container.id, rect])),
      droppableContainers: droppables.map(({ container }) => container),
      pointerCoordinates: pointer,
    }).map((collision) => collision.id);
  }

  it("ポインターがヘッダー帯の上にあれば、その下に隠れた艦カード・札の列のどちらにも当たらない", () => {
    const header = elementWithRect(rectOf(0, 0, 1366, 51));
    expect(detectWith([header], { x: 400, y: 40 })).toEqual([]);
    expect(detectWith([header], { x: 400, y: 20 })).toEqual([]);
  });

  it("ヘッダー帯の外（すぐ下）では、ふだんどおり艦カードに当たる", () => {
    const header = elementWithRect(rectOf(0, 0, 1366, 51));
    expect(detectWith([header], { x: 400, y: 60 })).toEqual([shipDropIdOf("shigure2")]);
    expect(detectWith([header], { x: 400, y: 90 })).toEqual([fudaDropIdOf("rengo")]);
  });

  it("隠す要素がまだない（null）ときは、ふだんどおりに判定する", () => {
    expect(detectWith([null], { x: 400, y: 40 })).toEqual([shipDropIdOf("shigure2")]);
  });
});
