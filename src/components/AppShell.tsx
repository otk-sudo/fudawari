"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isStandalonePath } from "@/lib/routes";
import { SideNav } from "./SideNav";
import styles from "./AppShell.module.css";

export type AppShellProps = {
  children: ReactNode;
};

/**
 * 共通の枠（要件 3.0）：左に幅 64px の縦メニュー、右に各画面（上部のヘッダー帯と本文）。
 * 単独の画面（ログイン。`@/lib/routes` の isStandalonePath）では左メニューを出さず、画面だけを出す。
 */
export function AppShell({ children }: AppShellProps): ReactNode {
  const pathname = usePathname();

  if (isStandalonePath(pathname)) {
    return children;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.navColumn}>
        <SideNav currentPath={pathname} />
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
