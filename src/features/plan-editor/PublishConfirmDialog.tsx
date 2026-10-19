"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, type RefObject, useRef } from "react";
import type { PublishWarning } from "@/domain/definition-edit";
import styles from "./PublishConfirmDialog.module.css";

/** 警告がないときの文 */
const NO_WARNING_NOTE = "公開すると一般の画面に反映されます。公開してよいですか？";

export type PublishConfirmDialogProps = {
  /** 確認に出す警告（findPublishWarnings の結果）。null のときは閉じている */
  warnings: readonly PublishWarning[] | null;
  /** 「公開する」 */
  onConfirm: () => void;
  /** 「やめる」（Esc・背景の暗い部分のクリックも同じ） */
  onCancel: () => void;
  /** 閉じた後にフォーカスを戻す部品（押した公開のボタン） */
  returnFocusRef: RefObject<HTMLElement | null>;
};

/**
 * 公開の前の確認（UI／UX の指摘 中8。Radix UI の Dialog を role="alertdialog" で使う。取り込み画面の確認と同じ作り）。
 *
 * - 名前は「公開の確認」。警告（空の特効グループ・札番号が未入力の札・艦船マスタにない艦名）があれば一覧にし、
 *   なければ「公開すると一般の画面に反映されます」と書く。警告があっても公開はできる（止めない）
 * - ボタンは「やめる」「公開する」。開いたときのフォーカスは、取り消せる側の「やめる」に置く
 * - 開いている間は後ろの画面を操作できない（Radix が後ろを支援技術から隠し、フォーカスを中に閉じ込める）
 * - Portal で body の直下に出すため、色は theme.css の変数と、このファイルの CSS の変数だけを使う
 */
export function PublishConfirmDialog({
  warnings,
  onConfirm,
  onCancel,
  returnFocusRef,
}: PublishConfirmDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={warnings !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content
            className={styles.content}
            // 公開するかどうかを決めてもらう確認なので alertdialog にする（Radix の既定は dialog）
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
            {warnings !== null && (
              <>
                <Dialog.Title className={styles.title}>公開の確認</Dialog.Title>
                {warnings.length === 0 ? (
                  <Dialog.Description className={styles.description}>{NO_WARNING_NOTE}</Dialog.Description>
                ) : (
                  // 説明（aria-describedby）に警告の一覧まで含める（読み上げで警告の中身も伝わるように）
                  <Dialog.Description asChild>
                    <div className={styles.body}>
                      <p className={styles.description}>次の点があります。このまま公開すると一般の画面に反映されます。</p>
                      <ul className={styles.warnings} aria-label="公開の前の警告">
                        {warnings.map((warning) => (
                          <li key={warning.id}>{warning.message}</li>
                        ))}
                      </ul>
                    </div>
                  </Dialog.Description>
                )}
                <div className={styles.footer}>
                  <button ref={cancelRef} type="button" className={styles.cancelButton} onClick={onCancel}>
                    やめる
                  </button>
                  <button
                    type="button"
                    className={styles.confirmButton}
                    onClick={onConfirm}
                  >
                    公開する
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
