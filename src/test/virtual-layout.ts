// jsdom で、控えの仮想スクロール（TanStack Virtual）が測る大きさを返させる補助（割り振り画面の画面テスト用。PR-06・T2-8）
//
// jsdom はレイアウトをしないため、どの要素も大きさが 0（clientHeight・offsetHeight・getBoundingClientRect）になる。
// 仮想スクロールは、見える範囲の高さが 0 だと 1 行も描かない（TanStack Virtual の calculateRange が range を null にする）。
// そこで割り振り画面は次のように振る舞う（実装の担当向けの約束。テストはこの形で確かめる）。
// - 大きさを測れない（控えの一覧の高さが 0。jsdom の既定）ときは、控えの行（区切りの見出しと艦カード）をすべて描く。
//   今の画面テスト（AssignScreen.test.tsx・page.test.tsx）は、この前提で手を加えずに通る
// - 大きさを測れるときは、見える範囲（と前後の少し）の行だけを描く
//
// 見える範囲の行だけを描くことを jsdom で確かめるテストは、simulateTrayLayout で次の大きさを返させる。
// - 控えの一覧（role="tabpanel"。仮想スクロールのスクロールする要素にする）：
//   高さ viewportHeight（clientHeight・offsetHeight・getBoundingClientRect の height）。中身の高さ（scrollHeight）は十分に大きい値
// - それ以外の要素：高さ rowHeight（区切りの見出しや艦カードの行を測ると、この高さになる）
// - 幅はどの要素も width
// jsdom には ResizeObserver がないので、大きさは描いたときに 1 回だけ測られる。必ず描く前に呼ぶ。
// スクロールは scrollTrayList で起こす（scrollTop を書いて scroll を送る。jsdom の scrollTop は書いた値をそのまま返す）。
import { act } from "@testing-library/react";

/** simulateTrayLayout の大きさ（px） */
export interface TrayLayoutOptions {
  /** 控えの一覧（スクロールする要素）の見える範囲の高さ */
  viewportHeight?: number;
  /** それ以外の要素（行）の高さ */
  rowHeight?: number;
  /** どの要素も同じ幅 */
  width?: number;
}

/** 既定の大きさ：見える範囲 600px、行 32px（一行表示のカードくらい）、幅 280px（控えの幅くらい） */
export const DEFAULT_TRAY_LAYOUT: Readonly<Required<TrayLayoutOptions>> = Object.freeze({
  viewportHeight: 600,
  rowHeight: 32,
  width: 280,
});

/** 控えの一覧の中身の高さ（scrollHeight）。どこまでスクロールしても端に当たらない大きさにする */
const SCROLL_CONTENT_HEIGHT = 1_000_000;

/** 控えの一覧（仮想スクロールのスクロールする要素）か */
function isTrayList(element: Element): boolean {
  return element.getAttribute("role") === "tabpanel";
}

/** 差し替えた性質（元に戻すために、元の自分自身の性質を覚えておく） */
interface Override {
  target: object;
  key: string;
  original: PropertyDescriptor | undefined;
}

/**
 * jsdom で、控えの仮想スクロールが測る大きさを返させる。戻り値の関数で元に戻す（afterEach で呼ぶ）。
 * 割り振り画面を描く前に呼ぶ（大きさは描いたときに測られる）
 */
export function simulateTrayLayout(options: TrayLayoutOptions = {}): () => void {
  const { viewportHeight, rowHeight, width } = { ...DEFAULT_TRAY_LAYOUT, ...options };
  const heightOf = (element: Element): number => (isTrayList(element) ? viewportHeight : rowHeight);

  const definitions: [target: object, key: string, descriptor: PropertyDescriptor][] = [
    [
      HTMLElement.prototype,
      "offsetHeight",
      {
        get(this: HTMLElement) {
          return heightOf(this);
        },
      },
    ],
    [HTMLElement.prototype, "offsetWidth", { get: () => width }],
    [
      Element.prototype,
      "clientHeight",
      {
        get(this: Element) {
          return heightOf(this);
        },
      },
    ],
    [Element.prototype, "clientWidth", { get: () => width }],
    [
      Element.prototype,
      "scrollHeight",
      {
        get(this: Element) {
          return isTrayList(this) ? SCROLL_CONTENT_HEIGHT : heightOf(this);
        },
      },
    ],
    [
      Element.prototype,
      "getBoundingClientRect",
      {
        value(this: Element): DOMRect {
          return new DOMRect(0, 0, width, heightOf(this));
        },
      },
    ],
  ];

  const overrides: Override[] = definitions.map(([target, key, descriptor]) => {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { ...descriptor, configurable: true });
    return { target, key, original };
  });

  return () => {
    for (const { target, key, original } of overrides.reverse()) {
      if (original === undefined) {
        Reflect.deleteProperty(target, key);
      } else {
        Object.defineProperty(target, key, original);
      }
    }
  };
}

/** 控えの一覧（role="tabpanel"）を top（px）までスクロールさせる（scrollTop を書いて scroll を送り、描き直しを待つ） */
export async function scrollTrayList(list: HTMLElement, top: number): Promise<void> {
  await act(async () => {
    list.scrollTop = top;
    list.dispatchEvent(new Event("scroll"));
  });
}
