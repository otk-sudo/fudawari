"use client";

import type { ReactNode } from "react";

export type SideNavProps = {
  /** 今いる画面のパス（例 "/list"）。レイアウト側で usePathname() から渡す */
  currentPath: string;
};

/**
 * 左メニュー（要件 2.2、モック SideNav.dc.html）。権限は `@/features/auth` の useRole() から受け取る。
 *
 * 期待する形
 * - 名前「メインメニュー」の navigation
 * - 先頭に「札」（名前「ホームへ」、/ へのリンク）
 * - 一般：一覧(/list)・割振(/assign)・取込(/import)・差分(/drift)・設定（ボタン。ウィンドウを開く）
 * - 協力者：上記＋「管理」の区切りの下に 定義(/definition)
 * - 管理者：上記＋「管理」の区切りの下に 定義・協力者(/collaborators)
 * - 今いる画面の項目に aria-current="page"
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何も描画しない
 */
export function SideNav(props: SideNavProps): ReactNode {
  void props;
  return null;
}
