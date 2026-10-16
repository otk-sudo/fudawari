// 割り振り画面（src/features/assign/AssignScreen.tsx と src/app/assign/page.tsx）の画面テストで使う、部品の探し方
//
// 画面の部品の公開する形（実装の担当向け。テストはこの形で探す）
// - ヘッダー：<header> の中に h1「割り振り」。最新イベント名・操作の説明・「特効データ：YYYY/MM/DD 版」・
//   ボタン「元に戻す」（戻せないときは disabled）・リンク「一覧で確認」（/list）も同じ <header> の中に置く
// - 控え：region「控えの艦」（<section aria-label="控えの艦">）。中に
//   見出し「控え」、「表示数 / 控えの総数隻」、group「表示の詰め具合」（ボタン「一行」「カード」。aria-pressed）、
//   searchbox「図鑑ID・名称で検索」（placeholder「図鑑ID 名称検索」）、ボタン「絞り込み」（aria-expanded。条件の数のバッジは中の文字）、
//   ボタン「リセット」、combobox「並び順」（option「艦型」「Lv」「特効の強さ」「名前」）、tablist「艦種」（tab。aria-selected）、
//   「特効を表示中：n隻」の帯とボタン「すべて閉じる」、区切りの見出し、艦カード、「条件に合う艦はいません」
// - 絞り込みの条件：group「改造状態」（checkbox「未改造」「中間改造」「最終改造」）、group「特効」（checkbox「特効のある艦だけ」）、
//   group「特効が効く札」（定義の札ごとの checkbox。名前は札名）。<fieldset> と <legend> で作れば group の名前になる
// - 区切りの見出し：aria-expanded を持つボタン（aria-pressed は持たない）。名前は見出しの文字（例「夕雲型」）で始まり、中に「n隻」
// - 札の列：定義の札ごとに 1 つの region。名前は札名そのもの（例「連合艦隊」）。中に使う段階（段階の表示名。例「E2 ゲージ2」）と「n隻」、
//   選択中だけボタン「ここに置く（特効あり）」／「ここに置く（特効なし）」。薄く表示する列は data-dimmed="true"
//   （パネルの中の札のブロックは region にしない。札の列と名前がぶつかるため）
// - 選択中の艦のパネル：region「選択中の艦」。中にボタン「選択をやめる」（×）、「（札名）に置く」
// - 艦カード：aria-pressed（選択中）と aria-expanded（特効を開いている）を持つボタン（button 要素、または role="button"）。
//   艦名は艦名だけの要素（またはカードの直下の文字）に入れる。
//   左端の色は data-stripe-color に入れる（札の色の "#RRGGBB" を定義の値のまま。灰色〔特効のない控えの艦〕は "none"）
// - 保存の失敗：role="alert" に「保存できませんでした」と理由
import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

/** 倍率の表示（「×1.24」など）があるかを見る形 */
export const MULTIPLIER = /×\s*\d/;

/** 「n隻」（前に数字が続かない n。例：8 は「18隻」に当てはまらない） */
export function shipCountPattern(count: number): RegExp {
  return new RegExp(`(?<!\\d)${count}\\s*隻`);
}

/** 控えの見出しの「表示数 / 控えの総数隻」（例「11 / 12隻」） */
export function trayCountPattern(shown: number, total: number): RegExp {
  return new RegExp(`(?<!\\d)${shown}\\s*/\\s*${total}\\s*隻`);
}

/** 画面名（h1「割り振り」）を含むヘッダー */
export function getHeader(): HTMLElement {
  const title = screen.getByRole("heading", { level: 1, name: "割り振り" });
  const header = title.closest("header");
  if (header === null) throw new Error("見出し「割り振り」を含む <header> がない");
  return header;
}

/** 控え（region「控えの艦」） */
export function getTray(): HTMLElement {
  return screen.getByRole("region", { name: "控えの艦" });
}

/** 控え（region「控えの艦」）。なければ null */
export function queryTray(): HTMLElement | null {
  return screen.queryByRole("region", { name: "控えの艦" });
}

/** 札の列（名前が札名の region） */
export function getColumn(fudaName: string): HTMLElement {
  return screen.getByRole("region", { name: fudaName });
}

/** 選択中の艦のパネル（region「選択中の艦」） */
export function getPanel(): HTMLElement {
  return screen.getByRole("region", { name: "選択中の艦" });
}

/** 選択中の艦のパネル。なければ null */
export function queryPanel(): HTMLElement | null {
  return screen.queryByRole("region", { name: "選択中の艦" });
}

/** 要素が隠されているか（自分か祖先が hidden・aria-hidden="true"。折りたたんだ区切りの中の艦など） */
function isHidden(element: Element): boolean {
  return element.closest('[hidden], [aria-hidden="true"]') !== null;
}

/** Lv が level の艦か（カードの文字に「Lv131」などがある） */
function hasLevel(card: HTMLElement, level: number): boolean {
  return new RegExp(`Lv\\s*${level}(?!\\d)`).test(card.textContent ?? "");
}

/**
 * container の中の、艦名が shipName の艦カード（見えているもの）。level を渡すと、その Lv の艦だけにする（同名艦の見分け）。
 * 艦名だけの要素を探し、それを含む aria-pressed の要素（艦カード）を返す
 */
export function findCards(container: HTMLElement, shipName: string, level?: number): HTMLElement[] {
  const cards = within(container)
    .queryAllByText(shipName)
    .map((element) => element.closest<HTMLElement>("[aria-pressed]"))
    .filter((card): card is HTMLElement => card !== null && !isHidden(card));
  const unique = [...new Set(cards)];
  return level === undefined ? unique : unique.filter((card) => hasLevel(card, level));
}

/** container の中の、艦名が shipName の艦カード（ちょうど 1 つ） */
export function getCard(container: HTMLElement, shipName: string, level?: number): HTMLElement {
  const cards = findCards(container, shipName, level);
  const which = level === undefined ? shipName : `${shipName}（Lv${level}）`;
  expect(cards, `${which} の艦カードがちょうど 1 つあること`).toHaveLength(1);
  return cards[0];
}

/** container の中の、艦名が shipName の艦カード。なければ null（2 つ以上あればテストを失敗させる） */
export function queryCard(container: HTMLElement, shipName: string, level?: number): HTMLElement | null {
  const cards = findCards(container, shipName, level);
  expect(cards.length, `${shipName} の艦カードが 2 つ以上ないこと`).toBeLessThanOrEqual(1);
  return cards[0] ?? null;
}

/** 控えの区切りの見出し（名前が title で始まり、aria-pressed を持たないボタン） */
export function getGroupHeader(title: string): HTMLElement {
  const headers = within(getTray())
    .queryAllByRole("button", { name: (name) => name.startsWith(title) })
    .filter((button) => !button.hasAttribute("aria-pressed"));
  expect(headers, `区切りの見出し「${title}」がちょうど 1 つあること`).toHaveLength(1);
  return headers[0];
}

/** 札の列の「ここに置く」ボタン（「ここに置く（特効あり）」「ここに置く（特効なし）」）。なければ null */
export function queryPlaceButton(column: HTMLElement): HTMLElement | null {
  return within(column).queryByRole("button", { name: /^ここに置く/ });
}
