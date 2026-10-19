"use client";

// 差分の画面の中身（roadmap T2-11、要件 3.5、U10・U23、モック Drift.dc.html）
//
// - 件数のまとめ（4 つ）・対応が必要な一覧・札ごとの進み具合を、共有の札割りのデータ（取り込んだ艦の実際の札と、計画の割り当て）から
//   computeDrift で求めて出す。割り当てが変わる（反映・元に戻す・ほかの部品の変更）たびに計算し直す。
// - 反映（「計画を実際に合わせる」「計画に追加する」、まとめての反映）と元に戻すは、setAssignments に「今の割り当てから作る関数」を
//   渡して行う（ほかの部品が同じ時に変えた分を消さない）。保存はブラウザ内だけ。
// - 元に戻せるのは直前の反映 1 回分だけ。反映の後にほかの部品が割り当てを変えたら（読み直しを含む）、その記録は使わない。
// - 代わりの艦の提案は出さない。「代わりの艦を探す」は割り振り画面へ移動するだけ（U23）。
// - 札番号が未入力の札は比べられないので、その札に置いた艦は差分の対象外にする（U10）。札ごとに「比べられません」を繰り返さず、
//   比べられる札（札番号のある札）の数で出し分ける（UI／UX レビュー 高2）。
//   - 一部の札だけ札番号がない：上に帯「札番号が未入力の札（n 札）は差分の対象外です」を一度だけ出し、進み具合はその札に短い印だけ
//   - 全札に札番号がない：件数のまとめと「対応が必要」の欄の代わりに、帯「この定義には札番号がないため、差分を比べられません」を
//     1 つだけ出す（何も比べていないのに「対応が必要なものはありません」と出さない）
import Link from "next/link";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PublicDefinition } from "@/domain/definition/types";
import {
  applyDriftEntries,
  computeDrift,
  type DriftApplyResult,
  type DriftKind,
  type DriftUndo,
  undoDriftApply,
} from "@/domain/drift";
import type { ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { PlanData } from "@/lib/plan";
import { ROUTES } from "@/lib/routes";
import {
  excludedFudasMessage,
  type FudaChip,
  fudaMapOf,
  gameNumberCoverageOf,
  inkOn,
  type IssueView,
  issueViewOf,
  NO_GAME_NUMBER_MESSAGE,
  type ProgressView,
  progressViewsOf,
} from "./drift-view";
import styles from "./DriftScreen.module.css";

/** 準備完了の札割りのデータ */
type ReadyPlanData = Extract<PlanData, { status: "ready" }>;

export type DriftScreenProps = {
  /** 最新イベントの公開定義 */
  definition: PublicDefinition;
  /** 艦船マスタ（艦名・特効の照合に使う） */
  master: ShipMaster;
  /** 共有の札割りのデータ（準備完了。取り込んだ艦がいる） */
  plan: ReadyPlanData;
};

/** 直前の反映の記録（元に戻すため。画面は最後の 1 回分だけを持つ） */
interface AppliedRecord {
  /** 元に戻すための記録 */
  undo: DriftUndo;
  /** 反映した艦の名前（反映した順） */
  shipNames: readonly string[];
  /** 反映した直後の割り当て。共有の札割りのデータの割り当てがこれと違えば（ほかの部品が変えた・読み直した）、記録を使わない */
  assignments: AssignmentMap;
}

/** 件数のまとめの分類ごとの見た目（モックの赤・橙・緑・灰） */
const SUMMARY_TONE: Readonly<Record<DriftKind, string>> = {
  differentFuda: styles.toneDanger,
  unplanned: styles.toneWarning,
  asPlanned: styles.toneOk,
  notSortied: styles.toneNeutral,
};

/** まとめての確認の注意書き（要件 3.5） */
const BULK_NOTE =
  "実際に付いた札が正しいものとして計画を書き換えます。札が抜けた枠は空いたままになるので、あとで割り振り画面で埋めてください";

/** 差分の画面の中身 */
export function DriftScreen({ definition, master, plan }: DriftScreenProps): ReactNode {
  const { ships, assignments, setAssignments, saveError } = plan;
  const fudas = useMemo(() => fudaMapOf(definition), [definition]);
  const report = useMemo(
    () => computeDrift({ ships, assignments, fudas: definition.fudas }),
    [ships, assignments, definition],
  );
  const issues = useMemo(() => {
    const shipByUid = new Map(ships.map((ship) => [ship.uid, ship]));
    return report.issues.map((entry) => issueViewOf(definition, master, fudas, entry, shipByUid.get(entry.uid)));
  }, [report, ships, definition, master, fudas]);
  const progress = useMemo(() => progressViewsOf(fudas, report.progress), [fudas, report]);
  const coverage = gameNumberCoverageOf(progress);

  const [record, setRecord] = useState<AppliedRecord | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkButtonRef = useRef<HTMLButtonElement>(null);
  /** 見出し「対応が必要 n件」（tabIndex=-1。押したボタンが消えたときのフォーカスの戻り先） */
  const issuesHeadingRef = useRef<HTMLHeadingElement>(null);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  /** 反映の後に「元に戻す」へフォーカスを移すか（押したボタンが一覧から消えるため） */
  const focusUndoAfterApply = useRef(false);
  const issuesHeadingId = useId();
  const progressHeadingId = useId();

  // ほかの部品が割り当てを変えた（読み直しを含む）後は、元に戻す記録を使わない（「元に戻す」を出さない）
  const activeRecord = record !== null && record.assignments === assignments ? record : null;

  useEffect(() => {
    if (!focusUndoAfterApply.current) return;
    focusUndoAfterApply.current = false;
    undoButtonRef.current?.focus();
  }, [record]);

  /** 件を計画に反映する（今の割り当てから作るので、ほかの部品が変えた分を消さない） */
  function apply(targets: readonly IssueView[]): void {
    const captured: { result: DriftApplyResult | null } = { result: null };
    // setAssignments は関数をその場で呼ぶ（準備完了でなければ呼ばない）。保存の失敗は状態（saveError）に入る
    void setAssignments((prev) => {
      const result = applyDriftEntries(
        prev,
        targets.map((target) => target.entry),
      );
      captured.result = result;
      return result.assignments;
    });
    setBulkOpen(false);
    const { result } = captured;
    if (result === null || result.undo === null) return;
    const nameByUid = new Map(targets.map((target) => [target.entry.uid, target.shipName]));
    focusUndoAfterApply.current = true;
    setRecord({
      undo: result.undo,
      shipNames: result.applied.map((entry) => nameByUid.get(entry.uid) ?? ""),
      assignments: result.assignments,
    });
  }

  /** 直前の反映を元に戻す（記録にある個体だけを戻す） */
  function undo(): void {
    if (activeRecord === null) return;
    const { undo: change } = activeRecord;
    void setAssignments((prev) => undoDriftApply(prev, change));
    setRecord(null);
    // 「元に戻す」は消えるので、一覧の見出しへフォーカスを移す
    issuesHeadingRef.current?.focus();
  }

  /**
   * まとめての確認を「やめる」（Esc）で閉じる。フォーカスを開いたボタンへ戻す。開いている間に件数が減って
   * ボタンが消えていたら（外れた ref は null）、一覧の見出しへ移す
   */
  function cancelBulk(): void {
    setBulkOpen(false);
    (bulkButtonRef.current ?? issuesHeadingRef.current)?.focus();
  }

  const progressSection = (
    <section aria-labelledby={progressHeadingId} className={styles.section}>
      <h2 id={progressHeadingId} className={styles.heading}>
        札ごとの進み具合
      </h2>
      <ul className={styles.progressGrid}>
        {progress.map((item) => (
          <ProgressItem key={item.fudaId} item={item} markMissingNumber={coverage.kind === "partial"} />
        ))}
      </ul>
    </section>
  );

  // 比べられる札が 1 つもなければ、件数のまとめと「対応が必要」の欄の代わりに帯を 1 つだけ出す
  if (coverage.kind === "none") {
    return (
      <div className={styles.screen}>
        <p className={styles.notice}>{NO_GAME_NUMBER_MESSAGE}</p>
        {saveError !== null && (
          <p role="alert" className={styles.saveError}>
            {saveError.message}
          </p>
        )}
        {progressSection}
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      {coverage.kind === "partial" && <p className={styles.notice}>{excludedFudasMessage(coverage.missing)}</p>}
      <ul aria-label="件数のまとめ" className={styles.summary}>
        {report.summary.map((item) => (
          <li key={item.kind} className={`${styles.summaryItem} ${SUMMARY_TONE[item.kind]}`}>
            <span className={styles.summaryCount}>{item.count}</span>
            <span className={styles.summaryLabel}>{item.label}</span>
          </li>
        ))}
      </ul>

      <section aria-labelledby={issuesHeadingId} className={styles.section}>
        <div className={styles.issuesHead}>
          <h2 ref={issuesHeadingRef} id={issuesHeadingId} tabIndex={-1} className={styles.heading}>
            対応が必要 {issues.length}件
          </h2>
          <span className={styles.spacer} aria-hidden="true" />
          {issues.length >= 2 && (
            <button
              ref={bulkButtonRef}
              type="button"
              className={styles.bulkButton}
              aria-expanded={bulkOpen}
              onClick={() => setBulkOpen(true)}
            >
              計画をまとめて実際に合わせる
            </button>
          )}
        </div>
        {bulkOpen && issues.length > 0 && <BulkConfirm issues={issues} onApply={apply} onCancel={cancelBulk} />}
        {saveError !== null && (
          <p role="alert" className={styles.saveError}>
            {saveError.message}
          </p>
        )}
        {/* 反映後の知らせ。読み上げで知らせるよう、知らせの入れ物（role="status"）は常に置いておく */}
        <div role="status">
          {activeRecord !== null && (
            <div className={styles.done}>
              <span className={styles.doneText}>
                {`${activeRecord.shipNames.length}件を計画に反映しました（${activeRecord.shipNames.join("・")}）`}
              </span>
              <button ref={undoButtonRef} type="button" className={styles.undoButton} onClick={undo}>
                元に戻す
              </button>
            </div>
          )}
        </div>
        {issues.length === 0 && activeRecord === null && (
          <p className={styles.allDone}>対応が必要なものはありません</p>
        )}
        {issues.map((issue) => (
          <IssueCard key={issue.entry.uid} issue={issue} onApply={() => apply([issue])} />
        ))}
      </section>

      {progressSection}
    </div>
  );
}

// ---- 札の表示 ----

/** 札の色の上の文字の色のクラス */
function inkClass(color: string): string {
  return inkOn(color) === "dark" ? styles.inkDark : styles.inkLight;
}

/** 札の表示（定義の札は札の色、定義の札でなければ灰色） */
function chipClass(chip: FudaChip): string {
  return chip.color === null ? `${styles.chip} ${styles.chipNone}` : `${styles.chip} ${inkClass(chip.color)}`;
}

/** 札の表示の下地（定義の札だけ札の色） */
function chipStyle(chip: FudaChip): { background: string } | undefined {
  return chip.color === null ? undefined : { background: chip.color };
}

// ---- 対応が必要な 1 件 ----

function IssueCard({ issue, onApply }: { issue: IssueView; onApply: () => void }): ReactNode {
  const different = issue.entry.kind === "differentFuda";
  return (
    <article className={`${styles.issue} ${different ? styles.issueDanger : styles.issueWarning}`}>
      <div className={styles.issueMain}>
        <div className={styles.issueLine}>
          {/* 艦名の帯の左端は実際の札の色（モックどおり） */}
          <span
            className={styles.shipBanner}
            style={issue.actual.color === null ? undefined : { boxShadow: `inset 4px 0 0 ${issue.actual.color}` }}
          >
            <span className={styles.shipName}>{issue.shipName}</span>
            {issue.level !== null && (
              <>
                {" "}
                <span className={styles.shipLevel}>{`Lv ${issue.level}`}</span>
              </>
            )}
          </span>
          <span className={styles.visuallyHidden}>計画の札：</span>
          <del className={`${chipClass(issue.planned)} ${styles.chipPlanned}`} style={chipStyle(issue.planned)}>
            {issue.planned.label}
          </del>
          <span aria-hidden="true" className={styles.arrow}>
            →
          </span>
          <span className={styles.visuallyHidden}>実際の札：</span>
          <span className={chipClass(issue.actual)} style={chipStyle(issue.actual)}>
            {issue.actual.label}
          </span>
        </div>
        <p className={styles.issueText}>{issue.description}</p>
      </div>
      <div className={styles.issueActions}>
        {different ? (
          <>
            <Link href={ROUTES.assign} className={styles.primaryButton}>
              代わりの艦を探す
            </Link>
            <button type="button" className={styles.secondaryButton} onClick={onApply}>
              計画を実際に合わせる
            </button>
          </>
        ) : (
          <button type="button" className={styles.primaryButton} onClick={onApply}>
            計画に追加する
          </button>
        )}
      </div>
    </article>
  );
}

// ---- まとめての確認 ----

type BulkConfirmProps = {
  /** 対応が必要な件（画面の順） */
  issues: readonly IssueView[];
  /** 「n件を計画に反映する」（チェックした件を渡す。1 件以上） */
  onApply: (targets: readonly IssueView[]) => void;
  /** 「やめる」（Esc も同じ） */
  onCancel: () => void;
};

/**
 * 「計画をまとめて実際に合わせる」の確認の枠（モックどおり一覧の上に開く枠。role="group"、名前「まとめて合わせる確認」。
 * 画面の操作を止めない枠なので、確認のウィンドウ（モーダル）にはしない）。開いたら枠へフォーカスを移す。
 * 開くたびに作り直すので、チェックは全部 ON から始まる。チェックを外した件だけを覚える（開いている間に増えた件は ON）
 */
function BulkConfirm({ issues, onApply, onCancel }: BulkConfirmProps): ReactNode {
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  const picked = issues.filter((issue) => !unchecked.has(issue.entry.uid));

  // 開いたら枠へフォーカスを移す（読み上げで確認の内容を知らせる）
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  function toggle(uid: string): void {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="まとめて合わせる確認"
      aria-describedby={descriptionId}
      tabIndex={-1}
      className={styles.bulk}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <p id={descriptionId} className={styles.bulkTitle}>
        次の変更を計画に反映します。合わせないものはチェックを外してください
      </p>
      <ul className={styles.bulkList}>
        {issues.map((issue) => {
          const { uid } = issue.entry;
          return (
            <li key={uid}>
              <label className={styles.bulkRow}>
                <input
                  type="checkbox"
                  className={styles.bulkCheck}
                  checked={!unchecked.has(uid)}
                  onChange={() => toggle(uid)}
                />{" "}
                <span className={styles.bulkName}>{issue.shipName}</span>{" "}
                {issue.level !== null && (
                  <>
                    <span className={styles.bulkLevel}>{`Lv ${issue.level}`}</span>{" "}
                  </>
                )}
                <span className={styles.bulkChange}>{`計画 ${issue.planned.label} → ${issue.actual.label}`}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className={styles.bulkNote}>{BULK_NOTE}</p>
      <div className={styles.bulkActions}>
        <button
          type="button"
          className={styles.bulkApply}
          disabled={picked.length === 0}
          onClick={() => {
            if (picked.length > 0) onApply(picked);
          }}
        >
          {`${picked.length}件を計画に反映する`}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

// ---- 札ごとの進み具合 ----

/**
 * 札ごとの進み具合の 1 つ。札番号が未入力の札（札付きが null）は計画の隻数だけを出す。
 * markMissingNumber が true（一部の札だけ札番号がない）なら、短い印「札番号なし」を添える（理由は上の帯に一度だけ書く）
 */
function ProgressItem({ item, markMissingNumber }: { item: ProgressView; markMissingNumber: boolean }): ReactNode {
  return (
    <li className={styles.progressCard}>
      <div className={`${styles.progressHead} ${inkClass(item.color)}`} style={{ background: item.color }}>
        {item.name}
      </div>
      <div className={styles.progressBody}>
        {item.tagged === null ? (
          <span className={styles.progressText}>
            {markMissingNumber ? `札番号なし ／ 計画 ${item.planned}隻` : `計画 ${item.planned}隻`}
          </span>
        ) : (
          <>
            <div className={styles.progressBar} aria-hidden="true">
              <span
                className={styles.progressFill}
                style={{
                  width: `${item.planned === 0 ? 0 : Math.round((Math.min(item.tagged, item.planned) / item.planned) * 100)}%`,
                  background: item.color,
                }}
              />
            </div>
            <span className={styles.progressText}>{`札付き ${item.tagged} ／ 計画 ${item.planned}隻`}</span>
          </>
        )}
      </div>
    </li>
  );
}
