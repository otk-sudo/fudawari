// 一覧（roadmap T2-9、要件 3.2）と画像で保存の画像（T2-10、要件 3.9）に出す値を作る純粋な関数
//
// 攻略の流れ（海域ごとの段階と「特効 n 隻」）、札ごとの艦（Lv の高い順・その札での特効）、艦種のまとまり、
// 札の色の上の文字の色、倍率・日時の書き方を、定義・マスタ・割り当てから組み立てる。画面・保存に依存しない。
//
// 割り振り画面（PR-05、src/features/assign/ship-view.ts）にも同じ役目の関数（艦種の略称・inkOn など）がある。
// どちらも取り込んだ後で、共通の場所にまとめてよい。
import { countBoostedShipsByStage, fudaBoost, stageLabel } from "@/domain/boost";
import type { Area, Fuda, PublicDefinition, Stage } from "@/domain/definition";
import { lookupShip, type ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";

// ---- 艦種 ----

/**
 * 艦種の略称（割り振り画面と同じ書き方）と、まとまりの順（配列の順）。
 * 艦種の番号は start2 の api_mst_stype。12（超弩級戦艦。今は使われていない）は戦艦、15・22 はどちらも補給艦
 */
const SHIP_TYPE_GROUPS: readonly { readonly label: string; readonly ids: readonly number[] }[] = [
  { label: "戦艦", ids: [8, 9, 12] },
  { label: "航戦", ids: [10] },
  { label: "正空", ids: [11] },
  { label: "装空", ids: [18] },
  { label: "軽空", ids: [7] },
  { label: "重巡", ids: [5] },
  { label: "航巡", ids: [6] },
  { label: "軽巡", ids: [3] },
  { label: "雷巡", ids: [4] },
  { label: "練巡", ids: [21] },
  { label: "駆逐", ids: [2] },
  { label: "海防", ids: [1] },
  { label: "潜水", ids: [13] },
  { label: "潜空", ids: [14] },
  { label: "水母", ids: [16] },
  { label: "潜母", ids: [20] },
  { label: "揚陸", ids: [17] },
  { label: "補給", ids: [15, 22] },
  { label: "工作", ids: [19] },
];

/** 艦種が分からない（マスタにない艦、対応表にない艦種の番号）ときの略称。まとまりの順は最後 */
export const UNKNOWN_SHIP_TYPE_LABEL = "艦種不明";

/** 艦種の番号 → 略称とまとまりの順位 */
const SHIP_TYPE_INFO: ReadonlyMap<number, { readonly label: string; readonly rank: number }> = new Map(
  SHIP_TYPE_GROUPS.flatMap(({ label, ids }, rank) => ids.map((id) => [id, { label, rank }] as const)),
);

// ---- 札ごとの艦 ----

/** 札に置いた艦 1 隻の表示 */
export interface FudaShipView {
  /** 個体 */
  readonly ship: OwnedShip;
  /** 艦名（マスタにない艦は「名前が分からない艦」） */
  readonly name: string;
  /** 艦種の略称（例「駆逐」） */
  readonly typeLabel: string;
  /** 艦種のまとまりの順位（小さいほど前） */
  readonly typeRank: number;
  /** その札で特効があるか（倍率が 1 より大きい段階がある） */
  readonly hasBoost: boolean;
  /** その札での最大倍率（特効がなければ 1） */
  readonly maxMultiplier: number;
}

/** 札 1 つ分の表示 */
export interface FudaView {
  /** 札 */
  readonly fuda: Fuda;
  /** その札を使う段階の表示名（例「E2 ゲージ2」。定義の海域の順、海域の中は段階の順） */
  readonly stageLabels: readonly string[];
  /** 置いた艦（Lv の高い順。同じ Lv は図鑑番号の小さい順 → 個体 ID の順） */
  readonly ships: readonly FudaShipView[];
  /** そのうち、その札で特効がある隻数 */
  readonly boostedCount: number;
}

/** 図鑑番号（マスタにない艦は最後） */
function sortNoOf(master: ShipMaster, ship: OwnedShip): number {
  return master.byId.get(ship.shipId)?.sortNo ?? Number.MAX_SAFE_INTEGER;
}

/** 並べる順：Lv の高い順 → 図鑑番号の小さい順 → 個体 ID の順（毎回同じ順になるように） */
function compareByLevel(master: ShipMaster): (a: OwnedShip, b: OwnedShip) => number {
  return (a, b) =>
    b.level - a.level || sortNoOf(master, a) - sortNoOf(master, b) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
}

/** 海域 ID → 定義の海域の順位（知らない海域は最後） */
function areaRanker(definition: PublicDefinition): (areaId: string) => number {
  const order = new Map<string, number>();
  definition.areas.forEach((area, index) => {
    if (!order.has(area.id)) order.set(area.id, index);
  });
  return (areaId) => order.get(areaId) ?? definition.areas.length;
}

/** 札を使う段階の表示名（定義の海域の順、海域の中は段階の配列の順。特効の計算〔@/domain/boost〕の段階の順と同じ） */
export function fudaStageLabels(definition: PublicDefinition, fudaId: string): string[] {
  const rank = areaRanker(definition);
  return definition.stages
    .filter((stage) => stage.fudaId === fudaId)
    .sort((a, b) => rank(a.areaId) - rank(b.areaId))
    .map((stage) => stageLabel(definition, stage.id));
}

/**
 * 札ごとの艦（定義の札の順。艦がいない札も含める）。
 * 取り込んだ艦の一覧から割り当てを引くので、一覧にない個体への割り当て・定義にない札への割り当ては出さない
 */
export function buildFudaViews(
  definition: PublicDefinition,
  master: ShipMaster,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): FudaView[] {
  const byFuda = new Map<string, OwnedShip[]>(definition.fudas.map((fuda) => [fuda.id, []]));
  for (const ship of ships) {
    // 自分自身のキーだけを見る（Object.prototype の項目を拾わない）
    const fudaId = Object.hasOwn(assignments, ship.uid) ? assignments[ship.uid] : undefined;
    if (fudaId !== undefined) byFuda.get(fudaId)?.push(ship);
  }

  const compare = compareByLevel(master);
  return definition.fudas.map((fuda) => {
    const members = [...(byFuda.get(fuda.id) ?? [])].sort(compare).map((ship): FudaShipView => {
      const info = lookupShip(master, ship.shipId);
      const type = info.known ? SHIP_TYPE_INFO.get(info.shipTypeId) : undefined;
      const boost = fudaBoost(definition, fuda.id, info.known ? info.baseName : null);
      return {
        ship,
        name: info.name,
        typeLabel: type?.label ?? UNKNOWN_SHIP_TYPE_LABEL,
        typeRank: type?.rank ?? SHIP_TYPE_GROUPS.length,
        hasBoost: boost.hasBoost,
        maxMultiplier: boost.maxMultiplier,
      };
    });
    return {
      fuda,
      stageLabels: fudaStageLabels(definition, fuda.id),
      ships: members,
      boostedCount: members.filter((member) => member.hasBoost).length,
    };
  });
}

/** 艦種のまとまり */
export interface ShipTypeGroup {
  /** 艦種の略称（見出し） */
  readonly label: string;
  /** そのまとまりの艦（渡した順のまま） */
  readonly ships: readonly FudaShipView[];
}

/** 艦を艦種ごとにまとめる（まとまりは艦種の順。まとまりの中は渡した順のまま） */
export function groupByShipType(ships: readonly FudaShipView[]): ShipTypeGroup[] {
  const groups = new Map<string, { rank: number; ships: FudaShipView[] }>();
  for (const ship of ships) {
    const group = groups.get(ship.typeLabel);
    if (group === undefined) {
      groups.set(ship.typeLabel, { rank: ship.typeRank, ships: [ship] });
    } else {
      group.ships.push(ship);
    }
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank)
    .map(([label, group]) => ({ label, ships: group.ships }));
}

// ---- 攻略の流れ ----

/** 攻略の流れの段階 1 つ */
export interface TimelineStep {
  /** 段階 */
  readonly stage: Stage;
  /** その段階で使う札（定義にない札 ID なら undefined） */
  readonly fuda: Fuda | undefined;
  /** その札に置いた艦のうち、その段階で特効がある隻数 */
  readonly boostedCount: number;
}

/** 攻略の流れの海域 1 行 */
export interface TimelineArea {
  /** 海域 */
  readonly area: Area;
  /** 段階（定義の段階の配列の順） */
  readonly steps: readonly TimelineStep[];
}

/** 攻略の流れ（定義の海域の順。段階のない海域も行を出す） */
export function buildTimeline(
  definition: PublicDefinition,
  master: ShipMaster,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): TimelineArea[] {
  const fudas = new Map(definition.fudas.map((fuda) => [fuda.id, fuda]));
  const counts = countBoostedShipsByStage(definition, master, ships, assignments);
  return definition.areas.map((area) => ({
    area,
    steps: definition.stages
      .filter((stage) => stage.areaId === area.id)
      .map((stage) => ({ stage, fuda: fudas.get(stage.fudaId), boostedCount: counts[stage.id] ?? 0 })),
  }));
}

// ---- 書き方 ----

/** 倍率の書き方（例「×1.24」。小数第 2 位まで） */
export function formatMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(2)}`;
}

/** 2 桁にそろえる */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 取り込んだ日時（ISO 8601）を「10/15 20:40」の形にする（利用者の端末の時刻帯で出す。取り込み画面と同じ書き方）。
 * 日時として読めなければ null
 */
export function formatImportedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// ---- 札の色の上の文字 ----

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
 * 札の色の上に置く文字の色：暗い文字（"dark"。#101114）か白い文字（"light"）か（割り振り画面と同じ決め方）。
 * 定義には札の色しかないため、コントラスト比の高い方を選ぶ。色の形が "#RRGGBB" でなければ暗い文字
 */
export function inkOn(color: string): "dark" | "light" {
  const luminance = relativeLuminance(color);
  if (luminance === null) return "dark";
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithDark = (luminance + 0.05) / (DARK_INK_LUMINANCE + 0.05);
  return contrastWithDark >= contrastWithWhite ? "dark" : "light";
}
