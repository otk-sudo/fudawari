// 表示の設定（文字の大きさ）の今の値と、設定のウィンドウでの選択の入口（要件 3.6）
//
// - 文字の大きさの今の値を持つ。SettingsSync がそれを <html data-font-size> に反映し、theme.css が :root の文字の大きさを変える。
//   画面モードは画面モードの入口（@/features/theme の setThemeMode）が持つ。
// - 設定のウィンドウで画面モード・文字の大きさを選んだら（chooseThemeMode・chooseFontSize）、選んだ回数を数える。
//   SettingsSync は起動時に保存した設定を読み終えたとき、読んでいる間に利用者が選んでいたら、古い保存の値で上書きしない。
import { create } from "zustand";
import { setThemeMode, type ThemeMode } from "@/features/theme";
import type { FontSize } from "@/lib/storage";

interface DisplayState {
  /** 今の文字の大きさ。まだ分からない（保存した設定も控えも読んでいない）ときは null（<html data-font-size> に触らない） */
  fontSize: FontSize | null;
  /** 設定のウィンドウで画面モード・文字の大きさを選んだ回数 */
  choices: number;
}

const useDisplayStore = create<DisplayState>(() => ({ fontSize: null, choices: 0 }));

/** 今の文字の大きさ（分からなければ null）。変わると、使っている部品は描き直される */
export function useFontSize(): FontSize | null {
  return useDisplayStore((state) => state.fontSize);
}

/** 今の文字の大きさ（描画の外から読む。分からなければ null） */
export function currentFontSize(): FontSize | null {
  return useDisplayStore.getState().fontSize;
}

/** 保存した設定・控えの文字の大きさを戻す（SettingsSync が使う。選んだ回数は数えない） */
export function restoreFontSize(fontSize: FontSize): void {
  useDisplayStore.setState({ fontSize });
}

/** 設定のウィンドウで画面モードを選ぶ（すぐに画面に反映する。保存は呼ぶ側が行う） */
export function chooseThemeMode(mode: ThemeMode): void {
  useDisplayStore.setState((state) => ({ choices: state.choices + 1 }));
  setThemeMode(mode);
}

/** 設定のウィンドウで文字の大きさを選ぶ（すぐに画面に反映する。保存は呼ぶ側が行う） */
export function chooseFontSize(fontSize: FontSize): void {
  useDisplayStore.setState((state) => ({ fontSize, choices: state.choices + 1 }));
}

/** 設定のウィンドウで画面モード・文字の大きさを選んだ回数 */
export function displayChoiceCount(): number {
  return useDisplayStore.getState().choices;
}
