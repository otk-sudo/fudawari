// 特効グループの編集（要件 3.7「この段階のボスで効く特効」、U11・U16、roadmap T3-6）
// 特効グループの ID は文書全体（すべての段階）で重複しないので、グループの操作は groupId だけで指定する。
// 国籍（v1.1）は BOOST_NATIONALITIES の順に並べて持ち、空なら nationalities の項目ごと持たない（v1 の定義と同じ形）。
// 艦種（v1.1。国籍の条件を絞る）は BOOST_SHIP_TYPE_IDS の順に並べて持ち、空なら shipTypes の項目ごと持たない。
// 国籍のないグループには艦種を持たせない（艦種だけの特効は扱わない。国籍を空にしたら艦種も消す）。
import type { BoostGroup, Stage } from "@/domain/definition/types";
import { SHIP_TYPES_WITHOUT_NATIONALITIES_MESSAGE } from "@/domain/definition/validate";
import { BOOST_NATIONALITIES, type BoostNationality, isBoostNationality } from "@/domain/nationality";
import { isBoostShipTypeId, normalizeShipTypeIds } from "@/domain/ship-type";
import { fail, ok } from "./result";
import type { AddBoostGroupInput, BoostGroupPatch, DefinitionDoc, EditResult } from "./types";

/** 倍率が許される値か（1 以上の有限の数） */
function isValidMultiplier(multiplier: number): boolean {
  return Number.isFinite(multiplier) && multiplier >= 1;
}

const invalidMultiplier = (): EditResult => fail("invalid_value", "倍率は 1 以上の数で入力してください");
const emptyShipName = (): EditResult => fail("invalid_value", "空の艦名は追加できません");
const groupNotFound = (): EditResult => fail("not_found", "特効グループが見つかりません");
const invalidNationality = (): EditResult => fail("invalid_value", "選べない国籍があります");
const invalidShipType = (): EditResult => fail("invalid_value", "選べない艦種があります");
const shipTypesWithoutNationalities = (): EditResult => fail("invalid_value", SHIP_TYPES_WITHOUT_NATIONALITIES_MESSAGE);

/** 重複を除く（先に出た順） */
function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

/** 艦名の前後の空白（半角・全角）を除く。空の艦名があれば undefined */
function trimShipNames(shipNames: readonly string[]): string[] | undefined {
  const trimmed = shipNames.map((name) => name.trim());
  return trimmed.includes("") ? undefined : trimmed;
}

/**
 * 国籍を BOOST_NATIONALITIES の順に並べ直し、重複を除く。選べない国籍（"unknown" を含む）があれば undefined。
 * 型の上では選べる国籍だけだが、画面などから型を外れた値が来ても文書に入れないよう、実行時にも確かめる
 */
function normalizeNationalities(nationalities: readonly BoostNationality[]): BoostNationality[] | undefined {
  if (!nationalities.every((nationality) => isBoostNationality(nationality))) return undefined;
  const chosen = new Set<BoostNationality>(nationalities);
  return BOOST_NATIONALITIES.filter((nationality) => chosen.has(nationality));
}

/**
 * 艦種を BOOST_SHIP_TYPE_IDS の順に並べ直し、重複を除く。選べない番号（12・小数・NaN など）があれば undefined。
 * 画面などから型を外れた値が来ても文書に入れないよう、実行時にも確かめる
 */
function normalizeShipTypes(shipTypes: readonly number[]): number[] | undefined {
  if (!shipTypes.every((id) => isBoostShipTypeId(id))) return undefined;
  return normalizeShipTypeIds(shipTypes);
}

/** 書き換えられる特効グループ（作り直すときだけ使う） */
type MutableBoostGroup = { -readonly [K in keyof BoostGroup]: BoostGroup[K] };

/** グループの国籍を置き換えたグループ（空なら nationalities の項目を持たず、艦種だけのグループにならないよう shipTypes も持たない） */
function withNationalities(group: BoostGroup, nationalities: readonly BoostNationality[]): BoostGroup {
  const next: MutableBoostGroup = { ...group };
  if (nationalities.length > 0) {
    next.nationalities = nationalities;
  } else {
    delete next.nationalities;
    delete next.shipTypes;
  }
  return next;
}

/** グループの艦種を置き換えたグループ（空なら shipTypes の項目を持たない。国籍があるかは呼び出し側で確かめる） */
function withShipTypes(group: BoostGroup, shipTypes: readonly number[]): BoostGroup {
  const next: MutableBoostGroup = { ...group };
  if (shipTypes.length > 0) {
    next.shipTypes = shipTypes;
  } else {
    delete next.shipTypes;
  }
  return next;
}

/** 特効グループと、それを持つ段階 */
interface GroupLocation {
  readonly stage: Stage;
  readonly group: BoostGroup;
}

/** 文書から特効グループを探す（なければ undefined） */
function locateGroup(doc: DefinitionDoc, groupId: string): GroupLocation | undefined {
  for (const stage of doc.stages) {
    const group = stage.boosts.find((g) => g.id === groupId);
    if (group !== undefined) return { stage, group };
  }
  return undefined;
}

/** 段階の特効グループを作り直した新しい文書（next が undefined なら、そのグループを取り除く） */
function withGroup(doc: DefinitionDoc, at: GroupLocation, next: BoostGroup | undefined): DefinitionDoc {
  const boosts = at.stage.boosts.flatMap((g) => {
    if (g !== at.group) return [g];
    return next === undefined ? [] : [next];
  });
  const updated: Stage = { ...at.stage, boosts };
  return { ...doc, stages: doc.stages.map((s) => (s === at.stage ? updated : s)) };
}

/**
 * 段階に特効グループを追加する（その段階の特効の最後）。
 * 省略時は 名前 ""・倍率 1・艦名なし・国籍なし。艦名は前後の空白を除き、重複を除く（先に出た順）。
 * 国籍は BOOST_NATIONALITIES の順に並べ直し、重複を除く（空なら nationalities の項目を持たない）。
 * 艦種は BOOST_SHIP_TYPE_IDS の順に並べ直し、重複を除く（空なら shipTypes の項目を持たない）。
 * - エラー：倍率が 1 未満・有限の数でない、空の艦名、選べない国籍・艦種、国籍がないのに艦種がある → invalid_value、
 *   newGroupId が文書のどこかの特効グループの ID と同じ → duplicate_id、段階がない → not_found
 */
export function addBoostGroup(doc: DefinitionDoc, input: AddBoostGroupInput): EditResult {
  const stage = doc.stages.find((s) => s.id === input.stageId);
  if (stage === undefined) return fail("not_found", "特効グループを追加する段階が見つかりません");
  if (locateGroup(doc, input.newGroupId) !== undefined) {
    return fail("duplicate_id", "同じ ID の特効グループが既にあります");
  }
  const multiplier = input.multiplier ?? 1;
  if (!isValidMultiplier(multiplier)) return invalidMultiplier();
  const shipNames = trimShipNames(input.shipNames ?? []);
  if (shipNames === undefined) return emptyShipName();
  const nationalities = normalizeNationalities(input.nationalities ?? []);
  if (nationalities === undefined) return invalidNationality();
  const shipTypes = normalizeShipTypes(input.shipTypes ?? []);
  if (shipTypes === undefined) return invalidShipType();
  if (shipTypes.length > 0 && nationalities.length === 0) return shipTypesWithoutNationalities();

  const group = withShipTypes(
    withNationalities(
      { id: input.newGroupId, name: input.name ?? "", multiplier, shipNames: unique(shipNames) },
      nationalities,
    ),
    shipTypes,
  );
  const updated: Stage = { ...stage, boosts: [...stage.boosts, group] };
  return ok({ ...doc, stages: doc.stages.map((s) => (s === stage ? updated : s)) });
}

/**
 * 特効グループの倍率・名前を変える（指定した項目だけ）。名前は空でもよい（PublicDefinition の約束）。
 * - エラー：倍率が 1 未満・有限の数でない → invalid_value、グループがない → not_found
 */
export function updateBoostGroup(doc: DefinitionDoc, groupId: string, patch: BoostGroupPatch): EditResult {
  const at = locateGroup(doc, groupId);
  if (at === undefined) return groupNotFound();
  if (patch.multiplier !== undefined && !isValidMultiplier(patch.multiplier)) return invalidMultiplier();

  const { group } = at;
  return ok(
    withGroup(doc, at, { ...group, name: patch.name ?? group.name, multiplier: patch.multiplier ?? group.multiplier }),
  );
}

/**
 * 特効グループに艦名を追加する（「＋ 艦名」、貼り付けた一覧）。最後に足す。
 * 前後の空白を除き、グループに既にある艦名・入力の中で重複する艦名は足さない（先に出た順）。
 * - エラー：空（空白だけを含む）の艦名がある → invalid_value、グループがない → not_found
 */
export function addShipNames(doc: DefinitionDoc, groupId: string, shipNames: readonly string[]): EditResult {
  const at = locateGroup(doc, groupId);
  if (at === undefined) return groupNotFound();
  const trimmed = trimShipNames(shipNames);
  if (trimmed === undefined) return emptyShipName();

  return ok(withGroup(doc, at, { ...at.group, shipNames: unique([...at.group.shipNames, ...trimmed]) }));
}

/**
 * 特効グループから艦名を 1 つ外す（艦名タグの ×）。
 * - エラー：グループがない、またはその艦名がグループにない → not_found
 */
export function removeShipName(doc: DefinitionDoc, groupId: string, shipName: string): EditResult {
  const at = locateGroup(doc, groupId);
  if (at === undefined) return groupNotFound();
  if (!at.group.shipNames.includes(shipName)) return fail("not_found", "その艦名は特効グループにありません");

  return ok(withGroup(doc, at, { ...at.group, shipNames: at.group.shipNames.filter((n) => n !== shipName) }));
}

/**
 * 特効グループの国籍を選び直す（国籍を選ぶ欄のチェック、国籍タグの ×。v1.1）。渡した国籍だけに置き換える（足すのではない）。
 * BOOST_NATIONALITIES の順に並べ直し、重複を除く。空になったら nationalities の項目を消す（キーを持たない）。
 * そのとき艦種（shipTypes）の項目も消す（艦種だけのグループを作らない）。
 * - エラー：選べない国籍（"unknown" を含む）がある → invalid_value、グループがない → not_found
 */
export function setGroupNationalities(
  doc: DefinitionDoc,
  groupId: string,
  nationalities: readonly BoostNationality[],
): EditResult {
  const at = locateGroup(doc, groupId);
  if (at === undefined) return groupNotFound();
  const normalized = normalizeNationalities(nationalities);
  if (normalized === undefined) return invalidNationality();

  return ok(withGroup(doc, at, withNationalities(at.group, normalized)));
}

/**
 * 特効グループの国籍を絞る艦種を選び直す（艦種を選ぶ欄のチェック、艦種タグの ×。v1.1）。渡した艦種だけに置き換える（足すのではない）。
 * BOOST_SHIP_TYPE_IDS の順に並べ直し、重複を除く。空になったら shipTypes の項目を消す（キーを持たない）。
 * - エラー：選べない番号がある、国籍のないグループに空でない艦種を入れる → invalid_value、グループがない → not_found
 */
export function setGroupShipTypes(doc: DefinitionDoc, groupId: string, shipTypes: readonly number[]): EditResult {
  const at = locateGroup(doc, groupId);
  if (at === undefined) return groupNotFound();
  const normalized = normalizeShipTypes(shipTypes);
  if (normalized === undefined) return invalidShipType();
  if (normalized.length > 0 && (at.group.nationalities ?? []).length === 0) return shipTypesWithoutNationalities();

  return ok(withGroup(doc, at, withShipTypes(at.group, normalized)));
}

/**
 * 特効グループを削除する（グループの ×）。
 * - エラー：グループがない → not_found
 */
export function deleteBoostGroup(doc: DefinitionDoc, groupId: string): EditResult {
  const at = locateGroup(doc, groupId);
  return at === undefined ? groupNotFound() : ok(withGroup(doc, at, undefined));
}

/** 艦名リストの区切り：改行（\r\n・\n・\r）、タブ、読点、カンマ（半角・全角）、スラッシュ（半角・全角） */
const SHIP_NAME_SEPARATOR = /\r\n|[\n\r\t、,，/／]/;

/**
 * 「攻略サイトの艦名リストを貼り付け」：区切られた艦名の文字列から艦名の一覧を作る。
 * - 区切り：改行（\n・\r\n・\r）、タブ、読点「、」、カンマ「,」「，」、スラッシュ「/」「／」
 * - 各艦名の前後の空白（半角・全角）を除く。艦名の中の半角空白は残す（例「Gambier Bay」）
 * - 空の項目は除く。重複は除く（先に出た順に並べる）
 */
export function parseShipNameList(text: string): string[] {
  const names = text
    .split(SHIP_NAME_SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return unique(names);
}
