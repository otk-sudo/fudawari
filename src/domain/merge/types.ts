// 3 方向マージ（同時編集の B 案。要件 3.7「同時編集」、roadmap T3-8 の単体部分）と保存の記録の文の型
import type { DefinitionDoc } from "@/domain/definition-edit/types";

/** イベントの情報の項目 */
export type EventField = "name" | "startAt" | "endAt" | "versionDate";
/** 札の項目 */
export type FudaField = "name" | "color" | "gameNumber";
/** 段階の項目（areaId は別の海域への移動） */
export type StageField = "name" | "fudaId" | "importance" | "areaId";
/** 特効グループの項目 */
export type BoostGroupField = "name" | "multiplier" | "shipNames";

/**
 * 変更・衝突の場所（画面の「場所を見る」や、赤く光らせる・橙の枠を付ける段階を決めるのに使う）
 * - field が null：そのもの自体（追加・削除、削除と変更の衝突）
 * - fudaOrder：札の並び順。stageOrder：その海域の中の段階の並び順
 * - area：海域の追加・外す（海域は名前を変える操作がないため項目は持たない）
 */
export type ChangeLocation =
  | { kind: "event"; field: EventField }
  | { kind: "area"; areaId: string }
  | { kind: "fuda"; fudaId: string; field: FudaField | null }
  | { kind: "fudaOrder" }
  | { kind: "stage"; stageId: string; field: StageField | null }
  | { kind: "stageOrder"; areaId: string }
  | { kind: "boostGroup"; stageId: string; groupId: string; field: BoostGroupField | null };

/** 変更の種類 */
export type ChangeKind = "added" | "deleted" | "modified";

/** 3 方向マージの入力 */
export interface MergeInput {
  /** 開いたときの版（共有の下書き） */
  base: DefinitionDoc;
  /** 自分の内容（保存しようとしている内容） */
  mine: DefinitionDoc;
  /** 相手が保存した内容（今の共有の下書き） */
  theirs: DefinitionDoc;
}

/**
 * 自動で合わせた所（相手だけが変えた所を取り込んだもの。画面で橙の枠と「（名前）が変更」を付ける）。
 * 自分だけが変えた所、2 人が同じ値に変えた所は含めない
 */
export interface AutoMergedChange {
  location: ChangeLocation;
  change: ChangeKind;
  /** 表示名（例「E3 ゲージ4 の特効「第二十七駆逐隊」」「E2 ゲージ3 の大事さ」「札の並び順」） */
  label: string;
  /** 印を付ける段階の ID（段階・特効グループの変更のとき。ほかは null） */
  stageId: string | null;
}

/** 衝突（同じ項目を 2 人が違う値に変えた所。画面で赤く光らせ、どちらを残すか選ばせる） */
export interface MergeConflict {
  /** 衝突の ID（resolveMerge で選ぶときのキー。同じ入力からは同じ ID になる） */
  id: string;
  location: ChangeLocation;
  /** 表示名（例「E2 ゲージ3 の大事さ」） */
  label: string;
  /** 相手の値の表示（例「重要」。削除した側は「削除」、削除と変更の衝突で変更した側は「変更」） */
  theirsText: string;
  /** 自分の値の表示（例「難所」） */
  mineText: string;
  /** 赤く光らせる段階の ID（段階・特効グループの衝突のとき。ほかは null） */
  stageId: string | null;
}

/** 3 方向マージの結果 */
export interface MergeResult {
  /**
   * 合わせた文書。衝突した所は仮に「自分の内容」を入れてある（選んでいる間の表示用）。
   * resolveMerge で、すべての衝突に "mine" を選んだ結果と同じ
   */
  merged: DefinitionDoc;
  /** 自動で合わせた所 */
  autoMerged: AutoMergedChange[];
  /** 衝突（なければ空。空ならそのまま merged を保存してよい） */
  conflicts: MergeConflict[];
}

/** 衝突ごとの選択。相手の内容／自分の内容 */
export type ConflictChoice = "theirs" | "mine";

/** 衝突の ID → 選択 */
export type ConflictChoices = Readonly<Record<string, ConflictChoice>>;

/** 選択から最終的な文書を作った結果。選んでいない衝突があれば、その ID を返す */
export type ResolveResult = { ok: true; doc: DefinitionDoc } | { ok: false; unresolved: string[] };

/** 保存の記録・未公開の変更の 1 件 */
export interface DefinitionChange {
  location: ChangeLocation;
  change: ChangeKind;
  /** 記録の内容の文（例「E2 ゲージ3 の大事さを「難所」→「重要」」） */
  text: string;
  /** 絞り込み用の海域 ID（例 ["E2"]。別の海域への移動は移す前と後の 2 つ。海域によらない変更は空） */
  areaIds: string[];
}

/** 1 回の保存の記録の内容 */
export interface SaveSummary {
  /** 記録の内容の文（1 行）。変更が 1 件ならその文、2 件以上なら「（最初の文） ほか n 件」、なければ「変更なし」 */
  text: string;
  /** 絞り込み用の海域 ID（変更のあった海域。重複なし、海域の並び順） */
  areaIds: string[];
  /** 変更の一覧（describeChanges と同じ） */
  changes: DefinitionChange[];
}
