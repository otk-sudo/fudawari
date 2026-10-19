"use client";

import Link from "next/link";
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { DefinitionLoadAlert } from "@/components/DefinitionLoadAlert";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useLatestDefinition } from "@/lib/definition";
import { usePlanData } from "@/lib/plan";
import { ROUTES } from "@/lib/routes";
import { useShipMaster } from "@/lib/ship-master";
import type { ImportRecord } from "@/lib/storage";
import { ConfirmRemoveDialog } from "./ConfirmRemoveDialog";
import {
  clampMinLevel,
  formatImportedAt,
  IMPORT_SCREEN_TITLE,
  lockConditionLabel,
  MIN_LEVEL_HIGHEST,
  MIN_LEVEL_LOWEST,
  MIN_LEVEL_PRESETS,
  toMinLevel,
} from "./import-screen-text";
import { type ImportSummary, useImportFlow } from "./useImportFlow";
import styles from "./ImportScreen.module.css";

/** 貼り付ける前に欄の下に出す文（要件 3.4） */
const PRIVACY_NOTE = "データはこのブラウザの中だけで読み取ります";

/** 「取り込む艦娘」の選択肢（要件 3.4） */
const LOCK_OPTIONS: ReadonlyArray<{ value: string; lockedOnly: boolean; label: string; note: string }> = [
  { value: "all", lockedOnly: false, label: "すべての艦娘", note: "未ロックの艦も含める" },
  { value: "locked", lockedOnly: true, label: "ロック済みだけ", note: "育成中・保護中の艦に絞る" },
];

/** ヘッダーに出す「最終取り込み 10/15 20:40 ／ 5隻」 */
function lastImportNote(record: ImportRecord): string {
  const importedAt = formatImportedAt(record.importedAt);
  return importedAt === null
    ? `最終取り込み ／ ${record.shipCount}隻`
    : `最終取り込み ${importedAt} ／ ${record.shipCount}隻`;
}

type LoadAlertProps = {
  /** 何を読み込めなかったか */
  title: string;
  /** 理由の文（なければ出さない） */
  reason?: string;
};

/**
 * 艦船マスタ・ブラウザ内の保存を読み込めなかったことを知らせる警告（role="alert"）。
 * 公開定義の警告（DefinitionLoadAlert）と並べて出すため、同じ形・同じ見た目にする
 */
function LoadAlert({ title, reason }: LoadAlertProps): ReactNode {
  return (
    <div className={styles.loadAlertBody}>
      <div role="alert" className={styles.loadAlert}>
        <p className={styles.loadAlertTitle}>{title}</p>
        {reason !== undefined && <p className={styles.loadAlertReason}>{reason}</p>}
        <p className={styles.loadAlertAdvice}>ページを再読み込みしてください</p>
      </div>
    </div>
  );
}

type MinLevelFieldProps = {
  /** 欄の文字（打ち込みの途中の空・範囲外も含む） */
  value: string;
  onChange: (next: string) => void;
  /** 欄とボタンを操作できなくする（取り込みの処理中と確認の間） */
  disabled: boolean;
};

/**
 * Lv 下限の欄（「−」「＋」付きの数値欄・「以上」・すぐ選べる Lv1／Lv50／Lv99／Lv150）。
 * 打ち込みの途中は文字のまま持ち、欄を離れたときに 1〜185 に収める（空は 1。2026-10-17 親の決定）。
 * すぐ選べる Lv は、今の Lv 下限と同じものを押された状態（aria-pressed="true"）にする
 */
function MinLevelField({ value, onChange, disabled }: MinLevelFieldProps): ReactNode {
  const hintId = useId();
  const current = toMinLevel(value);

  return (
    <div className={styles.levelField}>
      <span id={hintId} className={styles.fieldLabel}>
        Lv がいくつ以上の艦を取り込むか
      </span>
      <div className={styles.levelRow}>
        <button
          type="button"
          aria-label="Lv下限を下げる"
          className={`${styles.stepButton} ${styles.stepButtonDown}`}
          disabled={disabled}
          onClick={() => onChange(String(clampMinLevel(current - 1)))}
        >
          −
        </button>
        <input
          type="number"
          min={MIN_LEVEL_LOWEST}
          max={MIN_LEVEL_HIGHEST}
          step={1}
          inputMode="numeric"
          aria-label="Lv下限"
          aria-describedby={hintId}
          className={styles.levelInput}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onChange(String(toMinLevel(event.currentTarget.value)))}
        />
        <button
          type="button"
          aria-label="Lv下限を上げる"
          className={`${styles.stepButton} ${styles.stepButtonUp}`}
          disabled={disabled}
          onClick={() => onChange(String(clampMinLevel(current + 1)))}
        >
          ＋
        </button>
        <span className={styles.levelSuffix}>以上</span>
      </div>
      <div className={styles.presets}>
        {MIN_LEVEL_PRESETS.map((level) => {
          const pressed = level === current;
          return (
            <button
              key={level}
              type="button"
              className={pressed ? `${styles.preset} ${styles.presetActive}` : styles.preset}
              // 押されていないボタンにも false を付け、押して切り替えるボタンであることを支援技術に伝える
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onChange(String(level))}
            >
              Lv{level}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 取り込みの完了の表示（要件 3.4：隻数 3 種と「割り振りへ進む」「差分を見る」。形式についての知らせも添える） */
function ImportDoneSummary({ summary }: { summary: ImportSummary }): ReactNode {
  return (
    <section className={styles.done}>
      <h2 className={styles.doneTitle}>取り込みました</h2>
      <ul className={styles.doneList}>
        <li>
          艦娘 <b>{summary.shipCount}隻</b>（{lockConditionLabel(summary.lockedOnly)}・Lv{summary.minLevel}以上）
        </li>
        <li>
          すでに札が付いている艦 <b>{summary.taggedShipCount}隻</b> → 計画との差分に使います
        </li>
        {summary.unknownShipCount > 0 && (
          <li className={styles.warning}>
            名前が分からない艦が <b>{summary.unknownShipCount}隻</b>{" "}
            います。新しく実装された艦かもしれません（取り込みは続けられます）
          </li>
        )}
        {summary.keptAssignmentCount > 0 && (
          <li>
            札割り <b>{summary.keptAssignmentCount}隻</b>を引き継ぎました
          </li>
        )}
        {summary.removedAssignmentCount > 0 && (
          <li>
            <b>{summary.removedAssignmentCount}件</b>の割り当てを外しました
          </li>
        )}
        {!summary.hasUid && (
          <li className={styles.warning}>
            個体 ID がない古い形式のため、前の割り当ては引き継げません（札割りは控えから始まります）
          </li>
        )}
        {summary.lockFilterIgnored && (
          <li className={styles.warning}>
            ロックの情報がない形式のため、「ロック済みだけ」で絞り込めませんでした（すべての艦娘を取り込みました）
          </li>
        )}
      </ul>
      {/*
        取り込みの直後に出るリンクなので、先読み（静的書き出しでは HEAD と取得の要求）はしない。
        行き先は左メニューのリンクが先読みしているため、移動は遅くならない
      */}
      {/*
        札が付いている艦がいるときは、計画との差分を先に確かめられるよう「差分を見る」を主なボタンにして先に並べる
        （UI／UX の指摘 中7）。いないときは「割り振りへ進む」が主
      */}
      <div className={styles.doneActions}>
        {summary.taggedShipCount > 0 ? (
          <>
            <Link href={ROUTES.drift} prefetch={false} className={styles.primaryLink}>
              差分を見る
            </Link>
            <Link href={ROUTES.assign} prefetch={false} className={styles.secondaryLink}>
              割り振りへ進む
            </Link>
          </>
        ) : (
          <>
            <Link href={ROUTES.assign} prefetch={false} className={styles.primaryLink}>
              割り振りへ進む
            </Link>
            <Link href={ROUTES.drift} prefetch={false} className={styles.secondaryLink}>
              差分を見る
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * 取り込み画面の本文（要件 3.4、モック Import.dc.html、roadmap T2-4）。
 *
 * - 艦船マスタ（useShipMaster）・最新イベントの定義（useLatestDefinition）・札割りのデータ（usePlanData）・
 *   保存先（getPlanStorage。useImportFlow の中）を自分で読む
 * - ヘッダー：画面名（h1）と「最終取り込み 10/15 20:40 ／ 5隻」（取り込んだことがあるときだけ）
 * - 左：「艦娘の情報をコピーする」「ここに貼り付ける」と貼り付け欄。右：「取り込む範囲」と「取り込む」
 * - 取り込みは 解析 → 外れる割り当ての件数 → 必要なら確認 → 保存 → 読み直し（useImportFlow）
 * - 公開定義を読み込めなくても取り込める（共通の警告を出し、取り込んだ後の読み直しは定義が読めたときだけ。2026-10-17 親の決定）。
 *   取り込みの途中で定義が読めたときは、保存した後に読み直す
 * - 艦船マスタの読み込み中・失敗のときと、取り込みの途中は「取り込む」を押せない（マスタの読み込み中も、ほかの入力は止めない）
 * - 取り込みの処理中と確認の間は、貼り付け欄・取り込む範囲・Lv 下限を操作できない
 *   （取り込む内容が、押したときの内容と食い違わないように。貼り付け欄は中身を読めるよう readOnly、ほかは disabled）
 * - 貼り付けた内容はこのブラウザの中だけで解析・保存し、通信には乗せない
 */
export function ImportScreen(): ReactNode {
  const masterState = useShipMaster();
  const definitionState = useLatestDefinition();
  const definition = definitionState.status === "success" ? definitionState.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);

  const [pasted, setPasted] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [minLevelText, setMinLevelText] = useState(String(MIN_LEVEL_LOWEST));
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const lockGroupName = useId();
  const pasteNoteId = useId();
  const importNoteId = useId();

  const flow = useImportFlow({
    master: masterState.status === "success" ? masterState.master : null,
    latestEventId: definition?.event.id ?? null,
    // useImportFlow は、保存した時点で最後に描いたときのこの関数を呼ぶ。
    // そのため、取り込みの途中で定義が読めても、その定義で読み込んだ札割りのデータを読み直す
    onImported: () => {
      // 読み込む対象のイベントがない（定義を読めていない）ときは読み直さない
      if (definition !== null) void plan.reload();
    },
  });
  const { state } = flow;
  // 取り込みの処理中と確認の間（入力を操作できない間）
  const busy = state.status === "working" || state.status === "confirm";
  const canImport = masterState.status === "success" && !busy;

  function handleImport(): void {
    if (!canImport) return;
    // 欄に範囲外の値が残っていたら、1〜185 に収めた値で取り込み、欄もその値にする
    const minLevel = toMinLevel(minLevelText);
    setMinLevelText(String(minLevel));
    void flow.start(pasted, { lockedOnly, minLevel });
  }

  const lastImport = plan.status === "ready" ? plan.lastImport : null;
  // 貼り付け欄の枠の色：取り込みに失敗したとき・貼り付けた後・貼り付ける前（モックと同じ 3 つ）
  const pasteBoxStateClass =
    state.status === "failed" ? styles.pasteBoxError : pasted !== "" ? styles.pasteBoxFilled : undefined;
  const pasteBoxClass = pasteBoxStateClass === undefined ? styles.pasteBox : `${styles.pasteBox} ${pasteBoxStateClass}`;

  return (
    <>
      <ScreenHeader title={IMPORT_SCREEN_TITLE} note={lastImport !== null ? lastImportNote(lastImport) : undefined} />
      {definitionState.status === "error" && <DefinitionLoadAlert error={definitionState.error} />}
      {masterState.status === "error" && (
        <LoadAlert title="艦船マスタを読み込めませんでした" reason={masterState.error.message} />
      )}
      {plan.status === "error" && <LoadAlert title={plan.error.message} />}

      <div className={styles.body}>
        <section aria-label="取り込み" className={styles.panel}>
          <div className={styles.pasteColumn}>
            <h2 className={styles.step}>
              <span className={styles.stepNumber}>1</span>
              <span>艦娘の情報をコピーする</span>
            </h2>
            <p className={styles.stepText}>制空権シミュレータに艦娘を反映するときと同じ方法でコピーしてください。</p>
            <h2 className={`${styles.step} ${styles.stepNext}`}>
              <span className={styles.stepNumber}>2</span>
              <span>ここに貼り付ける</span>
            </h2>
            <textarea
              aria-label="艦娘の情報を貼り付け"
              aria-describedby={pasteNoteId}
              placeholder="Ctrl+V で貼り付け"
              rows={7}
              spellCheck={false}
              className={pasteBoxClass}
              value={pasted}
              readOnly={busy}
              onChange={(event) => {
                setPasted(event.target.value);
                flow.dismissFailure();
              }}
            />
            <span id={pasteNoteId} className={styles.pasteNote}>
              {pasted === "" ? PRIVACY_NOTE : `貼り付けました（${pasted.length}文字）`}
            </span>
          </div>

          <div className={styles.rangeColumn}>
            <h2 className={styles.rangeTitle}>取り込む範囲</h2>
            <div role="radiogroup" aria-label="取り込む艦娘" className={styles.lockOptions}>
              {LOCK_OPTIONS.map((option) => {
                const checked = lockedOnly === option.lockedOnly;
                return (
                  <label
                    key={option.value}
                    className={checked ? `${styles.lockOption} ${styles.lockOptionChecked}` : styles.lockOption}
                  >
                    <input
                      type="radio"
                      name={lockGroupName}
                      value={option.value}
                      className={styles.visuallyHidden}
                      checked={checked}
                      disabled={busy}
                      onChange={() => setLockedOnly(option.lockedOnly)}
                    />
                    <span className={styles.lockLabel}>{option.label}</span>
                    <span className={styles.lockNote}>{option.note}</span>
                  </label>
                );
              })}
            </div>
            <MinLevelField value={minLevelText} onChange={setMinLevelText} disabled={busy} />
            <span className={styles.spacer} />
            <button
              ref={importButtonRef}
              type="button"
              className={styles.importButton}
              // 押せない間もフォーカスは残す（確認を閉じた後にフォーカスを戻す先にもなる）。押しても何もしない
              aria-disabled={!canImport}
              aria-describedby={masterState.status === "loading" ? importNoteId : undefined}
              onClick={handleImport}
            >
              取り込む
            </button>
            {masterState.status === "loading" && (
              <p id={importNoteId} className={styles.importNote}>
                艦船マスタを読み込んでいます
              </p>
            )}
          </div>
        </section>

        {/* 失敗するたびに番号の key で作り直し、同じ理由で続けて失敗しても読み上げ直されるようにする */}
        {state.status === "failed" && (
          <div key={state.seq} role="alert" className={styles.error}>
            {state.message}
          </div>
        )}

        {/* 完了の表示は、出たときに読み上げられるよう、先に置いた role="status" の中に出す */}
        <div role="status" className={styles.statusRegion}>
          {state.status === "done" && <ImportDoneSummary summary={state.summary} />}
        </div>
      </div>

      <ConfirmRemoveDialog
        confirmation={
          state.status === "confirm"
            ? {
                removedAssignmentCount: state.pending.removedAssignmentCount,
                hasUid: state.pending.parsed.hasUid,
              }
            : null
        }
        onConfirm={() => void flow.confirm()}
        onCancel={flow.cancel}
        returnFocusRef={importButtonRef}
      />
    </>
  );
}
