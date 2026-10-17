// 差分（計画と実際の札。要件 3.5、roadmap T2-11、U10・U17・U23）の型
//
// - 取り込みデータの個体の「実際の札」（OwnedShip.sallyArea。0 は札なし）を、定義の札の「ゲーム内の札番号」
//   （Fuda.gameNumber）で定義の札に対応付け、計画（AssignmentMap）と比べる。処理は通信しない純粋な関数（drift.ts）。
// - 比べるのは取り込んだ個体だけ。割り当てにあっても取り込みデータにいない個体は数えない。
// - 札番号が未入力の札（gameNumber が null）に置いた個体は、差分の対象外として分類せず excluded に入れる（U10）。
// - 定義にない札 ID への割り当ては控えとして扱う（U17：定義から消えた札の割り当ては控えに戻す）。
// - 定義のどの札番号にも当たらない札が付いた艦は、計画した札（札番号あり）と違えば「計画と違う札が付いた」（実際の札 ID は null。
//   反映すると控えに戻す）。控えの艦なら、計画に追加できないため対象外にする（2026-10-17 親が決定）。
// - 代わりの艦の提案は持たない（U23）。説明文の特効（例「E2-3 ×1.24」）は画面側で domain/boost から求める。
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import type { Fuda } from "@/domain/definition/types";

/**
 * 差分の分類（要件 3.5 の「件数のまとめ」の 4 つ）
 * - differentFuda：計画と違う札が付いた（赤）。計画で札に置いたが、別の札が付いている
 * - unplanned：計画にない艦に札が付いた（橙）。控えの艦に札が付いている
 * - asPlanned：計画どおり（緑）。計画で置いた札と同じ札が付いている
 * - notSortied：まだ出撃していない（灰）。計画で札に置いたが、まだ札が付いていない
 *
 * 控えで札も付いていない艦は、どの分類にも入らない
 */
export type DriftKind = "differentFuda" | "unplanned" | "asPlanned" | "notSortied";

/** 差分の 1 件（分類した個体 1 隻） */
export interface DriftEntry {
  /** 個体 ID */
  uid: ShipUid;
  /** 艦 ID（艦名を引くため。艦船マスタにない艦もそのまま入る） */
  shipId: number;
  /** 分類 */
  kind: DriftKind;
  /** 計画の札 ID。控え（計画にない艦）なら null */
  plannedFudaId: string | null;
  /** 実際の札の ID。札なし、または定義のどの札番号にも当たらない札なら null */
  actualFudaId: string | null;
  /** 実際の札の番号（取り込みデータの sallyArea そのまま。0 は札なし） */
  actualGameNumber: number;
}

/**
 * 差分の対象外にした理由
 * - plannedFudaWithoutNumber：計画の札に札番号が入力されていない（U10）
 * - unknownGameNumber：控えの艦に付いている札の番号が、定義のどの札にもない（2026-10-17 親が決定）
 */
export type DriftExcludedReason = "plannedFudaWithoutNumber" | "unknownGameNumber";

/** 差分の対象外にした個体 1 隻（画面では「対象外」として表示する。U10） */
export interface DriftExcludedEntry {
  /** 個体 ID */
  uid: ShipUid;
  /** 艦 ID */
  shipId: number;
  /** 対象外にした理由 */
  reason: DriftExcludedReason;
  /** 計画の札 ID。控えなら null */
  plannedFudaId: string | null;
  /** 実際の札の番号（sallyArea そのまま。0 は札なし） */
  actualGameNumber: number;
}

/** 件数のまとめの 1 つ（画面の 4 つの枠） */
export interface DriftSummaryItem {
  /** 分類 */
  kind: DriftKind;
  /** 画面に出す名前（要件 3.5 の用語。例「計画と違う札が付いた」） */
  label: string;
  /** 件数 */
  count: number;
}

/** 札ごとの進み具合（画面の「札付き n ／ 計画 m 隻」） */
export interface FudaProgress {
  /** 札 ID */
  fudaId: string;
  /** 計画：計画でこの札に置いた、取り込んだ個体の隻数 */
  planned: number;
  /**
   * 札付き：そのうち実際にこの札が付いている隻数（計画どおりの隻数。計画にない艦に付いた札は数えない）。
   * 札番号が未入力の札は比べられないので null（U10）
   */
  tagged: number | null;
}

/** computeDrift に渡すもの */
export interface DriftInput {
  /** 取り込んだ個体の一覧（取り込みデータの順。取り込んでいなければ空） */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（計画） */
  assignments: AssignmentMap;
  /** 最新イベントの定義の札（配列の順が並び順） */
  fudas: readonly Fuda[];
}

/** 計画と実際の札を比べた結果 */
export interface DriftReport {
  /** 件数のまとめ。要件 3.5 の順（計画と違う札が付いた → 計画にない艦に札が付いた → 計画どおり → まだ出撃していない）で常に 4 つ */
  summary: DriftSummaryItem[];
  /**
   * 対応が必要な一覧（計画と違う札が付いた・計画にない艦に札が付いた）。
   * 「計画と違う札が付いた」が先、「計画にない艦に札が付いた」が後。各分類の中は取り込みデータの順
   */
  issues: DriftEntry[];
  /** 4 つの分類のどれかに入った個体すべて（取り込みデータの順） */
  entries: DriftEntry[];
  /** 差分の対象外にした個体（取り込みデータの順） */
  excluded: DriftExcludedEntry[];
  /** 札ごとの進み具合（定義の札の順。定義のすべての札） */
  progress: FudaProgress[];
}

/** 反映で変えた個体 1 隻の前後（元に戻すための記録） */
export interface DriftUndoChange {
  /** 個体 ID */
  uid: ShipUid;
  /** 反映前の札 ID（控えなら null） */
  before: string | null;
  /** 反映後の札 ID（控えなら null） */
  after: string | null;
}

/** 元に戻すための記録（直前の反映 1 回分。画面は最後の記録だけを持つ） */
export interface DriftUndo {
  /** 反映で変えた個体の前後 */
  changes: readonly DriftUndoChange[];
}

/** applyDriftEntries の結果 */
export interface DriftApplyResult {
  /** 反映した後の割り当て（新しいオブジェクト。渡した割り当ては変えない） */
  assignments: AssignmentMap;
  /** 反映した件（渡した順。画面の「n 件を計画に反映しました（艦名・艦名）」に使う） */
  applied: DriftEntry[];
  /** 元に戻すための記録。反映したものがなければ null */
  undo: DriftUndo | null;
}
