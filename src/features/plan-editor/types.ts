// イベント定義の画面（要件 3.7、roadmap T3-7・T3-8・T3-11、plan-v1 の PR-11）の「定義の保管庫」の型
//
// - 画面は、データの読み書きをこの保管庫（DefinitionRepository）だけを通して行う。
//   PR-11a（画面と編集の操作）のテストではメモリ上の偽物を渡し、PR-11b で Supabase の RPC を使う実装を作る。
// - 書き込みの関数は DB の RPC（docs/design/database.md 4 章）と 1 対 1 にする：
//   saveDraft ↔ save_draft、publish ↔ publish_definition、createEvent ↔ create_event、updateEventMeta ↔ update_event_meta。
//   読み取り（load・loadEventContent）は RLS で読める表（profiles・events・app_state・drafts・published_definitions）から組み立てる。
// - 日時はすべて ISO 8601 の時差つきの文字列（例 "2026-08-07T12:00:00+09:00"。秒は省略可。PublicDefinition の約束と同じ）。
// - 失敗したときは、画面に出す理由の文（日本語）を message に持つ Error で reject する。画面はその message を出す
//   （例：終了したイベントの保存 → 「このイベントは終了したため、更新できません」）。
import type { DefinitionDoc } from "@/domain/definition-edit";

/** 定義画面を使える権限（profiles.role）。一般利用者は定義画面を開けないため含めない */
export type EditorRole = "admin" | "collab";

/** ログイン中の人 */
export interface EditorUser {
  /** 表示名（profiles.display_name。「ログイン中：（名前）（権限）」に出す） */
  readonly displayName: string;
  /** 権限（DB の値。画面の出し分けはこの値で行う） */
  readonly role: EditorRole;
}

/** 共有の下書き（drafts。イベントごとに 1 つ） */
export interface SharedDraft {
  /** 版（保存のたびに 1 増える。下書きの保存・公開のときに「開いたときの版」として渡す） */
  readonly version: number;
  /** 定義の文書（公開定義 JSON と同じ形） */
  readonly content: DefinitionDoc;
  /** 最後に保存した人の表示名（外された人なら「不明」） */
  readonly updatedByName: string;
  /** 最後に保存した日時 */
  readonly updatedAt: string;
}

/** 公開中の版（published_definitions の最新の行） */
export interface PublishedVersion {
  /** 版の日付（"YYYY-MM-DD"。画面では「2026/08/04 版」） */
  readonly versionDate: string;
  /** 公開した時点の定義の文書（「未公開の変更」の比較に使う） */
  readonly content: DefinitionDoc;
}

/** 定義画面で編集するイベント（events の行と、その下書き・公開中の版） */
export interface EditableEvent {
  /** イベント ID（events.id） */
  readonly id: string;
  /** イベント名（events.name。正はこちらで、下書きの content.event は写し） */
  readonly name: string;
  /** 開始日時（events.starts_at） */
  readonly startAt: string;
  /** 終了日時（events.ends_at。未定は null）。保存済みの値なので「終了したイベント」の判定に使う */
  readonly endAt: string | null;
  /** 共有の下書き */
  readonly draft: SharedDraft;
  /** 公開中の版（まだ公開していなければ null） */
  readonly published: PublishedVersion | null;
}

/** 編集できる人（profiles の行） */
export interface EditorMember {
  /** profiles.user_id（編集中の表示の名前・保存の記録の「誰が」を ID で引くため） */
  readonly userId: string;
  readonly displayName: string;
  readonly role: EditorRole;
}

/** 新規作成の「元にするイベント」の候補 */
export interface BaseEventOption {
  /** イベント ID（loadEventContent に渡す） */
  readonly id: string;
  /** イベント名 */
  readonly name: string;
}

/** 定義画面を開いたときに読むもの */
export interface PlanEditorData {
  /** ログイン中の人 */
  readonly user: EditorUser;
  /** 最新のイベント（app_state.latest_event_id。まだイベントが 1 つもなければ null） */
  readonly latestEvent: EditableEvent | null;
  /**
   * 管理者が新規作成して、まだ公開していないイベント（U18：未公開の新規イベントは管理者だけが編集する）。
   * 管理者にだけ返す（協力者には null）。2 つ以上あるときは最後に作ったもの。なければ null。
   * 新規作成で「下書きを保存」した後に画面を開き直しても、続きから編集できるようにするため
   */
  readonly unpublishedEvent: EditableEvent | null;
  /** 編集できる人（管理者・協力者。「編集できる人：…」に並べる順） */
  readonly members: readonly EditorMember[];
  /** 新規作成の「元にするイベント」の候補（過去のイベント。並べる順） */
  readonly baseEventOptions: readonly BaseEventOption[];
}

/** 保存の記録の 1 件（save_logs に入れる。save_draft の p_logs の要素） */
export interface SaveLogInput {
  /** 絞り込み用の海域の表示名（例 "E2"）。海域によらない変更は null */
  readonly mapLabel: string | null;
  /** 記録の内容の文（例「E2 ゲージ3 の大事さを「難所」→「重要」」。src/domain/merge の describeChanges・summarizeSave で作る） */
  readonly summary: string;
}

/** 下書きの保存の入力（save_draft） */
export interface SaveDraftInput {
  /** イベント ID */
  readonly eventId: string;
  /** 開いたときの版（最後に読んだ・保存した下書きの版） */
  readonly baseVersion: number;
  /** 保存する文書 */
  readonly content: DefinitionDoc;
  /** 保存の記録の文（空の配列も可） */
  readonly logs: readonly SaveLogInput[];
}

/**
 * 下書きの保存の結果
 * - saved：保存した（version は新しい版）
 * - conflict：開いた後に他の人が保存していたため保存していない（今の版・内容・保存した人・日時。PR-11b で 3 方向マージする）
 */
export type SaveDraftResult =
  | { readonly status: "saved"; readonly version: number }
  | {
      readonly status: "conflict";
      readonly version: number;
      readonly content: DefinitionDoc;
      readonly updatedByName: string;
      readonly updatedAt: string;
    };

/** 公開の入力（publish_definition。公開するのは、保存済みの下書きのうち baseVersion の版） */
export interface PublishInput {
  /** イベント ID */
  readonly eventId: string;
  /** 公開する下書きの版（今の下書きの版と違えば失敗する） */
  readonly baseVersion: number;
  /** 最新のイベントにするか（新規作成の「公開して最新にする」だけ true。管理者だけ） */
  readonly makeLatest: boolean;
}

/** 公開の結果 */
export interface PublishResult {
  readonly status: "published";
  /** 公開版の ID */
  readonly id: string;
  /** 版の表示（例「2026/10/17 版」） */
  readonly versionLabel: string;
  /** 版の日付（"YYYY-MM-DD"） */
  readonly versionDate: string;
}

/** イベントの作成の入力（create_event。管理者だけ） */
export interface CreateEventInput {
  /** イベント名（空は不可） */
  readonly name: string;
  /** 開始日時 */
  readonly startAt: string;
  /** 終了日時（未定は null） */
  readonly endAt: string | null;
  /** 初期の文書（createDefinition で作り、画面で編集したもの） */
  readonly content: DefinitionDoc;
}

/** 作成したイベント */
export interface CreatedEvent {
  /** 作成したイベントの ID */
  readonly eventId: string;
  /** 作成した下書きの版（create_event は版 1 の下書きを作る） */
  readonly draftVersion: number;
}

/** イベントの名前・期間の更新の入力（update_event_meta。協力者は終了日時だけを変えられる） */
export interface UpdateEventMetaInput {
  /** イベント ID */
  readonly eventId: string;
  /** イベント名（協力者は今の値をそのまま渡す） */
  readonly name: string;
  /** 開始日時（協力者は今の値をそのまま渡す） */
  readonly startAt: string;
  /** 終了日時（未定は null） */
  readonly endAt: string | null;
}

/** 定義の保管庫 */
export interface DefinitionRepository {
  /** 定義画面を開いたときに読む */
  load(): Promise<PlanEditorData>;
  /** 下書きを保存する（save_draft） */
  saveDraft(input: SaveDraftInput): Promise<SaveDraftResult>;
  /** 保存済みの下書きを公開する（publish_definition） */
  publish(input: PublishInput): Promise<PublishResult>;
  /** イベントと版 1 の下書きを作る（create_event） */
  createEvent(input: CreateEventInput): Promise<CreatedEvent>;
  /** イベントの名前・期間を更新する（update_event_meta） */
  updateEventMeta(input: UpdateEventMetaInput): Promise<void>;
  /** 新規作成の「元にするイベント」の文書を読む（そのイベントの最新の公開版。なければ下書き） */
  loadEventContent(eventId: string): Promise<DefinitionDoc>;
}
