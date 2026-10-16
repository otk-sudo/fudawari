// 協力者の保管庫の Supabase の実装（docs/design/database.md 2.1.1・4 章）。
//
// - 一覧：profiles の全行（RLS で管理者・協力者は全行を読める）
// - 発行：まず、ふだんのクライアントに管理者のセッションがあるかを確かめる（なければアカウントを作らずに forbidden）。
//   次に、保存しない別のクライアント（createIssuingSupabaseClient）で auth.signUp（ID は「ID@fudawari.invalid」）し、
//   返った user ID を、ふだんのクライアント（管理者のログイン）で rpc("register_collaborator", { p_user_id, p_display_name }) に渡す。
//   発行用のクライアントは、使い終わったら（成功・失敗とも）破棄する
// - 外す：ふだんのクライアントで rpc("remove_collaborator", { p_user_id })
// - セッションの確認（checkSession）：ふだんのクライアントの auth.getUser
// - クライアントは、各操作を呼んだときに作る（保管庫を作っただけでは作らない）
// - 失敗は例外にせず、理由（CollaboratorError）で返す
import {
  type AuthError,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { loginIdToEmail } from "@/features/auth";
import {
  createIssuingSupabaseClient,
  getSupabaseClient,
  isPermissionFailure,
  isUnreachableStatus,
} from "@/lib/supabase";
import type {
  Collaborator,
  CollaboratorError,
  CollaboratorRepository,
  CollaboratorResult,
  IssueCollaboratorInput,
} from "./types";

/** RPC の例外のコード（docs/design/database.md 4.1）と、保管庫の失敗の理由の対応 */
const RPC_ERRORS: Readonly<Record<string, CollaboratorError>> = {
  FD001: "forbidden",
  FD005: "invalid-input",
  FD009: "not-found",
  FD010: "already-registered",
  FD011: "cannot-remove-admin",
};

/** profiles から読む列 */
const PROFILE_COLUMNS = "user_id, display_name, role, created_at, last_edited_at, last_edited_note";

function fail<T>(error: CollaboratorError): CollaboratorResult<T> {
  return { ok: false, error };
}

/** 表の読み取り・RPC の失敗を、保管庫の失敗の理由にする */
function postgrestError(error: PostgrestError, status: number): CollaboratorError {
  const mapped = RPC_ERRORS[error.code];
  if (mapped !== undefined) return mapped;
  // 権限がない（42501）・JWT が無効か期限切れ（PGRST301）・状態コード 401 は、FD001 と同じく扱う
  if (isPermissionFailure(error.code, status)) return "forbidden";
  return isUnreachableStatus(status) ? "network" : "unknown";
}

/** auth.getUser の失敗を、セッションの有無か保管庫の失敗の理由にする */
function sessionErrorResult(error: AuthError): CollaboratorResult<boolean> {
  // 届かなかった・Auth のサーバーの障害（AuthRetryableFetchError は fetch の失敗と 502〜504）
  if (isAuthRetryableFetchError(error)) return fail("network");
  if (isAuthApiError(error) && isUnreachableStatus(error.status)) return fail("network");
  // セッションがない・期限切れで更新できない・JWT が受け付けられない（4xx）
  if (isAuthSessionMissingError(error) || isAuthApiError(error)) return { ok: true, value: false };
  return fail("unknown");
}

/** ふだんのクライアントに、ログインのセッションがあるかを確かめる（auth.getUser。Auth のサーバーに問い合わせる） */
async function sessionOf(client: SupabaseClient): Promise<CollaboratorResult<boolean>> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error !== null) return sessionErrorResult(error);
    return { ok: true, value: data.user !== null };
  } catch {
    return fail("network");
  }
}

/** auth.signUp の失敗を、保管庫の失敗の理由にする */
function signUpError(error: AuthError): CollaboratorError {
  if (isAuthRetryableFetchError(error)) return "network";
  // 古い Auth のサーバーは code を付けず、文だけで返す
  if (
    error.code === "user_already_exists" ||
    error.code === "email_exists" ||
    error.message === "User already registered"
  ) {
    return "id-taken";
  }
  // パスワードの条件・アカウント作成の停止・回数の制限など（アカウントは作られていない）
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** profiles の 1 行を画面の形にする。形が違えば null */
function toCollaborator(row: unknown): Collaborator | null {
  if (!isRecord(row)) return null;
  const {
    user_id: userId,
    display_name: displayName,
    role,
    created_at: createdAt,
    last_edited_at: lastEditedAt,
    last_edited_note: lastEditedNote,
  } = row;
  if (typeof userId !== "string" || typeof displayName !== "string") return null;
  if (role !== "admin" && role !== "collab") return null;
  if (typeof createdAt !== "string") return null;
  if (!isNullableString(lastEditedAt) || !isNullableString(lastEditedNote)) return null;
  return { userId, displayName, role, createdAt, lastEditedAt, lastEditedNote };
}

/** ふだんのクライアント。設定がない・作れないときは null */
function mainClient(): SupabaseClient | null {
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
}

async function list(): Promise<CollaboratorResult<Collaborator[]>> {
  const client = mainClient();
  if (client === null) return fail("unknown");
  try {
    const { data, error, status } = await client.from("profiles").select(PROFILE_COLUMNS);
    if (error !== null) return fail(postgrestError(error, status));
    if (!Array.isArray(data)) return fail("unknown");
    const members: Collaborator[] = [];
    for (const row of data) {
      const member = toCollaborator(row);
      if (member === null) return fail("unknown");
      members.push(member);
    }
    return { ok: true, value: members };
  } catch {
    return fail("network");
  }
}

/** 発行用のクライアント（保存しない別のクライアント）。設定がない・作れないときは null */
function issuingClient(): SupabaseClient | null {
  try {
    return createIssuingSupabaseClient();
  } catch {
    return null;
  }
}

/**
 * 使い終わった発行用のクライアントを破棄する（auth.dispose で、セッションの更新・タブ間の通知などの後始末をする）。
 * auth.dispose がない版の supabase-js では、このクライアントのセッションを scope: "local" で終える（ふだんのクライアントのログインは変えない）。
 * 失敗しても発行の結果は変えない
 */
async function disposeIssuingClient(client: SupabaseClient): Promise<void> {
  try {
    // 古い版の supabase-js には auth.dispose がないので、あるかを確かめてから呼ぶ
    if (typeof client.auth.dispose === "function") {
      await client.auth.dispose();
    } else {
      await client.auth.signOut({ scope: "local" });
    }
  } catch {
    // 捨てるクライアントなので、片付けられなくても困らない
  }
}

/** 保存しない別のクライアントでアカウントを作り、作ったアカウントの user ID を返す */
async function createAccount(input: IssueCollaboratorInput): Promise<CollaboratorResult<string>> {
  const client = issuingClient();
  if (client === null) return fail("unknown");
  try {
    const { data, error } = await client.auth.signUp({
      email: loginIdToEmail(input.loginId),
      password: input.password,
    });
    if (error !== null) return fail(signUpError(error));
    const user = data.user;
    if (user === null) return fail("unknown");
    // 「Confirm email」が ON のときは、すでにあるメールアドレスでも失敗にせず、identities が空の利用者を返す
    if (Array.isArray(user.identities) && user.identities.length === 0) return fail("id-taken");
    // 「Confirm email」が ON だと、アカウントは作られるがセッションが返らない（確認のメールを待つ状態で、ログインできない）。
    // 協力者にはせず、Supabase の設定の失敗として返す（設計書 2.1.1 は OFF が前提）
    if (data.session === null) return fail("config");
    return { ok: true, value: user.id };
  } catch {
    return fail("network");
  } finally {
    await disposeIssuingClient(client);
  }
}

async function issue(input: IssueCollaboratorInput): Promise<CollaboratorResult<{ userId: string }>> {
  const client = mainClient();
  if (client === null) return fail("unknown");

  // 管理者のセッションがなければ、アカウントを作らない（作った後で register_collaborator が断られると、その ID が使えなくなるため）
  const session = await sessionOf(client);
  if (!session.ok) return fail(session.error);
  if (!session.value) return fail("forbidden");

  const account = await createAccount(input);
  if (!account.ok) return account;
  const userId = account.value;

  // 管理者のログイン（ふだんのクライアント）で協力者にする
  try {
    const { error, status } = await client.rpc("register_collaborator", {
      p_user_id: userId,
      p_display_name: input.displayName,
    });
    if (error !== null) return fail(postgrestError(error, status));
    return { ok: true, value: { userId } };
  } catch {
    return fail("network");
  }
}

async function remove(userId: string): Promise<CollaboratorResult<void>> {
  const client = mainClient();
  if (client === null) return fail("unknown");
  try {
    const { error, status } = await client.rpc("remove_collaborator", { p_user_id: userId });
    if (error !== null) return fail(postgrestError(error, status));
    return { ok: true, value: undefined };
  } catch {
    return fail("network");
  }
}

async function checkSession(): Promise<CollaboratorResult<boolean>> {
  const client = mainClient();
  if (client === null) return fail("unknown");
  return sessionOf(client);
}

/** 協力者の保管庫（Supabase の実装）を作る。クライアントは各操作を呼んだときに作る */
export function createSupabaseCollaboratorRepository(): CollaboratorRepository {
  return { list, issue, remove, checkSession };
}
