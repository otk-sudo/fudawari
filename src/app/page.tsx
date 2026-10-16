"use client";

import { HomeScreen } from "@/features/home/HomeScreen";
import { isEventRunning, useLatestDefinition } from "@/lib/definition";

export default function HomePage() {
  const state = useLatestDefinition();
  // 最新イベントが開催中のときだけイベント名を渡す（読み込み中・失敗・開始前・終了後は null で「開催中：」を出さない）。
  // 今の時刻は、読み込みの後の描画のときに取る（モジュールを読み込んだときの時刻に固定しない）
  const runningEventName =
    state.status === "success" && isEventRunning(state.definition.event, new Date())
      ? state.definition.event.name
      : null;
  return <HomeScreen runningEventName={runningEventName} />;
}
