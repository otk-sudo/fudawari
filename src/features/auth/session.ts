// ログイン・ログアウトと、ログイン中のアカウント（権限・表示名・ID）。
//
// - ログインは、管理者が発行した ID とパスワード（U3）。ID は「ID@fudawari.invalid」に変えて auth.signInWithPassword に渡す
// - ログインできたら自分の profiles の行（role・display_name）を読み、権限・表示名・ID をブラウザ（localStorage）に保存する
// - 一般の画面は、保存した権限だけを見て Supabase に通信しない。読み込み直しても権限が残る。localStorage が使えなければ一般利用者
// - ログアウトは auth.signOut を呼び、保存した権限を消す
//
// PR-10b のテスト（session.test.ts・persistence.test.tsx など）を先に書いた段階の入れ物。中身は実装の担当が書く
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

/**
 * ログインできなかった理由
 * - invalid-id：ID の形式が違う（通信しない）
 * - invalid-credentials：ID かパスワードが違う
 * - no-permission：ログインはできたが profiles に自分の行がない（定義を編集する権限がない。ログアウトする）
 * - not-configured：環境変数（接続先）がない（通信しない）
 * - network：通信の失敗
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

/** ID とパスワードでログインする。成功したら権限を保存し、useRole・useAccount の値を切り替える */
export const signIn: (loginId: string, password: string) => Promise<SignInResult> = async () => ({
  ok: false,
  reason: "not-configured",
});

/** ログアウトする（auth.signOut を呼び、保存した権限を消して一般利用者に戻す） */
export const signOut: () => Promise<void> = async () => {};

/** ログイン中のアカウントを返す。一般利用者（ログインしていない）なら null */
export const useAccount: () => Account | null = () => null;
