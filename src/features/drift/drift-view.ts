// 差分の画面（roadmap T2-11、要件 3.5、モック Drift.dc.html）の表示に使う値を作る純粋な関数
//
// 対応が必要な 1 件の表示（艦名・Lv・計画の札・実際の札・説明文）、札の色の上に置く文字の色、日時・倍率の書き方を、
// 差分の判定（@/domain/drift）・定義・艦船マスタから組み立てる。画面・保存に依存しない。
// 代わりの艦の提案は作らない（U23）。説明文の特効は「段階の表示名 ×倍率」（stageLabel。例「E2 ゲージ3 ×1.24」）。
import { fudaBoost, stageLabel } from "@/domain/boost";
import type { Fuda, PublicDefinition } from "@/domain/definition/types";
import type { DriftEntry, FudaProgress } from "@/domain/drift";
import { baseNameOf, lookupShip } from "@/domain/master";
import type { ShipMaster } from "@/domain/master/types";
import type { OwnedShip } from "@/domain/ship/types";

/** 計画にない艦（控え）の、計画の札の表示 */
export const UNPLANNED_FUDA_LABEL = "札なし（計画外）";

/** 札の表示（札名と札の色）。色が null の札は定義の札ではない（札なし・定義にない札番号） */
export interface FudaChip {
  /** 札名（例「連合艦隊」「札なし（計画外）」「定義にない札（番号 9）」） */
  readonly label: string;
  /** 札の色（"#RRGGBB"）。定義の札でなければ null */
  readonly color: string | null;
}

/** 対応が必要な 1 件の表示 */
export interface IssueView {
  /** 差分の 1 件（反映に使う） */
  readonly entry: DriftEntry;
  /** 艦名（艦船マスタにない艦は「名前が分からない艦」） */
  readonly shipName: string;
  /** Lv（同名艦を見分けるため）。取り込んだ艦にいなければ null */
  readonly level: number | null;
  /** 計画の札（取り消し線で出す） */
  readonly planned: FudaChip;
  /** 実際の札 */
  readonly actual: FudaChip;
  /** 説明文 */
  readonly description: string;
}

/** 札ごとの進み具合の 1 つの表示 */
export interface ProgressView {
  /** 札 ID */
  readonly fudaId: string;
  /** 札名 */
  readonly name: string;
  /** 札の色（"#RRGGBB"） */
  readonly color: string;
  /** 計画の隻数 */
  readonly planned: number;
  /** 札付きの隻数。札番号が未入力の札は比べられないので null（U10） */
  readonly tagged: number | null;
}

// ---- 書き方 ----

/** 2 桁にそろえる */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 取り込んだ日時（ISO 8601）を「10/15 20:40」の形にする（利用者の端末の時刻帯で出す）。
 * 日時として読めなければ null
 */
export function formatImportedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 倍率の書き方（例「×1.24」。小数第 2 位まで） */
export function formatMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(2)}`;
}

/** "#RRGGBB" の相対輝度（WCAG の定義。0〜1）。形が違えば null */
function relativeLuminance(color: string): number | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (match === null) return null;
  const [r, g, b] = match.slice(1).map((hex) => {
    const channel = Number.parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 暗い文字の色（モックの札の上の暗い文字 #101114）の相対輝度 */
const DARK_INK_LUMINANCE = relativeLuminance("#101114") ?? 0;

/**
 * 札の色の上に置く文字の色：暗い文字（"dark"。#101114）か白い文字（"light"）か。
 * 定義には札の色しかないため、コントラスト比の高い方を選ぶ（割り振り画面の札の見出しと同じ決め方）。
 * 色の形が "#RRGGBB" でなければ暗い文字
 */
export function inkOn(color: string): "dark" | "light" {
  const luminance = relativeLuminance(color);
  if (luminance === null) return "dark";
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithDark = (luminance + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return contrastWithDark >= contrastWithWhite ? "dark" : "light";
}

// ---- 札・特効 ----

/** 定義のどの札番号にも当たらない札の表示（例「定義にない札（番号 9）」） */
function unknownFudaLabel(gameNumber: number): string {
  return `定義にない札（番号 ${gameNumber}）`;
}

/** 札 ID → 札（ID が重複していたら定義の順で先の札） */
export function fudaMapOf(definition: PublicDefinition): ReadonlyMap<string, Fuda> {
  const byId = new Map<string, Fuda>();
  for (const fuda of definition.fudas) {
    if (!byId.has(fuda.id)) byId.set(fuda.id, fuda);
  }
  return byId;
}

/**
 * 艦のその札での特効を「段階の表示名 ×倍率」で並べた文（例「E2 ゲージ2 ×1.19・E2 ゲージ3 ×1.24」）。
 * 段階の順は特効の計算（@/domain/boost）と同じ。特効がなければ（マスタにない艦を含む）null
 */
export function boostText(definition: PublicDefinition, fudaId: string, baseName: string | null): string | null {
  const boost = fudaBoost(definition, fudaId, baseName);
  if (!boost.hasBoost) return null;
  return boost.stages
    .map((stage) => `${stageLabel(definition, stage.stageId)} ${formatMultiplier(stage.multiplier)}`)
    .join("・");
}

/**
 * 説明文。
 * - 計画と違う札が付いた：実際の札で出撃したため、計画の札の枠が空いたこと。計画の札で特効があれば、その倍率を添える。
 *   実際の札が定義にない札番号なら、反映すると控えに戻ることを書く
 * - 計画にない艦に札が付いた：計画になかった艦に札が付いたこと。実際の札で特効があれば、その倍率を添える
 */
function describeIssue(
  definition: PublicDefinition,
  entry: DriftEntry,
  baseName: string | null,
  planned: Fuda | undefined,
  actual: Fuda | undefined,
): string {
  if (entry.kind === "unplanned") {
    const actualName = actual?.name ?? unknownFudaLabel(entry.actualGameNumber);
    const boost = actual === undefined ? null : boostText(definition, actual.id, baseName);
    const boostNote = boost === null ? "" : `この艦は${actualName}で特効があります（${boost}）。`;
    return `計画になかった艦に${actualName}の札が付きました。${boostNote}`;
  }
  const plannedName = planned?.name ?? UNPLANNED_FUDA_LABEL;
  const boost = planned === undefined ? null : boostText(definition, planned.id, baseName);
  const loss = boost === null ? `${plannedName}の枠が1つ空きました` : `${plannedName}の特効艦が1隻減りました（${boost}）`;
  if (actual === undefined) {
    return `${unknownFudaLabel(entry.actualGameNumber)}が付いたため、${loss}。計画を実際に合わせると、この艦は控えに戻ります。`;
  }
  return `${actual.name}で出撃したため、${loss}。`;
}

/** 札 ID の札の表示（札 ID がない・定義にない札なら fallback の文字） */
function chipOf(fudas: ReadonlyMap<string, Fuda>, fudaId: string | null, fallback: string): FudaChip {
  const fuda = fudaId === null ? undefined : fudas.get(fudaId);
  return fuda === undefined ? { label: fallback, color: null } : { label: fuda.name, color: fuda.color };
}

/** 札ごとの進み具合の表示を作る（進み具合の順＝定義の札の順。定義にない札 ID の分は出さない） */
export function progressViewsOf(fudas: ReadonlyMap<string, Fuda>, progress: readonly FudaProgress[]): ProgressView[] {
  return progress.flatMap((item) => {
    const fuda = fudas.get(item.fudaId);
    if (fuda === undefined) return [];
    return [{ fudaId: fuda.id, name: fuda.name, color: fuda.color, planned: item.planned, tagged: item.tagged }];
  });
}

/** 対応が必要な 1 件の表示を作る。ship は取り込んだ艦のうち、その個体（Lv を出すため。いなければ undefined） */
export function issueViewOf(
  definition: PublicDefinition,
  master: ShipMaster,
  fudas: ReadonlyMap<string, Fuda>,
  entry: DriftEntry,
  ship: OwnedShip | undefined,
): IssueView {
  const planned = entry.plannedFudaId === null ? undefined : fudas.get(entry.plannedFudaId);
  const actual = entry.actualFudaId === null ? undefined : fudas.get(entry.actualFudaId);
  return {
    entry,
    shipName: lookupShip(master, entry.shipId).name,
    level: ship?.level ?? null,
    planned: chipOf(fudas, entry.plannedFudaId, UNPLANNED_FUDA_LABEL),
    actual: chipOf(fudas, entry.actualFudaId, unknownFudaLabel(entry.actualGameNumber)),
    description: describeIssue(definition, entry, baseNameOf(master, entry.shipId), planned, actual),
  };
}
