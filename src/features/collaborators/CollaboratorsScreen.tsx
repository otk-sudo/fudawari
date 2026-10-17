"use client";

// 協力者画面の本文（要件 3.8、モック Collaborators.dc.html。招待の欄は「協力者を追加」に置き換える）。
// 権限は `@/features/auth` の useRole() から受け取り、管理者以外には拒否の表示だけを出す（保管庫は呼ばない）。
// 管理者が開いたときは、Supabase のセッションを確かめてから一覧を読む。セッションがなければ（期限切れ・別のタブでのログアウトなど）
// 保存した権限を消し、ログインし直す案内を出す（拒否の表示には切り替えない）。
// 画面名のヘッダー帯（h1「協力者」・「管理者専用」・説明）は src/app/collaborators/page.tsx が置く（CollaboratorsHeader）
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { signOut, useRole, useRoleReady } from "@/features/auth";
import { ROUTES } from "@/lib/routes";
import { IssueSection } from "./IssueSection";
import { MembersSection, type MembersState } from "./MembersSection";
import type { Collaborator, CollaboratorRepository } from "./types";
import styles from "./CollaboratorsScreen.module.css";

export type CollaboratorsScreenProps = {
  /** 協力者の保管庫（本番は createSupabaseCollaboratorRepository()、テストでは偽物） */
  repository: CollaboratorRepository;
};

/** 管理者以外が開いたときの表示（要件 2.3・3.8） */
function AdminOnlyNotice(): ReactNode {
  return (
    <div className={styles.denied}>
      <p className={styles.deniedTitle}>このページは管理者のみ使えます</p>
      <p className={styles.deniedNote}>協力者の追加や削除は管理者にお願いしてください</p>
      <Link href={ROUTES.list} className={styles.link}>
        一覧に戻る
      </Link>
    </div>
  );
}

/** 開いたときに Supabase のセッションがなかったときの表示（保存した権限は消してある） */
function SessionExpiredNotice(): ReactNode {
  return (
    <div className={styles.denied}>
      <p className={styles.deniedTitle}>ログインが切れています。管理者でログインし直してください</p>
      <p className={styles.deniedNote}>
        ログインの期限が切れたときや、ほかのタブでログアウトしたときに、この表示になります
      </p>
      <Link href={ROUTES.login} className={styles.link}>
        ログインの画面へ
      </Link>
    </div>
  );
}

type CollaboratorsManagerProps = CollaboratorsScreenProps & {
  /** 開いたときに Supabase のセッションがなかったときに呼ぶ */
  onSessionExpired: () => void;
};

/** 管理者の表示：協力者を追加・編集できる人（表）。開いたときにセッションを確かめてから一覧を読む */
function CollaboratorsManager({ repository, onSessionExpired }: CollaboratorsManagerProps): ReactNode {
  const [members, setMembers] = useState<MembersState>({ status: "loading" });

  useEffect(() => {
    // 閉じた後（や保管庫が変わった後）に届いた結果は捨てる
    let active = true;
    const apply = (state: MembersState): void => {
      if (active) setMembers(state);
    };
    const load = async (): Promise<void> => {
      const session = await repository.checkSession();
      if (!active) return;
      // 確かめられなかった（通信の失敗など）ときは、一覧を読まずに理由を出す
      if (!session.ok) {
        apply({ status: "error", error: session.error });
        return;
      }
      if (!session.value) {
        onSessionExpired();
        return;
      }
      const result = await repository.list();
      apply(
        result.ok
          ? { status: "ready", members: result.value }
          : { status: "error", error: result.error },
      );
    };
    load().catch(() => apply({ status: "error", error: "unknown" }));
    return () => {
      active = false;
    };
  }, [repository, onSessionExpired]);

  // 発行・外すが成功したら、表を手元で書き換える（読み直さない）
  const addMember = useCallback((member: Collaborator) => {
    setMembers((state) =>
      state.status === "ready" ? { status: "ready", members: [...state.members, member] } : state,
    );
  }, []);

  const removeMember = useCallback((userId: string) => {
    setMembers((state) =>
      state.status === "ready"
        ? { status: "ready", members: state.members.filter((member) => member.userId !== userId) }
        : state,
    );
  }, []);

  return (
    <div className={styles.body}>
      {/* 一覧を読み終えるまで（読み込み中・失敗）は発行させない（古い一覧に加えると、加えた人が表から消えて見えるため） */}
      <IssueSection
        repository={repository}
        canIssue={members.status === "ready"}
        onIssued={addMember}
      />
      <MembersSection members={members} repository={repository} onRemoved={removeMember} />
    </div>
  );
}

export function CollaboratorsScreen({ repository }: CollaboratorsScreenProps): ReactNode {
  const roleReady = useRoleReady();
  const role = useRole();
  const [sessionExpired, setSessionExpired] = useState(false);

  // 保存した権限を消す（signOut は権限を先に一般利用者へ戻す）。権限より先にこの画面の表示を案内に切り替えておく
  const handleSessionExpired = useCallback(() => {
    setSessionExpired(true);
    void signOut();
  }, []);

  // 書き出した HTML に重ねる間は、まだ保存した権限を使えない。管理者に拒否の表示を一瞬見せないよう、何も出さない
  if (!roleReady) return null;
  // セッションがなかったときは、権限が一般利用者に戻っても拒否の表示ではなく、ログインし直す案内を出したままにする
  if (sessionExpired) return <SessionExpiredNotice />;
  if (role !== "admin") return <AdminOnlyNotice />;
  return <CollaboratorsManager repository={repository} onSessionExpired={handleSessionExpired} />;
}
