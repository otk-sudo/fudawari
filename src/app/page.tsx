"use client";

import { type HomeLatestEvent, HomeScreen } from "@/features/home/HomeScreen";
import {
  eventPhase,
  type LatestDefinitionState,
  useEventClock,
  useLatestDefinition,
} from "@/lib/definition";

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
  const now = useEventClock(state.status === "success" ? state.definition.event : null);
  return <HomeScreen latestEvent={latestEventOf(state, now)} />;
}
