/* eslint-disable @typescript-eslint/no-unused-vars -- 実装前の空の入れ物。実装するときにこの行を消す */
// 権限ごとの定義の編集の可否（要件 2.3、3.7、U18、roadmap T3-6）
//
// 画面で欄やボタンを出し分けるための判定。権限の強制は DB の RLS・RPC で行う（画面で隠すだけにしない。要件 2.4）。
//
// | 操作                                   | 一般 | 協力者 | 管理者 |
// | 定義画面を開く（終了後は見るだけ）      |  ×  |   ○   |   ○   |
// | 札・段階・大事さ・特効の編集、下書きの保存（終了前のみ） | × | ○ | ○ |
// | 公開（終了前のみ）                      |  ×  |   ○   |   ○   |
// | 終了日時を変える（終了前のみ）          |  ×  |   ○   |   ○   |
// | イベント名・開始日時を変える（終了前のみ）|  ×  |   ×   |   ○   |
// | 新規作成（終了後も可）                  |  ×  |   ×   |   ○   |
//
// - 「終了」は保存済みの終了日時で判定する（isEventEnded）。終了したイベントは誰も更新できない
//   （U18：終了後の延長は v1 では管理者が DB で直す）。
// - 開始前でも、最新のイベントなら協力者は更新できる（U18）。
// - 新規作成（mode "create"）は管理者だけが編集・公開できる。未公開の新規イベントは終了の判定をしない。
import type { EditPermissions, EditPermissionsInput, UpdatePermissionInput, UpdatePermissionResult } from "./types";

/** 権限・モード・終了の状態から、定義画面で何ができるかを返す */
export function editPermissions(input: EditPermissionsInput): EditPermissions {
  throw new Error("未実装");
}

/**
 * 最新のイベントの更新（下書きの保存・公開）をしてよいかを確かめる。確かめる順は次のとおり
 * 1. 一般利用者 → forbidden_role
 * 2. 保存済みの終了日時（saved.endAt）を過ぎている → event_ended（管理者も協力者も。next の終了日時は見ない）
 * 3. 協力者が saved からイベント名・開始日時を変えている → forbidden_field（変えた欄を fields に入れる）。
 *    開始日時は時刻で比べる（"2026-08-07T12:00+09:00" と "2026-08-07T12:00:00+09:00" は同じ）
 * 終了日時の変更は協力者もできる。日時の形式や前後の検証は validateEventInfo で行う（ここでは見ない）。
 */
export function checkUpdatePermission(input: UpdatePermissionInput): UpdatePermissionResult {
  throw new Error("未実装");
}
