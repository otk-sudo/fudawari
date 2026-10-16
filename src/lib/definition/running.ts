// 「開催中」の判定（要件 3.1 のホームの「開催中：〇〇」）
import type { EventInfo } from "@/domain/definition";

/**
 * イベントが開催中か。開始日時から終了日時の直前までを開催中とする（開始日時ちょうどは開催中、終了日時ちょうどは終了）。
 * 終了日時が null（未定）なら、開始日時を過ぎていれば開催中。
 * 今の時刻は引数で受け取る（テストで時刻を決められるようにするため）。
 * startAt・endAt は検証済みの値（ISO 8601 の時差つき）を前提にする。
 */
export function isEventRunning(
  event: Pick<EventInfo, "startAt" | "endAt">,
  now: Date,
): boolean {
  // 時差つきの日時を瞬間（ミリ秒）にして比べる。秒を省いた形（"2026-08-07T12:00+09:00"）も Date.parse で読める。
  // 読めない値（NaN）とはどう比べても false になるため、開催中ではないとみなす
  const nowTime = now.getTime();
  const startTime = Date.parse(event.startAt);
  if (!(startTime <= nowTime)) return false;
  if (event.endAt === null) return true;
  return nowTime < Date.parse(event.endAt);
}
