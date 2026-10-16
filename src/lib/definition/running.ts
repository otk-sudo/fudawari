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

/** イベントの段階：開始前（upcoming）・開催中（running）・終了（ended） */
export type EventPhase = "upcoming" | "running" | "ended";

/**
 * イベントの段階。開催中かどうかは isEventRunning と同じ（開始日時ちょうどは開催中、終了日時ちょうどは終了）。
 * 開催中でなければ、終了日時を過ぎていれば終了、そうでなければ開始前とする（終了日時が null〔未定〕なら終了にならない）。
 */
export function eventPhase(event: Pick<EventInfo, "startAt" | "endAt">, now: Date): EventPhase {
  if (isEventRunning(event, now)) return "running";
  const endTime = event.endAt === null ? Number.NaN : Date.parse(event.endAt);
  // 読めない値（NaN）との比べは false になるため、開始前とみなす
  return endTime <= now.getTime() ? "ended" : "upcoming";
}

/**
 * 今より後で、段階（開始前・開催中・終了）が次に変わる時刻（開始日時か終了日時の早いほう）。もう変わらなければ null。
 * 今の時刻ちょうどの境目は、すでに変わった後とみなして含めない（isEventRunning の境目の扱いと同じ）。
 */
export function nextEventBoundary(
  event: Pick<EventInfo, "startAt" | "endAt">,
  now: Date,
): Date | null {
  const nowTime = now.getTime();
  const times = [Date.parse(event.startAt), event.endAt === null ? Number.NaN : Date.parse(event.endAt)];
  // 読めない値（NaN）は今より後とはみなさない
  const upcoming = times.filter((time) => time > nowTime);
  return upcoming.length === 0 ? null : new Date(Math.min(...upcoming));
}
