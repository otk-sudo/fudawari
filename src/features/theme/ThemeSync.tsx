"use client";

import { useEffect } from "react";
import { themeAttributeFor, useThemeMode } from "./theme-mode";

/**
 * 画面モードを `<html data-theme>` に反映する部品。レイアウトに 1 つだけ置く。何も描画しない。
 * 置いた時点のモードもすぐに反映する（PR-08 で保存したモードを起動時に戻すときに使う）。
 */
export function ThemeSync(): null {
  const mode = useThemeMode();

  useEffect(() => {
    const attribute = themeAttributeFor(mode);
    const html = document.documentElement;
    if (attribute === undefined) {
      html.removeAttribute("data-theme");
    } else {
      html.setAttribute("data-theme", attribute);
    }
  }, [mode]);

  return null;
}
