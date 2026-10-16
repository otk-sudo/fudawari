// 「開催中」の判定（要件 3.1 のホームの「開催中：〇〇」）
//
// TODO(T2-3 実装担当)：中身はまだない（テストを先に書いた段階。running.test.ts を参照）
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
  void event;
  void now;
  throw new Error("未実装");
}
