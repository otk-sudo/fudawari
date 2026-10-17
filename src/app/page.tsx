"use client";

import { useEffect, useState } from "react";
import { type HomeLatestEvent, HomeScreen } from "@/features/home/HomeScreen";
import { formatImportedAt } from "@/features/import/import-screen-text";
import {
  eventPhase,
  type LatestDefinitionState,
  useEventClock,
  useLatestDefinition,
} from "@/lib/definition";
import { getPlanStorage } from "@/lib/plan";

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

/**
 * 最終取り込みの日時（「10/15 20:40」の形）。取り込んでいない・読めない・読み込み中は null。
 * 共有の札割りのデータ（usePlanData）は使わず、保存先から最終取り込みだけを直接読む（設定の useStoredLastImport と同じ形）。
 * usePlanData は読み込むときに定義から消えた札の割り当てを控えに戻して保存するので、ホームを開いただけで割り当てを
 * 書き換えないように使わない。最新イベントの定義の状態にもよらない
 */
function useLastImportedAt(): string | null {
  const [importedAt, setImportedAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getPlanStorage()
      .loadLastImport()
      .then(
        (record) => {
          if (active) setImportedAt(record === null ? null : formatImportedAt(record.importedAt));
        },
        () => {
          if (active) setImportedAt(null);
        },
      );
    return () => {
      active = false;
    };
  }, []);
  return importedAt;
}

export default function HomePage() {
  const state = useLatestDefinition();
  // 今の時刻は、読み込みの後の描画のときに取る（モジュールを読み込んだときの時刻に固定しない）。
  // 開いたまま最新イベントの開始日時・終了日時をまたいだら、描き直して「開催中：」などを切り替える
  const definition = state.status === "success" ? state.definition : null;
  const now = useEventClock(definition?.event ?? null);
  const lastImportedAt = useLastImportedAt();
  return <HomeScreen latestEvent={latestEventOf(state, now)} lastImportedAt={lastImportedAt} />;
}
