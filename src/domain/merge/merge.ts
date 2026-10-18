// 3 方向マージ（同時編集の B 案。要件 3.7「同時編集」、roadmap T3-8 の単体部分）
//
// 「開いたときの版（base）」「自分の内容（mine）」「相手が保存した内容（theirs）」を比べ、
// 段階・特効グループ・札・海域・イベントの情報の単位で差分を取って合わせる。画面・DB・通信に依存しない純粋な関数。
// 入力の文書は書き換えない。
//
// ■ 単位と同一性：段階・特効グループ・札・海域は ID で同じものとみなす。イベントの情報は 1 つの単位。
//
// ■ 項目ごとの合わせ方（単位が 3 つすべてにあるとき）
//   - 段階：name・fudaId・importance・areaId（海域の移動）、特効グループ：name・multiplier、
//     札：name・color・gameNumber、イベント：name・startAt・endAt・versionDate を、項目ごとに比べる
//     - 片方だけが base から変えた → その値（相手だけなら autoMerged に入れる）
//     - 2 人とも同じ値に変えた → その値（衝突にしない。autoMerged にも入れない）
//     - 2 人が違う値に変えた → 衝突（merged には仮に自分の値）
//   - 特効グループの艦名（shipNames）は集合として合わせる：base ＋ 2 人が足した艦名 − 2 人が外した艦名。衝突にしない
//     （並びは base の順 → 足した艦名。相手が足した・外した艦名があれば autoMerged に field "shipNames" で入れる）
//   - 特効グループの国籍（nationalities。v1.1）も艦名と同じく集合として合わせる。衝突にしない
//     （並びは BOOST_NATIONALITIES の順。省略は空として扱い、結果が空なら項目を持たない。
//     相手が足した・外した国籍があれば autoMerged に field "nationalities" で入れる）
//   - 特効グループの艦種（shipTypes。v1.1。国籍の条件を絞る）も国籍と同じく集合として合わせる。衝突にしない
//     （並びは BOOST_SHIP_TYPE_IDS の順。省略は空として扱い、結果が空なら項目を持たない。
//     相手が足した・外した艦種があれば autoMerged に field "shipTypes" で入れる）。
//     合わせた国籍が空なら艦種も持たない（艦種だけのグループを作らない）
//
// ■ 追加と削除
//   - 片方だけが追加した → 残す（相手が追加したものは autoMerged に change "added"）。新しい ID は呼び出し側が作るので重ならない。
//     2 人が同じ ID を追加した（海域の E4 など）→ 中身が同じなら 1 つにする
//   - 片方が削除し、もう片方は変えていない → 削除（相手が削除したものは autoMerged に change "deleted"）
//   - 2 人とも削除した → 削除（衝突にしない）
//   - 片方が削除し、もう片方が変えた → 衝突（location の field は null。削除した側の表示は「削除」、変えた側は「変更」）。
//     段階の「変えた」には、その段階の特効グループの追加・削除・変更を含む。このとき特効グループの衝突は別に出さず、
//     段階の衝突 1 件にまとめる（段階が両方に残っていれば、特効グループは特効グループの単位で合わせる）。
//     merged には仮に自分の側（自分が削除したなら削除、自分が変えたなら自分の内容）を入れる
//   - 参照の整合：片方が削除した札・外した海域でも、合わせた後の段階が使っていれば残す（使っている側の内容で）。
//     合わせた後の文書では、どの段階の fudaId・areaId も必ず存在する
//
// ■ 並び順（札の並び、海域ごとの段階の並び、段階ごとの特効グループの並び、海域の並び）
//   1. 3 つすべてにあり、合わせた後も同じ並び（同じ海域）に属するものだけを取り出し、base・mine・theirs での順を比べる
//      - 片方だけが順を変えた → その順（相手だけなら autoMerged に fudaOrder・stageOrder で入れる）
//      - 2 人とも変えて順が違う → 衝突（fudaOrder・stageOrder。merged には仮に自分の順）。
//        特効グループ・海域は並べ替える操作がないため、食い違っても衝突にせず自分の順にする
//   2. 残り（追加したもの、別の海域から移したもの）を、それを置いた側の並びで、後ろにあるもののうち
//      合わせた並びに既にある最も近いものの直前に差し込む（なければ最後）。「段階の前に割り込む」操作に合わせて後ろを基準にする。
//      置いた側は、自分の並びにあれば自分、なければ相手。差し込む順は、自分の並びの順 → 相手の並びの順
//      （例：相手が札を並べ替え、自分が札を最後に足した → 相手の順の最後に自分の札）
//
// ■ 表示名（label）
//   - 名前は base のもの（base にないものは、ある側のもの）を使う
//   - 段階：「E2 ゲージ3」（海域名 ＋ 半角空白 ＋ 段階名）。段階の項目：「E2 ゲージ3 の大事さ」
//     （段階名 → 「段階名」、札 → 「札」、大事さ → 「大事さ」、海域 → 「海域」）
//   - 段階の並び順：「E2 の段階の並び順」
//   - 特効グループ：「E2 ゲージ3 の特効「連合艦隊C」」。項目：「E2 ゲージ3 の特効「連合艦隊C」の倍率」（名前・倍率・艦名・国籍）
//   - 札：「札「連合艦隊」」。項目：「札「連合艦隊」の名前」（名前・色・札番号）。札の並び順：「札の並び順」
//   - 海域：「E4」。イベント：「イベント名」「開始日時」「終了日時」「版の日付」
// ■ 値の表示（theirsText・mineText）
//   - 大事さ：普通／重要／難所。倍率：「×1.27」（小数第 2 位まで）。札（段階の札）：札名。海域：海域名
//   - 札番号：数字（未入力は「未入力」）。日時：「2026/10/20 11:00」の形（未定は「未定」）
//   - 並び順：名前を「 → 」でつないだ文
//
// ■ 実装で決めたこと（上の決まりにない細部）
//   - 衝突の ID は場所（location）から作る（例 "stage:E2-3:importance"）。同じ入力からは同じ ID になる。
//   - resolveMerge は、選んだ側を使って同じ手順で合わせ直す。衝突の選び方によって、参照の整合で残す札・海域が変わり、
//     衝突の一覧が増減しうる（選んだ後に新しく生じた衝突は自分の内容にする）。
//   - 合わせた文書の問題（段階が 0、終了日時が開始日時以前、札番号の重複）は findDocumentIssues で調べ、issues に入れる。
//     resolveMerge は最終的な文書に問題があれば成功にしない。
//   - 参照の整合で残す札・海域は、削除と変更の衝突にも、自動で合わせた所（削除）にも出さない（残すしかないため）。
//   - 2 人が同じ ID を追加して中身が違うとき（ID は呼び出し側が重ならないように作るので、通常は起きない）は自分の内容にする。
//   - 海域の名前は変える操作がないため、項目として比べず報告もしない（変わっていれば、変えた側の名前にする）。
//   - 日時（開始日時・終了日時）は時刻で比べる（書き方の違いだけなら変更とみなさない）。表示は日本時間。
//   - 並び順の表示（theirsText・mineText）は、3 つすべてにあるものだけを、base の名前でつなぐ。
//   - 自動で合わせた所・衝突の並びは、イベント → 海域 → 札（札の並び順を含む）→ 段階（合わせた後の海域・段階の順。
//     削除した段階は base の位置。各海域の最後にその海域の段階の並び順）。
import { importanceLabel } from "@/domain/definition/importance";
import type { Area, BoostGroup, EventInfo, Fuda, Stage } from "@/domain/definition/types";
import { findDocumentIssues } from "@/domain/definition-edit/issues";
import type { DefinitionDoc } from "@/domain/definition-edit/types";
import { BOOST_NATIONALITIES, type BoostNationality } from "@/domain/nationality";
import { BOOST_SHIP_TYPE_IDS } from "@/domain/ship-type";
import {
  areaNameIn,
  eventFieldLabel,
  eventValueText,
  FUDA_ORDER_LABEL,
  fudaFieldLabel,
  fudaLabel,
  fudaNameIn,
  gameNumberText,
  groupFieldLabel,
  groupLabel,
  groupNameText,
  multiplierText,
  orderText,
  plainText,
  sameEventValue,
  stageFieldLabel,
  stageLabelIn,
  stageNameIn,
  stageOrderLabel,
} from "./labels";
import { deepEqual, sameArray, stageIdsInArea, stageReportOrder, unionOrder, unique } from "./order";
import type {
  AutoMergedChange,
  BoostGroupField,
  ChangeKind,
  ChangeLocation,
  ConflictChoice,
  ConflictChoices,
  EventField,
  FudaField,
  MergeConflict,
  MergeInput,
  MergeResult,
  ResolveResult,
  StageField,
} from "./types";

/** 値の持ち主（相手／自分） */
type Side = "mine" | "theirs";

/** 衝突の選び方（衝突の ID → 相手／自分） */
type Chooser = (conflictId: string) => ConflictChoice;

/** マージの入力と、衝突の選び方 */
interface MergeContext extends MergeInput {
  readonly choose: Chooser;
}

/** base・mine・theirs の 3 つの値 */
interface Three<T> {
  readonly base: T;
  readonly mine: T;
  readonly theirs: T;
}

/** 自動で合わせた所と衝突を集める入れ物（単位ごとに分けて集め、最後に並べて 1 つにする） */
interface Reports {
  readonly autoMerged: AutoMergedChange[];
  readonly conflicts: MergeConflict[];
}

/** 報告の場所・表示名・印を付ける段階 */
interface Place {
  readonly location: ChangeLocation;
  readonly label: string;
  readonly stageId: string | null;
}

function newReports(): Reports {
  return { autoMerged: [], conflicts: [] };
}

/** 単位の ID ごとの報告の入れ物を取り出す（なければ作る） */
function reportsFor(map: Map<string, Reports>, id: string): Reports {
  const found = map.get(id);
  if (found !== undefined) return found;
  const created = newReports();
  map.set(id, created);
  return created;
}

/** 場所を表す文字列の部品（衝突の ID に使う） */
function locationParts(location: ChangeLocation): string[] {
  switch (location.kind) {
    case "event":
      return [location.field];
    case "area":
      return [location.areaId];
    case "fuda":
      return [location.fudaId, location.field ?? ""];
    case "fudaOrder":
      return [];
    case "stage":
      return [location.stageId, location.field ?? ""];
    case "stageOrder":
      return [location.areaId];
    case "boostGroup":
      return [location.stageId, location.groupId, location.field ?? ""];
  }
}

/** 衝突の ID（場所から決める。同じ入力からは同じ ID。例 "stage:E2-3:importance"） */
function conflictId(location: ChangeLocation): string {
  return [location.kind, ...locationParts(location)].map(encodeURIComponent).join(":");
}

/** 自動で合わせた所を 1 件足す */
function addAutoMerged(reports: Reports, place: Place, change: ChangeKind): void {
  reports.autoMerged.push({ location: place.location, change, label: place.label, stageId: place.stageId });
}

/** 衝突を 1 件足し、その衝突で選ばれている側を返す */
function addConflict(
  ctx: MergeContext,
  reports: Reports,
  place: Place,
  texts: { readonly theirs: string; readonly mine: string },
): ConflictChoice {
  const id = conflictId(place.location);
  reports.conflicts.push({
    id,
    location: place.location,
    label: place.label,
    theirsText: texts.theirs,
    mineText: texts.mine,
    stageId: place.stageId,
  });
  return ctx.choose(id);
}

/** 表示名で名前を引く文書の順（base → 自分 → 相手。base にないものは、ある側の名前になる） */
function labelDocs(ctx: MergeContext): readonly DefinitionDoc[] {
  return [ctx.base, ctx.mine, ctx.theirs];
}

/** 値の表示で名前を引く文書の順（その側 → base → もう一方） */
function valueDocs(ctx: MergeContext, side: Side): readonly DefinitionDoc[] {
  return side === "mine" ? [ctx.mine, ctx.base, ctx.theirs] : [ctx.theirs, ctx.base, ctx.mine];
}

/** ID で引ける索引 */
function byId<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** 配列の要素の ID */
function idsOf(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id);
}

/** 3 つの配列の要素の ID */
function idsOfThree(items: Three<readonly { readonly id: string }[]>): Three<string[]> {
  return { base: idsOf(items.base), mine: idsOf(items.mine), theirs: idsOf(items.theirs) };
}

/** ID の並びの順に、索引から取り出す（索引にないものは飛ばす） */
function pickInOrder<T>(ids: readonly string[], map: ReadonlyMap<string, T>): T[] {
  return ids.flatMap((id) => {
    const item = map.get(id);
    return item === undefined ? [] : [item];
  });
}

// ---- 項目 ----

/**
 * 1 つの項目を 3 方向で合わせる。
 * 片方だけが変えた → その値（相手だけなら自動で合わせた所）、同じ値に変えた → その値、違う値に変えた → 衝突
 */
function mergeValue<T>(
  ctx: MergeContext,
  reports: Reports,
  place: Place,
  values: Three<T>,
  text: (value: T, side: Side) => string,
  same: (a: T, b: T) => boolean = Object.is,
): T {
  const { base, mine, theirs } = values;
  if (same(base, theirs)) return mine;
  if (same(base, mine)) {
    addAutoMerged(reports, place, "modified");
    return theirs;
  }
  if (same(mine, theirs)) return mine;
  const choice = addConflict(ctx, reports, place, { theirs: text(theirs, "theirs"), mine: text(mine, "mine") });
  return choice === "theirs" ? theirs : mine;
}

// ---- 単位（段階・特効グループ・札・海域）の追加と削除 ----

/** 単位の合わせ方 */
interface UnitRule<T> {
  /** 3 つすべてにあるとき、項目ごとに合わせる */
  readonly both: (base: T, mine: T, theirs: T) => T;
  /** 単位そのものの場所と表示名（追加・削除、削除と変更の衝突に使う）。unit は base のもの（base になければ、ある側のもの） */
  readonly place: (unit: T) => Place;
}

/**
 * 単位の有無を 3 方向で合わせる（ない単位は undefined。合わせた結果がなければ undefined を返す）。
 * keep が true（合わせた後の段階が使っている札・海域）なら、片方が削除していても残す
 */
function mergeUnit<T>(
  ctx: MergeContext,
  reports: Reports,
  base: T | undefined,
  mine: T | undefined,
  theirs: T | undefined,
  rule: UnitRule<T>,
  keep: boolean,
): T | undefined {
  if (base === undefined) {
    // 追加。2 人が同じ ID を追加したら自分の内容で 1 つにする
    if (mine !== undefined) return mine;
    if (theirs !== undefined) addAutoMerged(reports, rule.place(theirs), "added");
    return theirs;
  }
  if (mine !== undefined && theirs !== undefined) return rule.both(base, mine, theirs);
  if (mine === undefined && theirs === undefined) return keep ? base : undefined;
  // 片方が削除したが、合わせた後の段階が使っている：使っている側の内容で残す（報告しない）
  if (keep) return mine ?? theirs;
  if (mine !== undefined) {
    // 相手が削除
    if (deepEqual(base, mine)) {
      addAutoMerged(reports, rule.place(base), "deleted");
      return undefined;
    }
    const choice = addConflict(ctx, reports, rule.place(base), { theirs: "削除", mine: "変更" });
    return choice === "theirs" ? undefined : mine;
  }
  // 自分が削除
  if (deepEqual(base, theirs)) return undefined;
  const choice = addConflict(ctx, reports, rule.place(base), { theirs: "変更", mine: "削除" });
  return choice === "theirs" ? theirs : undefined;
}

/**
 * 同じ種類の単位の集まり（段階・札・海域、段階の特効グループ）を合わせ、ID → 合わせた単位 を返す。
 * reportsOf は単位ごとの報告の入れ物、keep は参照の整合で残す ID か
 */
function mergeUnits<T extends { readonly id: string }>(
  ctx: MergeContext,
  units: Three<readonly T[]>,
  reportsOf: (id: string) => Reports,
  ruleOf: (reports: Reports) => UnitRule<T>,
  keep: (id: string) => boolean = () => false,
): Map<string, T> {
  const base = byId(units.base);
  const mine = byId(units.mine);
  const theirs = byId(units.theirs);
  const merged = new Map<string, T>();
  for (const id of unique(idsOf([...units.base, ...units.mine, ...units.theirs]))) {
    const reports = reportsOf(id);
    const unit = mergeUnit(ctx, reports, base.get(id), mine.get(id), theirs.get(id), ruleOf(reports), keep(id));
    if (unit !== undefined) merged.set(id, unit);
  }
  return merged;
}

// ---- 並び順 ----

/** 並び順の食い違いを報告するときの設定（null なら報告も衝突もせず、2 人とも変えたら自分の順にする） */
interface OrderReport {
  readonly reports: Reports;
  readonly place: Place;
  /** 並び順の表示（ID の並び → 名前を「 → 」でつないだ文） */
  readonly text: (ids: readonly string[]) => string;
}

/**
 * 1 つの並び（札の並び、海域の中の段階の並びなど）を合わせる。
 * members は合わせた後にこの並びに属する ID、lists はそれぞれの文書でのこの並び
 */
function mergeOrder(
  ctx: MergeContext,
  members: ReadonlySet<string>,
  lists: Three<readonly string[]>,
  report: OrderReport | null,
): string[] {
  // 1. 3 つすべてにあり、合わせた後もこの並びに属するものの順を比べる
  const inMine = new Set(lists.mine);
  const inTheirs = new Set(lists.theirs);
  const common = new Set(lists.base.filter((id) => members.has(id) && inMine.has(id) && inTheirs.has(id)));
  const base = lists.base.filter((id) => common.has(id));
  const mine = lists.mine.filter((id) => common.has(id));
  const theirs = lists.theirs.filter((id) => common.has(id));

  let order: string[];
  if (sameArray(base, theirs)) {
    order = mine;
  } else if (sameArray(base, mine)) {
    order = theirs;
    if (report !== null) addAutoMerged(report.reports, report.place, "modified");
  } else if (sameArray(mine, theirs) || report === null) {
    order = mine;
  } else {
    const choice = addConflict(ctx, report.reports, report.place, {
      theirs: report.text(theirs),
      mine: report.text(mine),
    });
    order = choice === "theirs" ? theirs : mine;
  }

  // 2. 残り（追加したもの、別の並びから移したもの）を、置いた側の並びで後ろにある最も近いものの直前に差し込む。
  //    自分の並びの順 → 相手の並びの順に差し込む（自分の並びにあれば自分が置いた側）
  const result = [...order];
  const placed = new Set(result);
  const insert = (id: string, sideList: readonly string[]): void => {
    const next = sideList.slice(sideList.indexOf(id) + 1).find((other) => placed.has(other));
    if (next === undefined) result.push(id);
    else result.splice(result.indexOf(next), 0, id);
    placed.add(id);
  };
  for (const sideList of [lists.mine, lists.theirs]) {
    for (const id of sideList) {
      if (members.has(id) && !placed.has(id)) insert(id, sideList);
    }
  }
  // どちらの並びにもないもの（通常は起きない）は最後に足す
  for (const id of members) {
    if (!placed.has(id)) insert(id, []);
  }
  return result;
}

// ---- イベント ----

/** イベントの情報を項目ごとに合わせる（日時は時刻で比べる） */
function mergeEvent(ctx: MergeContext, reports: Reports): EventInfo {
  const events: Three<EventInfo> = { base: ctx.base.event, mine: ctx.mine.event, theirs: ctx.theirs.event };
  // 項目ごとに、どちらの側のイベントの値を使うかを決める
  const pick = (field: EventField): EventInfo =>
    mergeValue(
      ctx,
      reports,
      { location: { kind: "event", field }, label: eventFieldLabel(field), stageId: null },
      events,
      (event) => eventValueText(field, event),
      (a, b) => sameEventValue(field, a, b),
    );
  return {
    id: events.mine.id,
    name: pick("name").name,
    startAt: pick("startAt").startAt,
    endAt: pick("endAt").endAt,
    versionDate: pick("versionDate").versionDate,
  };
}

// ---- 札・海域 ----

/** 札の項目を合わせる */
function mergeFuda(ctx: MergeContext, reports: Reports, base: Fuda, mine: Fuda, theirs: Fuda): Fuda {
  const label = fudaLabel(base.name);
  const place = (field: FudaField): Place => ({
    location: { kind: "fuda", fudaId: base.id, field },
    label: fudaFieldLabel(label, field),
    stageId: null,
  });
  const field = <K extends FudaField>(key: K): Three<Fuda[K]> => ({
    base: base[key],
    mine: mine[key],
    theirs: theirs[key],
  });
  return {
    id: base.id,
    name: mergeValue(ctx, reports, place("name"), field("name"), plainText),
    color: mergeValue(ctx, reports, place("color"), field("color"), (value) => value),
    gameNumber: mergeValue(ctx, reports, place("gameNumber"), field("gameNumber"), gameNumberText),
  };
}

/** 海域を合わせる（名前を変える操作はないため報告しない。変わっていれば変えた側の名前） */
function mergeArea(base: Area, mine: Area, theirs: Area): Area {
  return { id: base.id, name: mine.name !== base.name ? mine.name : theirs.name };
}

// ---- 段階・特効グループ ----

/** 特効グループの艦名を集合として合わせる（base の順 → 足した艦名。衝突にしない） */
function mergeShipNames(reports: Reports, place: Place, names: Three<readonly string[]>): string[] {
  const { base, mine, theirs } = names;
  if (sameArray(base, theirs)) return [...mine];
  const baseSet = new Set(base);
  const mineSet = new Set(mine);
  const theirsSet = new Set(theirs);
  // 相手だけが足した・外した艦名があれば、自動で合わせた所に入れる（2 人とも同じ変更なら入れない）
  const theirsAdded = theirs.some((name) => !baseSet.has(name) && !mineSet.has(name));
  const theirsRemoved = base.some((name) => !theirsSet.has(name) && mineSet.has(name));
  if (theirsAdded || theirsRemoved) addAutoMerged(reports, place, "modified");
  if (sameArray(base, mine)) return [...theirs];
  const removed = new Set(base.filter((name) => !mineSet.has(name) || !theirsSet.has(name)));
  const added = [...mine, ...theirs].filter((name) => !baseSet.has(name));
  return unique([...base.filter((name) => !removed.has(name)), ...added]);
}

/**
 * 正規の並び（order）を持つ値の集合を合わせる（base ＋ 2 人が足した値 − 2 人が外した値。衝突にしない）。
 * 特効グループの国籍・艦種（v1.1）に使う。並びは order の順（base・足した順によらない。order にない値は捨てる）
 */
function mergeOrderedSet<T>(reports: Reports, place: Place, order: readonly T[], values: Three<readonly T[]>): T[] {
  const base = new Set(values.base);
  const mine = new Set(values.mine);
  const theirs = new Set(values.theirs);
  // 相手だけが足した・外した値があれば、自動で合わせた所に入れる（2 人とも同じ変更なら入れない）
  const theirsAdded = [...theirs].some((value) => !base.has(value) && !mine.has(value));
  const theirsRemoved = [...base].some((value) => !theirs.has(value) && mine.has(value));
  if (theirsAdded || theirsRemoved) addAutoMerged(reports, place, "modified");
  // base にあった値は 2 人とも残したものだけ、base になかった値はどちらかが足したもの
  return order.filter((value) =>
    base.has(value) ? mine.has(value) && theirs.has(value) : mine.has(value) || theirs.has(value),
  );
}

/** 特効グループの項目を合わせる */
function mergeGroup(
  ctx: MergeContext,
  reports: Reports,
  stageId: string,
  stageLabelText: string,
  groups: Three<BoostGroup>,
): BoostGroup {
  const { base, mine, theirs } = groups;
  const label = groupLabel(stageLabelText, base.name);
  const place = (field: BoostGroupField): Place => ({
    location: { kind: "boostGroup", stageId, groupId: base.id, field },
    label: groupFieldLabel(label, field),
    stageId,
  });
  const field = <K extends BoostGroupField>(key: K): Three<BoostGroup[K]> => ({
    base: base[key],
    mine: mine[key],
    theirs: theirs[key],
  });
  const merged: BoostGroup = {
    id: base.id,
    name: mergeValue(ctx, reports, place("name"), field("name"), groupNameText),
    multiplier: mergeValue(ctx, reports, place("multiplier"), field("multiplier"), multiplierText),
    shipNames: mergeShipNames(reports, place("shipNames"), field("shipNames")),
  };
  // 国籍・艦種は省略を空として扱い、結果が空なら項目を持たない（v1 の定義と同じ形）
  const nationalities = mergeOrderedSet<BoostNationality>(reports, place("nationalities"), BOOST_NATIONALITIES, {
    base: base.nationalities ?? [],
    mine: mine.nationalities ?? [],
    theirs: theirs.nationalities ?? [],
  });
  // 国籍が空なら艦種も持たない（艦種だけのグループを作らない）。結果に艦種がないので、艦種の自動の取り込みも伝えない
  if (nationalities.length === 0) return merged;
  const shipTypes = mergeOrderedSet(reports, place("shipTypes"), BOOST_SHIP_TYPE_IDS, {
    base: base.shipTypes ?? [],
    mine: mine.shipTypes ?? [],
    theirs: theirs.shipTypes ?? [],
  });
  return shipTypes.length > 0 ? { ...merged, nationalities, shipTypes } : { ...merged, nationalities };
}

/** 段階の項目と特効グループを合わせる（段階が 3 つすべてにあるとき） */
function mergeStage(ctx: MergeContext, reports: Reports, stages: Three<Stage>): Stage {
  const { base, mine, theirs } = stages;
  const label = stageLabelIn([ctx.base], base.id);
  const place = (field: StageField): Place => ({
    location: { kind: "stage", stageId: base.id, field },
    label: stageFieldLabel(label, field),
    stageId: base.id,
  });
  const field = <K extends StageField | "boosts">(key: K): Three<Stage[K]> => ({
    base: base[key],
    mine: mine[key],
    theirs: theirs[key],
  });
  const name = mergeValue(ctx, reports, place("name"), field("name"), plainText);
  const fudaId = mergeValue(ctx, reports, place("fudaId"), field("fudaId"), (value, side) =>
    fudaNameIn(valueDocs(ctx, side), value),
  );
  const importance = mergeValue(ctx, reports, place("importance"), field("importance"), importanceLabel);
  const areaId = mergeValue(ctx, reports, place("areaId"), field("areaId"), (value, side) =>
    areaNameIn(valueDocs(ctx, side), value),
  );

  // 特効グループ（グループの報告は段階の報告に入れる）
  const groups = field("boosts");
  const mergedGroups = mergeUnits(
    ctx,
    groups,
    () => reports,
    (groupReports) => ({
      both: (b, m, t) => mergeGroup(ctx, groupReports, base.id, label, { base: b, mine: m, theirs: t }),
      place: (group) => ({
        location: { kind: "boostGroup", stageId: base.id, groupId: group.id, field: null },
        label: groupLabel(label, group.name),
        stageId: base.id,
      }),
    }),
  );
  // 特効グループは並べ替える操作がないため、並びが食い違っても衝突にしない
  const groupOrder = mergeOrder(ctx, new Set(mergedGroups.keys()), idsOfThree(groups), null);

  return { id: base.id, areaId, name, fudaId, importance, boosts: pickInOrder(groupOrder, mergedGroups) };
}

// ---- 全体 ----

/** 単位ごとの報告を、ID の並びの順に取り出す（並びにない ID の報告も落とさず最後に足す） */
function reportsInOrder(map: ReadonlyMap<string, Reports>, order: readonly string[]): Reports[] {
  const seen = new Set<string>();
  const result: Reports[] = [];
  for (const id of [...order, ...map.keys()]) {
    const reports = map.get(id);
    if (reports !== undefined && !seen.has(id)) {
      seen.add(id);
      result.push(reports);
    }
  }
  return result;
}

/** 選び方を決めて 3 方向マージを行う（mergeDefinitions・resolveMerge の共通の手順） */
function runMerge(input: MergeInput, choose: Chooser): MergeResult {
  const ctx: MergeContext = { base: input.base, mine: input.mine, theirs: input.theirs, choose };
  const { base, mine, theirs } = input;
  const docs = <T>(select: (doc: DefinitionDoc) => T): Three<T> => ({
    base: select(base),
    mine: select(mine),
    theirs: select(theirs),
  });

  // イベント
  const eventReports = newReports();
  const event = mergeEvent(ctx, eventReports);

  // 段階（特効グループを含む）。札・海域の参照の整合を決めるため、札・海域より先に合わせる
  const stageReports = new Map<string, Reports>();
  const mergedStages = mergeUnits(
    ctx,
    docs((d) => d.stages),
    (id) => reportsFor(stageReports, id),
    (reports) => ({
      both: (b, m, t) => mergeStage(ctx, reports, { base: b, mine: m, theirs: t }),
      place: (stage) => ({
        location: { kind: "stage", stageId: stage.id, field: null },
        label: stageLabelIn(labelDocs(ctx), stage.id),
        stageId: stage.id,
      }),
    }),
  );
  const usedFudaIds = new Set([...mergedStages.values()].map((s) => s.fudaId));
  const usedAreaIds = new Set([...mergedStages.values()].map((s) => s.areaId));

  // 札
  const fudaReports = new Map<string, Reports>();
  const mergedFudas = mergeUnits(
    ctx,
    docs((d) => d.fudas),
    (id) => reportsFor(fudaReports, id),
    (reports) => ({
      both: (b, m, t) => mergeFuda(ctx, reports, b, m, t),
      place: (fuda) => ({
        location: { kind: "fuda", fudaId: fuda.id, field: null },
        label: fudaLabel(fuda.name),
        stageId: null,
      }),
    }),
    (id) => usedFudaIds.has(id),
  );

  // 海域
  const areaReports = new Map<string, Reports>();
  const mergedAreas = mergeUnits(
    ctx,
    docs((d) => d.areas),
    (id) => reportsFor(areaReports, id),
    () => ({
      both: mergeArea,
      place: (area) => ({ location: { kind: "area", areaId: area.id }, label: area.name, stageId: null }),
    }),
    (id) => usedAreaIds.has(id),
  );

  // 並び順：札、海域（並べ替える操作がないため衝突にしない）、海域ごとの段階
  const fudaOrderReports = newReports();
  const fudaIds = mergeOrder(ctx, new Set(mergedFudas.keys()), idsOfThree(docs((d) => d.fudas)), {
    reports: fudaOrderReports,
    place: { location: { kind: "fudaOrder" }, label: FUDA_ORDER_LABEL, stageId: null },
    text: (ids) => orderText(ids.map((id) => fudaNameIn(labelDocs(ctx), id))),
  });
  const areaIds = mergeOrder(ctx, new Set(mergedAreas.keys()), idsOfThree(docs((d) => d.areas)), null);
  const stageOrderReports = new Map<string, Reports>();
  const stages = areaIds.flatMap((areaId) => {
    const members = new Set([...mergedStages.values()].filter((s) => s.areaId === areaId).map((s) => s.id));
    const order = mergeOrder(
      ctx,
      members,
      docs((d) => stageIdsInArea(d, areaId)),
      {
        reports: reportsFor(stageOrderReports, areaId),
        place: {
          location: { kind: "stageOrder", areaId },
          label: stageOrderLabel(areaNameIn(labelDocs(ctx), areaId)),
          stageId: null,
        },
        text: (ids) => orderText(ids.map((id) => stageNameIn(labelDocs(ctx), id))),
      },
    );
    return pickInOrder(order, mergedStages);
  });

  const merged: DefinitionDoc = {
    schemaVersion: mine.schemaVersion,
    event,
    areas: pickInOrder(areaIds, mergedAreas),
    fudas: pickInOrder(fudaIds, mergedFudas),
    stages,
  };

  // 報告の並び：イベント → 海域 → 札 → 札の並び順 → 海域ごとの段階（各海域の最後にその海域の段階の並び順）
  const stageSection: Reports[] = [];
  const stageOrder: string[] = [];
  for (const { areaId, stageIds } of stageReportOrder(base, merged)) {
    stageOrder.push(...stageIds);
    stageSection.push(...pickInOrder(stageIds, stageReports));
    const orderReports = stageOrderReports.get(areaId);
    if (orderReports !== undefined) stageSection.push(orderReports);
  }
  // 並びに出てこなかった段階の報告（通常は起きない）も落とさない
  const shownStages = new Set(stageOrder);
  for (const [id, reports] of stageReports) {
    if (!shownStages.has(id)) stageSection.push(reports);
  }

  const all: Reports[] = [
    eventReports,
    ...reportsInOrder(areaReports, unionOrder(idsOf(base.areas), areaIds)),
    ...reportsInOrder(fudaReports, unionOrder(idsOf(base.fudas), fudaIds)),
    fudaOrderReports,
    ...stageSection,
  ];
  return {
    merged,
    autoMerged: all.flatMap((r) => r.autoMerged),
    conflicts: all.flatMap((r) => r.conflicts),
    issues: findDocumentIssues(merged),
  };
}

/** 3 方向マージ。自動で合わせた所・衝突・（衝突は自分の内容を仮に入れた）合わせた文書・その文書の問題を返す */
export function mergeDefinitions(input: MergeInput): MergeResult {
  return runMerge(input, () => "mine");
}

/** 選択の中から、その衝突の ID の選択を取り出す（選んでいなければ undefined） */
function choiceOf(choices: ConflictChoices, id: string): ConflictChoice | undefined {
  if (!Object.hasOwn(choices, id)) return undefined;
  const choice = choices[id];
  return choice === "theirs" || choice === "mine" ? choice : undefined;
}

/**
 * 衝突ごとの選択（相手の内容／自分の内容）から、最終的な文書を作る。確かめる順は次のとおり
 * 1. 選んでいない衝突があれば { ok: false, code: "unresolved", unresolved }（選んでいない衝突の ID）
 * 2. 最終的な文書に問題（findDocumentIssues）があれば { ok: false, code: "issues", issues, doc }（保存してはいけない）
 * 3. どちらもなければ { ok: true, doc }（衝突も問題もなければ、選択なしで merged と同じ文書）
 * - choices にある、衝突でない ID は無視する
 * - 衝突の一覧（mergeDefinitions の conflicts）は、すべて自分の内容を選んだ場合のもの。
 *   衝突の選び方によって衝突の一覧が増減しうる（参照の整合：段階の札の選び方で札が使われるかどうかが変わり、
 *   札の削除と変更の衝突が生じたり消えたりする）。選んだ後に新しく生じた衝突は、選んでいる間の表示と同じく自分の内容にし、
 *   選び方によって意味がなくなった衝突の選択は使われない
 */
export function resolveMerge(input: MergeInput, choices: ConflictChoices): ResolveResult {
  const { conflicts } = mergeDefinitions(input);
  const unresolved = conflicts.filter((c) => choiceOf(choices, c.id) === undefined).map((c) => c.id);
  if (unresolved.length > 0) return { ok: false, code: "unresolved", unresolved };
  // 選択を使って同じ手順で合わせ直す（選択の中にない衝突は自分の内容）
  const { merged, issues } = runMerge(input, (id) => choiceOf(choices, id) ?? "mine");
  if (issues.length > 0) return { ok: false, code: "issues", issues, doc: merged };
  return { ok: true, doc: merged };
}
