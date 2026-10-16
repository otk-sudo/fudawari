// 札の編集（要件 3.7「札の一覧」、U10・U16、roadmap T3-6）
import type { Fuda } from "@/domain/definition/types";
import { fail, ok } from "./result";
import type { AddFudaInput, DefinitionDoc, EditResult, FudaPatch } from "./types";

/**
 * 札の色の選択肢（U16：用意した色から選ぶ）。"#RRGGBB"（大文字）で重複なし。
 * 色はモックの札の色 12 色（PlanEditor.dc.html・Main.dc.html の 5 色と、Assign.dc.html・ExportImage.dc.html の残り 7 色）。
 * 並びは見分けやすい順：前から順に選んでも色相が近い色が続かないよう、青 → 赤 → 緑 → 黄 → 紫 … と色相を飛ばして並べ、
 * 似た系統の色（水色と青、紫と藍、朱と茶）は離して後ろに置く。彩度の低い灰色は最後。
 */
export const FUDA_COLOR_CHOICES: readonly string[] = [
  "#4C8DF6", // 青（連合艦隊）
  "#E5484D", // 赤
  "#3FB37F", // 緑（ウルシー攻撃部隊）
  "#C9A227", // 黄土
  "#A97EF0", // 紫（第六艦隊）
  "#2BB3B1", // 青緑
  "#E07A5F", // 朱
  "#5FB0E8", // 水色（多号作戦部隊）
  "#D16BA5", // 桃
  "#B5651D", // 茶
  "#6C5CE7", // 藍
  "#8B93A1", // 灰（第三十一戦隊）
];

/** 札番号が許される値か（未入力の null か、1 以上の整数） */
function isValidGameNumber(gameNumber: number | null): boolean {
  return gameNumber === null || (Number.isInteger(gameNumber) && gameNumber >= 1);
}

/** 札番号が、指定した札（exceptFudaId）以外の札と重複するか。null は重複にしない */
function isDuplicateGameNumber(fudas: readonly Fuda[], gameNumber: number | null, exceptFudaId: string): boolean {
  return gameNumber !== null && fudas.some((f) => f.id !== exceptFudaId && f.gameNumber === gameNumber);
}

const invalidColor = (): EditResult => fail("invalid_value", "札の色は用意した色から選んでください");
const invalidGameNumber = (): EditResult => fail("invalid_value", "札番号は 1 以上の整数で入力してください");
const duplicateGameNumber = (): EditResult => fail("duplicate_game_number", "その札番号は、ほかの札で使われています");

/**
 * 札を一覧の最後に追加する。名前は前後の空白を除いて入れる。
 * - エラー：名前が空（空白だけを含む）・色が選択肢にない・札番号が 1 以上の整数でない → invalid_value、
 *   札番号がほかの札と重複 → duplicate_game_number、newFudaId が既にある札の ID → duplicate_id
 */
export function addFuda(doc: DefinitionDoc, input: AddFudaInput): EditResult {
  const name = input.name.trim();
  if (name === "") return fail("invalid_value", "札の名前を入力してください");
  if (!FUDA_COLOR_CHOICES.includes(input.color)) return invalidColor();
  if (!isValidGameNumber(input.gameNumber)) return invalidGameNumber();
  if (isDuplicateGameNumber(doc.fudas, input.gameNumber, input.newFudaId)) return duplicateGameNumber();
  if (doc.fudas.some((f) => f.id === input.newFudaId)) return fail("duplicate_id", "同じ ID の札が既にあります");

  const fuda: Fuda = { id: input.newFudaId, name, color: input.color, gameNumber: input.gameNumber };
  return ok({ ...doc, fudas: [...doc.fudas, fuda] });
}

/**
 * 札の名前・色・札番号を変える（指定した項目だけ）。段階の札の参照（fudaId）は変わらない。
 * 名前は前後の空白を除いて入れる（addFuda と同じ）。空になっても弾かない（入力の途中の空の名前は、保存・公開のときの検証で弾く）。
 * 画面は名前の入力を確定したとき（blur・Enter）に呼ぶ前提（入力中に呼ぶと、打っている途中の空白も除かれるため）。
 * 札番号は自分自身の今の番号と同じなら重複にしない。null で未入力に戻せる。
 * - エラー：色が選択肢にない・札番号が 1 以上の整数でない → invalid_value、
 *   札番号がほかの札と重複 → duplicate_game_number、札がない → not_found
 */
export function updateFuda(doc: DefinitionDoc, fudaId: string, patch: FudaPatch): EditResult {
  const fuda = doc.fudas.find((f) => f.id === fudaId);
  if (fuda === undefined) return fail("not_found", "変更する札が見つかりません");
  if (patch.color !== undefined && !FUDA_COLOR_CHOICES.includes(patch.color)) return invalidColor();
  if (patch.gameNumber !== undefined) {
    if (!isValidGameNumber(patch.gameNumber)) return invalidGameNumber();
    if (isDuplicateGameNumber(doc.fudas, patch.gameNumber, fudaId)) return duplicateGameNumber();
  }

  const updated: Fuda = {
    ...fuda,
    name: patch.name?.trim() ?? fuda.name,
    color: patch.color ?? fuda.color,
    gameNumber: patch.gameNumber === undefined ? fuda.gameNumber : patch.gameNumber,
  };
  return ok({ ...doc, fudas: doc.fudas.map((f) => (f.id === fudaId ? updated : f)) });
}

/**
 * 札を並べ替える（間に割り込み）。beforeFudaId の札の直前へ移す。null なら最後へ移す。
 * 自分自身の前・すぐ後ろの札の前に落としたときは、同じ並びの文書を返す（成功）。
 * - エラー：札がない（fudaId・beforeFudaId）→ not_found
 */
export function moveFuda(doc: DefinitionDoc, fudaId: string, beforeFudaId: string | null): EditResult {
  const fuda = doc.fudas.find((f) => f.id === fudaId);
  if (fuda === undefined) return fail("not_found", "動かす札が見つかりません");
  if (beforeFudaId !== null && !doc.fudas.some((f) => f.id === beforeFudaId)) {
    return fail("not_found", "置く場所の札が見つかりません");
  }
  if (beforeFudaId === fudaId) return ok(doc);

  const rest = doc.fudas.filter((f) => f.id !== fudaId);
  const index = beforeFudaId === null ? rest.length : rest.findIndex((f) => f.id === beforeFudaId);
  const fudas = [...rest.slice(0, index), fuda, ...rest.slice(index)];
  const unchanged = fudas.every((f, i) => f === doc.fudas[i]);
  return ok(unchanged ? doc : { ...doc, fudas });
}

/**
 * 札を削除する（U16：使われていない札だけ）。
 * - エラー：段階で使われている → fuda_in_use、札がない → not_found
 */
export function deleteFuda(doc: DefinitionDoc, fudaId: string): EditResult {
  if (!doc.fudas.some((f) => f.id === fudaId)) return fail("not_found", "削除する札が見つかりません");
  if (doc.stages.some((s) => s.fudaId === fudaId)) {
    return fail("fuda_in_use", "段階で使われている札は削除できません");
  }
  return ok({ ...doc, fudas: doc.fudas.filter((f) => f.id !== fudaId) });
}

/** 札を削除できるか（どの段階でも使われていないか）。札がなければ false */
export function canDeleteFuda(doc: DefinitionDoc, fudaId: string): boolean {
  return doc.fudas.some((f) => f.id === fudaId) && !doc.stages.some((s) => s.fudaId === fudaId);
}
