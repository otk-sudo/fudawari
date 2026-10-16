"use client";

import type { ReactNode } from "react";

export type HomeScreenProps = {
  /**
   * 開催中のイベント名（例 "2026夏イベ"）。開催中のイベントがなければ null。
   * PR-03 では仮の値を渡す。T2-3（公開定義の読み込み）で本物につなぐ
   */
  runningEventName: string | null;
};

/**
 * ホーム（要件 3.1、モック Home.dc.html）。権限は `@/features/auth` の useRole() から受け取る。
 *
 * 期待する形
 * - ヘッダー：見出し（h1）にアプリ名「札割りプランナー」。開催中のイベントがあるときだけ「開催中：（イベント名）」
 * - 「札割り」の区分：一覧・割り振り・取り込み・差分（リンク）、設定（ボタン。設定のウィンドウを開く）
 * - 「管理」の区分（協力者・管理者のみ）：見出しに権限名のバッジ、イベント定義・協力者（管理者のみ）
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何も描画しない
 */
export function HomeScreen(props: HomeScreenProps): ReactNode {
  void props;
  return null;
}
