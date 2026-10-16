// 差分の画面（src/features/drift の DriftPageContent と src/app/drift/page.tsx）の画面テストで使う、部品の探し方
//
// 画面の部品の公開する形（実装の担当向け。テストはこの形で探す）
// - ヘッダー：<header> の中に h1「計画と実際の札」（LatestEventScreenHeader）。最新イベント名、
//   「（M/D HH:mm）に取り込んだ札の状態と、計画を比べています」（取り込んでいるときだけ。日時は端末の時刻帯）、
//   リンク「最新の状態を取り込む」（/import）も同じ <header> の中に置く
// - 読み込み中：「読み込み中」を含む文（role="status" を勧める）
// - 読み込みの失敗：role="alert" に「（何）を読み込めませんでした」・理由・「ページを再読み込みしてください」
//   （公開定義はヘッダーの下の DefinitionLoadAlert。札割りのデータ・艦船マスタも同じ形。警告は 1 つだけ）
// - 取り込んでいない：「取り込んでいません」を含む案内と、取り込みの画面（/import）へのリンク。艦船マスタは取得しない
// - 件数のまとめ：list「件数のまとめ」（<ul aria-label="件数のまとめ">）。listitem が要件 3.5 の順に 4 つ
//   （計画と違う札が付いた → 計画にない艦に札が付いた → 計画どおり → まだ出撃していない）。各 listitem に名前と件数（数字）
// - 対応が必要な一覧：見出し（h2）「対応が必要 n件」。1 件ずつ <article>（role="article"）。
//   「計画と違う札が付いた」が先、「計画にない艦に札が付いた」が後（computeDrift の issues の順。各分類の中の順は問わない）。中に
//   艦名、計画の札を <del>（role="deletion"。取り消し線）で、その後に実際の札の名前、説明文、操作。
//   - 計画にない艦：計画の札は「札なし（計画外）」
//   - 定義のどの札番号にも当たらない札：実際の札は「定義にない札（番号 n）」。説明文に「控えに戻」る旨を書く
//   - 説明文の特効は「段階の表示名 ×倍率」（stageLabel。例「E2 ゲージ3 ×1.24」）。計画と違う札は計画の札での特効、
//     計画にない艦は実際の札での特効。特効がなければ倍率を書かない。代わりの艦の提案は出さない（U23）
//   - 操作：計画と違う札が付いた → リンク「代わりの艦を探す」（/assign。移動するだけ。U23）とボタン「計画を実際に合わせる」。
//     計画にない艦に札が付いた → ボタン「計画に追加する」だけ
// - 対応が必要なものがない：「対応が必要なものはありません」
// - まとめて：ボタン「計画をまとめて実際に合わせる」（対応が必要なものが 2 件以上のときだけ）。押すと role="alertdialog"
//   （名前「まとめて合わせる確認」）を開く。中に「次の変更を計画に反映します。合わせないものはチェックを外してください」、
//   1 件ずつの checkbox（初期は全部 ON。名前に艦名と「計画 A → B」。<label> で包めば名前になる）、注意書き
//   「実際に付いた札が正しいものとして計画を書き換えます。札が抜けた枠は空いたままになるので、あとで割り振り画面で埋めてください」、
//   ボタン「n件を計画に反映する」（0 件のときは disabled）、ボタン「やめる」
// - 反映後：role="status" の中に「n件を計画に反映しました（艦名・艦名）」とボタン「元に戻す」。元に戻すと両方消える
// - 札ごとの進み具合：region「札ごとの進み具合」（<section aria-labelledby> で見出し h2 を名前にする）。
//   定義の札の順に listitem が 1 つずつ。各 listitem に札名と「札付き n ／ 計画 m隻」、札番号が未入力の札は「札番号が未入力」
// - 割り当ての保存の失敗：role="alert" に「保存できませんでした」
import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

/** 件数のまとめの名前（要件 3.5 の順） */
export const SUMMARY_LABELS = [
  "計画と違う札が付いた",
  "計画にない艦に札が付いた",
  "計画どおり",
  "まだ出撃していない",
] as const;

/** 件数のまとめの名前 */
export type SummaryLabel = (typeof SUMMARY_LABELS)[number];

/** 「対応が必要 n件」（前に数字が続かない n） */
export function issuesHeadingPattern(count: number): RegExp {
  return new RegExp(`対応が必要\\s*(?<!\\d)${count}\\s*件`);
}

/** 「札付き n ／ 計画 m隻」 */
export function progressPattern(tagged: number, planned: number): RegExp {
  return new RegExp(`札付き\\s*${tagged}\\s*／\\s*計画\\s*${planned}\\s*隻`);
}

/** まとめての確認のボタン「n件を計画に反映する」（名前の全体） */
export function bulkApplyLabel(count: number): RegExp {
  return new RegExp(`^${count}\\s*件を計画に反映する$`);
}

/**
 * 反映後の文「n件を計画に反映しました（艦名・艦名）」を出している role="status"（ちょうど 1 つ）。
 * 艦名の並び順は問わない（一覧の並びは共有の札割りのデータの艦の順で、保存先から読むと個体 ID の順になるため）
 */
export function getDoneStatus(count: number, shipNames: readonly string[]): HTMLElement {
  const pattern = new RegExp(`(?<!\\d)${count}\\s*件を計画に反映しました（([^）]*)）`);
  const expected = [...shipNames].sort().join("・");
  const statuses = screen.queryAllByRole("status").filter((element) => {
    const match = pattern.exec(element.textContent ?? "");
    return match !== null && match[1].split("・").sort().join("・") === expected;
  });
  expect(
    statuses,
    `role="status" に「${count}件を計画に反映しました（${shipNames.join("・")}）」（艦名の順は問わない）を出していること`,
  ).toHaveLength(1);
  return statuses[0];
}

/** 画面名（h1「計画と実際の札」）を含むヘッダー */
export function getHeader(): HTMLElement {
  const title = screen.getByRole("heading", { level: 1, name: "計画と実際の札" });
  const header = title.closest("header");
  if (header === null) throw new Error("見出し「計画と実際の札」を含む <header> がない");
  return header;
}

/** 件数のまとめ（list「件数のまとめ」） */
export function getSummaryList(): HTMLElement {
  return screen.getByRole("list", { name: "件数のまとめ" });
}

/** 件数のまとめ。なければ null */
export function querySummaryList(): HTMLElement | null {
  return screen.queryByRole("list", { name: "件数のまとめ" });
}

/** 件数のまとめの項目の名前（画面の順） */
export function summaryLabelsInOrder(): string[] {
  return within(getSummaryList())
    .getAllByRole("listitem")
    .map((item) => SUMMARY_LABELS.find((label) => item.textContent?.includes(label)) ?? `（名前のない項目：${item.textContent ?? ""}）`);
}

/** 件数のまとめの、名前が label の項目の件数（項目の文字から名前を除いた数字） */
export function summaryCount(label: SummaryLabel): number {
  const items = within(getSummaryList())
    .getAllByRole("listitem")
    .filter((item) => item.textContent?.includes(label));
  expect(items, `件数のまとめに「${label}」の項目がちょうど 1 つあること`).toHaveLength(1);
  const digits = (items[0].textContent ?? "").replace(label, "").match(/\d+/g) ?? [];
  expect(digits, `「${label}」の項目に件数（数字）がちょうど 1 つあること`).toHaveLength(1);
  return Number(digits[0]);
}

/** 対応が必要な一覧の 1 件ずつ（<article>。画面の順） */
export function issueCards(): HTMLElement[] {
  return screen.queryAllByRole("article");
}

/** 艦名を含む、対応が必要な 1 件（同名艦なら複数） */
export function issueCardsOf(shipName: string): HTMLElement[] {
  return issueCards().filter((card) => card.textContent?.includes(shipName));
}

/** 艦名を含む、対応が必要な 1 件（ちょうど 1 つ） */
export function getIssueCard(shipName: string): HTMLElement {
  const cards = issueCardsOf(shipName);
  expect(cards, `対応が必要な一覧に ${shipName} がちょうど 1 件あること`).toHaveLength(1);
  return cards[0];
}

/** 1 件の中の、計画の札（<del>。取り消し線） */
export function plannedFudaOf(card: HTMLElement): HTMLElement {
  return within(card).getByRole("deletion");
}

/** 1 件の中の、文字がちょうど text で、計画の札（<del>）の外にある要素（実際の札） */
export function actualFudaOf(card: HTMLElement, text: string): HTMLElement {
  const found = within(card)
    .queryAllByText(text)
    .filter((element) => element.closest("del") === null);
  expect(found.length, `${text}（実際の札）が計画の札の外に出ていること`).toBeGreaterThanOrEqual(1);
  return found[0];
}

/** 札ごとの進み具合（region「札ごとの進み具合」） */
export function getProgressRegion(): HTMLElement {
  return screen.getByRole("region", { name: "札ごとの進み具合" });
}

/** 札ごとの進み具合の項目（画面の順） */
export function progressItems(): HTMLElement[] {
  return within(getProgressRegion()).getAllByRole("listitem");
}

/** 札ごとの進み具合の、札名を含む項目（ちょうど 1 つ） */
export function getProgressItem(fudaName: string): HTMLElement {
  const items = progressItems().filter((item) => item.textContent?.includes(fudaName));
  expect(items, `札ごとの進み具合に「${fudaName}」の項目がちょうど 1 つあること`).toHaveLength(1);
  return items[0];
}
