// ログイン・ログアウトと、ログイン中のアカウント（権限・表示名・ID）。
//
// - ログインは、管理者が発行した ID とパスワード（U3）。ID は「ID@fudawari.invalid」に変えて auth.signInWithPassword に渡す
// - ログインできたら自分の profiles の行（role・display_name）を読み、権限・表示名・ID をブラウザ（localStorage）に保存する
// - 一般の画面は、保存した権限だけを見て Supabase に通信しない。読み込み直しても権限が残る。localStorage が使えなければ一般利用者
// - ログイン中に別の ID でログインし直して、Auth が切り替わった後で失敗したら、前に保存した権限も消して一般利用者に戻す。
//   ID かパスワードが違うだけ（Auth が切り替わっていない）なら、前のログインはそのまま
// - ログアウトは auth.signOut（このブラウザのセッションだけを終える scope: "local"）を呼び、保存した権限を消す
// - supabase-js（大きい）は、ログイン・ログアウトするときに初めて読み込む。
//   この入口は一般の画面（左メニュー・ホーム・設定）も読み込むため、一般利用者に supabase-js を配らないようにする
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
// 設定はファイルから直接読む（@/lib/supabase の入口は supabase-js を読み込むため）
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  type Account,
  clearStoredAccount,
  isManagerRole,
  writeStoredAccount,
} from "./account";
import { isValidLoginId, loginIdToEmail } from "./login-id";
import { applySignedIn, applySignedOut, useAccountState } from "./role";

export type { Account } from "./account";

/**
 * ログインできなかった理由
 * - invalid-id：ID の形式が違う（通信しない）
 * - invalid-credentials：ID かパスワードが違う
 * - no-permission：ログインはできたが profiles に自分の行がない（定義を編集する権限がない。ログアウトし、前に保存した権限も消す）
 * - not-configured：環境変数（接続先）がない（通信しない）
 * - network：通信の失敗。ID・パスワードの間違い以外の Auth の失敗（429・500 など）も含める
 */
export type SignInFailure =
  | "invalid-id"
  | "invalid-credentials"
  | "no-permission"
  | "not-configured"
  | "network";

/** ログインの結果 */
export type SignInResult =
  | { ok: true; account: Account }
  | { ok: false; reason: SignInFailure };

type SupabaseBoundary = typeof import("@/lib/supabase");

// 読み込んだ Supabase の入口。最初に読み込んだものを使い続ける
// （ふだんのクライアントは入口の中に 1 つだけ持つので、同じ入口から受け取る）
let supabaseBoundary: Promise<SupabaseBoundary> | null = null;

/** Supabase の入口（supabase-js を含む）を読み込む。読み込みに失敗したら、次に呼んだときに読み直す */
function loadSupabaseBoundary(): Promise<SupabaseBoundary> {
  if (supabaseBoundary === null) {
    supabaseBoundary = import("@/lib/supabase").catch((error: unknown) => {
      supabaseBoundary = null;
      throw error;
    });
  }
  return supabaseBoundary;
}

/** ふだんのクライアントを受け取る。設定がなければ null */
async function loadSupabaseClient(): Promise<SupabaseClient | null> {
  const { getSupabaseClient } = await loadSupabaseBoundary();
  return getSupabaseClient();
}

function failure(reason: SignInFailure): SignInResult {
  return { ok: false, reason };
}

/** ID かパスワードが違うという Auth の失敗か（それ以外は通信の失敗と同じく扱う） */
function isInvalidCredentials(error: AuthError): boolean {
  // 古い Auth のサーバーは code を付けず、文だけで返す
  return error.code === "invalid_credentials" || error.message === "Invalid login credentials";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** profiles の自分の行から、権限と表示名を取り出す。行がない・形が違うときは null（権限なし） */
function parseOwnProfile(row: unknown): Pick<Account, "role" | "displayName"> | null {
  if (!isRecord(row)) return null;
  const { role, display_name: displayName } = row;
  if (!isManagerRole(role) || typeof displayName !== "string" || displayName === "") return null;
  return { role, displayName };
}

/**
 * このブラウザの Supabase のセッションを終える（scope: "local"。ほかの端末のログインは終えない）。
 * 失敗しても例外を外に出さない（このブラウザのセッションは supabase-js が消す）
 */
async function endSupabaseSession(client: SupabaseClient): Promise<void> {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // 通信できなくても、画面の権限は呼び出し側で一般利用者に戻している
  }
}

/** 保存した権限を消し、この画面も一般利用者に戻す */
function forgetAccount(): void {
  clearStoredAccount();
  applySignedOut();
}

/**
 * Auth が別の人に切り替わった後で、ログインをやめる。
 * 前にログインしていた人の権限を残すと、Supabase のセッション（今は別の人）と食い違うので、保存した権限も消す
 */
async function abandonSwitchedSignIn(client: SupabaseClient): Promise<void> {
  forgetAccount();
  await endSupabaseSession(client);
}

/** ログインした後で、自分の profiles の行を読んで権限を決める（読めなかった・行がないときの後片付けは呼び出し側でする） */
async function readOwnProfile(
  client: SupabaseClient,
  userId: string,
  loginId: string,
): Promise<SignInResult> {
  const { data, error } = await client
    .from("profiles")
    .select("role, display_name")
    .eq("user_id", userId)
    .maybeSingle();
  // 読めなかったときは権限を確かめられないので、ログインをやめる（理由は通信の失敗と同じく出す）
  if (error !== null) return failure("network");
  const profile = parseOwnProfile(data);
  if (profile === null) return failure("no-permission");
  return { ok: true, account: { ...profile, loginId } };
}

/** ID とパスワードでログインする。成功したら権限を保存し、useRole・useAccount の値を切り替える */
export async function signIn(loginId: string, password: string): Promise<SignInResult> {
  const id = loginId.trim();
  if (!isValidLoginId(id)) return failure("invalid-id");
  // 設定がなければ、supabase-js を読み込まずに断る
  if (readSupabaseConfig() === null) return failure("not-configured");

  // Auth が別の人に切り替わった（signInWithPassword が通った）クライアント。切り替わる前は null
  let switchedClient: SupabaseClient | null = null;
  try {
    const client = await loadSupabaseClient();
    if (client === null) return failure("not-configured");

    const { data, error } = await client.auth.signInWithPassword({
      email: loginIdToEmail(id),
      password,
    });
    // 断られたときは Auth は切り替わっていない（supabase-js は前のセッションを残す）ので、前のログインはそのまま
    if (error !== null) return failure(isInvalidCredentials(error) ? "invalid-credentials" : "network");
    switchedClient = client;

    // 利用者が返らないときも、Auth がどうなったか分からないので切り替わった扱いにする
    const result =
      data.user === null ? failure("network") : await readOwnProfile(client, data.user.id, id);
    if (!result.ok) {
      await abandonSwitchedSignIn(client);
      return result;
    }
    // 保存できなくても（localStorage が使えない）、この画面の中ではログインした扱いにする。読み込み直すと一般利用者
    writeStoredAccount(result.account);
    applySignedIn(result.account);
    return result;
  } catch {
    // 呼び出しが例外を投げた（通信の失敗、supabase-js の読み込みの失敗など）。例外は外に出さない
    if (switchedClient !== null) await abandonSwitchedSignIn(switchedClient);
    return failure("network");
  }
}

/** ログアウトする（auth.signOut を scope: "local" で呼び、保存した権限を消して一般利用者に戻す） */
export async function signOut(): Promise<void> {
  // 先に画面の権限を戻す（Supabase の応答を待たない。失敗しても一般利用者に戻す）
  forgetAccount();
  if (readSupabaseConfig() === null) return;

  try {
    const client = await loadSupabaseClient();
    if (client === null) return;
    await endSupabaseSession(client);
  } catch {
    // supabase-js を読み込めない・クライアントを作れなくても、画面の権限は戻っている
  }
}

/** ログイン中のアカウントを返す。一般利用者（ログインしていない）なら null */
export function useAccount(): Account | null {
  return useAccountState();
}
