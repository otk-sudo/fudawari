// 定義の編集（roadmap T3-6）の型
//
// - 編集の対象は「定義の文書」（DefinitionDoc）。公開定義（PublicDefinition）と同じ形で、
//   共有の下書きとして DB に jsonb で保存される。
// - 編集の関数は文書を書き換えず、新しい文書を返す（イミュータブル）。
//   失敗したときは例外を投げず、EditResult の ok: false で理由を返す（元の文書はそのまま使える）。
// - 新しい段階・札・特効グループの ID は呼び出し側が渡す（例 crypto.randomUUID()）。
//   2 人が同時に追加しても ID が重ならず、3 方向マージ（src/domain/merge/）で別のものとして扱えるようにするため。
//   海域だけは「E4」のように番号で決まるので、関数の中で決める（addArea）。
// - 新規作成でまだ入力していないイベント名・開始日時・版の日付は空文字にする（保存・公開のときの検証で弾く）。
// - 名前を空にする変更（入力の途中）は編集の関数では弾かない。保存・公開のときの検証（validatePublicDefinition）で弾く。
//   札の追加だけは入力を確定する操作なので、空の名前を弾く。
import type { EventInfo, Importance, PublicDefinition } from "@/domain/definition/types";

/** 定義の文書（共有の下書き。公開定義と同じ形） */
export type DefinitionDoc = PublicDefinition;

// ---- 編集の結果 ----

/**
 * 編集のエラーの種類
 * - not_found：指定した段階・海域・札・特効グループ・艦名がない
 * - duplicate_id：新しく作るものの ID が既にある（段階は段階どうし、札は札どうし、特効グループは文書全体で重複しない）
 * - last_stage：イベント全体で最後の 1 つの段階は削除できない
 * - area_not_removable：外せるのは、海域が 2 つ以上あるときの、最後の、段階のない海域だけ
 * - fuda_in_use：段階で使われている札は削除できない
 * - duplicate_game_number：ゲーム内の札番号が、ほかの札と重複する
 * - invalid_value：値が許されない（倍率が 1 未満・有限の数でない、用意した色にない色、札番号が 1 以上の整数でない、
 *   札の名前が空、艦名が空）
 */
export type EditErrorCode =
  | "not_found"
  | "duplicate_id"
  | "last_stage"
  | "area_not_removable"
  | "fuda_in_use"
  | "duplicate_game_number"
  | "invalid_value";

/** 編集のエラー */
export interface EditError {
  code: EditErrorCode;
  /** 画面に出す理由の文（日本語） */
  message: string;
}

/** 編集の結果。成功なら新しい文書、失敗なら理由（元の文書は変わらない） */
export type EditResult = { ok: true; doc: DefinitionDoc } | { ok: false; error: EditError };

// ---- 段階 ----

/**
 * 段階を置く場所
 * - before：その段階の前（札・段階を段階の上に落としたとき）。海域はその段階の海域になる
 * - end：その海域の最後（海域の「＋」・空の海域に落としたとき、「＋」のメニューで札を選んだとき）
 */
export type StagePosition = { kind: "before"; stageId: string } | { kind: "end"; areaId: string };

/** 札から新しい段階を作るときの入力 */
export interface AddStageInput {
  /** 新しい段階の ID（呼び出し側が作る。段階どうしで重複しない） */
  newStageId: string;
  /** 使う札の ID */
  fudaId: string;
  /** 置く場所 */
  position: StagePosition;
}

/** 段階の変更（指定した項目だけ変える） */
export interface StagePatch {
  name?: string;
  fudaId?: string;
  importance?: Importance;
}

// ---- 札 ----

/** 札を追加するときの入力（U16：名前・色・札番号で追加） */
export interface AddFudaInput {
  /** 新しい札の ID（呼び出し側が作る。札どうしで重複しない） */
  newFudaId: string;
  /** 札名（空・空白だけは不可） */
  name: string;
  /** 札の色（FUDA_COLOR_CHOICES のどれか） */
  color: string;
  /** ゲーム内の札番号（U10。任意なので未入力は null。1 以上の整数で、札どうしで重複しない） */
  gameNumber: number | null;
}

/** 札の変更（指定した項目だけ変える。U16：名前と色。札番号は U10 で任意のため、あとから入れられるようにする） */
export interface FudaPatch {
  name?: string;
  color?: string;
  gameNumber?: number | null;
}

// ---- 特効グループ ----

/** 特効グループを追加するときの入力 */
export interface AddBoostGroupInput {
  /** 追加する段階の ID */
  stageId: string;
  /** 新しい特効グループの ID（呼び出し側が作る。文書全体で重複しない） */
  newGroupId: string;
  /** グループ名（省略時は空文字） */
  name?: string;
  /** 倍率（省略時は 1。1 以上の有限の数） */
  multiplier?: number;
  /** 艦名（省略時は空。前後の空白を除き、重複を除く。空の艦名は不可） */
  shipNames?: readonly string[];
}

/** 特効グループの変更（U16：倍率と名前をその場で編集） */
export interface BoostGroupPatch {
  name?: string;
  multiplier?: number;
}

// ---- 新規作成 ----

/** 新規作成の初期状態を作るときの入力 */
export interface CreateDefinitionInput {
  /** 新しいイベントの ID */
  eventId: string;
  /** 元にするイベントの文書（使わないなら省略か null） */
  base?: DefinitionDoc | null;
}

// ---- イベントの情報（名前・日時） ----

/** イベントの情報の変更（指定した項目だけ変える。権限の確認は checkUpdatePermission で行う） */
export interface EventPatch {
  name?: string;
  startAt?: string;
  endAt?: string | null;
}

/** 定義画面のモード。既存を更新（最新のイベント）／新規作成（管理者だけ） */
export type EditMode = "create" | "update";

/** イベントの情報の検証の対象の欄 */
export type EventInfoField = "name" | "startAt" | "endAt";

/**
 * イベントの情報の検証エラーの種類
 * - required：必須の欄が空（空白だけを含む）
 * - invalid_format：日時の形式が違う（ISO 8601 の時差つき。例 "2026-08-07T12:00+09:00"、秒は省略可）
 * - end_before_start：終了日時が開始日時以前
 * - end_in_past：（更新のとき）終了日時が今以前
 */
export type EventInfoErrorCode = "required" | "invalid_format" | "end_before_start" | "end_in_past";

/** イベントの情報の検証エラー */
export interface EventInfoError {
  field: EventInfoField;
  code: EventInfoErrorCode;
  /** 画面に出す文（日本語） */
  message: string;
}

/** イベントの情報の検証の入力 */
export interface EventInfoInput {
  mode: EditMode;
  /** イベント名 */
  name: string;
  /** 開始日時（ISO 8601 の時差つき。未入力は空文字） */
  startAt: string;
  /** 終了日時（任意。未定は null か空文字） */
  endAt: string | null;
  /** 今の時刻（テストで固定できるよう引数で渡す） */
  now: Date;
}

// ---- 権限（要件 2.3、U18） ----

/** 権限（要件 2.1）。ログインの仕組み（src/features/auth/）の型ができたら、そちらとそろえる */
export type Role = "user" | "collab" | "admin";

/** 権限ごとに、定義画面で何ができるか */
export interface EditPermissions {
  /** 定義画面を開ける（終了したイベントを見るだけの場合を含む） */
  canOpen: boolean;
  /** 札・段階・大事さ・特効を編集し、下書きを保存できる */
  canEditContent: boolean;
  /** 公開できる（「変更を公開する」、新規作成では「公開して最新にする」） */
  canPublish: boolean;
  /** イベント名を変えられる */
  canEditName: boolean;
  /** 開始日時を変えられる */
  canEditStartAt: boolean;
  /** 終了日時を変えられる */
  canEditEndAt: boolean;
  /** 新規作成ができる（「新規作成」への切り替え、終了後の「新しいイベントを作成」） */
  canCreate: boolean;
  /** 最新のイベントが終了している（保存済みの終了日時で判定。新規作成のときは false） */
  ended: boolean;
}

/** 権限の計算の入力 */
export interface EditPermissionsInput {
  role: Role;
  mode: EditMode;
  /** 保存済みの終了日時（DB にある最新イベントの値。編集中の値ではない）。新規作成のときは使わない */
  savedEndAt: string | null;
  /** 今の時刻 */
  now: Date;
}

/** 更新の保存（下書きの保存・公開）の権限の確認の入力 */
export interface UpdatePermissionInput {
  role: Role;
  /** 保存先の今のイベントの情報（相手が保存した内容を含む、DB にある最新の値） */
  saved: EventInfo;
  /** 保存しようとしているイベントの情報 */
  next: EventInfo;
  /** 今の時刻 */
  now: Date;
}

/** 協力者が変えられないイベントの情報の欄 */
export type ProtectedEventField = "name" | "startAt";

/**
 * 更新の保存の権限の確認の結果
 * - forbidden_role：一般利用者は保存できない
 * - event_ended：保存済みの終了日時を過ぎている（誰も更新できない）
 * - forbidden_field：協力者がイベント名・開始日時を変えようとしている
 */
export type UpdatePermissionResult =
  | { ok: true }
  | { ok: false; code: "forbidden_role"; message: string }
  | { ok: false; code: "event_ended"; message: string }
  | { ok: false; code: "forbidden_field"; fields: ProtectedEventField[]; message: string };
