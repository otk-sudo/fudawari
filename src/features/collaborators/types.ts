// 協力者画面（要件 3.8）の型と「協力者の保管庫」のインターフェース。
// DB とのやりとり（一覧・発行・外す）はこの保管庫にまとめ、画面は差し替えられるように受け取る（画面のテストでは偽物を渡す）

/** 権限（profiles.role） */
export type CollaboratorRole = "admin" | "collab";

/** 編集できる人（profiles の 1 行） */
export type Collaborator = {
  /** profiles.user_id */
  userId: string;
  /** profiles.display_name */
  displayName: string;
  /** profiles.role */
  role: CollaboratorRole;
  /** 追加した日時（profiles.created_at。ISO 8601） */
  createdAt: string;
  /** 最後に定義を編集した日時（profiles.last_edited_at。ISO 8601）。まだなければ null */
  lastEditedAt: string | null;
  /** 最後の編集の内容（profiles.last_edited_note。例「下書きを保存」「公開」）。なければ null */
  lastEditedNote: string | null;
};

/**
 * 保管庫の失敗の理由
 * - id-taken：その ID のアカウントがすでにある（auth.signUp の失敗。user_already_exists）
 * - already-registered：すでに権限がある人を登録しようとした（FD010）
 * - invalid-input：入力が不正（FD005）
 * - forbidden：権限がない（FD001）
 * - not-found：相手が見つからない（FD009）
 * - cannot-remove-admin：管理者は外せない（FD011）
 * - network：通信の失敗
 * - unknown：上のどれでもない失敗
 */
export type CollaboratorError =
  | "id-taken"
  | "already-registered"
  | "invalid-input"
  | "forbidden"
  | "not-found"
  | "cannot-remove-admin"
  | "network"
  | "unknown";

/** 保管庫の結果 */
export type CollaboratorResult<T> = { ok: true; value: T } | { ok: false; error: CollaboratorError };

/** 協力者を追加する（ID とパスワードを発行する）ときの入力。パスワードは画面が作って渡す */
export type IssueCollaboratorInput = {
  /** ログインの ID（「@fudawari.invalid」を付けない形。形は画面が先に確かめる） */
  loginId: string;
  /** 表示名 */
  displayName: string;
  /** 画面が作ったパスワード（英数字 16 文字） */
  password: string;
};

/** 協力者の保管庫 */
export type CollaboratorRepository = {
  /** 編集できる人の一覧（profiles の全行） */
  list: () => Promise<CollaboratorResult<Collaborator[]>>;
  /** アカウントを作り（保存しない別のクライアントで auth.signUp）、register_collaborator で協力者にする。作ったアカウントの user ID を返す */
  issue: (input: IssueCollaboratorInput) => Promise<CollaboratorResult<{ userId: string }>>;
  /** 協力者を外す（remove_collaborator） */
  remove: (userId: string) => Promise<CollaboratorResult<void>>;
};
