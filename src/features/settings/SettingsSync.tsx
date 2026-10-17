"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { setThemeMode, useThemeMode } from "@/features/theme";
import { getPlanStorage } from "@/lib/plan";
import {
  readMirroredFontSize,
  readMirroredThemeMode,
  writeMirroredFontSize,
  writeMirroredThemeMode,
} from "./display-mirror";
import { displayChoiceCount, restoreFontSize, useFontSize } from "./display-store";

/**
 * 保存した設定を、設定のウィンドウを開かなくても起動時に画面へ戻す部品（要件 3.6、roadmap T2-12）。
 * レイアウトに 1 つだけ置く。何も描画しない。
 *
 * - 起動時に getPlanStorage().loadSettings() で保存した設定を読み、画面モードを setThemeMode で戻す（ThemeSync が
 *   <html data-theme> に反映する）。文字の大きさは <html data-font-size> に付ける（theme.css が文字の大きさを変える）。
 *   読んでいる間に設定のウィンドウで選ばれていたら、その選択を優先する（古い保存の値で上書きしない）。
 *   読めなければ控え（なければ初期値）のまま進める（設定を読めなくても画面は使えるので、警告は出さない）
 * - 読み終えた後は、画面モード・文字の大きさを localStorage の控えにも写す。次に開いたとき、レイアウトの <head> の
 *   スクリプト（DISPLAY_BOOT_SCRIPT）が描画の前に控えを読み、ちらつきを防ぐ
 * - 描画の前（layout effect）にも控えを読んで戻す。ThemeSync が初期値（ダーク）で <html data-theme> を書き換えても、
 *   画面に描かれる前に控えの値へ戻るようにする
 */
export function SettingsSync(): null {
  const themeMode = useThemeMode();
  const fontSize = useFontSize();
  /** 保存した設定を読み終えたか（読めなかったときを含む）。読み終えるまでは控えを書き換えない */
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    const mirroredTheme = readMirroredThemeMode();
    if (mirroredTheme !== null) setThemeMode(mirroredTheme);
    const mirroredFontSize = readMirroredFontSize();
    if (mirroredFontSize !== null) restoreFontSize(mirroredFontSize);
  }, []);

  useEffect(() => {
    let active = true;
    const choicesAtStart = displayChoiceCount();
    getPlanStorage()
      .loadSettings()
      .then(
        (settings) => {
          if (!active) return;
          if (displayChoiceCount() === choicesAtStart) {
            setThemeMode(settings.themeMode);
            restoreFontSize(settings.fontSize);
          }
          setLoaded(true);
        },
        () => {
          if (active) setLoaded(true);
        },
      );
    return () => {
      active = false;
    };
  }, []);

  // 文字の大きさを <html data-font-size> に反映する（分かるまでは触らない。属性がなければ標準の大きさ）
  useEffect(() => {
    if (fontSize !== null) document.documentElement.setAttribute("data-font-size", fontSize);
  }, [fontSize]);

  // 読み終えた後は、画面モード・文字の大きさを控えに写す
  useEffect(() => {
    if (!loaded) return;
    writeMirroredThemeMode(themeMode);
    if (fontSize !== null) writeMirroredFontSize(fontSize);
  }, [loaded, themeMode, fontSize]);

  return null;
}
