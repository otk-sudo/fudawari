// 公開の前の確認に出す警告（UI／UX の指摘 中8、PR #44 のレビュー）
//
// 公開は止めずに、確認のウィンドウで知らせるだけの点を文書全体（選んでいない段階を含む）から集める。
// - 空の特効グループ（名前なし・倍率 1・艦名なし・国籍なし）→ empty_boost_groups（段階ごとに 1 件。段階の並び順）
//   空のグループは保存のときに除かない（消すのは利用者）。国籍だけのグループ（例「米艦 ×1.2」）は空にしない
// - 効く艦がない特効グループ（名前か倍率はあるが、艦名も国籍もない）→ no_target_boost_groups（段階ごとに 1 件）。
//   定義画面の要約の「効く艦がまだありません」と同じ状態
// - ゲーム内の札番号が未入力の札 → missing_game_number（札ごとに 1 件。札の並び順）。札番号がないと差分の対象外になる
// - 艦船マスタにない艦名 → unknown_ship_names（まとめて 1 件。出てきた順・重複なし）。
//   艦船マスタの艦名を渡さない（マスタを読めない）ときは見ない
// 警告の並びは 空のグループ → 効く艦がないグループ → 札 → 艦名。警告がなければ空の配列。文書は書き換えない。
// 同じ表示名の段階・同じ名前の札があるときは、位置を添えて見分けられる文にする（「E2 の 3 番目の段階「新しい段階」」）。
import type { BoostGroup, Stage } from "@/domain/definition/types";
import { stageLabelIn } from "@/domain/merge/labels";
import type { DefinitionDoc } from "./types";

/** 公開の前の警告の種類 */
export type PublishWarningCode =
  | "empty_boost_groups"
  | "no_target_boost_groups"
  | "missing_game_number"
  | "unknown_ship_names";

/** 公開の前の警告 */
export interface PublishWarning {
  /** 警告の ID（一覧の中で重複しない。画面の key に使う） */
  readonly id: string;
  readonly code: PublishWarningCode;
  /** 画面に出す文 */
  readonly message: string;
}

/** 空の特効グループか（名前なし・倍率 1・艦名なし・国籍なし） */
export function isEmptyBoostGroup(group: BoostGroup): boolean {
  return group.name.trim() === "" && group.multiplier === 1 && !hasTarget(group);
}

/** 効く艦の条件（艦名か国籍）があるか */
function hasTarget(group: BoostGroup): boolean {
  return group.shipNames.length > 0 || (group.nationalities ?? []).length > 0;
}

/** 効く艦がない特効グループか（空ではないが、艦名も国籍もない） */
function isNoTargetBoostGroup(group: BoostGroup): boolean {
  return !hasTarget(group) && !isEmptyBoostGroup(group);
}

/** 警告の文に入れる段階の呼び方（「「E3 ギミック」」。同じ表示名の段階があれば「E2 の 3 番目の段階「新しい段階」」） */
function stagePhrase(doc: DefinitionDoc, stage: Stage): string {
  const label = stageLabelIn([doc], stage.id);
  const sameLabel = doc.stages.filter((s) => stageLabelIn([doc], s.id) === label);
  if (sameLabel.length < 2) return `「${label}」`;
  const inArea = doc.stages.filter((s) => s.areaId === stage.areaId);
  const areaName = doc.areas.find((a) => a.id === stage.areaId)?.name ?? "";
  return `${areaName} の ${inArea.indexOf(stage) + 1} 番目の段階「${stage.name}」`.trim();
}

/** 段階ごとに、条件に合う特効グループの警告を作る */
function groupWarnings(
  doc: DefinitionDoc,
  code: "empty_boost_groups" | "no_target_boost_groups",
  matches: (group: BoostGroup) => boolean,
  describe: (stage: string, amount: string) => string,
): PublishWarning[] {
  return doc.stages.flatMap((stage): PublishWarning[] => {
    const count = stage.boosts.filter(matches).length;
    if (count === 0) return [];
    const amount = count === 1 ? "が" : `が ${count} つ`;
    return [{ id: `${code}:${stage.id}`, code, message: describe(stagePhrase(doc, stage), amount) }];
  });
}

/** ゲーム内の札番号が未入力の札（札ごとに 1 件。同じ名前の札があれば札の並びの位置を添える） */
function missingGameNumberWarnings(doc: DefinitionDoc): PublishWarning[] {
  return doc.fudas.flatMap((fuda, index): PublishWarning[] => {
    if (fuda.gameNumber !== null) return [];
    const duplicated = doc.fudas.filter((f) => f.name === fuda.name).length > 1;
    const phrase = duplicated ? `${index + 1} 番目の札「${fuda.name}」` : `「${fuda.name}」`;
    return [
      {
        id: `missing_game_number:${fuda.id}`,
        code: "missing_game_number",
        message: `${phrase}のゲーム内の札番号が未入力です。この札は計画との差分の対象外になります`,
      },
    ];
  });
}

/** 艦船マスタにない艦名（まとめて 1 件） */
function unknownShipWarnings(doc: DefinitionDoc, knownShipNames: ReadonlySet<string>): PublishWarning[] {
  const unknown = new Set<string>();
  for (const stage of doc.stages) {
    for (const group of stage.boosts) {
      for (const name of group.shipNames) {
        if (!knownShipNames.has(name)) unknown.add(name);
      }
    }
  }
  if (unknown.size === 0) return [];
  return [
    {
      id: "unknown_ship_names",
      code: "unknown_ship_names",
      message: `艦船マスタにない艦名：${[...unknown].join("、")}（書き間違いがないか確かめてください）`,
    },
  ];
}

/**
 * 公開の前の確認に出す警告の一覧を返す（警告がなければ空の配列）。
 * knownShipNames は艦船マスタにある改装段階を問わない艦名（渡さなければ艦名は見ない）
 */
export function findPublishWarnings(doc: DefinitionDoc, knownShipNames?: ReadonlySet<string>): PublishWarning[] {
  return [
    ...groupWarnings(
      doc,
      "empty_boost_groups",
      isEmptyBoostGroup,
      (stage, amount) =>
        `${stage}に空の特効グループ${amount}あります（名前・艦名・国籍が未入力で倍率 ×1）。不要なら消してください`,
    ),
    ...groupWarnings(
      doc,
      "no_target_boost_groups",
      isNoTargetBoostGroup,
      (stage, amount) =>
        `${stage}に効く艦がない特効グループ${amount}あります（艦名も国籍も未入力のため、どの艦にも効きません）`,
    ),
    ...missingGameNumberWarnings(doc),
    ...(knownShipNames === undefined ? [] : unknownShipWarnings(doc, knownShipNames)),
  ];
}
