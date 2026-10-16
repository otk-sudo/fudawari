"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { type Role, useRole } from "@/features/auth";
import { isCurrentRoute, ROUTES, type Route } from "@/lib/routes";
import { type IconName, LineIcon } from "./LineIcon";
import { openSettingsDialog } from "./settings-dialog-store";
import styles from "./SideNav.module.css";

export type SideNavProps = {
  /** 今いる画面のパス（例 "/list"）。レイアウト側で usePathname() から渡す */
  currentPath: string;
};

type NavLinkItem = {
  label: string;
  href: Route;
  icon: IconName;
};

type ManagementLinkItem = NavLinkItem & {
  /** この項目を出す権限 */
  roles: readonly Role[];
};

// 一般の画面（全員に出す）。「設定」は画面を移動しないので、この後にボタンとして置く
const GENERAL_LINKS: readonly NavLinkItem[] = [
  { label: "一覧", href: ROUTES.list, icon: "board" },
  { label: "割振", href: ROUTES.assign, icon: "assign" },
  { label: "取込", href: ROUTES.import, icon: "import" },
  { label: "差分", href: ROUTES.drift, icon: "diff" },
];

// 「管理」の区切りの下の項目（ログイン中の権限で出し分ける。要件 2.2）
const MANAGEMENT_LINKS: readonly ManagementLinkItem[] = [
  { label: "定義", href: ROUTES.definition, icon: "plan", roles: ["collab", "admin"] },
  { label: "協力者", href: ROUTES.collaborators, icon: "users", roles: ["admin"] },
];

// 今いる画面の項目だけに aria-current="page" を付ける（それ以外は属性を付けない）
function currentAttribute(currentPath: string, href: Route): "page" | undefined {
  return isCurrentRoute(currentPath, href) ? "page" : undefined;
}

function NavLink({
  item,
  currentPath,
}: {
  item: NavLinkItem;
  currentPath: string;
}): ReactNode {
  return (
    <Link
      href={item.href}
      className={styles.item}
      aria-current={currentAttribute(currentPath, item.href)}
    >
      <LineIcon name={item.icon} size={20} />
      <span className={styles.label}>{item.label}</span>
    </Link>
  );
}

/**
 * 左メニュー（要件 2.2、モック SideNav.dc.html）。権限は `@/features/auth` の useRole() から受け取る。
 *
 * - 名前「メインメニュー」の navigation
 * - 先頭に「札」（名前「ホームへ」、/ へのリンク）
 * - 一般：一覧(/list)・割振(/assign)・取込(/import)・差分(/drift)・設定（ボタン。ウィンドウを開く）
 * - 協力者：上記＋「管理」の区切りの下に 定義(/definition)
 * - 管理者：上記＋「管理」の区切りの下に 定義・協力者(/collaborators)
 * - 今いる画面の項目に aria-current="page"
 */
export function SideNav({ currentPath }: SideNavProps): ReactNode {
  const role = useRole();
  const managementLinks = MANAGEMENT_LINKS.filter((item) =>
    item.roles.includes(role),
  );

  return (
    <nav aria-label="メインメニュー" className={styles.nav}>
      <Link
        href={ROUTES.home}
        className={styles.home}
        aria-label="ホームへ"
        title="ホームへ"
        aria-current={currentAttribute(currentPath, ROUTES.home)}
      >
        札
      </Link>
      {GENERAL_LINKS.map((item) => (
        <NavLink key={item.href} item={item} currentPath={currentPath} />
      ))}
      <button
        type="button"
        className={styles.item}
        aria-haspopup="dialog"
        onClick={openSettingsDialog}
      >
        <LineIcon name="gear" size={20} />
        <span className={styles.label}>設定</span>
      </button>
      {managementLinks.length > 0 && (
        <>
          <div role="separator" aria-label="管理" className={styles.divider}>
            <span className={styles.dividerBadge}>管理</span>
          </div>
          {managementLinks.map((item) => (
            <NavLink key={item.href} item={item} currentPath={currentPath} />
          ))}
        </>
      )}
    </nav>
  );
}
