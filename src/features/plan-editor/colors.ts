// 札の色の補助（札の色の名前、札の色の上に置く文字の色）
import { FUDA_COLOR_CHOICES } from "@/domain/definition-edit";

/**
 * 札の色の選択肢（FUDA_COLOR_CHOICES）の日本語の名前。色の選択肢の読み上げ（aria-label）に使う。
 * 名前は src/domain/definition-edit/fudas.ts の色の注記と同じ
 */
const COLOR_NAMES: Readonly<Record<string, string>> = {
  "#4C8DF6": "青",
  "#E5484D": "赤",
  "#3FB37F": "緑",
  "#C9A227": "黄土",
  "#A97EF0": "紫",
  "#2BB3B1": "青緑",
  "#E07A5F": "朱",
  "#5FB0E8": "水色",
  "#D16BA5": "桃",
  "#B5651D": "茶",
  "#6C5CE7": "藍",
  "#8B93A1": "灰",
};

/** 札の色の名前（選択肢にない色は "#RRGGBB" のまま） */
export function colorName(color: string): string {
  return COLOR_NAMES[color.toUpperCase()] ?? color;
}

/** 札の色の選択肢（用意した色の順） */
export const COLOR_CHOICES: readonly string[] = FUDA_COLOR_CHOICES;

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** 暗い文字の色（モックの札の上の濃い文字）と、明るい文字の色 */
const DARK_INK = "#101114";
const LIGHT_INK = "#FFFFFF";

/** sRGB の 0〜255 の値を、相対輝度の計算に使う線形の値にする */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 色の相対輝度（WCAG 2 の定義）。読めない色は undefined */
function luminance(color: string): number | undefined {
  const match = HEX_COLOR.exec(color);
  if (match === null) return undefined;
  const [r, g, b] = [match[1], match[2], match[3]].map((hex) => linear(Number.parseInt(hex ?? "0", 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** 暗い文字の色の相対輝度 */
const DARK_INK_LUMINANCE = luminance(DARK_INK) ?? 0;

/**
 * 札の色を下地にしたときの文字の色。暗い文字と白のうち、コントラスト比が高いほうを返す
 * （札の色はイベント定義のデータなので、色ごとに計算する）。読めない色は暗い文字
 */
export function inkFor(color: string): string {
  const l = luminance(color);
  if (l === undefined) return DARK_INK;
  const withLight = 1.05 / (l + 0.05);
  const withDark = (l + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return withLight > withDark ? LIGHT_INK : DARK_INK;
}
