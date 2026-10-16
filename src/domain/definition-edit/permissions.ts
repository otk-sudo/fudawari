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
import { sameDateTime } from "./datetime";
import { isEventEnded } from "./event";
import type {
  EditPermissions,
  EditPermissionsInput,
  ProtectedEventField,
  UpdatePermissionInput,
  UpdatePermissionResult,
} from "./types";

/** 権限・モード・終了の状態から、定義画面で何ができるかを返す */
export function editPermissions(input: EditPermissionsInput): EditPermissions {
  const isAdmin = input.role === "admin";
  const canOpen = input.role !== "user";
  // 新規作成は未公開のため終了の判定をしない。一般利用者は画面を開けないので、終了かどうかも扱わない
  const ended = input.mode === "update" && canOpen && isEventEnded(input.savedEndAt, input.now);
  // 内容を編集できるか：新規作成は管理者だけ、既存の更新は協力者・管理者で、終了前だけ
  const canEdit = input.mode === "create" ? isAdmin : canOpen && !ended;

  return {
    canOpen,
    canEditContent: canEdit,
    canPublish: canEdit,
    canEditName: canEdit && isAdmin,
    canEditStartAt: canEdit && isAdmin,
    canEditEndAt: canEdit,
    canCreate: isAdmin,
    ended,
  };
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
  const { role, saved, next, now } = input;
  if (role === "user") {
    return { ok: false, code: "forbidden_role", message: "一般利用者は定義を保存できません" };
  }
  if (isEventEnded(saved.endAt, now)) {
    return { ok: false, code: "event_ended", message: "このイベントは終了したため、更新できません" };
  }
  if (role === "collab") {
    const fields: ProtectedEventField[] = [];
    if (next.name !== saved.name) fields.push("name");
    if (!sameDateTime(next.startAt, saved.startAt)) fields.push("startAt");
    if (fields.length > 0) {
      return {
        ok: false,
        code: "forbidden_field",
        fields,
        message: "協力者はイベント名・開始日時を変更できません",
      };
    }
  }
  return { ok: true };
}
