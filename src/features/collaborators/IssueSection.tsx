"use client";

// 協力者画面の「協力者を追加」の欄（要件 3.8。モックの招待の欄を置き換える）。
// ID と表示名を入れて「発行する」。パスワードは画面が作り（英数字 16 文字）、発行できたら ID とパスワードを一度だけ出す
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { isValidLoginId, LOGIN_ID_RULE_MESSAGE } from "@/features/auth";
import { ROUTES } from "@/lib/routes";
import { generatePassword } from "./password";
import type {
  Collaborator,
  CollaboratorError,
  CollaboratorRepository,
  CollaboratorResult,
} from "./types";
import styles from "./CollaboratorsScreen.module.css";

/** 発行できなかった理由の文 */
const ISSUE_ERROR_MESSAGES: Record<CollaboratorError, string> = {
  "id-taken": "この ID はすでに使われています。別の ID にしてください",
  "already-registered": "この人にはすでに定義を編集できる権限があります",
  "invalid-input": "入力が正しくありません。表示名を確かめてください",
  forbidden: "協力者を追加する権限がありません。管理者でログインし直してください",
  "not-found": "作ったアカウントが見つかりませんでした",
  "cannot-remove-admin": "発行できませんでした",
  network: "通信に失敗しました。しばらくしてからもう一度お試しください",
  unknown: "発行できませんでした。しばらくしてからもう一度お試しください",
};

/**
 * アカウントを作った後（協力者にするところ）でしか起きない失敗。
 * 作ったアカウントは画面からは消せない（運用手順書で管理画面から消す）ので、その ID はもう使えない
 */
const FAILURES_AFTER_ACCOUNT_CREATED: ReadonlySet<CollaboratorError> = new Set<CollaboratorError>([
  "already-registered",
  "invalid-input",
  "forbidden",
  "not-found",
]);

/** アカウントを作る前と後のどちらでも起きる失敗（通信の失敗など） */
const FAILURES_EITHER_SIDE: ReadonlySet<CollaboratorError> = new Set<CollaboratorError>([
  "network",
  "unknown",
]);

const ID_NO_LONGER_USABLE = "この ID は使えなくなりました。別の ID で発行してください";
const ID_MAYBE_UNUSABLE =
  "アカウントだけ作られていることがあります。もう一度発行して「すでに使われています」と出たら、別の ID で発行してください";

/** 発行できなかったときに出す文（理由と、その ID をまた使えるか） */
function issueFailureMessages(error: CollaboratorError): string[] {
  const messages = [ISSUE_ERROR_MESSAGES[error]];
  if (FAILURES_AFTER_ACCOUNT_CREATED.has(error)) messages.push(ID_NO_LONGER_USABLE);
  else if (FAILURES_EITHER_SIDE.has(error)) messages.push(ID_MAYBE_UNUSABLE);
  return messages;
}

/** 発行した ID とパスワード */
type IssuedCredentials = { loginId: string; password: string };

/** 「コピー」で写す文（ログインの画面のアドレスも添える。/login は一般の画面からリンクしないため。U14） */
function credentialsText({ loginId, password }: IssuedCredentials): string {
  const loginUrl = `${window.location.origin}${ROUTES.login}`;
  return `ログインの画面：${loginUrl}\nID：${loginId}\nパスワード：${password}`;
}

/** 発行した ID とパスワードの表示（この画面を閉じると二度と出せない） */
function IssuedPanel({ credentials }: { credentials: IssuedCredentials }): ReactNode {
  const [copyStatus, setCopyStatus] = useState("");

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(credentialsText(credentials));
      setCopyStatus("コピーしました");
    } catch {
      setCopyStatus("コピーできませんでした。ID とパスワードを選んで写してください");
    }
  }

  return (
    <div className={styles.issued}>
      <p className={styles.issuedTitle}>発行しました。次の ID とパスワードを相手に伝えてください</p>
      <dl className={styles.credentials}>
        <dt className={styles.credentialLabel}>ID</dt>
        <dd className={styles.credentialValue}>
          <code className={styles.code}>{credentials.loginId}</code>
        </dd>
        <dt className={styles.credentialLabel}>パスワード</dt>
        <dd className={styles.credentialValue}>
          <code className={styles.code}>{credentials.password}</code>
        </dd>
      </dl>
      <div className={styles.copyRow}>
        <button type="button" className={styles.copyButton} onClick={() => void handleCopy()}>
          コピー
        </button>
        <span className={styles.hint}>ログインの画面のアドレスも一緒に写します</span>
        <span role="status" className={styles.copyStatus}>
          {copyStatus}
        </span>
      </div>
      <p className={styles.notice}>パスワードはこの画面を閉じると二度と表示できません</p>
    </div>
  );
}

export type IssueSectionProps = {
  repository: CollaboratorRepository;
  /** 発行して協力者にできたときに、表に加える人を渡す */
  onIssued: (member: Collaborator) => void;
};

export function IssueSection({ repository, onIssued }: IssueSectionProps): ReactNode {
  const headingId = useId();
  const idFieldId = useId();
  const idHintId = useId();
  const nameFieldId = useId();
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  // 押した直後の二重送信も防ぐ（状態の更新を待たずに見られる印）
  const issuingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (issuingRef.current) return;

    const id = loginId.trim();
    const name = displayName.trim();
    const problems: string[] = [];
    if (!isValidLoginId(id)) problems.push(LOGIN_ID_RULE_MESSAGE);
    if (name === "") problems.push("表示名を入れてください");
    setErrors(problems);
    if (problems.length > 0) return;

    issuingRef.current = true;
    setIssuing(true);
    const password = generatePassword();
    let result: CollaboratorResult<{ userId: string }>;
    try {
      result = await repository.issue({ loginId: id, displayName: name, password });
    } catch {
      result = { ok: false, error: "unknown" };
    }
    issuingRef.current = false;
    setIssuing(false);

    if (!result.ok) {
      // 前に発行した ID とパスワードは、写し終えていないかもしれないので出したままにする
      setErrors(issueFailureMessages(result.error));
      return;
    }
    setIssued({ loginId: id, password });
    setLoginId("");
    setDisplayName("");
    onIssued({
      userId: result.value.userId,
      displayName: name,
      role: "collab",
      createdAt: new Date().toISOString(),
      lastEditedAt: null,
      lastEditedNote: null,
    });
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        協力者を追加
      </h2>
      <div className={styles.sectionBody}>
        <p className={styles.description}>
          ID とパスワードを発行して、協力してほしい人に伝えてください。その ID
          でログインすると協力者になり、イベント定義を編集できるようになります。メールアドレスなどの個人情報や外部のアカウントは使いません。協力者の権限に期限はなく、外すまで続きます。
        </p>
        <form className={styles.issueForm} onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor={idFieldId} className={styles.label}>
                ID
              </label>
              <span id={idHintId} className={styles.hint}>
                英小文字・数字・ハイフンの 3〜32 文字
              </span>
            </div>
            <input
              id={idFieldId}
              className={styles.input}
              type="text"
              // 管理者自身の ID をブラウザが入れないようにする
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={idHintId}
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor={nameFieldId} className={styles.label}>
                表示名
              </label>
            </div>
            <input
              id={nameFieldId}
              className={styles.input}
              type="text"
              autoComplete="off"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <button type="submit" className={styles.primaryButton} disabled={issuing} aria-busy={issuing}>
            発行する
          </button>
        </form>
        {errors.length > 0 && (
          <div role="alert" className={styles.alert}>
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        {issued !== null && <IssuedPanel key={issued.password} credentials={issued} />}
      </div>
    </section>
  );
}
