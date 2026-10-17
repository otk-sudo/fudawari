// 画面モード・文字の大きさの控え（このブラウザの localStorage）と、描画前に控えを読むスクリプト（要件 3.6）
//
// 設定の正はブラウザ内の保存（IndexedDB。getPlanStorage().loadSettings()）だが、読むのは非同期で、読み終えるまでは
// 初期値（ダーク・標準）の色・文字の大きさで描かれてしまう（ちらつき）。そこで SettingsSync が設定を localStorage にも写し、
// レイアウトの <head> に置くスクリプト（DISPLAY_BOOT_SCRIPT）が描画の前にそれを読んで <html> の属性を付ける。
// - 画面モード：ダーク／ライトは data-theme を付ける。端末に合わせるときは data-theme を外す（theme.css が端末の設定に従う）
// - 文字の大きさ：data-font-size（small／mid／large）を付ける
// localStorage が使えない（プライベートブラウズ・保存の拒否など）ときは何もしない（例外を外に出さない）。
// サーバー（静的書き出しのビルド）でも読み込むため、React・zustand を読み込まない。
// 画面モードは型だけのファイルから読む（入口 @/features/theme は React の部品や zustand も読み込むため）
import type { ThemeMode } from "@/features/theme/theme-mode-base";
import type { FontSize } from "@/lib/storage";

/** 画面モードの控えのキー */
export const THEME_MIRROR_KEY = "fudawari.theme";
/** 文字の大きさの控えのキー */
export const FONT_SIZE_MIRROR_KEY = "fudawari.fontSize";

// 型の値をすべて並べる（型に値が増えたら、ここが型の誤りになって気付ける）
const THEME_MODES: Readonly<Record<ThemeMode, true>> = { dark: true, light: true, system: true };
const FONT_SIZES: Readonly<Record<FontSize, true>> = { small: true, mid: true, large: true };

/** 値が、並べた値のどれかか */
function isOneOf<K extends string>(value: unknown, options: Readonly<Record<K, true>>): value is K {
  return typeof value === "string" && Object.hasOwn(options, value);
}

/** 控えを読む（使えない・ない・知らない値なら null） */
function readMirror<K extends string>(key: string, options: Readonly<Record<K, true>>): K | null {
  try {
    const value = window.localStorage.getItem(key);
    return isOneOf(value, options) ? value : null;
  } catch {
    return null;
  }
}

/** 控えに書く（使えなければ何もしない） */
function writeMirror(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 控えは描画前のちらつきを防ぐためだけのもの。書けなくても設定の保存（IndexedDB）には影響しない
  }
}

/** 控えの画面モード（なければ null） */
export function readMirroredThemeMode(): ThemeMode | null {
  return readMirror(THEME_MIRROR_KEY, THEME_MODES);
}

/** 画面モードを控えに写す */
export function writeMirroredThemeMode(mode: ThemeMode): void {
  writeMirror(THEME_MIRROR_KEY, mode);
}

/** 控えの文字の大きさ（なければ null） */
export function readMirroredFontSize(): FontSize | null {
  return readMirror(FONT_SIZE_MIRROR_KEY, FONT_SIZES);
}

/** 文字の大きさを控えに写す */
export function writeMirroredFontSize(fontSize: FontSize): void {
  writeMirror(FONT_SIZE_MIRROR_KEY, fontSize);
}

/**
 * 描画の前に控えを読んで <html> の属性を付けるスクリプト（レイアウトの <head> にそのまま置く）。
 * 控えがない・知らない値なら属性を変えない（レイアウトが書き出した初期値のまま）
 */
export const DISPLAY_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage,t=s.getItem(${JSON.stringify(
  THEME_MIRROR_KEY,
)}),f=s.getItem(${JSON.stringify(
  FONT_SIZE_MIRROR_KEY,
)});if(t==="dark"||t==="light"){d.setAttribute("data-theme",t)}else if(t==="system"){d.removeAttribute("data-theme")}if(f==="small"||f==="mid"||f==="large"){d.setAttribute("data-font-size",f)}}catch(e){}})();`;
