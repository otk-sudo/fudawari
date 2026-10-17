"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DefinitionLoadAlert } from "@/components/DefinitionLoadAlert";
import { type IconName, LineIcon } from "@/components/LineIcon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { openSettingsDialog } from "@/components/settings-dialog-store";
import { type Role, useRole } from "@/features/auth";
import { APP_NAME } from "@/lib/app-name";
import type { DefinitionLoadError } from "@/lib/definition";
import { ROUTES, type Route } from "@/lib/routes";
import styles from "./HomeScreen.module.css";

/**
 * ホームに出す最新イベントの状態。
 * ホームの画面（src/app/page.tsx）が、公開定義の読み込み（src/lib/definition）と今の時刻から決めて渡す
 */
export type HomeLatestEvent =
  /** 定義の読み込み中 */
  | { status: "loading" }
  /** 定義の読み込み・検証の失敗（理由つき） */
  | { status: "error"; error: DefinitionLoadError }
  /** 最新イベントの開始前 */
  | { status: "upcoming" }
  /** 最新イベントの開催中（eventName はヘッダーの「開催中：（イベント名）」に出す。例 "2026夏イベ"） */
  | { status: "running"; eventName: string }
  /** 最新イベントの終了後 */
  | { status: "ended" };

export type HomeScreenProps = {
  /** 最新イベントの状態（ヘッダーの「開催中：」、読み込みの失敗の警告、協力者のイベント定義の説明に使う） */
  latestEvent: HomeLatestEvent;
  /** 最終取り込みの日時（「10/15 20:40」の形。取り込んでいなければ null か省略。ヘッダーの「最終取り込み」に使う） */
  lastImportedAt?: string | null;
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

// 協力者のイベント定義のタイルの説明（要件 3.1、U18）。
// 最新のイベントが終了していなければ（開始前を含む）更新できる。読み込み中・失敗のときは、それと分かる文にする
function collabDefinitionNote(latestEvent: HomeLatestEvent): string {
  switch (latestEvent.status) {
    case "loading":
      return "イベントの情報を確認しています";
    case "error":
      return "イベントの情報を読み込めませんでした";
    case "upcoming":
    case "running":
      return "最新イベントの札・段階・特効を更新";
    case "ended":
      return "更新できるイベントがありません（最新のイベントは終了しました）";
  }
}

// 「管理」の区分のタイル（要件 3.1）。一般利用者には何も出さない
function managementTiles(role: Role, latestEvent: HomeLatestEvent): Tile[] {
  if (role === "user") return [];

  // 管理者の説明は、最新イベントの状態によらず同じ
  const definitionNote =
    role === "admin" ? "札・段階・特効の設定、新規イベントの作成" : collabDefinitionNote(latestEvent);
  const tiles: Tile[] = [
    { title: "イベント定義", href: ROUTES.definition, icon: "plan", note: definitionNote },
  ];
  if (role === "admin") {
    tiles.push({
      title: "協力者",
      href: ROUTES.collaborators,
      icon: "users",
      note: "定義を編集できる人の追加・管理",
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
 * - ヘッダー：見出し（h1）にアプリ名。補足に「開催中：（イベント名） ／ 最終取り込み M/D HH:mm」（モック Home.dc.html）。
 *   「開催中：」は開催中のときだけ、「最終取り込み」は取り込んでいるときだけ出し、両方あるときだけ「／」で区切る
 * - 定義の読み込みに失敗したら、ヘッダー帯の下に理由と次の行動（ほかの画面と同じ警告。role="alert"）
 * - 「札割り」の区分：一覧・割り振り・取り込み・差分（リンク）、設定（ボタン。設定のウィンドウを開く）
 * - 「管理」の区分（協力者・管理者のみ）：見出しに権限名のバッジ、イベント定義・協力者（管理者のみ）
 */
export function HomeScreen({ latestEvent, lastImportedAt = null }: HomeScreenProps): ReactNode {
  const role = useRole();
  const adminTiles = managementTiles(role, latestEvent);
  const noteParts = [
    latestEvent.status === "running" ? `開催中：${latestEvent.eventName}` : null,
    lastImportedAt === null ? null : `最終取り込み ${lastImportedAt}`,
  ].filter((part) => part !== null);

  return (
    <>
      <ScreenHeader
        title={APP_NAME}
        note={noteParts.length === 0 ? undefined : noteParts.join(" ／ ")}
      />
      {latestEvent.status === "error" && <DefinitionLoadAlert error={latestEvent.error} />}
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
