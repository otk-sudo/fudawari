// イベントの開始日時・終了日時をまたいだら描き直すための今の時刻（要件 3.1 のホームの「開催中：〇〇」）
//
// - 画面を開いたまま境目（開始日時・終了日時）を過ぎたら描き直す。次の境目にタイマー（setTimeout）を 1 つ仕掛け、
//   呼ばれたら描き直して次を仕掛け直す。
// - setTimeout の待ち時間の上限（2^31−1 ミリ秒、約 24.8 日）を超えるとすぐに呼ばれてしまうため、待ち時間は上限で区切る。
//   上限で呼ばれたときは、段階は変わらないまま描き直し、残りの時間で仕掛け直す。
// - 部品を外したら（またはイベントが変わったら）タイマーを止める。
import { useEffect, useState } from "react";
import type { EventInfo } from "@/domain/definition";
import { nextEventBoundary } from "./running";

/** setTimeout に渡せる待ち時間の上限（2^31−1 ミリ秒、約 24.8 日） */
const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * 今の時刻を返す。event の次の境目（開始日時・終了日時）にタイマーを仕掛け、境目を過ぎたら描き直す。
 * event が null（読み込み中・失敗など）ならタイマーは仕掛けない。
 * 今の時刻は描くたびに取る（読み込みが済んだ後の描画で、その時点の時刻を使うため）。
 */
export function useEventClock(event: Pick<EventInfo, "startAt" | "endAt"> | null): Date {
  // 境目のタイマーが呼ばれた回数。増やして描き直し、次のタイマーを仕掛け直す
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (event === null) return undefined;
    const now = new Date();
    const boundary = nextEventBoundary(event, now);
    if (boundary === null) return undefined;
    const delay = Math.min(Math.max(boundary.getTime() - now.getTime(), 0), MAX_TIMER_DELAY);
    const timer = setTimeout(() => {
      setTick((count) => count + 1);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [event, tick]);

  return new Date();
}
