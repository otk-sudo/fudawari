// 画像で保存の、PNG を作る・保存する・コピーする処理（要件 3.9・11 章、roadmap T2-10）。ブラウザの機能との境界
//
// - フォント：document.fonts.ready と、日本語フォント（Noto Sans JP）の画像に使う文字の document.fonts.load を待ってから描く
//   （読み込み前に描くと、代わりのフォントの画像になるため）
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
/** CSS 変数が読めないとき（テストなど）に使うフォントの指定 */
const FALLBACK_FONT_FAMILY = '"Noto Sans JP"';
/** 画像に使う文字の太さ（ExportImage.module.css の font-weight。可変フォントでなくても読み込めるように並べる） */
const IMAGE_FONT_WEIGHTS: readonly number[] = [400, 500, 700, 800];

/** 画像に使う日本語フォントの指定（例 'Noto Sans JP', 'Noto Sans JP Fallback'） */
function imageFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(FONT_VARIABLE).trim();
  return value === "" ? FALLBACK_FONT_FAMILY : value;
}

/**
 * 画像の文字を描くフォントの読み込みを待つ。
 * document.fonts.ready（読み込み中のフォント）を待ってから、Noto Sans JP の text の文字の分を読み込む
 * （Noto Sans JP は文字の範囲ごとにファイルが分かれていて、画面に出ていない文字の分はまだ読み込んでいないため）。
 * document.fonts がないブラウザでは待たない
 */
export async function waitForImageFonts(text: string): Promise<void> {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (fonts === undefined) return;
  await fonts.ready;
  const family = imageFontFamily();
  await Promise.all(IMAGE_FONT_WEIGHTS.map((weight) => fonts.load(`${weight} 16px ${family}`, text)));
}

/**
 * 画像に埋め込む日本語フォントの CSS（画像の文字を含む範囲の分だけ。font-embed.ts）。
 * 作れなければ null（modern-screenshot の既定の埋め込みに任せる。時間はかかるが、同じフォントで描ける）
 */
async function imageFontCss(text: string): Promise<string | null> {
  try {
    return await embeddedFontCss(familyNamesOf(imageFontFamily()), text);
  } catch {
    return null;
  }
}

/** 画像の DOM を 1600×900 の PNG にする（フォントの読み込みは waitForImageFonts で先に待つ） */
export async function renderPng(node: HTMLElement): Promise<Blob> {
  const cssText = await imageFontCss(node.textContent ?? "");
  return domToBlob(node, {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    scale: 1,
    type: "image/png",
    ...(cssText === null ? {} : { font: { cssText } }),
  });
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

/** PNG をクリップボードへコピーする */
export async function copyPng(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/** 失敗の理由の文（Error ならそのメッセージ、ほかは文字にしたもの） */
export function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return "原因が分かりません";
}
