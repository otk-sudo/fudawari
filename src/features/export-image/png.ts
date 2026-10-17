// 画像で保存の、PNG を作る・保存する・コピーする処理（要件 3.9・11 章、roadmap T2-10）。ブラウザの機能との境界
//
// - フォント：document.fonts.ready と、日本語フォント（Noto Sans JP）の画像に使う文字の document.fonts.load を待ってから描く
//   （読み込み前に描くと、代わりのフォントの画像になるため）。読み込みや埋め込みの一部が失敗しても、画像の作成は止めずに、
//   読み込めたフォントと端末のフォントで描く
// - PNG：modern-screenshot の domToBlob に画像の DOM を渡して 1600×900 の PNG にする
// - 保存：a 要素の download と URL.createObjectURL でダウンロードさせる（サーバーには送らない）
// - コピー：Clipboard API（navigator.clipboard.write と ClipboardItem）。対応していないブラウザではコピーを出さない
import { domToBlob } from "modern-screenshot";
import { embeddedFontCss, familyNamesOf } from "./font-embed";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "./image-layout";

/**
 * 日本語フォントの CSS 変数（src/app/layout.tsx の next/font の variable と同じ名前。
 * next/font の引数は文字をそのまま書く必要があるため、ここに書き写す）
 */
const FONT_VARIABLE = "--font-noto-sans-jp";
/** CSS 変数が読めないとき（テストなど）に使うフォントの名前 */
const FALLBACK_FONT_NAME = "Noto Sans JP";
/** 画像に使う文字の太さ（ExportImage.module.css の font-weight。可変フォントでなくても読み込めるように並べる） */
const IMAGE_FONT_WEIGHTS: readonly number[] = [400, 500, 700, 800];

/**
 * 画像に使う日本語フォントの名前（例 "Noto Sans JP"）。
 * CSS 変数の値（例 "Noto Sans JP", "Noto Sans JP Fallback"）の先頭だけを使う。2 つ目以降は next/font が足す代わりのフォント
 * （src が local(Arial) だけの @font-face）で、Arial のない端末（Linux など）では読み込みが必ず失敗する
 * （document.fonts.load は、指定したフォントのどれか 1 つでも読み込めないと全体を失敗にする）
 */
function imageFontName(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(FONT_VARIABLE);
  return familyNamesOf(value)[0] ?? FALLBACK_FONT_NAME;
}

/**
 * 画像の文字を描くフォントの読み込みを待つ。
 * document.fonts.ready（読み込み中のフォント）を待ってから、Noto Sans JP の text の文字の分を読み込む
 * （Noto Sans JP は文字の範囲ごとにファイルが分かれていて、画面に出ていない文字の分はまだ読み込んでいないため）。
 * 読み込めない分があっても失敗にしない（読み込めたフォントと端末のフォントで描く）。
 * document.fonts がないブラウザでは待たない
 */
export async function waitForImageFonts(text: string): Promise<void> {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (fonts === undefined) return;
  await fonts.ready;
  const family = JSON.stringify(imageFontName());
  // async の関数で包み、指定の誤りなどですぐに投げた例外も「読み込めなかった」として扱う
  await Promise.allSettled(IMAGE_FONT_WEIGHTS.map(async (weight) => fonts.load(`${weight} 16px ${family}`, text)));
}

/**
 * 画像に埋め込む日本語フォントの CSS（画像の文字を含む範囲の分だけ。font-embed.ts）。
 * 思わぬ失敗で作れなければ null（modern-screenshot の既定の埋め込みに任せる。時間はかかるが、同じフォントで描ける）
 */
async function imageFontCss(text: string): Promise<string | null> {
  try {
    return await embeddedFontCss([imageFontName()], text);
  } catch {
    return null;
  }
}

/** 画像の DOM を 1600×900 の PNG にする（フォントの読み込みは waitForImageFonts で先に待つ） */
export async function renderPng(node: HTMLElement): Promise<Blob> {
  const cssText = await imageFontCss(node.textContent ?? "");
  // null：既定の埋め込みに任せる。""：フォントのファイルを 1 つも取得できなかったので埋め込まない（端末のフォントで描く）
  const font = cssText === null ? {} : cssText === "" ? { font: false as const } : { font: { cssText } };
  return domToBlob(node, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, scale: 1, type: "image/png", ...font });
}

/** ダウンロードに使った URL を手放すまでの時間（すぐに手放すと、ブラウザによってはダウンロードが始まらない） */
const REVOKE_DELAY_MS = 60_000;

/** PNG をファイル名 fileName でダウンロードさせる */
export function downloadPng(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

/** 画像をクリップボードへコピーできるブラウザか（navigator.clipboard.write と ClipboardItem がある） */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

/**
 * PNG をクリップボードへコピーする（navigator.clipboard.write は、この関数を呼んだときに同期的に呼ぶ）。
 * Safari はユーザーの操作（クリック）の処理の中で write を呼ばないとコピーを断るため、クリックの処理から直接呼び、
 * まだ作っている途中の PNG は ClipboardItem に Promise のまま渡す（ブラウザが PNG のできあがりを待ってから書き込む）
 */
export function copyPng(png: Promise<Blob>): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** ウィンドウを閉じたため、作っている途中の PNG の保存・コピーをやめたことを表す */
export class ExportCancelledError extends Error {
  constructor() {
    super("ウィンドウを閉じたため、画像を作るのをやめました");
    this.name = "ExportCancelledError";
  }
}

/**
 * 失敗の理由の文（Error・DOMException などのメッセージ、文字ならその文字）。
 * DOMException は環境によって Error を継承しないため、message を持つかで見る
 */
export function reasonOf(error: unknown): string {
  if (typeof error === "string" && error !== "") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string" && message !== "") return message;
  }
  return "原因が分かりません";
}
