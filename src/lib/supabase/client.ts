// supabase-js のクライアントを作る入口。管理者・協力者の画面だけが、使う直前に呼ぶ（一般の画面からは呼ばない）
//
// PR-10b のテスト（client.test.ts）を先に書いた段階の入れ物。中身は実装の担当が書く
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ふだんのクライアント（ログインしたセッションをブラウザに保存する）。
 * - 設定（readSupabaseConfig）がなければ null を返し、クライアントを作らない
 * - 最初に呼ばれたときに 1 つだけ作り、2 回目からは同じものを返す
 */
export const getSupabaseClient: () => SupabaseClient | null = () => null;

/**
 * 協力者のアカウントを作る（auth.signUp）ための、セッションを保存しない別のクライアント（auth.persistSession: false）。
 * 管理者のログイン（ふだんのクライアントのセッション）を変えずにアカウントを作るために使う。
 * 設定がなければ null。呼ぶたびに新しく作ってよい
 */
export const createIssuingSupabaseClient: () => SupabaseClient | null = () => null;

/**
 * テスト用：作っておいたふだんのクライアントを捨てる（次に getSupabaseClient を呼ぶと作り直す）。
 * 各テストの前に呼び、前のテストの偽物のクライアントや環境変数が残らないようにする
 */
export const resetSupabaseClient: () => void = () => {};
