"use client";

// 設定のウィンドウの「アカウント」欄（要件 3.6、モック SettingsDialog.dc.html）。
// 協力者・管理者のときだけ、見出し「アカウント」、「ログイン中：（名前）」「権限：管理者／協力者」、「ログアウト」を出す。
// 一般利用者には何も出さない。設定のウィンドウへの組み込みは PR-08 が行う
//
// PR-10b のテスト（AccountSection.test.tsx）を先に書いた段階の入れ物。中身は実装の担当が書く
import type { ReactNode } from "react";

export const AccountSection: () => ReactNode = () => null;
