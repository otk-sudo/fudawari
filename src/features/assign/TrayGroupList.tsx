"use client";

// 控えの艦の一覧（区切りの見出しと艦カード。要件 3.3「控え」、モック Assign.dc.html）
//
// - 区切りの見出し（aria-expanded を持つボタン）：見出しの文字と隻数。押すとその区切りを折りたたむ（折りたたんだ区切りの艦は描かない）
// - 見出しはスクロール中も上に固定する（position: sticky）
// - 艦カードの中身は呼ぶ側（renderCard）が描く
//
// 600 隻以上の仮想スクロール（TanStack Virtual）とドラッグ（dnd-kit）は PR-06。
// そのときはこの部品の中だけを差し替える（区切りの見出しと艦を 1 列の行に並べて仮想化し、<li> に useDraggable を付ける）。
import type { ReactNode } from "react";
import type { TrayEntry, TrayGroup } from "./tray";
import styles from "./TrayGroupList.module.css";

export interface TrayGroupListProps {
  /** 区切り（buildTray の groups。並び順どおり） */
  groups: readonly TrayGroup[];
  /** 折りたたんだ区切りのキー */
  folded: ReadonlySet<string>;
  /** 区切りの見出しを押したとき（キーを渡す） */
  onToggleGroup: (key: string) => void;
  /** 一行表示か（カードの間を詰める） */
  dense: boolean;
  /** 艦カードを描く */
  renderCard: (entry: TrayEntry) => ReactNode;
}

/** 控えの艦の一覧 */
export function TrayGroupList({ groups, folded, onToggleGroup, dense, renderCard }: TrayGroupListProps): ReactNode {
  return (
    <>
      {groups.map((group) => {
        const open = !folded.has(group.key);
        return (
          <div key={group.key} className={styles.group}>
            <button
              type="button"
              className={styles.header}
              aria-expanded={open}
              onClick={() => onToggleGroup(group.key)}
            >
              <span className={styles.chevron} aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
              <span className={styles.title}>{group.title}</span>
              <span className={styles.count}>{group.count}隻</span>
            </button>
            {open && (
              <ul className={dense ? `${styles.list} ${styles.dense}` : styles.list}>
                {group.entries.map((entry) => (
                  <li key={entry.ship.uid}>{renderCard(entry)}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
