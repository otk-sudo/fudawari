"use client";

// 一覧の画面（/list。roadmap T2-9・T2-10、要件 3.2・3.9・5 章）の読み込みと出し分け
//
// 読む順と出し分け（先に決まったものから出す。警告は 1 つだけ。割り振りの画面〔PR-05〕と同じ考え方）
// 1. 最新イベントの公開定義（useLatestDefinition）：読み込み中は「読み込み中」、失敗はヘッダーの下の警告（LatestEventScreenHeader）
// 2. 札割りのデータ（usePlanData：取り込んだ艦・割り当て）：読み込み中は「読み込み中」、失敗は警告、
//    艦を取り込んでいなければ取り込みの画面への案内
// 3. 艦船マスタ（useShipMaster）：艦を取り込んでいるときだけ取得する（取り込む前の人に 600 隻分のマスタを配らない）。
//    読み込み中は「読み込み中」、失敗は警告
// 4. すべて読めたら本文（ListBoard）を出し、ヘッダーの「画像で保存」で画像で保存のウィンドウを開けるようにする。
//    それまでは「画像で保存」を押せない
//
// ヘッダーの「最終取り込み」は、割り当ての更新日時を保存していないため、v1 では最後に取り込んだ日時で代える。
// 通信するのは公開定義と艦船マスタの静的ファイルだけ。取り込んだ艦や割り当てはサーバーに送らない（要件 5 章）。
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { LatestEventScreenHeader } from "@/components/LatestEventScreenHeader";
import type { PublicDefinition } from "@/domain/definition";
import { ExportImageDialog } from "@/features/export-image/ExportImageDialog";
import { useLatestDefinition } from "@/lib/definition";
import { type PlanData, usePlanData } from "@/lib/plan";
import { ROUTES } from "@/lib/routes";
import { useShipMaster } from "@/lib/ship-master";
import type { ImportRecord } from "@/lib/storage";
import { ListBoard } from "./ListBoard";
import { formatImportedAt } from "./list-view";
import { LIST_SCREEN_TITLE } from "./title";
import styles from "./ListPageContent.module.css";

/** 準備完了の札割りのデータ */
type ReadyPlanData = Extract<PlanData, { status: "ready" }>;

/** 一覧の画面（読み込みと出し分け） */
export function ListPageContent(): ReactNode {
  const definitionState = useLatestDefinition();
  const definition = definitionState.status === "success" ? definitionState.definition : null;
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  const lastImport = plan.status === "ready" ? plan.lastImport : null;

  // 公開定義の失敗は、ヘッダーの下の警告（LatestEventScreenHeader）だけを出す
  if (definitionState.status === "error") return <ListHeader lastImport={null} />;
  if (plan.status === "error") {
    return (
      <StatusScreen lastImport={null}>
        <LoadAlert title="札割りのデータを読み込めませんでした" reason={plan.error.message} />
      </StatusScreen>
    );
  }
  if (definition !== null && plan.status === "ready" && plan.ships.length === 0) {
    return (
      <StatusScreen lastImport={lastImport}>
        <NotImported />
      </StatusScreen>
    );
  }
  if (definition === null || plan.status !== "ready") {
    return (
      <StatusScreen lastImport={lastImport}>
        <Loading />
      </StatusScreen>
    );
  }
  return <ListWithMaster definition={definition} plan={plan} />;
}

/** 艦船マスタを読んでから本文を出す（艦を取り込んでいるときだけ描く。描いたときに艦船マスタの取得が始まる） */
function ListWithMaster({ definition, plan }: { definition: PublicDefinition; plan: ReadyPlanData }): ReactNode {
  const masterState = useShipMaster();
  const [exportOpen, setExportOpen] = useState(false);

  if (masterState.status === "loading") {
    return (
      <StatusScreen lastImport={plan.lastImport}>
        <Loading />
      </StatusScreen>
    );
  }
  if (masterState.status === "error") {
    return (
      <StatusScreen lastImport={plan.lastImport}>
        <LoadAlert title="艦船マスタを読み込めませんでした" reason={masterState.error.message} />
      </StatusScreen>
    );
  }
  return (
    <>
      <ListHeader lastImport={plan.lastImport} onOpenExport={() => setExportOpen(true)} />
      <ListBoard
        definition={definition}
        master={masterState.master}
        ships={plan.ships}
        assignments={plan.assignments}
      />
      <ExportImageDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        definition={definition}
        master={masterState.master}
        ships={plan.ships}
        assignments={plan.assignments}
      />
    </>
  );
}

// ---- ヘッダー ----

/** ヘッダーに出す「最終取り込み 10/15 21:40」（日時を読めなければ「最終取り込み」だけ） */
function lastImportNote(record: ImportRecord): string {
  const importedAt = formatImportedAt(record.importedAt);
  return importedAt === null ? "最終取り込み" : `最終取り込み ${importedAt}`;
}

/**
 * ヘッダー帯：画面名、最新イベント名、最終取り込み、「画像で保存」（onOpenExport がなければ押せない）、「割り振りを編集」
 */
function ListHeader({
  lastImport,
  onOpenExport,
}: {
  lastImport: ImportRecord | null;
  onOpenExport?: () => void;
}): ReactNode {
  return (
    <LatestEventScreenHeader title={LIST_SCREEN_TITLE}>
      {lastImport !== null && <span className={styles.headerNote}>{lastImportNote(lastImport)}</span>}
      <span className={styles.headerSpacer} />
      <button
        type="button"
        className={styles.exportButton}
        aria-haspopup="dialog"
        disabled={onOpenExport === undefined}
        onClick={onOpenExport}
      >
        画像で保存
      </button>
      <Link href={ROUTES.assign} className={styles.editLink}>
        割り振りを編集
      </Link>
    </LatestEventScreenHeader>
  );
}

// ---- 読み込み中・失敗・未取り込みの表示 ----

/** ヘッダー（最新イベント名つき）と本文 */
function StatusScreen({ lastImport, children }: { lastImport: ImportRecord | null; children: ReactNode }): ReactNode {
  return (
    <>
      <ListHeader lastImport={lastImport} />
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
        艦娘を取り込んでいません。一覧を見る前に、制空権シミュレータの形式で艦娘を取り込み、割り振りで札に置いてください。
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
