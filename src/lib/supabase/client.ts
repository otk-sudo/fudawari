// supabase-js のクライアントを作る入口。管理者・協力者の画面だけが、使う直前に呼ぶ（一般の画面からは呼ばない）
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./config";

// ふだんのクライアント（最初に getSupabaseClient を呼んだときに作る）
let mainClient: SupabaseClient | null = null;

// 協力者のアカウントを作るクライアントの通し番号（クライアントごとに保存のキーを変えるために使う）
let issuingClientCount = 0;

/**
 * ふだんのクライアント（ログインしたセッションをブラウザに保存する）。
 * - 設定（readSupabaseConfig）がなければ null を返し、クライアントを作らない
 * - 最初に呼ばれたときに 1 つだけ作り、2 回目からは同じものを返す
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (mainClient !== null) return mainClient;
  const config = readSupabaseConfig();
  if (config === null) return null;
  // 設定は既定のまま（セッションを localStorage に保存し、読み込み直してもログインが続く）
  mainClient = createClient(config.url, config.publishableKey);
  return mainClient;
}

/**
 * 協力者のアカウントを作る（auth.signUp）ための、セッションを保存しない別のクライアント（auth.persistSession: false）。
 * 管理者のログイン（ふだんのクライアントのセッション）を変えずにアカウントを作るために使う。
 * 設定がなければ null。呼ぶたびに新しく作る
 */
export function createIssuingSupabaseClient(): SupabaseClient | null {
  const config = readSupabaseConfig();
  if (config === null) return null;
  issuingClientCount += 1;
  return createClient(config.url, config.publishableKey, {
    auth: {
      // 作ったアカウントのセッションは、このクライアントのメモリの中だけに置いて捨てる
      persistSession: false,
      // 捨てたクライアントがセッションの更新を続けないようにする
      autoRefreshToken: false,
      // URL のログインの情報は、ふだんのクライアントだけが読む
      detectSessionInUrl: false,
      // ふだんのクライアントと保存のキーを分ける（同じキーのクライアントが複数あるという警告を出さない）
      storageKey: `fudawari-issuing-${issuingClientCount}`,
    },
  });
}

/**
 * テスト用：作っておいたふだんのクライアントを捨てる（次に getSupabaseClient を呼ぶと作り直す）。
 * 各テストの前に呼び、前のテストの偽物のクライアントや環境変数が残らないようにする
 */
export function resetSupabaseClient(): void {
  mainClient = null;
}
