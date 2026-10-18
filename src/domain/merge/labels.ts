// 3 方向マージ（merge.ts）と保存の記録の文（changes.ts）で共通に使う、表示名と値の表示（内部の補助）
//
// 表示名の形（merge.ts 冒頭の決まり）
// - 段階：「E2 ゲージ3」（海域名 ＋ 半角空白 ＋ 段階名）。段階の項目：「E2 ゲージ3 の大事さ」
// - 特効グループ：「E2 ゲージ3 の特効「連合艦隊C」」（名前が空なら「E2 ゲージ3 の特効（名前なし）」）。項目：「…の倍率」
// - 札：「札「連合艦隊」」。項目：「札「連合艦隊」の名前」
// 値の表示
// - 大事さ：普通／重要／難所。倍率：「×1.27」（小数第 2 位まで）。札番号：数字（未入力は「未入力」）
// - 日時：「2026/10/20 11:00」（日本時間。未定は「未定」）。版の日付：「2026/08/04」。空の名前：「未入力」
import { stageLabel } from "@/domain/boost/boost";
import type { EventInfo } from "@/domain/definition/types";
import { formatDateTimeJst, sameDateTime } from "@/domain/definition-edit/datetime";
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import type { BoostGroupField, EventField, FudaField, StageField } from "./types";

/** イベントの情報の項目（比べる順・並べる順） */
export const EVENT_FIELDS: readonly EventField[] = ["name", "startAt", "endAt", "versionDate"];
/** 札の項目（比べる順） */
export const FUDA_FIELDS: readonly FudaField[] = ["name", "color", "gameNumber"];
/** 段階の項目（比べる順） */
export const STAGE_FIELDS: readonly StageField[] = ["name", "fudaId", "importance", "areaId"];

const EVENT_FIELD_NAMES: Readonly<Record<EventField, string>> = {
  name: "イベント名",
  startAt: "開始日時",
  endAt: "終了日時",
  versionDate: "版の日付",
};
const STAGE_FIELD_NAMES: Readonly<Record<StageField, string>> = {
  name: "段階名",
  fudaId: "札",
  importance: "大事さ",
  areaId: "海域",
};
const FUDA_FIELD_NAMES: Readonly<Record<FudaField, string>> = { name: "名前", color: "色", gameNumber: "札番号" };
const GROUP_FIELD_NAMES: Readonly<Record<BoostGroupField, string>> = {
  name: "名前",
  multiplier: "倍率",
  shipNames: "艦名",
  nationalities: "国籍",
  shipTypes: "艦種",
};

/** 札の並び順の表示名 */
export const FUDA_ORDER_LABEL = "札の並び順";

// ---- 表示名 ----

/** イベントの項目の表示名（「イベント名」「終了日時」など） */
export function eventFieldLabel(field: EventField): string {
  return EVENT_FIELD_NAMES[field];
}

/** 段階の表示名「E2 ゲージ3」。docs のうち、その段階がある最初の文書の名前を使う（なければ ID） */
export function stageLabelIn(docs: readonly DefinitionDoc[], stageId: string): string {
  const doc = docs.find((d) => d.stages.some((s) => s.id === stageId));
  return doc === undefined ? stageId : stageLabel(doc, stageId);
}

/** 段階の項目の表示名「E2 ゲージ3 の大事さ」 */
export function stageFieldLabel(stageLabelText: string, field: StageField): string {
  return `${stageLabelText} の${STAGE_FIELD_NAMES[field]}`;
}

/** 海域の段階の並び順の表示名「E2 の段階の並び順」 */
export function stageOrderLabel(areaName: string): string {
  return `${areaName} の段階の並び順`;
}

/** 特効グループの表示名「E2 ゲージ3 の特効「連合艦隊C」」（名前が空なら「E2 ゲージ3 の特効（名前なし）」） */
export function groupLabel(stageLabelText: string, groupName: string): string {
  return groupName === "" ? `${stageLabelText} の特効（名前なし）` : `${stageLabelText} の特効「${groupName}」`;
}

/** 特効グループの項目の表示名「E2 ゲージ3 の特効「連合艦隊C」の倍率」 */
export function groupFieldLabel(groupLabelText: string, field: BoostGroupField): string {
  return `${groupLabelText}の${GROUP_FIELD_NAMES[field]}`;
}

/** 札の表示名「札「連合艦隊」」 */
export function fudaLabel(fudaName: string): string {
  return `札「${fudaName}」`;
}

/** 札の項目の表示名「札「連合艦隊」の名前」 */
export function fudaFieldLabel(fudaLabelText: string, field: FudaField): string {
  return `${fudaLabelText}の${FUDA_FIELD_NAMES[field]}`;
}

// ---- 名前を引く ----

/** 海域名。docs のうち、その海域がある最初の文書の名前（なければ ID） */
export function areaNameIn(docs: readonly DefinitionDoc[], areaId: string): string {
  for (const doc of docs) {
    const area = doc.areas.find((a) => a.id === areaId);
    if (area !== undefined) return area.name;
  }
  return areaId;
}

/** 札名。docs のうち、その札がある最初の文書の名前（なければ ID） */
export function fudaNameIn(docs: readonly DefinitionDoc[], fudaId: string): string {
  for (const doc of docs) {
    const fuda = doc.fudas.find((f) => f.id === fudaId);
    if (fuda !== undefined) return fuda.name;
  }
  return fudaId;
}

/** 段階名。docs のうち、その段階がある最初の文書の名前（なければ ID） */
export function stageNameIn(docs: readonly DefinitionDoc[], stageId: string): string {
  for (const doc of docs) {
    const stage = doc.stages.find((s) => s.id === stageId);
    if (stage !== undefined) return stage.name;
  }
  return stageId;
}

// ---- 値の表示 ----

/** 名前などの文字列の表示（空・空白だけなら「未入力」） */
export function plainText(value: string): string {
  return value.trim() === "" ? "未入力" : value;
}

/** 特効グループの名前の表示（空なら「名前なし」。グループ名は空でもよいため） */
export function groupNameText(name: string): string {
  return name === "" ? "名前なし" : name;
}

/** 倍率の表示「×1.27」（小数第 2 位まで） */
export function multiplierText(multiplier: number): string {
  return `×${multiplier.toFixed(2)}`;
}

/** 札番号の表示（未入力は「未入力」） */
export function gameNumberText(gameNumber: number | null): string {
  return gameNumber === null ? "未入力" : String(gameNumber);
}

/** 並び順の表示（名前を「 → 」でつなぐ） */
export function orderText(names: readonly string[]): string {
  return names.join(" → ");
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** イベントの項目の値の表示 */
export function eventValueText(field: EventField, event: EventInfo): string {
  switch (field) {
    case "name":
      return plainText(event.name);
    case "startAt":
      return event.startAt === "" ? "未入力" : formatDateTimeJst(event.startAt);
    case "endAt":
      return event.endAt === null || event.endAt === "" ? "未定" : formatDateTimeJst(event.endAt);
    case "versionDate": {
      const match = DATE_PATTERN.exec(event.versionDate);
      if (match === null) return plainText(event.versionDate);
      return `${match[1]}/${match[2]}/${match[3]}`;
    }
  }
}

/**
 * イベントの項目の値が同じか。日時は時刻で比べる（書き方の違いだけなら同じ）。
 * 終了日時の null と空文字は、どちらも未定として同じに扱う
 */
export function sameEventValue(field: EventField, a: EventInfo, b: EventInfo): boolean {
  switch (field) {
    case "name":
    case "versionDate":
      return a[field] === b[field];
    case "startAt":
      return sameDateTime(a.startAt, b.startAt);
    case "endAt": {
      const aEnd = a.endAt ?? "";
      const bEnd = b.endAt ?? "";
      if (aEnd === "" || bEnd === "") return aEnd === bEnd;
      return sameDateTime(aEnd, bEnd);
    }
  }
}
