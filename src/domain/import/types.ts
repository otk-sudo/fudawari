// 取り込みデータの解析（roadmap T2-1、要件 3.4、U8・U9）の型
//
// - 受け付ける形式は制空権シミュと同じ 2 種類（docs/research/import-and-master.md）
//   ① `svdata=` で始まるゲームの API 応答（api_data.api_ship の配列）
//   ② 短縮形式の JSON 配列（id・ship_id・lv・exp・st・area）。ship_id がない古い形式は id が艦の ID で、個体 ID はない
// - 解析は通信しない純粋な関数（parse.ts の parseImportText）。壊れた入力でも例外を投げず、理由を返す。
import type { OwnedShip } from "@/domain/ship/types";

/** 取り込む範囲（取り込み画面の右側「取り込む範囲」） */
export interface ImportFilter {
  /** true：ロック済みだけ／false：すべての艦娘（未ロックの艦も含める） */
  lockedOnly: boolean;
  /** Lv 下限（この Lv 以上の艦を取り込む。画面では 1〜185） */
  minLevel: number;
}

/**
 * 読み取った形式
 * - "svdata"：`svdata=` で始まる文字列（ロックの情報あり、個体 ID あり）
 * - "compact"：短縮形式で ship_id がある新しい形式（個体 ID あり、ロックの情報なし）
 * - "compactLegacy"：短縮形式で ship_id がない古い形式（個体 ID なし、ロックの情報なし）
 */
export type ImportFormat = "svdata" | "compact" | "compactLegacy";

/**
 * 解析に失敗した理由
 * - "empty"：空（空白・改行だけを含む）
 * - "invalidJson"：JSON として読めない（`svdata=` の後ろが読めない場合も含む）
 * - "unexpectedShape"：JSON としては読めるが、どちらの形式の形でもない
 */
export type ImportFailureReason = "empty" | "invalidJson" | "unexpectedShape";

/** 解析に成功したときの結果（数はすべて「取り込む範囲」で絞り込んだ後の艦について数える） */
export interface ImportSuccess {
  ok: true;
  /** 読み取った形式 */
  format: ImportFormat;
  /**
   * 取り込む艦の個体の一覧（入力の順）
   * - uid：svdata は api_id、新しい短縮形式は id を文字列にしたもの（同じ艦はどちらの形式でも同じ uid になる）。
   *   古い短縮形式は連番で振る（重複しない。同じ入力なら同じ値）
   * - luck：艦船マスタの運の初期値＋近代化改修の運（api_kyouka[4]／st[4]）。マスタにない艦は近代化改修の運だけ（なければ 0）
   * - sallyArea：api_sally_area／area の値そのまま（ない・偽の値は 0）
   * - level：Lv 0 は 1 として扱う
   */
  ships: OwnedShip[];
  /** 名前が分からない艦（艦船マスタにない艦）の数 */
  unknownShipCount: number;
  /** 札が付いている艦（sallyArea が 0 でない艦）の数 */
  taggedShipCount: number;
  /** 個体 ID があるか。false（古い短縮形式）のときは、前の割り当てを引き継げない（U9） */
  hasUid: boolean;
  /** ロックの情報があるか（svdata 形式だけ true） */
  hasLockInfo: boolean;
  /** 「ロック済みだけ」を選んだが、ロックの情報がない形式のため絞り込まなかった（すべての艦を対象にした） */
  lockFilterIgnored: boolean;
}

/** 解析に失敗したときの結果 */
export interface ImportFailure {
  ok: false;
  reason: ImportFailureReason;
}

/** 解析の結果 */
export type ImportParseResult = ImportSuccess | ImportFailure;
