"use client";

import type { ReactNode } from "react";
import type { PlanEditorProps } from "./PlanEditor";

export type DefinitionScreenProps = PlanEditorProps;

/**
 * イベント定義のページの中身（src/app/definition/page.tsx から使う）。
 * - 一般利用者（useRole() が "user"）：h1「イベント定義」と「このページは管理者・協力者のみ使えます」を出し、保管庫は読まない
 * - 協力者・管理者：PlanEditor を描く
 *
 * PR-11a のテスト（Red）のための空の入れ物。中身は実装の担当が作る。
 */
export function DefinitionScreen(props: DefinitionScreenProps): ReactNode {
  void props;
  return null;
}
