"use client";

// 差分の画面（/drift。roadmap T2-11、要件 3.5、U10・U23）の読み込みと出し分け
//
// 読む順と出し分け（先に決まったものから出す。警告は 1 つだけ）
// 1. 最新イベントの公開定義（useLatestDefinition）：読み込み中は「読み込み中」、失敗はヘッダーの下の警告（LatestEventScreenHeader）
// 2. 札割りのデータ（usePlanData：取り込んだ艦・最終取り込み・割り当て）：
//    読み込み中は「読み込み中」、失敗は警告、艦を取り込んでいなければ取り込みの画面への案内
// 3. 艦船マスタ（useShipMaster）：艦を取り込んでいるときだけ取得する（取り込む前の人に 600 隻分のマスタを配らない）。
//    読み込み中は「読み込み中」、失敗は警告
// 4. すべて読めたら中身（DriftScreen）を出す。計画の変更（反映・元に戻す）は共有の札割りのデータ（setAssignments）を通して
//    ブラウザ内に保存する（同じページの別の部品・割り振りなどにも新しい割り当てが届く）
//
// 比べるのはブラウザの中だけで、取り込んだ艦や割り当てはサーバーに送らない（要件 3.5・5 章）。
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { LatestEventScreenHeader } from "@/components/LatestEventScreenHeader";
import type { PublicDefinition } from "@/domain/definition/types";
import { useLatestDefinition } from "@/lib/definition";
import { type PlanData, usePlanData } from "@/lib/plan";
import { ROUTES } from "@/lib/routes";
import { useShipMaster } from "@/lib/ship-master";
import { formatImportedAt } from "./drift-view";
import { DriftScreen } from "./DriftScreen";
import { DRIFT_SCREEN_TITLE } from "./title";
import styles from "./DriftPageContent.module.css";

/** 準備完了の札割りのデータ */
type ReadyPlanData = Extract<PlanData, { status: "ready" }>;

/** 差分の画面（読み込みと出し分け） */
export function DriftPageContent(): ReactNode {
  const definitionState = useLatestDefinition();
  const definition = definitionState.status === "success" ? definitionState.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);

  // 公開定義の失敗は、ヘッダーの下の警告（LatestEventScreenHeader）だけを出す
  if (definitionState.status === "error") return <DriftHeader importedAt={null} />;
  if (plan.status === "error") {
    return (
      <StatusScreen importedAt={null}>
        <LoadAlert title="札割りのデータを読み込めませんでした" reason={plan.error.message} />
      </StatusScreen>
    );
  }
  if (definition !== null && plan.status === "ready" && plan.ships.length === 0) {
    return (
      <StatusScreen importedAt={null}>
        <NotImported />
      </StatusScreen>
    );
  }
  if (definition === null || plan.status !== "ready") {
    return (
      <StatusScreen importedAt={null}>
        <Loading />
      </StatusScreen>
    );
  }
  return <DriftWithMaster definition={definition} plan={plan} />;
}

/** 艦船マスタを読んでから中身を出す（艦を取り込んでいるときだけ描く。描いたときに艦船マスタの取得が始まる） */
function DriftWithMaster({ definition, plan }: { definition: PublicDefinition; plan: ReadyPlanData }): ReactNode {
  const masterState = useShipMaster();
  const importedAt = plan.lastImport === null ? null : formatImportedAt(plan.lastImport.importedAt);

  if (masterState.status === "loading") {
    return (
      <StatusScreen importedAt={importedAt}>
        <Loading />
      </StatusScreen>
    );
  }
  if (masterState.status === "error") {
    return (
      <StatusScreen importedAt={importedAt}>
        <LoadAlert title="艦船マスタを読み込めませんでした" reason={masterState.error.message} />
      </StatusScreen>
    );
  }
  return (
    <>
      <DriftHeader importedAt={importedAt} />
      {/* イベントが替わったら（新しい定義を読んだら）、反映の記録・確認の枠ごと作り直す */}
      <DriftScreen key={definition.event.id} definition={definition} master={masterState.master} plan={plan} />
    </>
  );
}

// ---- ヘッダー・読み込み中・失敗・未取り込みの表示 ----

/**
 * ヘッダー（画面名・最新イベント名・比べている取り込みの日時・「最新の状態を取り込む」）。
 * importedAt は「10/15 20:40」の形の取り込んだ日時（取り込んでいない・まだ分からないときは null で、文を出さない）
 */
function DriftHeader({ importedAt }: { importedAt: string | null }): ReactNode {
  return (
    <LatestEventScreenHeader title={DRIFT_SCREEN_TITLE}>
      {importedAt !== null && (
        <span className={styles.note}>{`${importedAt} に取り込んだ札の状態と、計画を比べています`}</span>
      )}
      <span className={styles.spacer} aria-hidden="true" />
      <Link href={ROUTES.import} className={styles.headerAction}>
        最新の状態を取り込む
      </Link>
    </LatestEventScreenHeader>
  );
}

/** ヘッダーと本文 */
function StatusScreen({ importedAt, children }: { importedAt: string | null; children: ReactNode }): ReactNode {
  return (
    <>
      <DriftHeader importedAt={importedAt} />
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
      <p className={styles.text}>
        艦娘を取り込んでいません。計画と実際の札を比べるには、出撃後の状態の艦娘を制空権シミュレータの形式で取り込んでください。
      </p>
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
