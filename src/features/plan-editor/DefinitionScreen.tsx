"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { signOut, useRole } from "@/features/auth";
import { ROUTES } from "@/lib/routes";
import { useShipMaster } from "@/lib/ship-master";
import { EditorHeader } from "./EditorHeader";
import { PlanEditor, type PlanEditorProps } from "./PlanEditor";
import styles from "./PlanEditor.module.css";

export type DefinitionScreenProps = Omit<PlanEditorProps, "onSessionExpired"> & {
  /**
   * 艦船マスタ（useShipMaster）を読み、その「改装段階を問わない艦名」を knownShipNames として渡す（ページが true にする）。
   * マスタを読めなければ渡さない（知らない艦名を警告しない）。true のときは knownShipNames を無視する
   */
  withShipMaster?: boolean;
};

/** 開いたときに Supabase のセッションがなかったときの表示（保存した権限は消してある） */
function SessionExpiredNotice(): ReactNode {
  return (
    <div className={styles.root}>
      <EditorHeader user={null} />
      <div className={styles.body}>
        <div role="alert" className={styles.loadError}>
          <p className={styles.loadErrorTitle}>ログインが切れています。管理者・協力者でログインし直してください</p>
          <p className={styles.loadErrorReason}>
            ログインの期限が切れたときや、ほかのタブでログアウトしたときに、この表示になります
          </p>
          <p>
            <Link href={ROUTES.login} className={styles.link}>
              ログインの画面へ
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** 艦船マスタを読んで、改装段階を問わない艦名の集合を渡す定義画面 */
function PlanEditorWithShipMaster(props: PlanEditorProps): ReactNode {
  const master = useShipMaster();
  const knownShipNames = useMemo(
    () =>
      master.status === "success"
        ? new Set(Array.from(master.master.byId.values(), (entry) => entry.baseName))
        : undefined,
    [master],
  );
  return <PlanEditor {...props} knownShipNames={knownShipNames} />;
}

/**
 * イベント定義のページの中身（src/app/definition/page.tsx から使う）。
 * - 一般利用者（useRole() が "user"）：h1「イベント定義」と「このページは管理者・協力者のみ使えます」を出し、保管庫は読まない
 * - 協力者・管理者：PlanEditor を描く（画面の出し分けは保管庫が返す DB の権限で行う。権限の強制は DB の RLS）
 * - 読み込みで Supabase のセッションがないと分かったら（期限切れ・別のタブでのログアウトなど）、保存した権限を消し、
 *   ログインし直す案内を出す（権限が一般利用者に戻っても、拒否の表示には切り替えない。協力者画面と同じ扱い）
 */
export function DefinitionScreen({ withShipMaster = false, ...props }: DefinitionScreenProps): ReactNode {
  const role = useRole();
  const [sessionExpired, setSessionExpired] = useState(false);

  // 保存した権限を消す（signOut は権限を先に一般利用者へ戻す）。権限より先にこの画面の表示を案内に切り替えておく
  const handleSessionExpired = useCallback(() => {
    setSessionExpired(true);
    void signOut();
  }, []);

  if (sessionExpired) return <SessionExpiredNotice />;
  if (role === "user") {
    return (
      <div className={styles.root}>
        <EditorHeader user={null} />
        <div className={styles.body}>
          <p className={styles.denied}>このページは管理者・協力者のみ使えます</p>
        </div>
      </div>
    );
  }
  if (withShipMaster) return <PlanEditorWithShipMaster {...props} onSessionExpired={handleSessionExpired} />;
  return <PlanEditor {...props} onSessionExpired={handleSessionExpired} />;
}
