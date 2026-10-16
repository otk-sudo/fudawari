// 定義の編集・マージの単体テストの補助（テストからだけ使う。本体のコードからは使わない）
import { expect } from "vitest";
import type { Area, BoostGroup, Fuda, Stage } from "@/domain/definition/types";
import type { Mutable } from "@/test/fixtures";
import { deepFreeze } from "@/test/fixtures/freeze";
import type { DefinitionDoc, EditError, EditErrorCode, EditResult } from "./types";

/** 成功したことを確かめて、新しい文書を返す */
export function expectOk(result: EditResult): DefinitionDoc {
  if (!result.ok) {
    throw new Error(`成功するはずが失敗しました（${result.error.code}：${result.error.message}）`);
  }
  return result.doc;
}

/** 失敗したことと、理由の種類を確かめる（理由の文が空でないことも確かめる） */
export function expectEditError(result: EditResult, code: EditErrorCode): EditError {
  if (result.ok) {
    throw new Error(`失敗（${code}）するはずが成功しました`);
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message.trim()).not.toBe("");
  return result.error;
}

/** 海域の段階の ID を、その海域の中の並び順で返す */
export function stageIdsOf(doc: DefinitionDoc, areaId: string): string[] {
  return doc.stages.filter((s) => s.areaId === areaId).map((s) => s.id);
}

/** 段階を取り出す（なければテストの書き間違いとして例外）。下書き（Mutable）から取り出すと、書き換えられる型で返す */
export function stageOf(doc: Mutable<DefinitionDoc>, stageId: string): Mutable<Stage>;
export function stageOf(doc: DefinitionDoc, stageId: string): Stage;
export function stageOf(doc: DefinitionDoc, stageId: string): Stage {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`段階 ${stageId} がありません`);
  return stage;
}

/** 特効グループを取り出す（なければ例外）。下書き（Mutable）から取り出すと、書き換えられる型で返す */
export function groupOf(doc: Mutable<DefinitionDoc>, groupId: string): Mutable<BoostGroup>;
export function groupOf(doc: DefinitionDoc, groupId: string): BoostGroup;
export function groupOf(doc: DefinitionDoc, groupId: string): BoostGroup {
  const group = doc.stages.flatMap((s) => s.boosts).find((g) => g.id === groupId);
  if (!group) throw new Error(`特効グループ ${groupId} がありません`);
  return group;
}

/** 札を取り出す（なければ例外）。下書き（Mutable）から取り出すと、書き換えられる型で返す */
export function fudaOf(doc: Mutable<DefinitionDoc>, fudaId: string): Mutable<Fuda>;
export function fudaOf(doc: DefinitionDoc, fudaId: string): Fuda;
export function fudaOf(doc: DefinitionDoc, fudaId: string): Fuda {
  const fuda = doc.fudas.find((f) => f.id === fudaId);
  if (!fuda) throw new Error(`札 ${fudaId} がありません`);
  return fuda;
}

/** 札の ID を並び順で返す */
export function fudaIdsOf(doc: DefinitionDoc): string[] {
  return doc.fudas.map((f) => f.id);
}

/** 海域の ID を並び順で返す */
export function areaIdsOf(doc: DefinitionDoc): string[] {
  return doc.areas.map((a: Area) => a.id);
}

/** 文書のどこかにその特効グループの ID があるか */
export function hasGroup(doc: DefinitionDoc, groupId: string): boolean {
  return doc.stages.some((s) => s.boosts.some((g) => g.id === groupId));
}

/**
 * テストの準備：文書を複製して書き換え、凍結して返す。
 * 凍結した文書を関数に渡すと、関数が元の文書を書き換えたときに例外になるので、イミュータブルであることも確かめられる。
 * 文書の型は読み取り専用なので、複製した下書きは入れ子まで書き換えられる型（Mutable）で渡す
 */
export function editDoc(doc: DefinitionDoc, change: (draft: Mutable<DefinitionDoc>) => void): DefinitionDoc {
  const draft = JSON.parse(JSON.stringify(doc)) as Mutable<DefinitionDoc>;
  change(draft);
  return deepFreeze(draft);
}

/** テストの準備：段階を 1 つ作る（省略した項目は 名前「テスト段階」・大事さ「普通」・特効なし。下書きに差し込めるよう Mutable で返す） */
export function makeStage(
  fields: Pick<Mutable<Stage>, "id" | "areaId" | "fudaId"> & Partial<Mutable<Stage>>,
): Mutable<Stage> {
  return { name: "テスト段階", importance: "normal", boosts: [], ...fields };
}

/** テストの準備：段階を、指定した段階の直前（null なら配列の最後）に差し込む（draft を書き換える） */
export function insertStageInto(draft: Mutable<DefinitionDoc>, stage: Mutable<Stage>, beforeStageId: string | null): void {
  const at = beforeStageId === null ? draft.stages.length : draft.stages.findIndex((s) => s.id === beforeStageId);
  if (at < 0) throw new Error(`段階 ${String(beforeStageId)} がありません`);
  draft.stages.splice(at, 0, stage);
}

/** テストの準備：段階を取り除く（draft を書き換える） */
export function removeStageFrom(draft: Mutable<DefinitionDoc>, stageId: string): void {
  const at = draft.stages.findIndex((s) => s.id === stageId);
  if (at < 0) throw new Error(`段階 ${stageId} がありません`);
  draft.stages.splice(at, 1);
}
