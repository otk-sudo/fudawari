// 一覧（src/features/list、/list）と画像で保存（src/features/export-image）のテストで使う、部品の探し方
//
// 部品の公開する形（実装の担当向け。テストはこの形で探す）
//
// ■ 一覧の本文（ListBoard）
// - 攻略の流れ：region「攻略の流れ」（<section aria-label="攻略の流れ">）。
//   海域ごとに 1 つの list（名前は海域名。例 <ol aria-label="E2">）、段階ごとに listitem（定義の順）。
//   listitem の中に段階名・札名・「特効 n隻」、大事さが難所なら「難所」。listitem に data-fuda-color（札の色 "#RRGGBB" を定義の値のまま）
// - 表示の切り替え：ボタン「艦種ごとに並べる」「特効艦だけ」（aria-pressed。初期は true／false）
// - 札ごとの行：定義の札ごとに 1 つの region（名前は札名そのもの。例 <section aria-label="連合艦隊">）。region に data-fuda-color。
//   中に札名・使う段階（段階の表示名〔@/domain/boost の stageLabel〕を「・」でつなぐ。例「E2 ゲージ2・E2 ゲージ3」）・
//   「n隻 ・ 特効 m隻」。艦がいなければ「まだ割り当てがありません」
//   - 艦種のまとまり：group（名前は艦種名。例 role="group" aria-label="駆逐"）。「艦種ごとに並べる」が OFF のときは group を作らない
//   - 艦：listitem（行の中の listitem は艦だけにする）。中に艦名・「Lv131」・「運48」・その札での最大倍率のバッジ（「×1.12」。
//     特効がなければ「–」）。その札で特効がない艦は data-dimmed="true"
//   - 行の中にボタン・チェックボックスなどの操作の部品は置かない（一覧は見るだけ）
//
// ■ 一覧の画面（/list。src/app/list/page.tsx）
// - <header> の中に h1「札割り一覧」、ボタン「画像で保存」（aria-haspopup="dialog"）、リンク「割り振りを編集」（href="/assign"）
// - 読み込み中は「読み込み中」。失敗は role="alert" に理由と「ページを再読み込みしてください」
//   （公開定義：「イベントの定義を読み込めませんでした」、艦船マスタ：「艦船マスタを読み込めませんでした」、
//   ブラウザ内の保存：「札割りのデータを読み込めませんでした」。警告は 1 つだけ出す）
// - 取り込んでいなければ「艦娘を取り込んでいません」と、取り込みの画面へのリンク（名前に「取り込み」を含む。href="/import"）
//
// ■ 画像で保存のウィンドウ（ExportImageDialog）
// - dialog「画像で保存」（aria-modal="true"）。説明「横長 1600×900 の PNG。X などに貼りやすい大きさです」
// - radiogroup「入れる札」に radio「札が付いた札をすべて」（初期）「札を選ぶ」。
//   「札を選ぶ」のときだけ、艦がいる札の checkbox（名前は札名。定義の順。初期はすべて ON）
// - 枚数の表示「n札 → m枚」（2 枚以上なら後ろに「（分けて保存）」）。札を選んでいなければ「札を1つ以上選んでください」
// - 見本：figure「見本（1枚目）」（aria-label か figcaption で名前を付ける）の中に、1 枚目の画像（ExportImage）
// - ボタン：右上の「×」（名前「閉じる」）、「やめる」、「画像をコピー」（Clipboard API に対応しているときだけ）、
//   「PNGで保存」（2 枚以上なら「m枚まとめて保存（PNG）」）。札を選んでいなければコピーと保存は disabled
// - コピーの後：ボタンの名前が「コピーしました ✓」、role="status" に
//   「画像をコピーしました。Xの投稿欄などにそのまま貼り付けられます」（2 枚以上なら「n枚目の画像を…」）
// - 2 枚以上でコピーできるとき：combobox「コピーする画像」（option「1枚目」「2枚目」…。<select> で作る）
// - 背景の暗い部分：data-testid="export-image-dialog-overlay"（クリックで閉じる）
//
// ■ 出力する画像（ExportImage）
// - 上部：イベント名・「札割り」。2 枚以上なら「n / m」
// - 攻略の流れ：海域ごとに 1 つの list（名前は海域名）、段階ごとに listitem（札名・段階名。data-fuda-color）。この画像の札に関係なく全海域
// - 札の列：札ごとに 1 つの region（名前は札名）。data-fuda-color。札名・「n隻」（その札の全隻数）。
//   艦は listitem（Lv の高い順。艦名・「Lv175」・「運59」・その札で特効があれば「特効」、なければ「－」）。
//   列に入らない艦は載せず、listitem ではない要素に「ほか n 隻」と書く（U15）
// - 下部：「札」のロゴ、ツール名（APP_NAME「札割りプランナー」。U4）、凡例「特効 その札で特効あり」「－ 特効なし」。倍率（×）は載せない
//
// ■ PNG を作る（保存・コピー）
// - document.fonts.ready と、document.fonts.load（フォントの指定に "Noto Sans JP" を含め、第 2 引数に画像の文字を渡す）が
//   終わってから、modern-screenshot の domToBlob(画像の DOM, { width: 1600, height: 900, … }) を呼ぶ
//   （scale を渡すなら 1、type を渡すなら "image/png"。Context を渡す形〔createContext〕は使わない）
// - 保存：a 要素の download にファイル名（exportImageFileName）、href に URL.createObjectURL(blob) を入れて click する。
//   2 枚以上なら 1 枚目から順に
// - コピー：navigator.clipboard.write([new ClipboardItem({ "image/png": blob（または blob を返す Promise） })])
import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { nationalityMasterEntries, shipTypeMasterEntries, summer2026MasterEntries } from "@/test/fixtures";

/** マスタにない艦の表示名（@/domain/master の lookupShip と同じ） */
export const UNKNOWN_SHIP_NAME = "名前が分からない艦";

/** 「n隻」（前に数字が続かない n。例：8 は「18隻」に当てはまらない） */
export function shipCountPattern(count: number): RegExp {
  return new RegExp(`(?<!\\d)${count}\\s*隻`);
}

/** 「特効 n隻」（前に数字が続かない n） */
export function boostCountPattern(count: number): RegExp {
  return new RegExp(`特効\\s*${count}\\s*隻`);
}

/**
 * 札の行に「n隻 ・ 特効 m隻」だけを書いた要素があることを確かめる。
 * 行の文字全体で探すと、直前の使う段階の数字（例「E2 ゲージ3」の 3）と続けて読んでしまうため、要素ごとの文字全体で比べる
 */
export function expectRowCount(scope: HTMLElement, count: number, boosted: number): void {
  const pattern = new RegExp(`^\\s*${count}\\s*隻\\s*・\\s*特効\\s*${boosted}\\s*隻\\s*$`);
  const found = Array.from(scope.querySelectorAll("*")).some((element) => pattern.test(element.textContent ?? ""));
  expect(found, `「${count}隻 ・ 特効 ${boosted}隻」だけを書いた要素があること（行の文字：${scope.textContent ?? ""}）`).toBe(true);
}

/** 画像の「ほか n 隻」の n を読む（なければ null） */
export function overflowCountOf(scope: HTMLElement): number | null {
  const match = /ほか\s*(\d+)\s*隻/.exec(scope.textContent ?? "");
  return match === null ? null : Number(match[1]);
}

/** 攻略の流れ（region「攻略の流れ」） */
export function getTimeline(scope: HTMLElement = document.body): HTMLElement {
  return within(scope).getByRole("region", { name: "攻略の流れ" });
}

/** 攻略の流れ。なければ null */
export function queryTimeline(scope: HTMLElement = document.body): HTMLElement | null {
  return within(scope).queryByRole("region", { name: "攻略の流れ" });
}

/** 攻略の流れの海域の行（名前が海域名の list） */
export function getAreaRow(scope: HTMLElement, areaName: string): HTMLElement {
  return within(scope).getByRole("list", { name: areaName });
}

/** 攻略の流れの海域の行の段階（listitem。並びの順） */
export function getAreaSteps(scope: HTMLElement, areaName: string): HTMLElement[] {
  return within(getAreaRow(scope, areaName)).getAllByRole("listitem");
}

/** 海域の行の中の、段階名が stageName の段階（段階名で始まる、またはちょうど含む listitem。ちょうど 1 つ） */
export function getStep(scope: HTMLElement, areaName: string, stageName: string, fudaName: string): HTMLElement {
  const steps = getAreaSteps(scope, areaName).filter((step) => {
    const text = step.textContent ?? "";
    return text.includes(stageName) && text.includes(fudaName);
  });
  expect(steps, `${areaName} の「${stageName}」（${fudaName}）の段階がちょうど 1 つあること`).toHaveLength(1);
  return steps[0];
}

/** 札ごとの行・画像の札の列（名前が札名の region） */
export function getFudaRegion(scope: HTMLElement, fudaName: string): HTMLElement {
  return within(scope).getByRole("region", { name: fudaName });
}

/** 札ごとの行・画像の札の列。なければ null */
export function queryFudaRegion(scope: HTMLElement, fudaName: string): HTMLElement | null {
  return within(scope).queryByRole("region", { name: fudaName });
}

/**
 * 札ごとの行・画像の札の列の名前（文書の順。aria-label・aria-labelledby のどちらで付けてもよい）。攻略の流れ（region「攻略の流れ」）は除く。
 * PNG にするための画像の DOM は、支援技術から隠した入れ物（aria-hidden）の中に置いてもよいので、隠れた region も数える
 */
export function fudaRegionNames(scope: HTMLElement): string[] {
  const names = new Map<Element, string>();
  const regions = within(scope).queryAllByRole("region", {
    hidden: true,
    // name に関数を渡すと、計算した名前を受け取れる（すべての region を当てはめたまま、名前を集める）
    name: (name, element) => {
      if (element !== null) names.set(element, name);
      return true;
    },
  });
  return regions.map((region) => names.get(region) ?? "").filter((name) => name !== "攻略の流れ");
}

/** 艦の listitem（「ほか n 隻」を書いた要素は除く。文書の順） */
export function shipItems(scope: HTMLElement): HTMLElement[] {
  return within(scope)
    .queryAllByRole("listitem")
    .filter((item) => !/ほか\s*\d+\s*隻/.test(item.textContent ?? ""));
}

/**
 * マスタの艦名（長い順。「時雨改二」と「時雨」のように前が重なる名前は長い方を先に当てる）。
 * 国籍の特効（v1.1）のテスト用の艦（nationalityMasterEntries）と、艦種で絞る特効のテスト用の艦（shipTypeMasterEntries）の艦名も含める
 */
const SHIP_NAMES: readonly string[] = [
  ...new Set([
    ...summer2026MasterEntries.map((entry) => entry.name),
    ...nationalityMasterEntries.map((entry) => entry.name),
    ...shipTypeMasterEntries.map((entry) => entry.name),
    UNKNOWN_SHIP_NAME,
  ]),
].sort((a, b) => b.length - a.length);

/** 艦の listitem の艦名（マスタの艦名のうち、文字に含まれる最も長いもの。見つからなければテストを失敗させる） */
export function shipNameOf(item: HTMLElement): string {
  const text = item.textContent ?? "";
  const name = SHIP_NAMES.find((candidate) => text.includes(candidate));
  expect(name, `艦の要素「${text}」に艦名があること`).toBeDefined();
  return name ?? "";
}

/** scope の中の艦の艦名（文書の順） */
export function shipNamesIn(scope: HTMLElement): string[] {
  return shipItems(scope).map(shipNameOf);
}

/** scope の中の、艦名が shipName の艦の listitem（level を渡すとその Lv の艦だけ。ちょうど 1 つ） */
export function getShipItem(scope: HTMLElement, shipName: string, level?: number): HTMLElement {
  const items = shipItems(scope).filter(
    (item) => shipNameOf(item) === shipName && (level === undefined || hasLevel(item, level)),
  );
  const which = level === undefined ? shipName : `${shipName}（Lv${level}）`;
  expect(items, `${which} の艦がちょうど 1 つあること`).toHaveLength(1);
  return items[0];
}

/** 艦の要素の文字に「Lv（level）」があるか */
export function hasLevel(item: HTMLElement, level: number): boolean {
  return new RegExp(`Lv\\s*${level}(?!\\d)`).test(item.textContent ?? "");
}

/** 艦の要素の文字の Lv（「Lv131」の 131。なければ null） */
export function levelOf(item: HTMLElement): number | null {
  const match = /Lv\s*(\d+)/.exec(item.textContent ?? "");
  return match === null ? null : Number(match[1]);
}

/** 画像で保存のウィンドウ（dialog「画像で保存」） */
export function getExportDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "画像で保存" });
}

/** 見本（figure「見本（1枚目）」） */
export function getPreview(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("figure", { name: "見本（1枚目）" });
}
