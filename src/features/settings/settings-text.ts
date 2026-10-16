// 設定のウィンドウの文言と、表示の値を作る純粋な関数（要件 3.6、U21、モック SettingsDialog.dc.html）
import type { PlanFileFailureReason } from "@/domain/plan/planFile";

/** 2 桁にそろえる */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 取り込んだ日時（ISO 8601）を「10/15 20:40」の形にする（利用者の端末の時刻帯で出す）。
 * 日時として読めなければ null
 */
export function formatImportedAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 書き出す札割りのファイルの名前（例「fudawari-plan-2026-summer.json」。イベント ID のうちファイル名に使えない文字は _ にする） */
export function planFileName(eventId: string): string {
  return `fudawari-plan-${eventId.replace(/[^0-9A-Za-z_-]/g, "_")}.json`;
}

/** 札割りのファイルを読み込めなかったときの次の行動 */
const PLAN_FILE_ADVICE = "このアプリの「書き出す」で作ったファイルを選んでください";

/** 札割りのファイルの中身を読めなかったときの文（理由ごと） */
export function planFileFailureMessage(reason: PlanFileFailureReason): string {
  switch (reason) {
    case "invalidJson":
      return `札割りのファイルを読み込めませんでした（JSON として読めません）。${PLAN_FILE_ADVICE}`;
    case "invalidFormat":
      return `札割りのファイルを読み込めませんでした（札割りのファイルの形ではありません）。${PLAN_FILE_ADVICE}`;
    case "unsupportedVersion":
      return `札割りのファイルを読み込めませんでした（このアプリの知らない形式の版です）。${PLAN_FILE_ADVICE}`;
  }
}

/** ファイルそのものを読めなかったとき（ブラウザがファイルを開けないなど）の文 */
export const FILE_READ_FAILED_MESSAGE = `ファイルを読み込めませんでした。${PLAN_FILE_ADVICE}`;

/** 別のイベントの札割りのファイルを選んだときの文（札割りできるのは最新のイベントだけ） */
export function otherEventMessage(fileEventId: string, latestEventName: string | null): string {
  const latest = latestEventName === null ? "最新のイベント" : `最新のイベント（${latestEventName}）`;
  return `別のイベント（${fileEventId}）の札割りのファイルのため、読み込めませんでした。札割りできるのは${latest}だけです`;
}

/** 取り込んだ艦娘データを削除できなかったときの文 */
export const DELETE_FAILED_MESSAGE =
  "取り込んだ艦娘データを削除できませんでした（ブラウザ内の保存を使えない可能性があります）。ページを再読み込みしてから、もう一度試してください";

/** 表示の設定を保存できなかったときの文 */
export const SETTINGS_SAVE_FAILED_MESSAGE =
  "設定をこのブラウザに保存できませんでした（ブラウザ内の保存を使えない可能性があります）。選んだ設定は、ページを開き直すと元に戻ります";
