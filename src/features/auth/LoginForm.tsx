"use client";

// 管理者・協力者のログインのフォーム（/login。U3・U14、要件 2.1・2.3）。
// ID・パスワードの欄と「ログイン」。ログインできたらホーム（/）へ移り、できなければ理由を出す。
// 開いただけでは Supabase に通信しない（「ログイン」を押したときに signIn が通信する）。ログイン中に開いても、そのままフォームを出す
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { ROUTES } from "@/lib/routes";
// 設定はファイルから直接読む（@/lib/supabase の入口は supabase-js を読み込むため。読み込むのはログインするときだけ）
import { readSupabaseConfig } from "@/lib/supabase/config";
import { LOGIN_ID_RULE_MESSAGE } from "./login-id";
import { type SignInFailure, signIn } from "./session";
import styles from "./LoginForm.module.css";

/** ログインできなかった理由の文 */
const FAILURE_MESSAGES: Record<SignInFailure, string> = {
  "invalid-id": LOGIN_ID_RULE_MESSAGE,
  "invalid-credentials": "ID かパスワードが違います",
  "no-permission": "この ID には定義を編集する権限がありません。管理者に確かめてください",
  "not-configured": "ログインの設定がありません。サイトの管理者に連絡してください",
  // ID・パスワードの間違い以外の失敗（混雑・サーバーの障害など）もこの文にする
  network:
    "通信に失敗したか、サーバーが混み合っているため、ログインできませんでした。しばらくしてからもう一度お試しください",
};

/** 開いたときに出しておく理由（接続先の設定がなければ、押す前から知らせる） */
function initialMessage(): string | null {
  return readSupabaseConfig() === null ? FAILURE_MESSAGES["not-configured"] : null;
}

export function LoginForm(): ReactNode {
  const router = useRouter();
  const idFieldId = useId();
  const passwordFieldId = useId();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [submitting, setSubmitting] = useState(false);
  // 押した直後の二重送信も防ぐ（状態の更新を待たずに見られる印）
  const submittingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setMessage(null);

    const result = await signIn(loginId, password);
    if (result.ok) {
      // ホームへ移るまで、ボタンは押せないままにする
      router.replace(ROUTES.home);
      return;
    }
    submittingRef.current = false;
    setSubmitting(false);
    setMessage(FAILURE_MESSAGES[result.reason]);
  }

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <div className={styles.field}>
        <label htmlFor={idFieldId} className={styles.label}>
          ID
        </label>
        <input
          id={idFieldId}
          className={styles.input}
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={loginId}
          onChange={(event) => setLoginId(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={passwordFieldId} className={styles.label}>
          パスワード
        </label>
        <input
          id={passwordFieldId}
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {message !== null && (
        <p role="alert" className={styles.message}>
          {message}
        </p>
      )}
      <button type="submit" className={styles.submit} disabled={submitting} aria-busy={submitting}>
        ログイン
      </button>
    </form>
  );
}
