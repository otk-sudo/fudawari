// 単体テスト用の補助：要素が画面（DOM）上で指定の順に並んでいるかを確かめる
import { expect } from "vitest";

// 失敗したときに、どの要素の順番が違うかを読めるようにする
function describeElement(element: Element): string {
  const label = element.getAttribute("aria-label");
  const text = element.textContent?.trim() ?? "";
  return `「${label ?? text}」`;
}

/** elements が、渡した順に DOM 上で並んでいることを確かめる */
export function expectInDocumentOrder(elements: readonly Element[]): void {
  for (let i = 0; i < elements.length - 1; i += 1) {
    const current = elements[i];
    const next = elements[i + 1];
    const isFollowing =
      (current.compareDocumentPosition(next) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
      0;
    expect(
      isFollowing,
      `${describeElement(current)} の後に ${describeElement(next)} が並ぶこと`,
    ).toBe(true);
  }
}
