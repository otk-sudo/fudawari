"use client";

// 協力者画面の「編集できる人」の表と、外すときの確認（要件 3.8、モック Collaborators.dc.html）。
// - 表：名前・権限・追加した日・権限の期限（無期限）・最後に定義を編集・「外す」（管理者の行には出さない）
// - 外すときの確認は、モックどおり表の下にその場で開く（画面全体を覆うウィンドウにはしない）。
//   チェックを入れるまで「外す」を押せない。外せなかった理由は確認の中に出す
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { compareMembers, formatAddedDate, formatLastEdit } from "./format";
import type {
  Collaborator,
  CollaboratorError,
  CollaboratorRepository,
  CollaboratorResult,
  CollaboratorRole,
} from "./types";
import styles from "./CollaboratorsScreen.module.css";

/** 一覧の読み込みの状態 */
export type MembersState =
  | { status: "loading" }
  | { status: "error"; error: CollaboratorError }
  | { status: "ready"; members: Collaborator[] };

/** 権限の表示名 */
const ROLE_LABELS: Record<CollaboratorRole, string> = {
  admin: "管理者",
  collab: "協力者",
};

/** 一覧を読み込めなかった理由の文 */
function listErrorReason(error: CollaboratorError): string {
  switch (error) {
    case "network":
      return "通信に失敗しました";
    case "forbidden":
      return "読む権限がありません。管理者でログインし直してください";
    default:
      // 接続先の設定がない場合も、保管庫は unknown を返す
      return "予期しない失敗です";
  }
}

/** 外せなかった理由の文 */
function removeErrorMessage(error: CollaboratorError): string {
  switch (error) {
    case "cannot-remove-admin":
      return "管理者は外せません";
    case "forbidden":
      return "協力者を外す権限がありません。管理者でログインし直してください";
    case "not-found":
      return "この協力者は見つかりませんでした（すでに外されているかもしれません）。ページを再読み込みしてください";
    case "network":
      return "通信に失敗しました。しばらくしてからもう一度お試しください";
    default:
      return "外せませんでした。しばらくしてからもう一度お試しください";
  }
}

type RemoveConfirmProps = {
  target: Collaborator;
  agreed: boolean;
  removing: boolean;
  error: CollaboratorError | null;
  onToggleAgreed: () => void;
  onRemove: () => void;
  onCancel: () => void;
};

/** 外すときの確認 */
function RemoveConfirm({
  target,
  agreed,
  removing,
  error,
  onToggleAgreed,
  onRemove,
  onCancel,
}: RemoveConfirmProps): ReactNode {
  const titleId = useId();
  const descriptionId = useId();
  const checkboxRef = useRef<HTMLInputElement>(null);

  // 開いたとき（相手を変えたとき）は、確認のチェックに移る（キーボードで続けて操作できるように）
  useEffect(() => {
    checkboxRef.current?.focus();
  }, [target.userId]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !removing) {
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={styles.confirm}
      onKeyDown={handleKeyDown}
    >
      <p id={titleId} className={styles.confirmTitle}>
        {target.displayName} を協力者から外しますか？
      </p>
      <p id={descriptionId} className={styles.confirmText}>
        外すとすぐにイベント定義を編集できなくなります。これまでの編集内容は残ります。もう一度協力してもらうには、新しく
        ID を発行してください。
      </p>
      <label className={styles.confirmCheck}>
        <input
          ref={checkboxRef}
          type="checkbox"
          className={styles.checkbox}
          checked={agreed}
          disabled={removing}
          onChange={onToggleAgreed}
        />
        {target.displayName} を外すことを確認しました
      </label>
      {error !== null && (
        <p role="alert" className={styles.alert}>
          {removeErrorMessage(error)}
        </p>
      )}
      <div className={styles.confirmActions}>
        <button
          type="button"
          className={styles.removeButton}
          disabled={!agreed || removing}
          aria-busy={removing}
          onClick={onRemove}
        >
          外す
        </button>
        <button type="button" className={styles.cancelButton} disabled={removing} onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

export type MembersSectionProps = {
  members: MembersState;
  repository: CollaboratorRepository;
  /** 外せたときに、表から消す人の user ID を渡す */
  onRemoved: (userId: string) => void;
};

export function MembersSection({ members, repository, onRemoved }: MembersSectionProps): ReactNode {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 確認を開いた「外す」のボタン（やめたときに戻る先）
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [target, setTarget] = useState<Collaborator | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<CollaboratorError | null>(null);
  // 押した直後の二重送信も防ぐ（状態の更新を待たずに見られる印）
  const removingRef = useRef(false);

  function openConfirm(member: Collaborator, trigger: HTMLButtonElement): void {
    triggerRef.current = trigger;
    setTarget(member);
    setAgreed(false);
    setRemoveError(null);
  }

  function closeConfirm(): void {
    setTarget(null);
    setAgreed(false);
    setRemoveError(null);
  }

  function handleCancel(): void {
    closeConfirm();
    triggerRef.current?.focus();
  }

  async function handleRemove(): Promise<void> {
    if (target === null || !agreed || removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setRemoveError(null);
    let result: CollaboratorResult<void>;
    try {
      result = await repository.remove(target.userId);
    } catch {
      result = { ok: false, error: "unknown" };
    }
    removingRef.current = false;
    setRemoving(false);

    if (!result.ok) {
      setRemoveError(result.error);
      return;
    }
    closeConfirm();
    onRemoved(target.userId);
    // 外した人の行はなくなるので、表の見出しに移る
    headingRef.current?.focus();
  }

  const sorted = members.status === "ready" ? [...members.members].sort(compareMembers) : [];

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.sectionHeadTitle}>
          編集できる人
        </h2>
        {members.status === "ready" && <span className={styles.count}>{sorted.length}人</span>}
      </div>

      {members.status === "loading" && <p className={styles.status}>読み込んでいます…</p>}

      {members.status === "error" && (
        <div className={styles.sectionBody}>
          <div role="alert" className={styles.alert}>
            <p>編集できる人の一覧を読み込めませんでした（{listErrorReason(members.error)}）</p>
            <p>ページを再読み込みしてください</p>
          </div>
        </div>
      )}

      {members.status === "ready" && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">名前</th>
                <th scope="col">権限</th>
                <th scope="col">追加した日</th>
                <th scope="col">権限の期限</th>
                <th scope="col">最後に定義を編集</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((member) => (
                <tr key={member.userId}>
                  <td className={styles.nameCell}>{member.displayName}</td>
                  <td>
                    <span className={member.role === "admin" ? styles.adminBadge : styles.collabBadge}>
                      {ROLE_LABELS[member.role]}
                    </span>
                  </td>
                  <td className={styles.dateCell}>{formatAddedDate(member.createdAt)}</td>
                  <td>無期限</td>
                  <td>{formatLastEdit(member)}</td>
                  <td className={styles.actionCell}>
                    {member.role === "collab" && (
                      <button
                        type="button"
                        className={styles.rowRemoveButton}
                        aria-label={`${member.displayName} を外す`}
                        aria-expanded={target?.userId === member.userId}
                        disabled={removing}
                        onClick={(event) => openConfirm(member, event.currentTarget)}
                      >
                        外す
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target !== null && (
        <RemoveConfirm
          target={target}
          agreed={agreed}
          removing={removing}
          error={removeError}
          onToggleAgreed={() => setAgreed((value) => !value)}
          onRemove={() => void handleRemove()}
          onCancel={handleCancel}
        />
      )}
    </section>
  );
}
