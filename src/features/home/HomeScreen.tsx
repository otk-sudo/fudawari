"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { type IconName, LineIcon } from "@/components/LineIcon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { openSettingsDialog } from "@/components/settings-dialog-store";
import { type Role, useRole } from "@/features/auth";
import { APP_NAME } from "@/lib/app-name";
import { ROUTES, type Route } from "@/lib/routes";
import styles from "./HomeScreen.module.css";

export type HomeScreenProps = {
  /**
   * 開催中のイベント名（例 "2026夏イベ"）。開催中のイベントがなければ null。
   * ホームの画面（src/app/page.tsx）が、公開定義の読み込み（src/lib/definition）と開催中の判定から渡す
   */
  runningEventName: string | null;
};

type Tile = {
  title: string;
  href: Route;
  icon: IconName;
  note: string;
};

// 「札割り」の区分のリンクのタイル（全員）。この後に「設定」のタイル（ボタン）を置く
const GENERAL_TILES: readonly Tile[] = [
  { title: "一覧", href: ROUTES.list, icon: "board", note: "決めた札割りを札ごとに見る" },
  { title: "割り振り", href: ROUTES.assign, icon: "assign", note: "特効を見ながら艦を札に割り振る" },
  { title: "取り込み", href: ROUTES.import, icon: "import", note: "制空権シミュレータの形式で艦娘を取り込む" },
  { title: "差分", href: ROUTES.drift, icon: "diff", note: "イベント中に付いた札と計画を比べる" },
];

// 「管理」の見出しのバッジに出す権限名
const ROLE_LABELS: Record<Exclude<Role, "user">, string> = {
  collab: "協力者",
  admin: "管理者",
};

// 「管理」の区分のタイル（要件 3.1）。一般利用者には何も出さない
function managementTiles(role: Role, isEventRunning: boolean): Tile[] {
  if (role === "user") return [];

  const definitionNote =
    role === "admin"
      ? "札・段階・特効の設定、新規イベントの作成"
      : isEventRunning
        ? "開催中イベントの札・段階・特効を更新"
        : "開催中のイベントがないため、いまは更新できるものはありません";
  const tiles: Tile[] = [
    { title: "イベント定義", href: ROUTES.definition, icon: "plan", note: definitionNote },
  ];
  if (role === "admin") {
    tiles.push({
      title: "協力者",
      href: ROUTES.collaborators,
      icon: "users",
      note: "定義を編集できる人の招待・管理",
    });
  }
  return tiles;
}

// タイルの中身（アイコン・名前・説明）
function TileBody({
  title,
  icon,
  note,
}: Pick<Tile, "title" | "icon" | "note">): ReactNode {
  return (
    <>
      <span className={styles.tileHead}>
        <LineIcon name={icon} size={22} className={styles.tileIcon} />
        <span className={styles.tileTitle}>{title}</span>
      </span>
      <span className={styles.tileNote}>{note}</span>
    </>
  );
}

/**
 * ホーム（要件 3.1、モック Home.dc.html）。権限は `@/features/auth` の useRole() から受け取る。
 *
 * - ヘッダー：見出し（h1）にアプリ名。開催中のイベントがあるときだけ「開催中：（イベント名）」
 * - 「札割り」の区分：一覧・割り振り・取り込み・差分（リンク）、設定（ボタン。設定のウィンドウを開く）
 * - 「管理」の区分（協力者・管理者のみ）：見出しに権限名のバッジ、イベント定義・協力者（管理者のみ）
 */
export function HomeScreen({ runningEventName }: HomeScreenProps): ReactNode {
  const role = useRole();
  const isEventRunning = runningEventName !== null && runningEventName !== "";
  const adminTiles = managementTiles(role, isEventRunning);

  return (
    <>
      <ScreenHeader
        title={APP_NAME}
        note={isEventRunning ? `開催中：${runningEventName}` : undefined}
      />
      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>札割り</h2>
          <div className={styles.tiles}>
            {GENERAL_TILES.map((tile) => (
              <Link key={tile.href} href={tile.href} className={styles.tile}>
                <TileBody title={tile.title} icon={tile.icon} note={tile.note} />
              </Link>
            ))}
            <button
              type="button"
              className={styles.tile}
              aria-haspopup="dialog"
              onClick={openSettingsDialog}
            >
              <TileBody title="設定" icon="gear" note="画面モードや文字の大きさなど" />
            </button>
          </div>
        </section>

        {role !== "user" && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              管理 <span className={styles.roleBadge}>{ROLE_LABELS[role]}</span>
            </h2>
            <div className={styles.tiles}>
              {adminTiles.map((tile) => (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className={`${styles.tile} ${styles.adminTile}`}
                >
                  <TileBody title={tile.title} icon={tile.icon} note={tile.note} />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
