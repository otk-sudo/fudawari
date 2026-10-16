// 権限の入口（ログインの状態を持つストア）。
// 画面は必ず `@/features/auth` から権限を受け取る。レイアウトや画面は中身を知らない作りにする
//
// - ブラウザで読み込んだときに、保存したアカウント（account.ts）から権限を戻す。Supabase には通信しない
// - 静的書き出し（U19）の HTML は一般利用者の表示で作る。保存した権限は、HTML に重ねた（hydration の）あとで切り替える
//   （useSyncExternalStore の getServerSnapshot を一般利用者にして、食い違いのエラーを出さない）
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import { type Account, readStoredAccount } from "./account";

/** 権限：一般利用者（user）／協力者（collab）／管理者（admin） */
export type Role = "user" | "collab" | "admin";

/** ログインの状態 */
type AuthState = {
  /** 今の権限 */
  role: Role;
  /** ログイン中のアカウント。一般利用者なら null */
  account: Account | null;
};

/** ログインしていない状態（一般利用者） */
const SIGNED_OUT: AuthState = { role: "user", account: null };

/** ブラウザなら保存したアカウントを読み、最初の状態にする（ビルドのときの書き出しでは読まない） */
function initialState(): AuthState {
  if (typeof window === "undefined") return SIGNED_OUT;
  const account = readStoredAccount();
  return account === null ? SIGNED_OUT : { role: account.role, account };
}

const authStore = createStore<AuthState>()(initialState);

function selectRole(): Role {
  return authStore.getState().role;
}

function selectAccount(): Account | null {
  return authStore.getState().account;
}

// 書き出した HTML に重ねるとき（と、ビルドのときの書き出し）に使う値。一般利用者の表示にそろえる
function serverRole(): Role {
  return "user";
}

function serverAccount(): Account | null {
  return null;
}

/**
 * 今の権限を返す。既定（ログインしていない状態）は "user"。
 * 書き出した HTML に重ねる間は "user" を返し、その後で保存した権限に切り替える。
 * ログイン・ログアウト・setRole で変わったら、使っている部品は新しい権限で描き直される。
 */
export function useRole(): Role {
  return useSyncExternalStore(authStore.subscribe, selectRole, serverRole);
}

/** ログイン中のアカウントを返す（useAccount の中身）。一般利用者なら null。書き出した HTML に重ねる間は null */
export function useAccountState(): Account | null {
  return useSyncExternalStore(authStore.subscribe, selectAccount, serverAccount);
}

function subscribeNothing(): () => void {
  return () => {};
}

function ready(): boolean {
  return true;
}

function notReady(): boolean {
  return false;
}

/**
 * 保存した権限を画面に使える状態かを返す。書き出した HTML に重ねる間（とビルドのときの書き出し）は false、その後は true。
 * 権限で拒否の表示を出す画面が、管理者に一瞬だけ拒否の表示を見せないために使う
 */
export function useRoleReady(): boolean {
  return useSyncExternalStore(subscribeNothing, ready, notReady);
}

/**
 * 権限だけを切り替える（テストと仮の切り替え用。保存はしない）。
 * ログイン中のアカウントは、権限が同じときだけ残す。ログインは signIn を使う
 */
export function setRole(role: Role): void {
  authStore.setState((state) => ({
    role,
    account: state.account !== null && state.account.role === role ? state.account : null,
  }));
}

/** ログインした状態にする（signIn から呼ぶ） */
export function applySignedIn(account: Account): void {
  authStore.setState({ role: account.role, account });
}

/** ログインしていない状態に戻す（signOut から呼ぶ） */
export function applySignedOut(): void {
  authStore.setState(SIGNED_OUT);
}
