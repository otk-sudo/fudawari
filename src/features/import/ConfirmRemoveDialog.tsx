"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, type RefObject, useRef } from "react";
import styles from "./ConfirmRemoveDialog.module.css";

/** 確認に出す内容 */
export interface RemoveConfirmation {
  /** 保存すると外れる割り当ての件数（previewImport の戻り値。保存しているすべてのイベントの合計。1 以上） */
  removedAssignmentCount: number;
  /** 個体 ID がある形式か（false なら、すべての割り当てが外れる理由として引き継げないことを書く。U9） */
  hasUid: boolean;
}

export type ConfirmRemoveDialogProps = {
  /** 確認の内容。null のときは閉じている */
  confirmation: RemoveConfirmation | null;
  /** 「外して取り込む」 */
  onConfirm: () => void;
  /** 「やめる」（Esc・背景の暗い部分のクリックも同じ） */
  onCancel: () => void;
  /** 閉じた後にフォーカスを戻す部品（「取り込む」ボタン） */
  returnFocusRef: RefObject<HTMLElement | null>;
};

/**
 * 取り込みで割り当てが外れるときの確認（2026-10-17 親の決定。Radix UI の Dialog を role="alertdialog" で使う）。
 *
 * - 「保存しているすべてのイベントの割り当てのうちn件が外れます」と、外れる理由（個体 ID がない古い形式なら、引き継げないこと）を書く
 *   （件数は最新のイベントだけでなく、保存しているすべてのイベントの合計。2026-10-17 親の決定）
 * - ボタンは「やめる」「外して取り込む」。開いたときのフォーカスは、取り消せる側の「やめる」に置く
 * - 開いている間は後ろの画面を操作できない（Radix が後ろを支援技術から隠し、フォーカスを中に閉じ込める）
 */
export function ConfirmRemoveDialog({
  confirmation,
  onConfirm,
  onCancel,
  returnFocusRef,
}: ConfirmRemoveDialogProps): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={confirmation !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content
            className={styles.content}
            // 取り込むかどうかを決めてもらう確認なので alertdialog にする（Radix の既定は dialog）
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
            {confirmation !== null && (
              <>
                <Dialog.Title className={styles.title}>割り当てが外れます</Dialog.Title>
                <Dialog.Description className={styles.description}>
                  この内容で取り込むと、保存しているすべてのイベントの割り当てのうち
                  <b>{confirmation.removedAssignmentCount}件</b>が外れます。
                  {confirmation.hasUid
                    ? "今回取り込む艦にいない艦（解体した艦や、取り込む範囲から外れた艦）の割り当てです。"
                    : "個体 ID がない古い形式のため、前の割り当ては引き継げません（札割りは控えから始まります）。"}
                </Dialog.Description>
                <div className={styles.footer}>
                  <button ref={cancelRef} type="button" className={styles.cancelButton} onClick={onCancel}>
                    やめる
                  </button>
                  <button type="button" className={styles.confirmButton} onClick={onConfirm}>
                    外して取り込む
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
