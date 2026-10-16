/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 特効グループの編集（要件 3.7「この段階のボスで効く特効」、U11・U16、roadmap T3-6）
// 特効グループの ID は文書全体（すべての段階）で重複しないので、グループの操作は groupId だけで指定する。
import type { AddBoostGroupInput, BoostGroupPatch, DefinitionDoc, EditResult } from "./types";

/**
 * 段階に特効グループを追加する（その段階の特効の最後）。
 * 省略時は 名前 ""・倍率 1・艦名なし。艦名は前後の空白を除き、重複を除く（先に出た順）。
 * - エラー：倍率が 1 未満・有限の数でない、空の艦名 → invalid_value、
 *   newGroupId が文書のどこかの特効グループの ID と同じ → duplicate_id、段階がない → not_found
 */
export function addBoostGroup(doc: DefinitionDoc, input: AddBoostGroupInput): EditResult {
  throw new Error("未実装");
}

/**
 * 特効グループの倍率・名前を変える（指定した項目だけ）。名前は空でもよい（PublicDefinition の約束）。
 * - エラー：倍率が 1 未満・有限の数でない → invalid_value、グループがない → not_found
 */
export function updateBoostGroup(doc: DefinitionDoc, groupId: string, patch: BoostGroupPatch): EditResult {
  throw new Error("未実装");
}

/**
 * 特効グループに艦名を追加する（「＋ 艦名」、貼り付けた一覧）。最後に足す。
 * 前後の空白を除き、グループに既にある艦名・入力の中で重複する艦名は足さない（先に出た順）。
 * - エラー：空（空白だけを含む）の艦名がある → invalid_value、グループがない → not_found
 */
export function addShipNames(doc: DefinitionDoc, groupId: string, shipNames: readonly string[]): EditResult {
  throw new Error("未実装");
}

/**
 * 特効グループから艦名を 1 つ外す（艦名タグの ×）。
 * - エラー：グループがない、またはその艦名がグループにない → not_found
 */
export function removeShipName(doc: DefinitionDoc, groupId: string, shipName: string): EditResult {
  throw new Error("未実装");
}

/**
 * 特効グループを削除する（グループの ×）。
 * - エラー：グループがない → not_found
 */
export function deleteBoostGroup(doc: DefinitionDoc, groupId: string): EditResult {
  throw new Error("未実装");
}

/**
 * 「攻略サイトの艦名リストを貼り付け」：区切られた艦名の文字列から艦名の一覧を作る。
 * - 区切り：改行（\n・\r\n・\r）、タブ、読点「、」、カンマ「,」「，」、スラッシュ「/」「／」
 * - 各艦名の前後の空白（半角・全角）を除く。艦名の中の半角空白は残す（例「Gambier Bay」）
 * - 空の項目は除く。重複は除く（先に出た順に並べる）
 */
export function parseShipNameList(text: string): string[] {
  throw new Error("未実装");
}
