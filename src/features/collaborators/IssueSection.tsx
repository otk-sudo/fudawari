"use client";

// 協力者画面の「協力者を追加」の欄（要件 3.8。モックの招待の欄を置き換える）。
// ID と表示名を入れて「発行する」。パスワードは画面が作り（英数字 16 文字）、発行できたら ID とパスワードを一度だけ出す。
// 発行の前に管理者のセッションを確かめ（checkSession）、なければアカウントを作らずに、ログインし直す案内を出す
// （このときは「この ID は使えなくなりました」を出さない。保管庫の発行が返す forbidden は、アカウントを作った後の失敗として扱う）
import Link from "next/link";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { isValidLoginId, LOGIN_ID_RULE_MESSAGE } from "@/features/auth";
import { ROUTES } from "@/lib/routes";
import { generatePassword } from "./password";
import type {
  Collaborator,
  CollaboratorError,
  CollaboratorRepository,
  CollaboratorResult,
  IssueCollaboratorInput,
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
  config:
    "アカウントは作られましたが、ログインできる状態になっていません。Supabase の設定（Authentication → Providers → Email）で「Confirm email」を OFF にしてください",
  network: "通信に失敗しました。しばらくしてからもう一度お試しください",
  unknown: "発行できませんでした。しばらくしてからもう一度お試しください",
};

/** 発行の前の確認で、管理者のセッションがなかったときの文（アカウントは作っていないので、その ID はまだ使える） */
const SESSION_EXPIRED_MESSAGE =
  "ログインが切れています。管理者でログインし直してください（アカウントは作っていないので、この ID はそのまま使えます）";

/**
 * アカウントを作った後（協力者にするところ）でしか起きない失敗。
 * 作ったアカウントは画面からは消せない（運用手順書で管理画面から消す）ので、その ID はもう使えない。
 * config（Confirm email が ON）も、確認待ちのアカウントが残るので、その ID はもう使えない
 */
const FAILURES_AFTER_ACCOUNT_CREATED: ReadonlySet<CollaboratorError> = new Set<CollaboratorError>([
  "already-registered",
  "invalid-input",
  "forbidden",
  "not-found",
  "config",
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

/** 「発行する」の下に出す失敗の知らせ（relogin なら、ログインの画面へのリンクも出す） */
type IssueAlert = { messages: string[]; relogin: boolean };

/** 発行を試した結果 */
type IssueAttempt = { ok: true; userId: string } | { ok: false; alert: IssueAlert };

/** 管理者のセッションを確かめてから、保管庫で発行する。保管庫が例外を投げても外に出さない */
async function attemptIssue(
  repository: CollaboratorRepository,
  input: IssueCollaboratorInput,
): Promise<IssueAttempt> {
  // ここで止まったときはアカウントを作っていないので、「この ID は使えなくなりました」などは出さない
  let session: CollaboratorResult<boolean>;
  try {
    session = await repository.checkSession();
  } catch {
    session = { ok: false, error: "unknown" };
  }
  if (!session.ok) {
    return {
      ok: false,
      alert: { messages: [ISSUE_ERROR_MESSAGES[session.error]], relogin: session.error === "forbidden" },
    };
  }
  if (!session.value) return { ok: false, alert: { messages: [SESSION_EXPIRED_MESSAGE], relogin: true } };

  let result: CollaboratorResult<{ userId: string }>;
  try {
    result = await repository.issue(input);
  } catch {
    result = { ok: false, error: "unknown" };
  }
  if (!result.ok) {
    return {
      ok: false,
      alert: { messages: issueFailureMessages(result.error), relogin: result.error === "forbidden" },
    };
  }
  return { ok: true, userId: result.value.userId };
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
  /** 発行できるか（編集できる人の一覧を読み終えるまでは false。「発行する」を押せない） */
  canIssue: boolean;
  /** 発行して協力者にできたときに、表に加える人を渡す */
  onIssued: (member: Collaborator) => void;
};

export function IssueSection({ repository, canIssue, onIssued }: IssueSectionProps): ReactNode {
  const headingId = useId();
  const idFieldId = useId();
  const idHintId = useId();
  const nameFieldId = useId();
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [issueAlert, setIssueAlert] = useState<IssueAlert | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  // 押した直後の二重送信も防ぐ（状態の更新を待たずに見られる印）
  const issuingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (issuingRef.current || !canIssue) return;

    const id = loginId.trim();
    const name = displayName.trim();
    const problems: string[] = [];
    if (!isValidLoginId(id)) problems.push(LOGIN_ID_RULE_MESSAGE);
    if (name === "") problems.push("表示名を入れてください");
    setIssueAlert(problems.length > 0 ? { messages: problems, relogin: false } : null);
    if (problems.length > 0) return;

    issuingRef.current = true;
    setIssuing(true);
    const password = generatePassword();
    const attempt = await attemptIssue(repository, { loginId: id, displayName: name, password });
    issuingRef.current = false;
    setIssuing(false);

    if (!attempt.ok) {
      // 前に発行した ID とパスワードは、写し終えていないかもしれないので出したままにする
      setIssueAlert(attempt.alert);
      return;
    }
    setIssued({ loginId: id, password });
    setLoginId("");
    setDisplayName("");
    onIssued({
      userId: attempt.userId,
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
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canIssue || issuing}
            aria-busy={issuing}
          >
            発行する
          </button>
        </form>
        {issueAlert !== null && (
          <div role="alert" className={styles.alert}>
            {issueAlert.messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
            {issueAlert.relogin && (
              <p>
                <Link href={ROUTES.login} className={styles.link}>
                  ログインの画面へ
                </Link>
              </p>
            )}
          </div>
        )}
        {issued !== null && <IssuedPanel key={issued.password} credentials={issued} />}
      </div>
    </section>
  );
}
