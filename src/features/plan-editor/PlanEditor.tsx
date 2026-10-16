"use client";

import type { ReactNode } from "react";
import type { DefinitionRepository } from "./types";

export type PlanEditorProps = {
  /** 定義の保管庫（読み込み・下書きの保存・公開・イベントの作成と更新） */
  repository: DefinitionRepository;
  /**
   * 艦船マスタにある「改装段階を問わない艦名」の集合（知らない艦名の警告に使う。PR-02 レビュー 4）。
   * 省略（undefined）なら警告しない
   */
  knownShipNames?: ReadonlySet<string>;
};

/**
 * イベント定義の画面（要件 3.7、モック PlanEditor.dc.html）。ヘッダー帯（h1「イベント定義」）から本文までを描く。
 * 権限は保管庫の load() が返す user.role（DB の値）で出し分ける。
 *
 * PR-11a のテスト（Red）のための空の入れ物。中身は実装の担当が作る。
 */
export function PlanEditor(props: PlanEditorProps): ReactNode {
  void props;
  return null;
}
