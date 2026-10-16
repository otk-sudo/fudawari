// 保存の記録の文と、未公開の変更の一覧（要件 3.7「保存の記録」「状態の表示」の提案、roadmap T3-8・T3-10）
//
// before と after の差分から、記録の内容の文と絞り込み用の海域を作る。
// - 保存の記録：before は保存先の今の内容（衝突の確認の後なら相手が保存した内容）、after は保存する内容
// - 未公開の変更（「未公開の変更 n 件（主な変更 ほか）」）：before は公開中の版、after は共有の下書き
//
// 差分の単位と比べ方は merge.ts と同じ（段階・特効グループ・札・海域・イベントの情報。並び順は 3 つすべてにあるものの順）。
// 文の形（名前は before のもの。before にないものは after のもの）
// - 段階の項目：「E2 ゲージ3 の大事さを「難所」→「重要」」「E3 ゲージ3 の札を「第六艦隊」→「ウルシー攻撃部隊」」
//   「E2 ゲージ1 輸送 の段階名を「ゲージ1 輸送」→「ゲージ1」」
// - 段階の追加・削除：「E3 の段階を追加（新しい段階）」「E3 の段階を削除（ギミック）」
// - 別の海域への移動：「E3 ギミック を E2 へ移動」（areaIds は移す前と後）
// - 段階の並び順：「E2 の段階の並び順を変更」
// - 特効グループの追加・削除：「E3 ゲージ4 の特効を追加（第二十七駆逐隊 ×1.20）」「E2 ゲージ3 の特効を削除（連合艦隊B）」
// - 特効グループの項目：「E2 ゲージ3 の特効「連合艦隊C」の倍率を「×1.27」→「×1.30」」、名前も同じ形、
//   艦名：「E2 ゲージ3 の特効「連合艦隊C」の艦名を変更（追加：時雨、雪風／削除：響）」
// - 札：「札を追加（機動部隊）」「札を削除（予備の札）」「札「連合艦隊」の名前を「連合艦隊」→「連合艦隊（後段）」」、
//   色・札番号も同じ形、「札の並び順を変更」
// - 海域：「E4 を追加」「E4 を外す」。イベント：「イベント名を「…」→「…」」、日時も同じ形（未定は「未定」）
// - 倍率は小数第 2 位まで（×1.20）
// 一覧の順：イベント → 海域 → 札 → 段階（after の海域の順、その中の段階の順。削除した段階は before の位置）
//
// 実装で決めたこと（上の決まりにない細部）
// - 札の項目の変更 → 札の並び順、海域ごとに 段階の変更 → その海域の段階の並び順 の順に並べる。
// - 段階の項目・特効グループの変更の areaIds は、その段階の移す前と後の海域（移していなければ 1 つ）。
// - 名前が空の特効グループは「特効（名前なし）」と書き、追加・削除の括弧には名前の代わりに倍率を書く。
// - 艦名は集合として比べる（並びだけが変わっても変更にしない）。特効グループの並び、海域の名前は変える操作がないため比べない。
import { importanceLabel } from "@/domain/definition/importance";
import type { BoostGroup, Fuda, Stage } from "@/domain/definition/types";
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import {
  areaNameIn,
  EVENT_FIELDS,
  eventFieldLabel,
  eventValueText,
  FUDA_FIELDS,
  fudaFieldLabel,
  fudaLabel,
  fudaNameIn,
  gameNumberText,
  groupFieldLabel,
  groupLabel,
  groupNameText,
  multiplierText,
  plainText,
  sameEventValue,
  STAGE_FIELDS,
  stageFieldLabel,
  stageLabelIn,
  stageOrderLabel,
} from "./labels";
import { sameArray, stageIdsInArea, stageReportOrder, unionOrder, unique } from "./order";
import type { BoostGroupField, ChangeLocation, DefinitionChange, FudaField, SaveSummary, StageField } from "./types";

/** 「（表示名）を「変更前」→「変更後」」の文 */
function modifiedText(label: string, beforeText: string, afterText: string): string {
  return `${label}を「${beforeText}」→「${afterText}」`;
}

/** ID で引ける索引 */
function byId<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** 配列の要素の ID */
function idsOf(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id);
}

/** 両方にあるものだけの並びが、before と after で違うか */
function orderChanged(before: readonly string[], after: readonly string[]): boolean {
  const inBefore = new Set(before);
  const inAfter = new Set(after);
  return !sameArray(
    before.filter((id) => inAfter.has(id)),
    after.filter((id) => inBefore.has(id)),
  );
}

/** 札の項目の値の表示 */
function fudaValueText(field: FudaField, fuda: Fuda): string {
  switch (field) {
    case "name":
      return plainText(fuda.name);
    case "color":
      return fuda.color;
    case "gameNumber":
      return gameNumberText(fuda.gameNumber);
  }
}

/** 段階の項目（移動を除く）の値の表示。札名は、その段階がある側の文書から引く */
function stageValueText(field: Exclude<StageField, "areaId">, stage: Stage, docs: readonly DefinitionDoc[]): string {
  switch (field) {
    case "name":
      return plainText(stage.name);
    case "fudaId":
      return fudaNameIn(docs, stage.fudaId);
    case "importance":
      return importanceLabel(stage.importance);
  }
}

/** 特効グループの追加・削除の括弧の中（名前 ＋ 倍率。名前が空なら倍率だけ） */
function groupSummary(group: BoostGroup, withMultiplier: boolean): string {
  if (group.name === "") return multiplierText(group.multiplier);
  return withMultiplier ? `${group.name} ${multiplierText(group.multiplier)}` : group.name;
}

/** 段階の特効グループの変更（段階が before・after の両方にあるとき） */
function describeGroups(
  stageId: string,
  stageLabelText: string,
  areaIds: string[],
  before: readonly BoostGroup[],
  after: readonly BoostGroup[],
): DefinitionChange[] {
  const beforeGroups = byId(before);
  const afterGroups = byId(after);
  return unionOrder(idsOf(before), idsOf(after)).flatMap((groupId): DefinitionChange[] => {
    const b = beforeGroups.get(groupId);
    const a = afterGroups.get(groupId);
    const location = (field: BoostGroupField | null): ChangeLocation => ({
      kind: "boostGroup",
      stageId,
      groupId,
      field,
    });
    if (b === undefined) {
      if (a === undefined) return [];
      const text = `${stageLabelText} の特効を追加（${groupSummary(a, true)}）`;
      return [{ location: location(null), change: "added", text, areaIds }];
    }
    if (a === undefined) {
      const text = `${stageLabelText} の特効を削除（${groupSummary(b, false)}）`;
      return [{ location: location(null), change: "deleted", text, areaIds }];
    }

    const label = groupLabel(stageLabelText, b.name);
    const changes: DefinitionChange[] = [];
    if (b.name !== a.name) {
      const text = modifiedText(groupFieldLabel(label, "name"), groupNameText(b.name), groupNameText(a.name));
      changes.push({ location: location("name"), change: "modified", text, areaIds });
    }
    if (b.multiplier !== a.multiplier) {
      const text = modifiedText(
        groupFieldLabel(label, "multiplier"),
        multiplierText(b.multiplier),
        multiplierText(a.multiplier),
      );
      changes.push({ location: location("multiplier"), change: "modified", text, areaIds });
    }
    const beforeNames = new Set(b.shipNames);
    const afterNames = new Set(a.shipNames);
    const added = a.shipNames.filter((name) => !beforeNames.has(name));
    const removed = b.shipNames.filter((name) => !afterNames.has(name));
    if (added.length > 0 || removed.length > 0) {
      const parts = [
        ...(added.length > 0 ? [`追加：${added.join("、")}`] : []),
        ...(removed.length > 0 ? [`削除：${removed.join("、")}`] : []),
      ];
      const text = `${groupFieldLabel(label, "shipNames")}を変更（${parts.join("／")}）`;
      changes.push({ location: location("shipNames"), change: "modified", text, areaIds });
    }
    return changes;
  });
}

/** 段階 1 つの変更（追加・削除・項目・移動・特効グループ） */
function describeStage(
  before: DefinitionDoc,
  after: DefinitionDoc,
  b: Stage | undefined,
  a: Stage | undefined,
): DefinitionChange[] {
  const nameDocs = [before, after];
  if (b === undefined) {
    if (a === undefined) return [];
    const text = `${areaNameIn(nameDocs, a.areaId)} の段階を追加（${plainText(a.name)}）`;
    return [{ location: { kind: "stage", stageId: a.id, field: null }, change: "added", text, areaIds: [a.areaId] }];
  }
  if (a === undefined) {
    const text = `${areaNameIn(nameDocs, b.areaId)} の段階を削除（${plainText(b.name)}）`;
    return [{ location: { kind: "stage", stageId: b.id, field: null }, change: "deleted", text, areaIds: [b.areaId] }];
  }

  const label = stageLabelIn([before], b.id);
  const areaIds = unique([b.areaId, a.areaId]);
  const changes: DefinitionChange[] = [];
  for (const field of STAGE_FIELDS) {
    if (b[field] === a[field]) continue;
    const text =
      field === "areaId"
        ? `${label} を ${areaNameIn(nameDocs, a.areaId)} へ移動`
        : modifiedText(
            stageFieldLabel(label, field),
            stageValueText(field, b, [before, after]),
            stageValueText(field, a, [after, before]),
          );
    changes.push({ location: { kind: "stage", stageId: b.id, field }, change: "modified", text, areaIds });
  }
  return [...changes, ...describeGroups(b.id, label, areaIds, b.boosts, a.boosts)];
}

/** before から after への変更の一覧（変更がなければ空） */
export function describeChanges(before: DefinitionDoc, after: DefinitionDoc): DefinitionChange[] {
  const changes: DefinitionChange[] = [];
  const nameDocs = [before, after];

  // イベント
  for (const field of EVENT_FIELDS) {
    if (sameEventValue(field, before.event, after.event)) continue;
    const text = modifiedText(
      eventFieldLabel(field),
      eventValueText(field, before.event),
      eventValueText(field, after.event),
    );
    changes.push({ location: { kind: "event", field }, change: "modified", text, areaIds: [] });
  }

  // 海域（追加・外す）
  const beforeAreaIds = new Set(idsOf(before.areas));
  const afterAreaIds = new Set(idsOf(after.areas));
  for (const areaId of unionOrder(idsOf(before.areas), idsOf(after.areas))) {
    const name = areaNameIn(nameDocs, areaId);
    if (!beforeAreaIds.has(areaId)) {
      changes.push({ location: { kind: "area", areaId }, change: "added", text: `${name} を追加`, areaIds: [areaId] });
    } else if (!afterAreaIds.has(areaId)) {
      changes.push({ location: { kind: "area", areaId }, change: "deleted", text: `${name} を外す`, areaIds: [areaId] });
    }
  }

  // 札（追加・削除・項目）、札の並び順
  const beforeFudas = byId(before.fudas);
  const afterFudas = byId(after.fudas);
  for (const fudaId of unionOrder(idsOf(before.fudas), idsOf(after.fudas))) {
    const b = beforeFudas.get(fudaId);
    const a = afterFudas.get(fudaId);
    if (b === undefined) {
      if (a !== undefined) {
        const text = `札を追加（${plainText(a.name)}）`;
        changes.push({ location: { kind: "fuda", fudaId, field: null }, change: "added", text, areaIds: [] });
      }
    } else if (a === undefined) {
      const text = `札を削除（${plainText(b.name)}）`;
      changes.push({ location: { kind: "fuda", fudaId, field: null }, change: "deleted", text, areaIds: [] });
    } else {
      for (const field of FUDA_FIELDS) {
        if (b[field] === a[field]) continue;
        const text = modifiedText(
          fudaFieldLabel(fudaLabel(b.name), field),
          fudaValueText(field, b),
          fudaValueText(field, a),
        );
        changes.push({ location: { kind: "fuda", fudaId, field }, change: "modified", text, areaIds: [] });
      }
    }
  }
  if (orderChanged(idsOf(before.fudas), idsOf(after.fudas))) {
    changes.push({ location: { kind: "fudaOrder" }, change: "modified", text: "札の並び順を変更", areaIds: [] });
  }

  // 段階（海域ごと。各海域の最後にその海域の段階の並び順）
  const beforeStages = byId(before.stages);
  const afterStages = byId(after.stages);
  for (const { areaId, stageIds } of stageReportOrder(before, after)) {
    for (const stageId of stageIds) {
      changes.push(...describeStage(before, after, beforeStages.get(stageId), afterStages.get(stageId)));
    }
    if (orderChanged(stageIdsInArea(before, areaId), stageIdsInArea(after, areaId))) {
      const text = `${stageOrderLabel(areaNameIn(nameDocs, areaId))}を変更`;
      changes.push({ location: { kind: "stageOrder", areaId }, change: "modified", text, areaIds: [areaId] });
    }
  }

  return changes;
}

/**
 * 1 回の保存の記録の内容。
 * - text：変更が 1 件ならその文、2 件以上なら「（最初の変更の文） ほか n 件」（n は残りの件数）、なければ「変更なし」
 * - areaIds：変更のあった海域の ID（重複なし。after の海域の順、after にない海域は before の順で後ろ）
 */
export function summarizeSave(before: DefinitionDoc, after: DefinitionDoc): SaveSummary {
  const changes = describeChanges(before, after);
  const first = changes[0];
  let text = "変更なし";
  if (first !== undefined) {
    text = changes.length === 1 ? first.text : `${first.text} ほか ${changes.length - 1} 件`;
  }
  const touched = new Set(changes.flatMap((c) => c.areaIds));
  const areaOrder = unique([...idsOf(after.areas), ...idsOf(before.areas), ...touched]);
  return { text, areaIds: areaOrder.filter((id) => touched.has(id)), changes };
}
