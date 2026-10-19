// 公開の前の確認に出す警告（UI／UX の指摘 中8）
//
// 公開は止めずに、確認のウィンドウで知らせるだけの点を文書全体（選んでいない段階を含む）から集める。
// - 空の特効グループ（名前なし・倍率 1・艦名なし・国籍なし）→ empty_boost_groups（段階ごとに 1 件。段階の並び順）
//   空のグループは保存のときに除かない（消すのは利用者）。国籍だけのグループ（例「米艦 ×1.2」）は空にしない
// - ゲーム内の札番号が未入力の札 → missing_game_number（札ごとに 1 件。札の並び順）。札番号がないと差分の対象外になる
// - 艦船マスタにない艦名 → unknown_ship_names（まとめて 1 件。出てきた順・重複なし）。
//   艦船マスタの艦名を渡さない（マスタを読めない）ときは見ない
// 警告の並びは 特効グループ → 札 → 艦名。警告がなければ空の配列。文書は書き換えない。
import type { BoostGroup, Stage } from "@/domain/definition/types";
import type { DefinitionDoc } from "./types";

/** 公開の前の警告の種類 */
export type PublishWarningCode = "empty_boost_groups" | "missing_game_number" | "unknown_ship_names";

/** 公開の前の警告 */
export interface PublishWarning {
  readonly code: PublishWarningCode;
  /** 画面に出す文 */
  readonly message: string;
}

/** 空の特効グループか（名前なし・倍率 1・艦名なし・国籍なし） */
export function isEmptyBoostGroup(group: BoostGroup): boolean {
  return (
    group.name.trim() === "" &&
    group.multiplier === 1 &&
    group.shipNames.length === 0 &&
    (group.nationalities ?? []).length === 0
  );
}

/** 段階の表示名（「E3 ギミック」。海域が見つからなければ段階名だけ） */
function stageLabelOf(doc: DefinitionDoc, stage: Stage): string {
  const area = doc.areas.find((a) => a.id === stage.areaId);
  return `${area?.name ?? ""} ${stage.name}`.trim();
}

/** 空の特効グループ（段階ごとに 1 件） */
function emptyGroupWarnings(doc: DefinitionDoc): PublishWarning[] {
  return doc.stages.flatMap((stage): PublishWarning[] => {
    const count = stage.boosts.filter(isEmptyBoostGroup).length;
    if (count === 0) return [];
    const amount = count === 1 ? "" : `が ${count} つ`;
    return [
      {
        code: "empty_boost_groups",
        message: `「${stageLabelOf(doc, stage)}」に空の特効グループ${amount}あります（名前・艦名・国籍が未入力で倍率 ×1）。不要なら消してください`,
      },
    ];
  });
}

/** ゲーム内の札番号が未入力の札（札ごとに 1 件） */
function missingGameNumberWarnings(doc: DefinitionDoc): PublishWarning[] {
  return doc.fudas
    .filter((fuda) => fuda.gameNumber === null)
    .map((fuda): PublishWarning => ({
      code: "missing_game_number",
      message: `「${fuda.name}」のゲーム内の札番号が未入力です。この札は計画との差分の対象外になります`,
    }));
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
    ...emptyGroupWarnings(doc),
    ...missingGameNumberWarnings(doc),
    ...(knownShipNames === undefined ? [] : unknownShipWarnings(doc, knownShipNames)),
  ];
}
