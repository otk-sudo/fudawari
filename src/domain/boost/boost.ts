// 特効の計算（roadmap T1-3）。画面・保存・通信に依存しない純粋な関数
//
// 艦の指定は「改装段階を問わない艦名と国籍」（BoostTarget）で行う。個体からは
// boostTargetOf(master, ship.shipId)（@/domain/master）で求める。マスタにない艦は null（どこにも効かない）。
// グループは「shipNames に艦の baseName がある、または nationalities に艦の国籍がある」ときにその艦に効く（v1.1）。
// 1 つのグループは両方に当てはまっても 1 回だけ掛け、別のグループどうしは掛け合わせる（U12）。
// 国籍が "unknown" の艦は国籍の条件には当てはまらない。
//
// 性能の考え方（割り振り画面が 600 隻規模で毎回の描画のたびに呼んでも重くならないように）
// - 定義ごとに「札 → その札を使う段階（並び順どおり）」「段階 ID → 段階」「海域 ID → 海域名」の索引を、
//   段階ごとに「艦名 → 当てはまるグループと倍率の積」「国籍 → 当てはまるグループと倍率の積」の索引を、
//   初めて使うときに 1 回だけ作って覚えておく。艦名と国籍は別々の索引にする（同じ文字列でも混ざらない）。
//   以後の呼び出しは、段階の全探索や艦名の配列の走査をせずに索引を引くだけで済む。
//   艦名と国籍の両方で当てはまる艦だけは、両方のグループの番号の並びを合わせて、同じグループを 1 回だけ掛ける。
// - 覚えておく先は WeakMap（定義・段階のオブジェクトが不要になれば一緒に捨てられる）。
// - そのため、定義（PublicDefinition）とその中身は不変の値であることを前提にしている。
//   この前提は型と凍結で守られる：型は入れ子まで読み取り専用（readonly・readonly T[]）で書き換えは型の誤りになり、
//   validatePublicDefinition で検証した値は実行時にも深く凍結してある。
//   内容を変えるときは新しいオブジェクトを作る（React・Zustand の更新の作法と同じ）。
import { importanceWeight } from "@/domain/definition/importance";
import type { PublicDefinition, Stage } from "@/domain/definition/types";
import { boostTargetOf } from "@/domain/master/master";
import type { ShipMaster } from "@/domain/master/types";
import { type BoostNationality, isBoostNationality } from "@/domain/nationality";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { BoostTarget, FudaBoost, ShipBoostSummary, StageBoost } from "./types";

/** 定義の索引 */
interface DefinitionIndex {
  /** 札 ID → その札を使う段階（定義の海域の順、海域の中は配列の中の前後の順） */
  readonly stagesByFuda: ReadonlyMap<string, readonly Stage[]>;
  /** 段階 ID → 段階 */
  readonly stageById: ReadonlyMap<string, Stage>;
  /** 海域 ID → 海域名 */
  readonly areaNameById: ReadonlyMap<string, string>;
}

/** 1 つの艦名（または国籍）で当てはまるグループ */
interface GroupMatches {
  /** 当てはまるグループの番号（段階の boosts の位置。昇順で重複なし） */
  readonly groups: readonly number[];
  /** 当てはまるグループの倍率の積（groups の順に掛けたもの） */
  readonly multiplier: number;
}

/** 段階の特効グループの索引。艦名と国籍は別々に持つ */
interface StageBoostIndex {
  /** 艦名 → 当てはまるグループ */
  readonly byName: ReadonlyMap<string, GroupMatches>;
  /** 国籍 → 当てはまるグループ（選べる国籍だけ。"unknown" などは入れない） */
  readonly byNationality: ReadonlyMap<BoostNationality, GroupMatches>;
}

/** 索引を作る途中の、書き換えられる GroupMatches */
interface MutableGroupMatches {
  groups: number[];
  multiplier: number;
}

const definitionIndexes = new WeakMap<PublicDefinition, DefinitionIndex>();
const stageBoostIndexes = new WeakMap<Stage, StageBoostIndex>();

/** 定義の索引（初めて使うときに作り、同じ定義のオブジェクトには作ったものを使い回す） */
function definitionIndex(definition: PublicDefinition): DefinitionIndex {
  const cached = definitionIndexes.get(definition);
  if (cached !== undefined) return cached;

  const areaNameById = new Map<string, string>();
  const areaOrder = new Map<string, number>();
  definition.areas.forEach((area, order) => {
    if (areaOrder.has(area.id)) return;
    areaOrder.set(area.id, order);
    areaNameById.set(area.id, area.name);
  });

  // 海域の順に並べる。同じ海域の中は配列の中の前後の順（sort は安定）。知らない海域の段階は最後
  const areaRank = (stage: Stage): number => areaOrder.get(stage.areaId) ?? definition.areas.length;
  const orderedStages = [...definition.stages].sort((a, b) => areaRank(a) - areaRank(b));

  const stagesByFuda = new Map<string, Stage[]>();
  const stageById = new Map<string, Stage>();
  for (const stage of orderedStages) {
    const list = stagesByFuda.get(stage.fudaId);
    if (list === undefined) {
      stagesByFuda.set(stage.fudaId, [stage]);
    } else {
      list.push(stage);
    }
  }
  for (const stage of definition.stages) {
    if (!stageById.has(stage.id)) stageById.set(stage.id, stage);
  }

  const index: DefinitionIndex = { stagesByFuda, stageById, areaNameById };
  definitionIndexes.set(definition, index);
  return index;
}

/** キー → 当てはまるグループの索引に、グループを 1 つ足す（グループは番号の昇順に足すこと） */
function addMatch<K>(index: Map<K, MutableGroupMatches>, key: K, position: number, multiplier: number): void {
  const current = index.get(key);
  if (current === undefined) {
    index.set(key, { groups: [position], multiplier });
  } else {
    current.groups.push(position);
    current.multiplier *= multiplier;
  }
}

/**
 * 段階の特効グループの索引（艦名 → グループ、国籍 → グループ）。
 * 1 つのグループに同じ艦名・国籍が重複して書かれていても、そのグループは 1 回だけ数える。
 * 検証を通さない定義に選べない国籍（"unknown" など）が入っていても索引には入れない（どの艦にも当てはまらない）
 */
function stageBoostIndexOf(stage: Stage): StageBoostIndex {
  const cached = stageBoostIndexes.get(stage);
  if (cached !== undefined) return cached;

  const byName = new Map<string, MutableGroupMatches>();
  const byNationality = new Map<BoostNationality, MutableGroupMatches>();
  stage.boosts.forEach((group, position) => {
    for (const name of new Set(group.shipNames)) {
      addMatch(byName, name, position, group.multiplier);
    }
    for (const nationality of new Set(group.nationalities ?? [])) {
      if (isBoostNationality(nationality)) addMatch(byNationality, nationality, position, group.multiplier);
    }
  });
  const index: StageBoostIndex = { byName, byNationality };
  stageBoostIndexes.set(stage, index);
  return index;
}

/**
 * 艦名と国籍の両方で当てはまるときの倍率。2 つのグループの番号の並び（どちらも昇順）を合わせ、
 * 同じグループは 1 回だけ、番号の順に掛ける（片方だけで当てはまるときの積と同じ順なので、誤差の出方もそろう）
 */
function combinedMultiplier(stage: Stage, byName: readonly number[], byNationality: readonly number[]): number {
  let multiplier = 1;
  let i = 0;
  let j = 0;
  while (i < byName.length || j < byNationality.length) {
    const fromName = i < byName.length ? byName[i] : Number.POSITIVE_INFINITY;
    const fromNationality = j < byNationality.length ? byNationality[j] : Number.POSITIVE_INFINITY;
    const position = Math.min(fromName, fromNationality);
    if (fromName === position) i += 1;
    if (fromNationality === position) j += 1;
    multiplier *= stage.boosts[position].multiplier;
  }
  return multiplier;
}

/**
 * スコアの合計を整数に丸める。
 * 浮動小数の誤差で ちょうど .5 になるはずの値が .49999… になり丸めの向きが変わらないよう、先に小数第 6 位で丸める
 */
function roundScore(total: number): number {
  return Math.round(Math.round(total * 1e6) / 1e6);
}

/**
 * 艦 × 段階の倍率。段階の特効グループのうち、shipNames に艦の baseName を含む、または nationalities に艦の国籍を含む
 * ものの倍率を掛け合わせる（U12）。1 つのグループは両方に当てはまっても 1 回だけ掛ける。
 * 国籍が "unknown" の艦は国籍の条件には当てはまらない。どれにも当てはまらない、または target が null なら 1
 */
export function stageMultiplier(stage: Stage, target: BoostTarget | null): number {
  if (target === null) return 1;
  const index = stageBoostIndexOf(stage);
  const byName = index.byName.get(target.baseName);
  const byNationality = target.nationality === "unknown" ? undefined : index.byNationality.get(target.nationality);
  if (byNationality === undefined) return byName?.multiplier ?? 1;
  if (byName === undefined) return byNationality.multiplier;
  return combinedMultiplier(stage, byName.groups, byNationality.groups);
}

/**
 * 艦 × 札の特効（スコア、効く段階と倍率、特効の有無、最大倍率）。
 * 定義にない札 ID なら score 0・stages []・hasBoost false・maxMultiplier 1
 */
export function fudaBoost(
  definition: PublicDefinition,
  fudaId: string,
  target: BoostTarget | null,
): FudaBoost {
  const stages: StageBoost[] = [];
  let total = 0;
  let maxMultiplier = 1;
  if (target !== null) {
    for (const stage of definitionIndex(definition).stagesByFuda.get(fudaId) ?? []) {
      const multiplier = stageMultiplier(stage, target);
      if (multiplier <= 1) continue;
      stages.push({ stageId: stage.id, multiplier });
      total += (multiplier - 1) * 100 * importanceWeight(stage.importance);
      if (multiplier > maxMultiplier) maxMultiplier = multiplier;
    }
  }
  return { fudaId, score: roundScore(total), stages, hasBoost: stages.length > 0, maxMultiplier };
}

/** 艦ごとの特効のまとめ。効く札をスコアの高い順に、効かない札を定義の順に返す */
export function shipBoostSummary(
  definition: PublicDefinition,
  target: BoostTarget | null,
): ShipBoostSummary {
  const boosts = definition.fudas.map((fuda) => fudaBoost(definition, fuda.id, target));
  // sort は安定なので、同点の札は定義の札の順のまま
  const effective = boosts.filter((boost) => boost.hasBoost).sort((a, b) => b.score - a.score);
  const ineffectiveFudaIds = boosts.filter((boost) => !boost.hasBoost).map((boost) => boost.fudaId);
  return { effective, ineffectiveFudaIds };
}

/**
 * 段階ごとに、その段階の札に割り当てた個体のうち、その段階で特効がある（倍率 > 1）隻数（一覧の「特効 n 隻」）。
 * 定義のすべての段階 ID をキーに持つ（該当なしは 0）。
 * 一覧にない個体への割り当て、定義にない札への割り当て、マスタにない艦は数えない。艦名と国籍はマスタから引く
 */
export function countBoostedShipsByStage(
  definition: PublicDefinition,
  master: ShipMaster,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): Record<string, number> {
  const { stagesByFuda } = definitionIndex(definition);
  const counts: Record<string, number> = Object.fromEntries(definition.stages.map((stage) => [stage.id, 0]));
  // 一覧の個体から割り当てを引く（割り当て側から引かないので、一覧にない個体への割り当ては数えない）
  for (const ship of ships) {
    // 自分自身のキーだけを見る（Object.prototype の項目を拾わない）。値が undefined の個体も控えとして飛ばす
    if (!Object.hasOwn(assignments, ship.uid)) continue;
    const fudaId = assignments[ship.uid];
    if (fudaId === undefined) continue;
    const stages = stagesByFuda.get(fudaId);
    if (stages === undefined) continue;
    const target = boostTargetOf(master, ship.shipId);
    if (target === null) continue;
    for (const stage of stages) {
      if (stageMultiplier(stage, target) > 1) counts[stage.id] += 1;
    }
  }
  return counts;
}

/** 段階の表示名「海域名 段階名」（例「E2 ゲージ3」。要件 14 章の提案）。定義にない段階 ID はその ID をそのまま返す */
export function stageLabel(definition: PublicDefinition, stageId: string): string {
  const { stageById, areaNameById } = definitionIndex(definition);
  const stage = stageById.get(stageId);
  if (stage === undefined) return stageId;
  const areaName = areaNameById.get(stage.areaId);
  return areaName === undefined ? stage.name : `${areaName} ${stage.name}`;
}
