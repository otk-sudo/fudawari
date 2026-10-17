"use client";

import { useMemo } from "react";
import { type HomeLatestEvent, HomeScreen } from "@/features/home/HomeScreen";
import { formatImportedAt } from "@/features/import/import-screen-text";
import {
  eventPhase,
  type LatestDefinitionState,
  useEventClock,
  useLatestDefinition,
} from "@/lib/definition";
import { usePlanData } from "@/lib/plan";

/** 公開定義の読み込みの状態と今の時刻から、ホームに出す最新イベントの状態を決める */
function latestEventOf(state: LatestDefinitionState, now: Date): HomeLatestEvent {
  switch (state.status) {
    case "loading":
      return { status: "loading" };
    case "error":
      return { status: "error", error: state.error };
    case "success": {
      const { event } = state.definition;
      const phase = eventPhase(event, now);
      return phase === "running" ? { status: "running", eventName: event.name } : { status: phase };
    }
  }
}

export default function HomePage() {
  const state = useLatestDefinition();
  // 今の時刻は、読み込みの後の描画のときに取る（モジュールを読み込んだときの時刻に固定しない）。
  // 開いたまま最新イベントの開始日時・終了日時をまたいだら、描き直して「開催中：」などを切り替える
  const definition = state.status === "success" ? state.definition : null;
  const now = useEventClock(definition?.event ?? null);
  // 最終取り込みは、ほかの画面と同じ共有の札割りのデータ（ブラウザ内の保存）から読む。定義を読めるまでは読まない
  const fudaIds = useMemo(() => definition?.fudas.map((fuda) => fuda.id) ?? [], [definition]);
  const plan = usePlanData(definition?.event.id ?? null, fudaIds);
  const lastImportedAt =
    plan.status === "ready" && plan.lastImport !== null ? formatImportedAt(plan.lastImport.importedAt) : null;
  return <HomeScreen latestEvent={latestEventOf(state, now)} lastImportedAt={lastImportedAt} />;
}
