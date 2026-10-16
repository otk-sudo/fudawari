"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, type RefObject, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

export type ConfirmDialogProps = {
  /** 開いているか */
  open: boolean;
  /** 見出し */
  title: string;
  /** 説明（何が起きるか。取り消せるかどうか） */
  description: ReactNode;
  /** 実行するボタンの文字（例「置き換える」「削除する」） */
  confirmLabel: string;
  /** 実行するボタンの見た目（"danger"：削除など取り消せない操作の赤系、"action"：操作の青） */
  tone: "danger" | "action";
  /** 実行する */
  onConfirm: () => void;
  /** 「やめる」（Esc・背景の暗い部分のクリックも同じ） */
  onCancel: () => void;
  /** 閉じた後にフォーカスを戻す部品（確認を開いたボタンなど） */
  returnFocusRef: RefObject<HTMLElement | null>;
};

/**
 * 設定のウィンドウの中から開く確認（Radix UI の Dialog を role="alertdialog" で使う。取り込み画面の確認と同じ作り）。
 *
 * - 設定のウィンドウの上に重ねて開き、開いている間は設定のウィンドウを操作できない（Radix が重なりを管理し、
 *   Esc・背景のクリックはこの確認だけを閉じる）
 * - ボタンは「やめる」と実行するボタン。開いたときのフォーカスは、取り消せる側の「やめる」に置く
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  onConfirm,
  onCancel,
  returnFocusRef,
}: ConfirmDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content
            className={styles.content}
            // 実行するかどうかを決めてもらう確認なので alertdialog にする（Radix の既定は dialog）
            role="alertdialog"
            // Radix は aria-modal を自動で付けないため明示する
            aria-modal="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              // 開くボタン（Dialog.Trigger）を使っていないため、Radix の既定ではフォーカスが戻らない。自分で戻す
              event.preventDefault();
              const target = returnFocusRef.current;
              if (target?.isConnected) target.focus();
            }}
          >
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Description className={styles.description}>{description}</Dialog.Description>
            <div className={styles.footer}>
              <button ref={cancelRef} type="button" className={styles.cancelButton} onClick={onCancel}>
                やめる
              </button>
              <button
                type="button"
                className={tone === "danger" ? styles.dangerButton : styles.confirmButton}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
