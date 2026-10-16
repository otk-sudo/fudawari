"use client";

import type { ReactNode } from "react";

export type SettingsDialogProps = {
  /** ウィンドウの中身（表示・データ・アカウントの設定項目）。PR-08 で別の担当が作って差し込む */
  children?: ReactNode;
};

/**
 * 設定のウィンドウの枠（Radix UI の Dialog）。レイアウトに 1 つだけ置く。
 * 開閉は settings-dialog-store（openSettingsDialog／closeSettingsDialog）に従う。
 *
 * 期待する形（モック SideNav.dc.html・Home.dc.html の設定ウィンドウ）
 * - role="dialog"、名前「設定」、aria-modal="true"
 * - 説明「表示などの設定はこのブラウザに保存されます」
 * - 右上に「×」（名前「閉じる」）、下に「閉じる」ボタン
 * - 背景の暗い部分（data-testid="settings-dialog-overlay"）のクリックで閉じる
 * - 開いている間は後ろの画面を操作できない
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何も描画しない
 */
export function SettingsDialog(props: SettingsDialogProps): ReactNode {
  void props;
  return null;
}
