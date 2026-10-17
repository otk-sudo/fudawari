// イベント定義の保管庫（DefinitionRepository）の Supabase の実装（PR-11b。docs/design/database.md 3・4 章）。
//
// - 読み取り（load・loadEventContent）は、RLS で読める表（profiles・app_state・events・drafts・published_definitions）から組み立てる
//   - load は、まず Auth のサーバーにセッションを問い合わせ（auth.getUser）、なければイベントも下書きも読まずに SessionExpiredError で失敗する
//   - 自分の profiles の行がなければ（権限のないアカウント）、「権限がありません」で失敗する
// - 書き込みはすべて security definer の RPC（save_draft・publish_definition・create_event・update_event_meta）。表へ直接書かない
// - 日時は PostgREST の返す形（"2026-10-15T13:40:00.345678+00:00"）のままにせず、同じ時刻の日本時間の
//   「秒の小数のない時差つき」（"2026-10-15T22:40:00+09:00"）にして返す（公開定義の検証・formatDateTimeJst が読める形）
// - 失敗は、画面に出す理由の文（日本語）を message に持つ Error で reject する（例外のコードは docs/design/database.md 4.1）
// - クライアントは、各操作を呼んだときに作る（保管庫を作っただけでは作らない）。
//   この部品は supabase-js を読み込むので、画面は lazy-repository.ts から遅延読み込みする
import {
  type AuthError,
  isAuthApiError,
  isAuthSessionMissingError,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { type DefinitionDoc, validateDraftDefinition } from "@/domain/definition-edit";
import { parseDateTime } from "@/domain/definition-edit/datetime";
import { getSupabaseClient, isUnreachableStatus } from "@/lib/supabase";
import { SessionExpiredError } from "./repository-errors";
import type {
  BaseEventOption,
  CreatedEvent,
  CreateEventInput,
  DefinitionRepository,
  EditableEvent,
  EditorMember,
  EditorRole,
  PlanEditorData,
  PublishedVersion,
  PublishInput,
  PublishResult,
  SaveDraftInput,
  SaveDraftResult,
  UpdateEventMetaInput,
} from "./types";

// ---- 理由の文 ----

const MSG_NO_CONFIG = "Supabase の接続の設定がありません（管理者に連絡してください）";
const MSG_NETWORK = "通信に失敗しました。しばらくしてからやり直してください";
const MSG_FORBIDDEN = "権限がありません（管理者・協力者だけが使えます）";
const MSG_PERMISSION_DENIED = "権限がありません。管理者・協力者でログインし直してください";
const MSG_RATE_LIMITED = "問い合わせの回数が上限に達しました。しばらくしてからやり直してください";
const MSG_INVALID_RESPONSE = "サーバーの応答の形が正しくありません";
const MSG_NOT_FOUND = "イベントが見つかりません";
/** 下書きの保存者が profiles にいない（外された協力者）ときの表示名（save_draft の conflict と同じ） */
const UNKNOWN_NAME = "不明";

/** RPC の例外のコード（docs/design/database.md 4.1）と理由の文。FD005 はサーバーの説明を後ろに足す */
const RPC_MESSAGES: Readonly<Record<string, string>> = {
  FD001: MSG_FORBIDDEN,
  FD002: "このイベントは終了したため、更新できません",
  FD003: "最新のイベントではないため、更新できません",
  FD004: "下書きの版が違います（ほかの人が保存しました）。ページを再読み込みしてください",
  FD005: "入力が正しくありません",
  FD009: MSG_NOT_FOUND,
};

// ---- 読む列 ----

const PROFILE_COLUMNS = "user_id, display_name, role, created_at";
const EVENT_COLUMNS = "id, name, starts_at, ends_at, created_at";
const DRAFT_COLUMNS = "event_id, version, content, updated_by, updated_at";

// ---- 失敗 ----

function networkError(): Error {
  return new Error(MSG_NETWORK);
}

function invalidResponse(): Error {
  return new Error(MSG_INVALID_RESPONSE);
}

/** 表の読み取り・RPC の失敗を、理由の文の Error にする */
function postgrestError(error: PostgrestError, status: number): Error {
  const message = RPC_MESSAGES[error.code];
  if (message !== undefined) {
    // 入力の誤りは、サーバーの説明（日本語）があれば足す
    if (error.code === "FD005" && error.message !== "") return new Error(`${message}：${error.message}`);
    return new Error(message);
  }
  // JWT が無効・期限切れ（PGRST301）・ログインの情報が受け付けられない（401）：セッションが切れている
  if (error.code === "PGRST301" || status === 401) return new SessionExpiredError();
  // 権限がない（RLS・GRANT で断られた。外された協力者など）
  if (error.code === "42501") return new Error(MSG_PERMISSION_DENIED);
  if (status === 429) return new Error(MSG_RATE_LIMITED);
  if (isUnreachableStatus(status)) return networkError();
  return new Error(`サーバーで失敗しました（${error.code === "" ? String(status) : error.code}）`);
}

/** 表の読み取り・RPC の応答の形（supabase-js の PostgrestResponse のうち使うところ） */
type QueryResponse = { data: unknown; error: PostgrestError | null; status: number };

/** 読み取り・RPC を待ち、成功なら data を返す。失敗・例外は理由の文の Error にする */
async function run(query: PromiseLike<QueryResponse>): Promise<unknown> {
  let response: QueryResponse;
  try {
    response = await query;
  } catch {
    throw networkError();
  }
  if (response.error !== null) throw postgrestError(response.error, response.status);
  return response.data;
}

/** ふだんのクライアント。設定がなければ「設定がありません」で失敗する */
function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (client === null) throw new Error(MSG_NO_CONFIG);
  return client;
}

/** Auth の失敗のうち、セッションが切れていることを表すコード（403 のとき。JWT が受け付けられない・セッションがない） */
const SESSION_EXPIRED_AUTH_CODES: ReadonlySet<string> = new Set(["bad_jwt", "session_not_found"]);

/**
 * auth.getUser の失敗を Error にする。SessionExpiredError にするのは、セッションが切れていると分かるときだけ
 * （AuthSessionMissingError、AuthApiError の 401、403 の bad_jwt・session_not_found）。
 * 回数の上限（429）は「しばらくしてから」の失敗、届かなかった・Auth のサーバーの障害は通信の失敗にする
 */
function authError(error: AuthError): Error {
  if (isAuthSessionMissingError(error)) return new SessionExpiredError();
  if (isAuthApiError(error)) {
    if (error.status === 401) return new SessionExpiredError();
    if (error.status === 403 && error.code !== undefined && SESSION_EXPIRED_AUTH_CODES.has(error.code)) {
      return new SessionExpiredError();
    }
    if (error.status === 429) return new Error(MSG_RATE_LIMITED);
    if (isUnreachableStatus(error.status)) return networkError();
    return new Error(`ログインの状態を確かめられませんでした（${error.code ?? String(error.status)}）`);
  }
  // 届かなかった（AuthRetryableFetchError）・そのほかの失敗
  return networkError();
}

/** ログイン中の人の user ID（Auth のサーバーに問い合わせる）。セッションがなければ SessionExpiredError */
async function requireUserId(client: SupabaseClient): Promise<string> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await client.auth.getUser();
  } catch {
    throw networkError();
  }
  if (result.error !== null) throw authError(result.error);
  const user = result.data.user;
  if (user === null) throw new SessionExpiredError();
  return user.id;
}

// ---- 値の取り出し ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse();
  return value;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map(asRecord);
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalidResponse();
  return value;
}

function asRole(value: unknown): EditorRole {
  if (value !== "admin" && value !== "collab") throw invalidResponse();
  return value;
}

/** 定義の文書（jsonb）を検証して返す（下書きの検証。形が違えば失敗） */
function asDoc(value: unknown): DefinitionDoc {
  const checked = validateDraftDefinition(value);
  if (!checked.ok) throw new Error("サーバーの定義の文書の形が正しくありません");
  return checked.value;
}

// ---- 日時 ----

/** PostgREST の timestamptz（秒・秒の小数・時差の書き方に幅がある）。4 つ目は秒の小数、5 つ目は時差 */
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 時差の書き方を "+09:00" の形にそろえる（"Z" はそのまま） */
function normalizeOffset(offset: string): string {
  if (offset === "Z") return offset;
  const digits = offset.slice(1).replace(":", "");
  return `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
}

/** 日時の文字列を読む（秒までのミリ秒と、秒の小数のミリ秒）。読めなければ失敗 */
function readTimestamp(value: unknown): { readonly ms: number; readonly fractionMs: number } {
  const match = TIMESTAMP_PATTERN.exec(asString(value));
  if (match === null) throw invalidResponse();
  const ms = parseDateTime(`${match[1]}T${match[2]}:${match[3] ?? "00"}${normalizeOffset(match[5] ?? "Z")}`);
  if (ms === undefined) throw invalidResponse();
  return { ms, fractionMs: match[4] === undefined ? 0 : Number(match[4]) * 1000 };
}

/** 日時の文字列を、1970-01-01T00:00Z からのミリ秒にする（秒の小数は切り捨てる。表示に使う）。読めなければ失敗 */
function timestampMs(value: unknown): number {
  return readTimestamp(value).ms;
}

/**
 * 日時の文字列を、秒の小数（マイクロ秒まで）も含めたミリ秒にする（小数つきの数）。
 * 作った順の比べ合いに使う（同じ秒に作った 2 つのイベントも見分ける）
 */
function preciseTimestampMs(value: unknown): number {
  const { ms, fractionMs } = readTimestamp(value);
  return ms + fractionMs;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 日時の文字列を、同じ時刻の日本時間の「秒の小数のない時差つき」にする（例 "2026-10-15T22:40:00+09:00"） */
function toJstIso(value: unknown): string {
  const jst = new Date(timestampMs(value) + JST_OFFSET_MS);
  const date = `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
  const time = `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}:${pad2(jst.getUTCSeconds())}`;
  return `${date}T${time}+09:00`;
}

/** 日時か null（終了日時の未定） */
function toJstIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toJstIso(value);
}

const VERSION_LABEL_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})/;

/** 版の表示（「2026/08/04 版」）から版の日付（"2026-08-04"）を取り出す。読めなければ文書の版の日付 */
function versionDateOf(label: unknown, content: DefinitionDoc): string {
  const match = typeof label === "string" ? VERSION_LABEL_PATTERN.exec(label) : null;
  if (match !== null) return `${match[1]}-${match[2]}-${match[3]}`;
  if (content.event.versionDate !== "") return content.event.versionDate;
  throw invalidResponse();
}

// ---- 表の行 ----

interface ProfileRow {
  readonly userId: string;
  readonly displayName: string;
  readonly role: EditorRole;
  /** 作った日時（秒の小数まで。並べる順に使う） */
  readonly createdMs: number;
}

function toProfile(row: Record<string, unknown>): ProfileRow {
  return {
    userId: asString(row.user_id),
    displayName: asString(row.display_name),
    role: asRole(row.role),
    createdMs: preciseTimestampMs(row.created_at),
  };
}

interface EventRow {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly startMs: number;
  /** 作った日時（秒の小数まで。並べる順に使う） */
  readonly createdMs: number;
}

function toEvent(row: Record<string, unknown>): EventRow {
  return {
    id: asString(row.id),
    name: asString(row.name),
    startAt: toJstIso(row.starts_at),
    endAt: toJstIsoOrNull(row.ends_at),
    startMs: timestampMs(row.starts_at),
    createdMs: preciseTimestampMs(row.created_at),
  };
}

interface DraftRow {
  readonly eventId: string;
  readonly version: number;
  readonly content: DefinitionDoc;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

function toDraft(row: Record<string, unknown>): DraftRow {
  return {
    eventId: asString(row.event_id),
    version: asInteger(row.version),
    content: asDoc(row.content),
    updatedBy: asString(row.updated_by),
    updatedAt: toJstIso(row.updated_at),
  };
}

/** 編集できる人の並び：管理者を先に、追加した順（協力者画面の表と同じ） */
function compareMembers(a: ProfileRow, b: ProfileRow): number {
  if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
  return a.createdMs - b.createdMs;
}

/** イベントの新しい順（開始日時の遅い順、同じなら作った順の遅い順） */
function compareNewest(a: EventRow, b: EventRow): number {
  return b.startMs - a.startMs || b.createdMs - a.createdMs;
}

// ---- 読み取り ----

/** そのイベントの公開版のうち最新の 1 件（なければ null） */
async function latestPublished(client: SupabaseClient, eventId: string): Promise<PublishedVersion | null> {
  const data = await run(
    client
      .from("published_definitions")
      .select("version_label, content")
      .eq("event_id", eventId)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (data === null) return null;
  const row = asRecord(data);
  const content = asDoc(row.content);
  return { versionDate: versionDateOf(row.version_label, content), content };
}

/** events の行と下書き・公開中の版から、編集するイベントを作る */
function editableEvent(
  event: EventRow,
  draft: DraftRow | undefined,
  published: PublishedVersion | null,
  names: ReadonlyMap<string, string>,
): EditableEvent {
  if (draft === undefined) throw new Error(`「${event.name}」の下書きが見つかりません`);
  return {
    id: event.id,
    name: event.name,
    startAt: event.startAt,
    endAt: event.endAt,
    draft: {
      version: draft.version,
      content: draft.content,
      updatedByName: names.get(draft.updatedBy) ?? UNKNOWN_NAME,
      updatedAt: draft.updatedAt,
    },
    published,
  };
}

async function load(): Promise<PlanEditorData> {
  const client = requireClient();
  const userId = await requireUserId(client);

  // 自分の profiles の行（なければ権限のないアカウント）
  const own = await run(client.from("profiles").select(PROFILE_COLUMNS).eq("user_id", userId).maybeSingle());
  if (own === null) throw new Error(MSG_FORBIDDEN);
  const me = toProfile(asRecord(own));

  const [profileData, appStateData, eventData, publishedData] = await Promise.all([
    run(client.from("profiles").select(PROFILE_COLUMNS)),
    run(client.from("app_state").select("latest_event_id").maybeSingle()),
    run(client.from("events").select(EVENT_COLUMNS)),
    run(client.from("published_definitions").select("event_id")),
  ]);

  const profiles = asRows(profileData).map(toProfile);
  const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
  const latestId = appStateData === null ? null : asRecord(appStateData).latest_event_id;
  if (latestId !== null && latestId !== undefined && typeof latestId !== "string") throw invalidResponse();
  const events = asRows(eventData).map(toEvent);
  const publishedIds = new Set(asRows(publishedData).map((row) => asString(row.event_id)));

  const latestRow = events.find((event) => event.id === latestId) ?? null;
  // 未公開の新規イベント：管理者だけ。最新以外で、公開版がないもののうち最後に作ったもの（U18）
  const unpublishedRow =
    me.role === "admin"
      ? ([...events]
          .filter((event) => event.id !== latestRow?.id && !publishedIds.has(event.id))
          .sort((a, b) => b.createdMs - a.createdMs)[0] ?? null)
      : null;

  const draftIds = [latestRow, unpublishedRow].flatMap((event) => (event === null ? [] : [event.id]));
  const [draftData, latestVersion] = await Promise.all([
    draftIds.length === 0 ? Promise.resolve([]) : run(client.from("drafts").select(DRAFT_COLUMNS).in("event_id", draftIds)),
    latestRow === null ? Promise.resolve(null) : latestPublished(client, latestRow.id),
  ]);
  const drafts = new Map(asRows(draftData).map(toDraft).map((draft) => [draft.eventId, draft]));

  const members: EditorMember[] = [...profiles]
    .sort(compareMembers)
    .map((profile) => ({ displayName: profile.displayName, role: profile.role }));
  // 元にするイベントの候補：既存のイベントすべてを新しい順（新規作成から見ると、最新のイベントも過去のイベント）
  const baseEventOptions: BaseEventOption[] = [...events]
    .sort(compareNewest)
    .map((event) => ({ id: event.id, name: event.name }));

  return {
    user: { displayName: me.displayName, role: me.role },
    latestEvent: latestRow === null ? null : editableEvent(latestRow, drafts.get(latestRow.id), latestVersion, names),
    unpublishedEvent: unpublishedRow === null ? null : editableEvent(unpublishedRow, drafts.get(unpublishedRow.id), null, names),
    members,
    baseEventOptions,
  };
}

async function loadEventContent(eventId: string): Promise<DefinitionDoc> {
  const client = requireClient();
  const published = await latestPublished(client, eventId);
  if (published !== null) return published.content;
  const draft = await run(client.from("drafts").select("content").eq("event_id", eventId).maybeSingle());
  if (draft === null) throw new Error(MSG_NOT_FOUND);
  return asDoc(asRecord(draft).content);
}

// ---- 書き込み（RPC） ----

async function saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const client = requireClient();
  const data = asRecord(
    await run(
      client.rpc("save_draft", {
        p_event_id: input.eventId,
        p_base_version: input.baseVersion,
        p_content: input.content,
        p_logs: input.logs.map((log) => ({ mapLabel: log.mapLabel, summary: log.summary })),
      }),
    ),
  );
  if (data.status === "saved") return { status: "saved", version: asInteger(data.version) };
  if (data.status === "conflict") {
    return {
      status: "conflict",
      version: asInteger(data.version),
      content: asDoc(data.content),
      updatedByName: asString(data.updatedByName),
      updatedAt: toJstIso(data.updatedAt),
    };
  }
  throw invalidResponse();
}

async function publish(input: PublishInput): Promise<PublishResult> {
  const client = requireClient();
  const data = asRecord(
    await run(
      client.rpc("publish_definition", {
        p_event_id: input.eventId,
        p_base_version: input.baseVersion,
        p_make_latest: input.makeLatest,
      }),
    ),
  );
  if (data.status !== "published") throw invalidResponse();
  return {
    status: "published",
    id: asString(data.id),
    versionLabel: asString(data.versionLabel),
    versionDate: asString(data.versionDate),
  };
}

async function createEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const client = requireClient();
  const data = await run(
    client.rpc("create_event", {
      p_name: input.name,
      p_starts_at: input.startAt,
      p_ends_at: input.endAt,
      p_content: input.content,
    }),
  );
  // create_event は版 1 の下書きを作る（docs/design/database.md 4.2）
  return { eventId: asString(data), draftVersion: 1 };
}

async function updateEventMeta(input: UpdateEventMetaInput): Promise<void> {
  const client = requireClient();
  await run(
    client.rpc("update_event_meta", {
      p_event_id: input.eventId,
      p_name: input.name,
      p_starts_at: input.startAt,
      p_ends_at: input.endAt,
    }),
  );
}

/** イベント定義の保管庫（Supabase の実装）を作る。クライアントは各操作を呼んだときに作る */
export function createSupabaseDefinitionRepository(): DefinitionRepository {
  return { load, saveDraft, publish, createEvent, updateEventMeta, loadEventContent };
}
