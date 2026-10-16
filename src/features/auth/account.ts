// ログイン中のアカウントの型と、ブラウザ（localStorage）への保存。
//
// - 保存するのは権限・表示名・ID だけ（パスワードやトークンは持たない。セッションは supabase-js が自分で保存する）
// - 一般の画面は、この保存した値だけを見て管理メニューを出す（Supabase に通信しない）
// - 読めない・壊れている・localStorage が使えないときは、ログインしていない（一般利用者）として扱い、例外を外に出さない
import { isValidLoginId } from "./login-id";
import type { Role } from "./role";

/** ログイン中のアカウント（協力者・管理者） */
export type Account = {
  /** 権限（profiles.role） */
  role: Exclude<Role, "user">;
  /** 表示名（profiles.display_name） */
  displayName: string;
  /** ログインに使った ID（「@fudawari.invalid」を付けない形） */
  loginId: string;
};

/** 保存のキー */
const STORAGE_KEY = "fudawari.account";

/** 保存の形の版（形を変えるときに上げ、古い形は読まない） */
const STORAGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 権限が協力者・管理者のどちらかか */
export function isManagerRole(value: unknown): value is Account["role"] {
  return value === "admin" || value === "collab";
}

/** 保存した文字列をアカウントに戻す。形が違えば null */
function parseStoredAccount(text: string): Account | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== STORAGE_VERSION) return null;
  const { role, displayName, loginId } = value;
  if (!isManagerRole(role)) return null;
  if (typeof displayName !== "string" || displayName === "") return null;
  if (typeof loginId !== "string" || !isValidLoginId(loginId)) return null;
  return { role, displayName, loginId };
}

/** 保存したアカウントを読む。ない・読めない・壊れている・localStorage が使えないときは null */
export function readStoredAccount(): Account | null {
  try {
    const text = globalThis.localStorage.getItem(STORAGE_KEY);
    return text === null ? null : parseStoredAccount(text);
  } catch {
    return null;
  }
}

/** アカウントを保存する。保存できなかったら false（その画面の中だけログインした扱いになる） */
export function writeStoredAccount(account: Account): boolean {
  try {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, ...account }),
    );
    return true;
  } catch {
    return false;
  }
}

/** 保存したアカウントを消す。localStorage が使えなくても例外を出さない */
export function clearStoredAccount(): void {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 使えないなら、もともと保存できていない
  }
}
