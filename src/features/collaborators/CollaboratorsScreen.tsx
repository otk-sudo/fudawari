"use client";

// 協力者画面の本文（要件 3.8、モック Collaborators.dc.html。招待の欄は「協力者を追加」に置き換える）。
// 権限は `@/features/auth` の useRole() から受け取り、管理者以外には拒否の表示だけを出す（保管庫は呼ばない）。
// 画面名のヘッダー帯（h1「協力者」・「管理者専用」・説明）は src/app/collaborators/page.tsx が置く（CollaboratorsHeader）
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRole, useRoleReady } from "@/features/auth";
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

/** 管理者の表示：協力者を追加・編集できる人（表）。開いたときに一覧を読む */
function CollaboratorsManager({ repository }: CollaboratorsScreenProps): ReactNode {
  const [members, setMembers] = useState<MembersState>({ status: "loading" });

  useEffect(() => {
    // 閉じた後（や保管庫が変わった後）に届いた結果は捨てる
    let active = true;
    const apply = (state: MembersState): void => {
      if (active) setMembers(state);
    };
    repository.list().then(
      (result) =>
        apply(
          result.ok
            ? { status: "ready", members: result.value }
            : { status: "error", error: result.error },
        ),
      () => apply({ status: "error", error: "unknown" }),
    );
    return () => {
      active = false;
    };
  }, [repository]);

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
      <IssueSection repository={repository} onIssued={addMember} />
      <MembersSection members={members} repository={repository} onRemoved={removeMember} />
    </div>
  );
}

export function CollaboratorsScreen({ repository }: CollaboratorsScreenProps): ReactNode {
  const roleReady = useRoleReady();
  const role = useRole();

  // 書き出した HTML に重ねる間は、まだ保存した権限を使えない。管理者に拒否の表示を一瞬見せないよう、何も出さない
  if (!roleReady) return null;
  if (role !== "admin") return <AdminOnlyNotice />;
  return <CollaboratorsManager repository={repository} />;
}
