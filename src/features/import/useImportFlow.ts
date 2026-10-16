// 取り込みの流れ（要件 3.4、U9）：解析 → 外れる割り当ての件数 → 必要なら確認 → 保存 → 読み直し
//
// - 解析は parseImportText（@/domain/import。通信しない純粋な関数）。失敗したら理由を出し、保存先には触らない
// - 保存先は usePlanData と同じもの（getPlanStorage）。保存の前に previewImport で外れる割り当ての件数を数え、
//   1 件以上なら確認を挟む（2026-10-17 親の決定）。やめれば保存しない
// - 完了の表示の「外した件数」は saveImport の戻り値（確認の後に割り当てが変わっても、実際に外した件数を出す）
// - 解析〜保存の途中と確認待ちの間は、次の取り込みを受け付けない（二重押しを防ぐ）
// - 保存した後に呼ぶ onImported は、呼ぶ時点で最後に描いたときに渡されたものを使う
//   （取り込みの途中で公開定義が読めて札割りのデータの読み込み先が決まっても、最新の値で読み直せるように）
import { useEffect, useRef, useState } from "react";
import { type ImportFilter, type ImportSuccess, parseImportText } from "@/domain/import";
import type { ShipMaster } from "@/domain/master";
import { getPlanStorage } from "@/lib/plan";
import type { SaveImportInput } from "@/lib/storage";
import { failureMessage, SAVE_FAILED_MESSAGE } from "./import-screen-text";

/** 取り込みの結果（完了の表示に出すもの） */
export interface ImportSummary {
  /** 取り込んだ隻数 */
  shipCount: number;
  /** 実際に効いた「ロック済みだけ」（ロックの情報がない形式では false） */
  lockedOnly: boolean;
  /** Lv 下限 */
  minLevel: number;
  /** すでに札が付いている艦の数 */
  taggedShipCount: number;
  /** 名前が分からない艦（艦船マスタにない艦）の数 */
  unknownShipCount: number;
  /** 外した割り当ての件数（saveImport の戻り値） */
  removedAssignmentCount: number;
  /** 個体 ID があったか（false なら割り当てを引き継げなかった。U9） */
  hasUid: boolean;
  /** 「ロック済みだけ」を選んだが、ロックの情報がない形式のため効かなかった */
  lockFilterIgnored: boolean;
}

/** 確認を待っている取り込み */
export interface PendingImport {
  /** 解析の結果 */
  parsed: ImportSuccess;
  /** 取り込む範囲（選んだ条件） */
  filter: ImportFilter;
  /** 保存すると外れる割り当ての件数（previewImport の戻り値。1 以上） */
  removedAssignmentCount: number;
}

/** 取り込みの状態 */
export type ImportFlowState =
  /** 何もしていない（最初・確認でやめた後） */
  | { status: "idle" }
  /** 外れる割り当ての件数を数えている・保存している */
  | { status: "working" }
  /** 外れる割り当てがあるため、保存してよいかの確認を待っている */
  | { status: "confirm"; pending: PendingImport }
  /** 保存した */
  | { status: "done"; summary: ImportSummary }
  /**
   * 解析・保存に失敗した（理由の文つき）。
   * seq は失敗の番号（失敗するたびに増える）。警告の key に使い、同じ理由で続けて失敗しても警告を作り直して読み上げ直す
   */
  | { status: "failed"; message: string; seq: number };

export interface UseImportFlowOptions {
  /** 艦船マスタ（読み込み中・失敗のときは null。null の間は取り込まない） */
  master: ShipMaster | null;
  /**
   * 保存した後に呼ぶ（札割りのデータの読み直しなど）。
   * 取り込みを始めたときのものではなく、保存した時点で最後に描いたときに渡されたものを呼ぶ
   */
  onImported: () => void;
}

/** 画面から使う取り込みの状態と操作 */
export interface ImportFlow {
  state: ImportFlowState;
  /** 貼り付けた文字列を、取り込む範囲で取り込む（途中・確認待ち・マスタがないときは何もしない） */
  start(text: string, filter: ImportFilter): Promise<void>;
  /** 確認で「外して取り込む」 */
  confirm(): Promise<void>;
  /** 確認で「やめる」（保存しない） */
  cancel(): void;
  /** 失敗の理由を消す（貼り付け欄を書き換えたとき） */
  dismissFailure(): void;
}

const IDLE: ImportFlowState = { status: "idle" };
const WORKING: ImportFlowState = { status: "working" };

/** 保存先に渡す入力を作る（日時は呼んだときの時刻） */
function toSaveInput(parsed: ImportSuccess, filter: ImportFilter): SaveImportInput {
  return {
    ships: parsed.ships,
    importedAt: new Date().toISOString(),
    filter,
    hasUid: parsed.hasUid,
    hasLockInfo: parsed.hasLockInfo,
  };
}

/** 保存した結果から、完了の表示に出すものを作る */
function toSummary(parsed: ImportSuccess, filter: ImportFilter, removedAssignmentCount: number): ImportSummary {
  return {
    shipCount: parsed.ships.length,
    lockedOnly: filter.lockedOnly && parsed.hasLockInfo,
    minLevel: filter.minLevel,
    taggedShipCount: parsed.taggedShipCount,
    unknownShipCount: parsed.unknownShipCount,
    removedAssignmentCount,
    hasUid: parsed.hasUid,
    lockFilterIgnored: parsed.lockFilterIgnored,
  };
}

/**
 * 操作を受け付けるかの判定に使う段階
 * - "idle"：取り込みを受け付ける
 * - "working"：解析〜保存の途中（何も受け付けない）
 * - "confirm"：確認の答え（外して取り込む・やめる）だけを受け付ける
 */
type FlowPhase = "idle" | "working" | "confirm";

/** 取り込みの流れ（解析・確認・保存）の状態と操作を返す */
export function useImportFlow({ master, onImported }: UseImportFlowOptions): ImportFlow {
  const [state, setState] = useState<ImportFlowState>(IDLE);
  // 今の段階。続けて押したときに 2 回目を無視するために使う
  // （状態は次の描画まで変わらないため、押した直後の 2 回目は状態では見分けられない）。描画には使わない
  const phaseRef = useRef<FlowPhase>("idle");
  // これまでに失敗した回数（失敗の状態の番号に使う）。描画には使わない
  const failureCountRef = useRef(0);
  // 最後に描いたときに渡された onImported（保存は描画をまたいで終わるため、始めたときの関数を使うと古い値で読み直してしまう）
  const onImportedRef = useRef(onImported);
  useEffect(() => {
    onImportedRef.current = onImported;
  });

  /** 失敗にする（前の失敗と同じ理由でも、新しい番号を振る） */
  function fail(message: string): void {
    failureCountRef.current += 1;
    setState({ status: "failed", message, seq: failureCountRef.current });
  }

  /** 保存して完了にする（失敗なら理由を出す） */
  async function save(parsed: ImportSuccess, filter: ImportFilter): Promise<void> {
    phaseRef.current = "working";
    setState(WORKING);
    try {
      const result = await getPlanStorage().saveImport(toSaveInput(parsed, filter));
      setState({ status: "done", summary: toSummary(parsed, filter, result.removedAssignmentCount) });
      onImportedRef.current();
    } catch {
      fail(SAVE_FAILED_MESSAGE);
    } finally {
      phaseRef.current = "idle";
    }
  }

  async function start(text: string, filter: ImportFilter): Promise<void> {
    if (phaseRef.current !== "idle" || master === null) return;
    const parsed = parseImportText(text, master, filter);
    if (!parsed.ok) {
      fail(failureMessage(parsed.reason, filter));
      return;
    }

    phaseRef.current = "working";
    setState(WORKING);
    let removedAssignmentCount: number;
    try {
      ({ removedAssignmentCount } = await getPlanStorage().previewImport(toSaveInput(parsed, filter)));
    } catch {
      phaseRef.current = "idle";
      fail(SAVE_FAILED_MESSAGE);
      return;
    }
    if (removedAssignmentCount > 0) {
      // 確認の答えを待つ（待つ間は次の取り込みを受け付けない）
      phaseRef.current = "confirm";
      setState({ status: "confirm", pending: { parsed, filter, removedAssignmentCount } });
      return;
    }
    await save(parsed, filter);
  }

  async function confirm(): Promise<void> {
    if (phaseRef.current !== "confirm" || state.status !== "confirm") return;
    const { parsed, filter } = state.pending;
    await save(parsed, filter);
  }

  function cancel(): void {
    if (phaseRef.current !== "confirm") return;
    phaseRef.current = "idle";
    setState(IDLE);
  }

  function dismissFailure(): void {
    setState((current) => (current.status === "failed" ? IDLE : current));
  }

  return { state, start, confirm, cancel, dismissFailure };
}
