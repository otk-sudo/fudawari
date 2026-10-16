// 画面モードの型と初期値。React・zustand を読み込まない
//
// ブラウザ内の保存（src/lib/storage）が設定の型・初期値として読むため、切り替えの状態（theme-mode.ts の zustand）や
// 部品（ThemeSync）とは分けている。画面・部品は入口（index.ts）から読み込む。

/** 画面モード。"system" は端末の設定（prefers-color-scheme）に合わせる */
export type ThemeMode = "dark" | "light" | "system";

/**
 * 画面モードの初期値。モックの設定の初期値がダークで、ライトの色がまだ仮のためダークにする。
 * レイアウトの `<html data-theme>` の初期値もここから決める（読み込み直後に色が切り替わって見えないように）
 */
export const DEFAULT_THEME_MODE: ThemeMode = "dark";
