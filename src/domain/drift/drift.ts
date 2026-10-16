// 差分（計画と実際の札。要件 3.5、roadmap T2-11）の判定と反映。純粋な関数
//
// - 実際の札（OwnedShip.sallyArea）は、定義の札の「ゲーム内の札番号」（Fuda.gameNumber）で定義の札に対応付ける。
//   検証済みの定義では札番号は札どうしで重複しないが、重複していても止まらないよう、定義の順で先の札を使う。
// - 渡した艦・割り当て・札は読むだけで書き換えない（凍結した値でもそのまま渡せる）。結果はすべて新しい値。
import type { Fuda } from "@/domain/definition/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import type {
  DriftApplyResult,
  DriftEntry,
  DriftExcludedEntry,
  DriftExcludedReason,
  DriftInput,
  DriftKind,
  DriftReport,
  DriftSummaryItem,
  DriftUndo,
  DriftUndoChange,
  FudaProgress,
} from "./types";

/** 実際の札の番号で「札なし」を表す値（取り込みデータの api_sally_area の 0） */
const NO_FUDA = 0;

/** 件数のまとめの順と画面に出す名前（要件 3.5 の順と用語） */
const SUMMARY_LABELS: readonly { readonly kind: DriftKind; readonly label: string }[] = [
  { kind: "differentFuda", label: "計画と違う札が付いた" },
  { kind: "unplanned", label: "計画にない艦に札が付いた" },
  { kind: "asPlanned", label: "計画どおり" },
  { kind: "notSortied", label: "まだ出撃していない" },
];

/** 反映する分類（対応が必要な件）。「計画どおり」「まだ出撃していない」は反映しない */
const APPLICABLE_KINDS: ReadonlySet<DriftKind> = new Set<DriftKind>(["differentFuda", "unplanned"]);

/** 札 ID → 札（ID が重複していたら定義の順で先の札） */
function fudaIndexById(fudas: readonly Fuda[]): ReadonlyMap<string, Fuda> {
  const byId = new Map<string, Fuda>();
  for (const fuda of fudas) {
    if (!byId.has(fuda.id)) byId.set(fuda.id, fuda);
  }
  return byId;
}

/** 札番号 → 札（札番号が未入力の札は入れない。番号が重複していたら定義の順で先の札） */
function fudaIndexByGameNumber(fudas: readonly Fuda[]): ReadonlyMap<number, Fuda> {
  const byNumber = new Map<number, Fuda>();
  for (const fuda of fudas) {
    if (fuda.gameNumber !== null && !byNumber.has(fuda.gameNumber)) byNumber.set(fuda.gameNumber, fuda);
  }
  return byNumber;
}

/**
 * 割り当ての札 ID を読む。控え（キーなし・undefined）は null。
 * 継承したプロパティ（toString など）を札 ID と取り違えないよう、文字列のときだけ札 ID とする
 */
function assignedFudaId(assignments: AssignmentMap, uid: ShipUid): string | null {
  const fudaId = assignments[uid];
  return typeof fudaId === "string" ? fudaId : null;
}

/** 分類した 1 隻を作る */
function driftEntryOf(
  ship: OwnedShip,
  kind: DriftKind,
  plannedFudaId: string | null,
  actualFudaId: string | null,
): DriftEntry {
  return { uid: ship.uid, shipId: ship.shipId, kind, plannedFudaId, actualFudaId, actualGameNumber: ship.sallyArea };
}

/** 対象外にした 1 隻を作る */
function excludedEntryOf(
  ship: OwnedShip,
  reason: DriftExcludedReason,
  plannedFudaId: string | null,
): DriftExcludedEntry {
  return { uid: ship.uid, shipId: ship.shipId, reason, plannedFudaId, actualGameNumber: ship.sallyArea };
}

/**
 * 取り込んだ個体の実際の札と計画を比べ、4 つの分類・件数のまとめ・対応が必要な一覧・対象外・札ごとの進み具合を返す。
 * 渡した値は書き換えない
 */
export function computeDrift(input: DriftInput): DriftReport {
  const { ships, assignments, fudas } = input;
  const fudaById = fudaIndexById(fudas);
  const fudaByNumber = fudaIndexByGameNumber(fudas);

  const entries: DriftEntry[] = [];
  const excluded: DriftExcludedEntry[] = [];
  // 札 ID → 計画の隻数・札付き（計画どおり）の隻数
  const plannedCounts = new Map<string, number>();
  const taggedCounts = new Map<string, number>();

  for (const ship of ships) {
    const actualGameNumber = ship.sallyArea;
    // 定義にない札 ID への割り当ては控えとして扱う（U17）
    const assignedId = assignedFudaId(assignments, ship.uid);
    const planned = assignedId === null ? undefined : fudaById.get(assignedId);
    const actualFuda = actualGameNumber === NO_FUDA ? undefined : fudaByNumber.get(actualGameNumber);

    if (planned === undefined) {
      // 控えの艦。札が付いていなければどこにも入れない
      if (actualGameNumber === NO_FUDA) continue;
      if (actualFuda === undefined) {
        // 定義のどの札番号にも当たらない札は、計画に追加できないので対象外
        excluded.push(excludedEntryOf(ship, "unknownGameNumber", null));
      } else {
        entries.push(driftEntryOf(ship, "unplanned", null, actualFuda.id));
      }
      continue;
    }

    plannedCounts.set(planned.id, (plannedCounts.get(planned.id) ?? 0) + 1);

    if (planned.gameNumber === null) {
      // 札番号が未入力の札に置いた艦は、実際の札に関わらず比べられないので対象外（U10）
      excluded.push(excludedEntryOf(ship, "plannedFudaWithoutNumber", planned.id));
    } else if (actualGameNumber === NO_FUDA) {
      entries.push(driftEntryOf(ship, "notSortied", planned.id, null));
    } else if (actualGameNumber === planned.gameNumber) {
      taggedCounts.set(planned.id, (taggedCounts.get(planned.id) ?? 0) + 1);
      entries.push(driftEntryOf(ship, "asPlanned", planned.id, planned.id));
    } else {
      // 定義のどの札番号にも当たらない札でも、計画と違うのは確かなので「計画と違う札が付いた」（実際の札 ID は null）
      entries.push(driftEntryOf(ship, "differentFuda", planned.id, actualFuda?.id ?? null));
    }
  }

  const summary: DriftSummaryItem[] = SUMMARY_LABELS.map(({ kind, label }) => ({
    kind,
    label,
    count: entries.filter((entry) => entry.kind === kind).length,
  }));

  const issues: DriftEntry[] = [
    ...entries.filter((entry) => entry.kind === "differentFuda"),
    ...entries.filter((entry) => entry.kind === "unplanned"),
  ];

  const progress: FudaProgress[] = fudas.map((fuda) => ({
    fudaId: fuda.id,
    planned: plannedCounts.get(fuda.id) ?? 0,
    tagged: fuda.gameNumber === null ? null : (taggedCounts.get(fuda.id) ?? 0),
  }));

  return { summary, issues, entries, excluded, progress };
}

/**
 * 差分の件を計画に反映する（「計画を実際に合わせる」「計画に追加する」、まとめての反映）。
 * 実際の札が正しいものとして割り当てを書き換える。札が抜けた枠は空いたまま（ほかの艦で埋めない）。
 * 実際の札 ID が null の件（定義のどの札番号にも当たらない札）は、控えに戻す（割り当てのキーを消す）。
 * 「計画どおり」「まだ出撃していない」の件は反映しない。渡した割り当ては書き換えない
 */
export function applyDriftEntries(
  assignments: AssignmentMap,
  entries: readonly DriftEntry[],
): DriftApplyResult {
  const next: Partial<Record<ShipUid, string>> = { ...assignments };
  const applied: DriftEntry[] = [];
  const changes: DriftUndoChange[] = [];

  for (const entry of entries) {
    if (!APPLICABLE_KINDS.has(entry.kind)) continue;
    // 反映前の札は件に書かれた計画ではなく、今の割り当てから読む（元に戻すときに今の値へ正しく戻すため）
    const before = assignedFudaId(next, entry.uid);
    const after = entry.actualFudaId;
    if (after === null) {
      delete next[entry.uid];
    } else {
      next[entry.uid] = after;
    }
    applied.push(entry);
    changes.push({ uid: entry.uid, before, after });
  }

  return { assignments: next, applied, undo: changes.length > 0 ? { changes } : null };
}

/**
 * 反映を元に戻す（直前の反映 1 回分）。記録にある個体だけを反映前の札（控えならキーなし）に戻し、
 * ほかの個体の割り当ては今の値のままにする。渡した割り当ては書き換えない
 */
export function undoDriftApply(assignments: AssignmentMap, undo: DriftUndo): AssignmentMap {
  const next: Partial<Record<ShipUid, string>> = { ...assignments };
  // 同じ個体を 1 回の反映で 2 度変えていても最初の札に戻るよう、反映と逆の順に戻す
  for (const change of [...undo.changes].reverse()) {
    if (change.before === null) {
      delete next[change.uid];
    } else {
      next[change.uid] = change.before;
    }
  }
  return next;
}
