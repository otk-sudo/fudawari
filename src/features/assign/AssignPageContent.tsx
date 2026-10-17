"use client";

// 割り振りの画面（/assign。roadmap T2-7、要件 3.3・5 章、U17）の読み込みと出し分け
//
// 読む順と出し分け（先に決まったものから出す。警告は 1 つだけ）
// 1. 最新イベントの公開定義（useLatestDefinition）：読み込み中は「読み込み中」、失敗はヘッダーの下の警告（LatestEventScreenHeader）
// 2. 札割りのデータ（usePlanData：取り込んだ艦・割り当て）と設定（控えの並び順・表示の初期値）：
//    読み込み中は「読み込み中」、札割りのデータの失敗は警告、艦を取り込んでいなければ取り込みの画面への案内。
//    設定を読めなければ初期値（艦型・一行）で進める（警告は出さない）
// 3. 艦船マスタ（useShipMaster）：艦を取り込んでいるときだけ取得する（取り込む前の人に 600 隻分のマスタを配らない）。
//    読み込み中は「読み込み中」、失敗は警告
// 4. すべて読めたら中身（AssignScreen）を出す。割り当ての変更は共有の札割りのデータ（setAssignments）を通して
//    ブラウザ内に保存する（同じページの別の部品・一覧などにも新しい割り当てが届く）。
//    共有の割り当てが外（設定の札割りの読み込みなど）で置き換えられたら、中身に渡して表示を替え、「元に戻す」の履歴を捨てさせる
//    （sharedAssignments。PR-14）。
//    控えに戻した割り当ての件数（U17）は、最初に描いたときの件数を出し続け、出した後に共有の件数を 0 に戻す（知らせは一度だけ）
//
// 通信するのは公開定義と艦船マスタの静的ファイルだけ。取り込んだ艦や割り当てはサーバーに送らない（要件 5 章）。
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LatestEventScreenHeader } from "@/components/LatestEventScreenHeader";
import type { PublicDefinition } from "@/domain/definition/types";
import { useLatestDefinition } from "@/lib/definition";
import { getPlanStorage, type PlanData, usePlanData } from "@/lib/plan";
import { ROUTES } from "@/lib/routes";
import { useShipMaster } from "@/lib/ship-master";
import { AssignScreen } from "./AssignScreen";
import type { SaveAssignments } from "./assign-store";
import { ASSIGN_SCREEN_TITLE } from "./title";
import type { TrayOptionsInit } from "./tray";
import styles from "./AssignPageContent.module.css";

/** 準備完了の札割りのデータ */
type ReadyPlanData = Extract<PlanData, { status: "ready" }>;

/** 割り振りの画面（読み込みと出し分け） */
export function AssignPageContent(): ReactNode {
  const definitionState = useLatestDefinition();
  const definition = definitionState.status === "success" ? definitionState.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  const trayInit = useTrayInit();

  // 公開定義の失敗は、ヘッダーの下の警告（LatestEventScreenHeader）だけを出す
  if (definitionState.status === "error") return <LatestEventScreenHeader title={ASSIGN_SCREEN_TITLE} />;
  if (plan.status === "error") {
    return (
      <StatusScreen>
        <LoadAlert title="札割りのデータを読み込めませんでした" reason={plan.error.message} />
      </StatusScreen>
    );
  }
  if (definition !== null && plan.status === "ready" && plan.ships.length === 0) {
    return (
      <StatusScreen>
        <NotImported />
      </StatusScreen>
    );
  }
  if (definition === null || plan.status !== "ready" || trayInit === null) {
    return (
      <StatusScreen>
        <Loading />
      </StatusScreen>
    );
  }
  return <AssignWithMaster definition={definition} plan={plan} trayInit={trayInit} />;
}

/** 艦船マスタを読んでから中身を出す（艦を取り込んでいるときだけ描く。描いたときに艦船マスタの取得が始まる） */
function AssignWithMaster({
  definition,
  plan,
  trayInit,
}: {
  definition: PublicDefinition;
  plan: ReadyPlanData;
  trayInit: TrayOptionsInit;
}): ReactNode {
  const masterState = useShipMaster();
  const save = usePlanSave(plan);
  const returnedCount = useReturnedNotice(plan, masterState.status === "success");

  if (masterState.status === "loading") {
    return (
      <StatusScreen>
        <Loading />
      </StatusScreen>
    );
  }
  if (masterState.status === "error") {
    return (
      <StatusScreen>
        <LoadAlert title="艦船マスタを読み込めませんでした" reason={masterState.error.message} />
      </StatusScreen>
    );
  }
  return (
    // イベントが替わったら（新しい定義を読んだら）、割り当ての履歴ごと作り直す
    <AssignScreen
      key={definition.event.id}
      definition={definition}
      master={masterState.master}
      ships={plan.ships}
      initialAssignments={plan.assignments}
      sharedAssignments={plan.assignments}
      save={save}
      returnedCount={returnedCount}
      trayInit={trayInit}
    />
  );
}

/**
 * 控えに戻した割り当ての件数の知らせ（U17）。知らせる件数を返す。
 *
 * 最初に描いたときの件数を覚えて、この画面にいる間は出し続ける。知らせを描いた後（shown：中身を出したとき）に、
 * 共有の札割りのデータの件数を 0 に戻す（acknowledgeReturned）。画面を外して戻ったときには同じ知らせを出さない。
 * 艦船マスタを読めずに中身を出せなかったときは知らせていないので、0 に戻さない
 */
function useReturnedNotice(plan: ReadyPlanData, shown: boolean): number {
  const [returnedCount] = useState(plan.returnedCount);
  const { acknowledgeReturned } = plan;
  useEffect(() => {
    if (shown && returnedCount > 0) acknowledgeReturned();
  }, [shown, returnedCount, acknowledgeReturned]);
  return returnedCount;
}

/**
 * 設定から控えの並び順・表示の初期値を読む。読み終えるまでは null。
 * 読めなければ空（初期値の艦型・一行）にする（設定を読めなくても画面は使えるので、警告は出さない）
 */
function useTrayInit(): TrayOptionsInit | null {
  const [trayInit, setTrayInit] = useState<TrayOptionsInit | null>(null);
  useEffect(() => {
    let active = true;
    getPlanStorage()
      .loadSettings()
      .then(
        (settings) => ({ sort: settings.traySort, view: settings.trayView }),
        () => ({}),
      )
      .then((init: TrayOptionsInit) => {
        if (active) setTrayInit(init);
      });
    return () => {
      active = false;
    };
  }, []);
  return trayInit;
}

/**
 * 共有の札割りのデータ（usePlanData）を通して割り当てを保存する関数を作る（AssignScreen の save に渡す。何度描いても同じ関数）。
 *
 * setAssignments は失敗しても例外にせず、保存の結果を状態（saveError）に入れてから終わる。そこで保存を終えた後の状態を見て、
 * 失敗なら理由の文をメッセージに持つエラーで reject する。保存先のイベント ID は札割りのデータが読み込んだもの
 * （最新イベント。AssignScreen が渡す definition.event.id と同じ）。
 *
 * 状態は描き直しのたびに latest へ写す（useLayoutEffect）。状態の変化は React がマイクロタスクで同期的に描き直して反映し、
 * setAssignments の Promise はその後に解決するので、保存を終えた時点の latest は保存の後の状態になっている
 */
function usePlanSave(plan: ReadyPlanData): SaveAssignments {
  const latest = useRef<PlanData>(plan);
  useLayoutEffect(() => {
    latest.current = plan;
  }, [plan]);
  return useCallback(async (_eventId, assignments) => {
    await latest.current.setAssignments(assignments);
    const state = latest.current;
    if (state.status === "ready" && state.saveError !== null) throw new Error(state.saveError.message);
  }, []);
}

// ---- 読み込み中・失敗・未取り込みの表示 ----

/** ヘッダー（最新イベント名つき）と本文 */
function StatusScreen({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <LatestEventScreenHeader title={ASSIGN_SCREEN_TITLE} />
      <div className={styles.body}>{children}</div>
    </>
  );
}

function Loading(): ReactNode {
  return (
    <p role="status" className={styles.text}>
      読み込み中…
    </p>
  );
}

/** 艦娘を取り込んでいないときの案内 */
function NotImported(): ReactNode {
  return (
    <div className={styles.notImported}>
      <p className={styles.text}>艦娘を取り込んでいません。割り振りの前に、制空権シミュレータの形式で艦娘を取り込んでください。</p>
      <Link href={ROUTES.import} className={styles.action}>
        取り込みの画面へ
      </Link>
    </div>
  );
}

/** 読み込めなかったことを知らせる警告（公開定義の警告〔DefinitionLoadAlert〕と同じ形：何を・理由・次の行動） */
function LoadAlert({ title, reason }: { title: string; reason: string }): ReactNode {
  return (
    <div role="alert" className={styles.alert}>
      <p className={styles.alertTitle}>{title}</p>
      <p className={styles.alertReason}>{reason}</p>
      <p className={styles.alertAdvice}>ページを再読み込みしてください</p>
    </div>
  );
}
