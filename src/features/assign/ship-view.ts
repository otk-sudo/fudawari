// 割り振り画面（roadmap T2-7、要件 3.3）の表示に使う値を作る純粋な関数
//
// 艦種の略称、倍率・版の日付の書き方、札の列の「使う段階」、艦カード・パネルに並べる段階の倍率、
// 札の色の上に置く文字の色、個体の今の札などを、定義・マスタ・割り当てから組み立てる。画面・保存に依存しない。
import { nationalityBoostGroups, shipBoostSummary, stageLabel } from "@/domain/boost";
import type { BoostTarget, FudaBoost } from "@/domain/boost/types";
import type { BoostGroup, Fuda, PublicDefinition } from "@/domain/definition/types";
import { lookupShip } from "@/domain/master";
import type { ShipLookup, ShipMaster } from "@/domain/master/types";
import { nationalityLabel } from "@/domain/nationality";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import { shipTypeOptionLabelsOf } from "@/domain/ship-type";
import type { TrayEntry } from "./tray";

// ---- 艦 ----

/**
 * 艦種の番号（start2 の api_mst_stype）→ 画面に出す略称（モック Assign.dc.html の艦種の書き方）。
 * 12（超弩級戦艦。今は使われていない）は戦艦、15・22 はどちらも補給艦
 */
const SHIP_TYPE_LABELS: ReadonlyMap<number, string> = new Map([
  [1, "海防"],
  [2, "駆逐"],
  [3, "軽巡"],
  [4, "雷巡"],
  [5, "重巡"],
  [6, "航巡"],
  [7, "軽空"],
  [8, "戦艦"],
  [9, "戦艦"],
  [10, "航戦"],
  [11, "正空"],
  [12, "戦艦"],
  [13, "潜水"],
  [14, "潜空"],
  [15, "補給"],
  [16, "水母"],
  [17, "揚陸"],
  [18, "装空"],
  [19, "工作"],
  [20, "潜母"],
  [21, "練巡"],
  [22, "補給"],
]);

/** 艦種が分からない（マスタにない艦、対応表にない艦種の番号）ときの文字 */
const UNKNOWN_SHIP_TYPE_LABEL = "艦種不明";

/** 艦カード・パネルに出す艦種の略称（例「駆逐」「正空」） */
export function shipTypeLabel(info: ShipLookup): string {
  if (!info.known) return UNKNOWN_SHIP_TYPE_LABEL;
  return SHIP_TYPE_LABELS.get(info.shipTypeId) ?? UNKNOWN_SHIP_TYPE_LABEL;
}

/** 画面に出す艦の情報（控えの組み立て〔buildTray〕の TrayEntry と同じ形：個体・マスタで引いた情報・特効のまとめ） */
export function shipEntryOf(definition: PublicDefinition, master: ShipMaster, ship: OwnedShip): TrayEntry {
  const info = lookupShip(master, ship.shipId);
  return { ship, info, boost: shipBoostSummary(definition, info.known ? info : null) };
}

/** 艦が札で特効を持つか（倍率が 1 より大きい段階がある） */
export function hasBoostIn(entry: TrayEntry, fudaId: string): boolean {
  return entry.boost.effective.some((boost) => boost.fudaId === fudaId);
}

/** 艦のその札での特効（効かなければ undefined） */
export function boostIn(entry: TrayEntry, fudaId: string): FudaBoost | undefined {
  return entry.boost.effective.find((boost) => boost.fudaId === fudaId);
}

// ---- 割り当て ----

/** 個体の今の札の ID。控え（割り当てがない、または定義にない札に割り当てている。U17）なら null */
export function placedFudaOf(assignments: AssignmentMap, uid: ShipUid, fudaIds: ReadonlySet<string>): string | null {
  // 自分自身のキーだけを見る（Object.prototype の項目を拾わない）
  const fudaId = Object.hasOwn(assignments, uid) ? assignments[uid] : undefined;
  return fudaId !== undefined && fudaIds.has(fudaId) ? fudaId : null;
}

/** 札ごとの艦（札 ID → その札に置いた個体。個体の並びは取り込んだ順）。定義の札はすべてキーに持つ（艦がいなければ空） */
export function shipsByFuda(
  definition: PublicDefinition,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): ReadonlyMap<string, readonly OwnedShip[]> {
  const byFuda = new Map<string, OwnedShip[]>(definition.fudas.map((fuda) => [fuda.id, []]));
  const fudaIds = new Set(byFuda.keys());
  for (const ship of ships) {
    const fudaId = placedFudaOf(assignments, ship.uid, fudaIds);
    if (fudaId !== null) byFuda.get(fudaId)?.push(ship);
  }
  return byFuda;
}

// ---- 定義 ----

/** 札 ID → 札 */
export function fudaMapOf(definition: PublicDefinition): ReadonlyMap<string, Fuda> {
  return new Map(definition.fudas.map((fuda) => [fuda.id, fuda]));
}

/**
 * 札を使う段階の表示名（例「E2 ゲージ2」「E2 ゲージ3」）。定義の海域の順、海域の中は段階の配列の順
 * （特効の計算〔@/domain/boost〕の段階の順と同じ）
 */
export function fudaStageLabels(definition: PublicDefinition, fudaId: string): string[] {
  const areaOrder = new Map<string, number>();
  definition.areas.forEach((area, order) => {
    if (!areaOrder.has(area.id)) areaOrder.set(area.id, order);
  });
  const areaRank = (areaId: string): number => areaOrder.get(areaId) ?? definition.areas.length;
  return definition.stages
    .filter((stage) => stage.fudaId === fudaId)
    .sort((a, b) => areaRank(a.areaId) - areaRank(b.areaId))
    .map((stage) => stageLabel(definition, stage.id));
}

/** 艦カード・パネルに並べる段階の倍率 1 行分 */
export interface BoostLine {
  /** 行のキー（札 ID と段階 ID） */
  readonly key: string;
  /** その段階の札の色（"#RRGGBB"。行の頭の ■） */
  readonly color: string;
  /** 段階の表示名（例「E2 ゲージ3」） */
  readonly label: string;
  /** 倍率 */
  readonly multiplier: number;
  /**
   * 国籍（・艦種）の条件で効いたグループの内訳（例「米駆逐（アメリカ・駆逐）」。v1.1）。
   * 艦名の条件だけで効く行、照合の対象がない行は null（今の表示のまま）
   */
  readonly note: string | null;
}

/** 倍率が同じとみなす差（浮動小数の誤差を吸収する） */
const SAME_MULTIPLIER_EPSILON = 1e-9;

/** グループの条件の文（国籍の表示名、続けて艦種の表示名〔選択肢の順〕を「・」でつなぐ。例「アメリカ・駆逐」） */
function groupConditionText(group: BoostGroup): string {
  const nationalities = (group.nationalities ?? []).map(nationalityLabel);
  return [...nationalities, ...shipTypeOptionLabelsOf(group.shipTypes ?? [])].join("・");
}

/**
 * 段階の行の内訳の文。グループごとに「{グループ名}（{条件}）」を「、」でつなぐ（名前が空なら条件だけ）。
 * 行の倍率とグループの倍率が違う（ほかのグループと掛け合わせている）ときだけ、グループ名の後に倍率を付ける
 * （名前が空なら条件の後に「アメリカ ×1.10」）。
 * 倍率が 1 以下のグループは効いていないので出さない。出すものがなければ null
 */
function boostNote(groups: readonly BoostGroup[], lineMultiplier: number): string | null {
  const parts = groups
    .filter((group) => group.multiplier > 1)
    .map((group) => {
      const condition = groupConditionText(group);
      const multiplier =
        Math.abs(group.multiplier - lineMultiplier) > SAME_MULTIPLIER_EPSILON ? formatMultiplier(group.multiplier) : null;
      // 名前が空なら条件を名前の代わりにする（倍率を付けるときは「アメリカ ×1.10」）
      if (group.name === "") return multiplier === null ? condition : `${condition} ${multiplier}`;
      const head = multiplier === null ? group.name : `${group.name} ${multiplier}`;
      return `${head}（${condition}）`;
    });
  return parts.length > 0 ? parts.join("、") : null;
}

/**
 * 札ごとの特効から、効く段階の倍率の行を作る（渡した札の順、札の中は段階の順）。
 * target（照合の対象。マスタで引いた艦）を渡すと、国籍（・艦種）の条件で効いたグループの内訳を note に入れる（v1.1）。
 * 省略・null なら note はすべて null
 */
export function boostLines(
  definition: PublicDefinition,
  fudas: ReadonlyMap<string, Fuda>,
  boosts: readonly FudaBoost[],
  target: BoostTarget | null = null,
): BoostLine[] {
  // 内訳を作るときだけ段階を引く表を作る（照合の対象がなければ要らない）
  const stageById = target === null ? null : new Map(definition.stages.map((stage) => [stage.id, stage]));
  return boosts.flatMap((boost) =>
    boost.stages.map((stage) => {
      const defStage = stageById?.get(stage.stageId);
      return {
        key: `${boost.fudaId}:${stage.stageId}`,
        color: fudas.get(boost.fudaId)?.color ?? "",
        label: stageLabel(definition, stage.stageId),
        multiplier: stage.multiplier,
        note:
          defStage === undefined ? null : boostNote(nationalityBoostGroups(defStage, target), stage.multiplier),
      };
    }),
  );
}

// ---- 書き方 ----

/** 倍率の書き方（例「×1.24」。小数第 2 位まで） */
export function formatMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(2)}`;
}

/** 特効データの版の日付の書き方（"2026-08-04" → "2026/08/04"） */
export function formatVersionDate(versionDate: string): string {
  return versionDate.replaceAll("-", "/");
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

/** 暗い文字の色（モックの札の見出しの暗い文字 #101114）の相対輝度 */
const DARK_INK_LUMINANCE = relativeLuminance("#101114") ?? 0;

/**
 * 札の色の上に置く文字の色：暗い文字（"dark"。#101114）か白い文字（"light"）か。
 * 定義には札の色しかないため、コントラスト比の高い方を選ぶ（モックの札ごとの文字の色は、明るさだけでは決まっていないため再現しない）。
 * 色の形が "#RRGGBB" でなければ暗い文字
 */
export function inkOn(color: string): "dark" | "light" {
  const luminance = relativeLuminance(color);
  if (luminance === null) return "dark";
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithDark = (luminance + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return contrastWithDark >= contrastWithWhite ? "dark" : "light";
}
