"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";
import {
  closeSettingsDialog,
  openSettingsDialog,
  useSettingsDialogOpen,
} from "./settings-dialog-store";
import styles from "./SettingsDialog.module.css";

export type SettingsDialogProps = {
  /** ウィンドウの中身（表示・データ・アカウントの設定項目）。PR-08 で別の担当が作って差し込む */
  children?: ReactNode;
};

/**
 * 設定のウィンドウの枠（Radix UI の Dialog）。レイアウトに 1 つだけ置く。
 * 開閉は settings-dialog-store（openSettingsDialog／closeSettingsDialog）に従う。
 *
 * 形（モック SideNav.dc.html・Home.dc.html の設定ウィンドウ）
 * - role="dialog"、名前「設定」、aria-modal="true"
 * - 説明「表示などの設定はこのブラウザに保存されます」
 * - 右上に「×」（名前「閉じる」）、下に「閉じる」ボタン
 * - 背景の暗い部分（data-testid="settings-dialog-overlay"）のクリックで閉じる。中のクリックでは閉じない
 * - 開いている間は後ろの画面を操作できない（Radix が後ろを支援技術から隠し、フォーカスを中に閉じ込める）
 */
export function SettingsDialog({ children }: SettingsDialogProps): ReactNode {
  const open = useSettingsDialogOpen();
  // 開く前にフォーカスがあった部品（左メニューの「設定」など）。閉じたらそこへ戻す
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          openSettingsDialog();
        } else {
          closeSettingsDialog();
        }
      }}
    >
      <Dialog.Portal>
        {/* ウィンドウを背景の中に置き、縦に長いときは背景ごとスクロールできるようにする */}
        <Dialog.Overlay
          className={styles.overlay}
          data-testid="settings-dialog-overlay"
        >
          <Dialog.Content
            className={styles.content}
            // Radix は aria-modal を自動で付けないため明示する
            aria-modal="true"
            onOpenAutoFocus={() => {
              const active = document.activeElement;
              returnFocusRef.current =
                active instanceof HTMLElement ? active : null;
            }}
            onCloseAutoFocus={(event) => {
              // 開くボタン（Dialog.Trigger）を使っていないため、Radix の既定ではフォーカスが戻らない。自分で戻す
              event.preventDefault();
              const target = returnFocusRef.current;
              returnFocusRef.current = null;
              if (target?.isConnected) target.focus();
            }}
          >
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>設定</Dialog.Title>
              <Dialog.Description className={styles.description}>
                表示などの設定はこのブラウザに保存されます
              </Dialog.Description>
              <Dialog.Close className={styles.cross} aria-label="閉じる">
                ×
              </Dialog.Close>
            </div>
            <div className={styles.body}>
              {children ?? (
                <p className={styles.placeholder}>設定の項目は準備中です</p>
              )}
            </div>
            <div className={styles.footer}>
              <Dialog.Close className={styles.closeButton}>閉じる</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
