"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ExportImage } from "./ExportImage";
import { IMAGE_WIDTH } from "./image-layout";
import { exportImageFileName, splitIntoImagePages } from "./pages";
import {
  canCopyImage,
  copyPng,
  downloadPng,
  ExportCancelledError,
  reasonOf,
  renderPng,
  waitForImageFonts,
} from "./png";
import styles from "./ExportImageDialog.module.css";

/** 画像で保存のウィンドウ（ExportImageDialog）に渡すもの */
export interface ExportImageDialogProps {
  /** 開いているか（開閉は呼ぶ側が持つ） */
  open: boolean;
  /** 開閉が変わるとき（×・「やめる」・背景のクリックで false） */
  onOpenChange: (open: boolean) => void;
  /** 最新イベントの公開定義 */
  definition: PublicDefinition;
  /** 艦船マスタ */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
}

/**
 * 画像で保存のウィンドウ（要件 3.9、モック Main.dc.html の画像で保存。roadmap T2-10）。Radix UI の Dialog で作る。
 * 一覧の「画像で保存」から開く。
 *
 * 形（モック Main.dc.html の画像で保存）
 * - role="dialog"、名前「画像で保存」、aria-modal="true"。説明「横長 1600×900 の PNG。X などに貼りやすい大きさです」
 * - 入れる札（「札が付いた札をすべて」／「札を選ぶ」）、枚数（1 枚 6 札まで。超えたら分けて保存）、見本（1 枚目）
 * - 「やめる」「画像をコピー」（Clipboard API に対応しているときだけ）「PNGで保存」
 * - 背景の暗い部分（data-testid="export-image-dialog-overlay"）のクリック・×・「やめる」で閉じる。中のクリックでは閉じない
 * - 開いている間は後ろの画面を操作できない（Radix が後ろを支援技術から隠し、フォーカスを中に閉じ込める）
 *
 * 中身（入れる札の選び方など）は開くたびに初めの状態に戻す（閉じると中身を外すため）。
 */
export function ExportImageDialog({
  open,
  onOpenChange,
  definition,
  master,
  ships,
  assignments,
}: ExportImageDialogProps): ReactNode {
  // 開く前にフォーカスがあった部品（一覧の「画像で保存」など）。閉じたらそこへ戻す
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* ウィンドウを背景の中に置き、縦に長いときは背景ごとスクロールできるようにする */}
        <Dialog.Overlay className={styles.overlay} data-testid="export-image-dialog-overlay">
          <Dialog.Content
            className={styles.content}
            // Radix は aria-modal を自動で付けないため明示する
            aria-modal="true"
            onOpenAutoFocus={() => {
              const active = document.activeElement;
              returnFocusRef.current = active instanceof HTMLElement ? active : null;
            }}
            onCloseAutoFocus={(event) => {
              // 開くボタン（Dialog.Trigger）を使っていないため、Radix の既定ではフォーカスが戻らない。自分で戻す
              event.preventDefault();
              const target = returnFocusRef.current;
              returnFocusRef.current = null;
              if (target?.isConnected) target.focus();
            }}
          >
            <ExportImageBody definition={definition} master={master} ships={ships} assignments={assignments} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---- ウィンドウの中身 ----

/** 入れる札の選び方：艦がいる札をすべて／選んだ札だけ */
type Scope = "all" | "pick";

/** 今している処理（null なら何もしていない） */
type Busy = "save" | "copy" | null;

/** 何もしない購読（Clipboard API の対応は変わらないため） */
function subscribeNothing(): () => void {
  return () => {};
}

/** サーバーでの描画では、コピーできないものとして扱う */
function cannotCopyOnServer(): boolean {
  return false;
}

/** 艦がいる札の ID（定義の札の順。取り込んだ艦の一覧から割り当てを引く） */
function filledFudaIds(
  definition: PublicDefinition,
  ships: readonly OwnedShip[],
  assignments: AssignmentMap,
): string[] {
  const used = new Set<string>();
  for (const ship of ships) {
    // 自分自身のキーだけを見る（Object.prototype の項目を拾わない）
    const fudaId = Object.hasOwn(assignments, ship.uid) ? assignments[ship.uid] : undefined;
    if (fudaId !== undefined) used.add(fudaId);
  }
  return definition.fudas.filter((fuda) => used.has(fuda.id)).map((fuda) => fuda.id);
}

/** コピーした後の知らせ（複数枚なら何枚目かを付ける） */
function copiedMessage(page: number, pageCount: number): string {
  return `${pageCount > 1 ? `${page}枚目の` : ""}画像をコピーしました。Xの投稿欄などにそのまま貼り付けられます`;
}

/** 見本の縮小の倍率（見本の枠の幅に合わせる。枠の幅が分からないうちはモックの 0.6） */
function usePreviewScale(frameRef: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setScale(width / IMAGE_WIDTH);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);
  return scale;
}

/** ウィンドウの中身（開くたびに作り直す） */
function ExportImageBody({
  definition,
  master,
  ships,
  assignments,
}: Omit<ExportImageDialogProps, "open" | "onOpenChange">): ReactNode {
  const baseId = useId();
  const scopeLabelId = `${baseId}-scope`;
  const captionId = `${baseId}-caption`;
  const canCopy = useSyncExternalStore(subscribeNothing, canCopyImage, cannotCopyOnServer);

  const filled = useMemo(() => filledFudaIds(definition, ships, assignments), [definition, ships, assignments]);
  const fudaById = useMemo(() => new Map(definition.fudas.map((fuda) => [fuda.id, fuda])), [definition]);
  const [scope, setScope] = useState<Scope>("all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(filled));
  const [copyIndex, setCopyIndex] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  /** コピーした画像（何枚目か。0 から）。選び方を変えたら null に戻す */
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = scope === "all" ? filled : filled.filter((id) => picked.has(id));
  const pages = splitIntoImagePages(chosen);
  const pageCount = pages.length;
  const nothingChosen = pageCount === 0;
  const selectedCopyIndex = Math.min(copyIndex, Math.max(0, pageCount - 1));

  // PNG にする画像の DOM（何枚目か → 画像の一番外側の要素）
  const captureRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 閉じた（中身を外した）後に、作り終えた PNG を保存・コピーしないための印
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const previewScale = usePreviewScale(frameRef);

  /** 選び方が変わったら、コピーした知らせと失敗の表示を消す */
  const resetNotice = (): void => {
    setCopiedIndex(null);
    setError(null);
  };

  /**
   * 何枚目か（0 から）の画像を PNG にする（フォントの読み込みを待ってから）。
   * 途中でウィンドウを閉じたら ExportCancelledError で打ち切る（保存・コピーに渡さない）
   */
  const makePng = async (index: number): Promise<Blob> => {
    const node = captureRefs.current[index];
    if (node === null || node === undefined) throw new Error("画像の元が見つかりません");
    await waitForImageFonts(node.textContent ?? "");
    // フォントを待っている間に閉じていたら、作らずにやめる
    if (!aliveRef.current) throw new ExportCancelledError();
    const blob = await renderPng(node);
    // 作っている間に閉じていたら渡さない（コピーでは ClipboardItem に渡した Promise が失敗になり、書き込まれない）
    if (!aliveRef.current) throw new ExportCancelledError();
    return blob;
  };

  const save = async (): Promise<void> => {
    if (busy !== null || nothingChosen) return;
    setBusy("save");
    resetNotice();
    try {
      for (let index = 0; index < pageCount; index += 1) {
        const blob = await makePng(index);
        if (!aliveRef.current) return;
        downloadPng(blob, exportImageFileName(definition.event.name, index + 1, pageCount));
      }
    } catch (cause) {
      if (aliveRef.current) setError(`画像を作れませんでした（${reasonOf(cause)}）`);
    } finally {
      if (aliveRef.current) setBusy(null);
    }
  };

  /**
   * 選んだ画像をコピーする。Safari はクリックの処理の中で同期的に write を呼ばないとコピーを断るため、
   * PNG のできあがりを待たずに write を呼び、PNG は ClipboardItem に Promise で渡す（フォントを待ってから作る順は同じ）。
   * 知らせ（コピーした・失敗した）は、write と PNG の作成の両方が終わってから出す
   */
  const copy = (): void => {
    if (busy !== null || nothingChosen || !canCopy) return;
    const index = selectedCopyIndex;
    setBusy("copy");
    resetNotice();
    const png = makePng(index);
    let writing: Promise<void>;
    try {
      writing = copyPng(png);
    } catch (cause) {
      writing = Promise.reject(cause);
    }
    void Promise.allSettled([png, writing]).then(([made, written]) => {
      if (!aliveRef.current) return;
      if (made.status === "rejected") {
        setError(`画像を作れませんでした（${reasonOf(made.reason)}）`);
      } else if (written.status === "rejected") {
        setError(`コピーできませんでした（${reasonOf(written.reason)}）`);
      } else {
        setCopiedIndex(index);
      }
      setBusy(null);
    });
  };

  const status =
    busy !== null ? "画像を作っています…" : copiedIndex !== null ? copiedMessage(copiedIndex + 1, pageCount) : "";
  const pageNote =
    filled.length === 0
      ? "まだどの札にも艦がいないため、画像に入れる札がありません"
      : nothingChosen
        ? "札を1つ以上選んでください"
        : `${chosen.length}札 → ${pageCount}枚${pageCount > 1 ? "（分けて保存）" : ""}`;
  const controlsDisabled = busy !== null;

  return (
    <>
      <div className={styles.header}>
        <Dialog.Title className={styles.title}>画像で保存</Dialog.Title>
        <Dialog.Description className={styles.description}>
          横長 1600×900 の PNG。X などに貼りやすい大きさです
        </Dialog.Description>
        <Dialog.Close className={styles.cross} aria-label="閉じる">
          ×
        </Dialog.Close>
      </div>

      <div className={styles.body}>
        <div className={styles.options}>
          <span id={scopeLabelId} className={styles.optionsLabel}>
            入れる札
          </span>
          <div role="radiogroup" aria-labelledby={scopeLabelId} className={styles.radios}>
            {(
              [
                ["all", "札が付いた札をすべて"],
                ["pick", "札を選ぶ"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input
                  type="radio"
                  name={`${baseId}-scope-input`}
                  value={value}
                  checked={scope === value}
                  disabled={controlsDisabled}
                  onChange={() => {
                    setScope(value);
                    resetNotice();
                  }}
                  className={styles.radio}
                />
                {label}
              </label>
            ))}
          </div>
          {scope === "pick" && (
            <div className={styles.checks}>
              {filled.map((id) => {
                const fuda = fudaById.get(id);
                return (
                  <label key={id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={picked.has(id)}
                      disabled={controlsDisabled}
                      onChange={() => {
                        setPicked((current) => {
                          const next = new Set(current);
                          if (next.has(id)) {
                            next.delete(id);
                          } else {
                            next.add(id);
                          }
                          return next;
                        });
                        resetNotice();
                      }}
                      className={styles.checkbox}
                    />
                    <span className={styles.dot} style={{ backgroundColor: fuda?.color }} aria-hidden="true" />
                    {fuda?.name ?? id}
                  </label>
                );
              })}
            </div>
          )}
          <p className={styles.explain}>
            入るもの：イベント名・攻略の流れ・札ごとの艦（艦名・Lv・運・特効あり／なし）・ツール名。まだ艦がいない札は入りません。1枚に入るのは6札までで、超えると自動で分けて保存します
          </p>
          <p className={styles.pageNote}>{pageNote}</p>
        </div>

        <figure aria-labelledby={captionId} className={styles.preview}>
          <figcaption id={captionId} className={styles.caption}>
            見本（1枚目）
          </figcaption>
          {/* 見本は 1600×900 の画像を枠の幅に縮小して見せる（中身は下の保存する画像と同じなので、読み上げからは外す） */}
          <div ref={frameRef} className={styles.frame} aria-hidden="true">
            <div className={styles.scaler} style={{ transform: `scale(${previewScale})` }}>
              <ExportImage
                definition={definition}
                master={master}
                ships={ships}
                assignments={assignments}
                fudaIds={pages[0] ?? []}
                page={1}
                pageCount={Math.max(1, pageCount)}
              />
            </div>
          </div>
        </figure>
      </div>

      {/* PNG にする画像（等倍）。画面の外に置き、読み上げからは外す */}
      <div className={styles.captureArea} aria-hidden="true">
        {pages.map((fudaIds, index) => (
          <ExportImage
            key={fudaIds.join(",")}
            ref={(node) => {
              captureRefs.current[index] = node;
            }}
            definition={definition}
            master={master}
            ships={ships}
            assignments={assignments}
            fudaIds={fudaIds}
            page={index + 1}
            pageCount={pageCount}
          />
        ))}
      </div>

      <div className={styles.footer}>
        {error !== null && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <p role="status" className={styles.status}>
            {status}
          </p>
          <Dialog.Close className={styles.cancel}>やめる</Dialog.Close>
          {canCopy && pageCount > 1 && (
            <label className={styles.copyPage}>
              コピーする画像
              <select
                value={selectedCopyIndex}
                disabled={controlsDisabled}
                onChange={(event) => {
                  setCopyIndex(Number(event.target.value));
                  resetNotice();
                }}
                className={styles.select}
              >
                {pages.map((fudaIds, index) => (
                  <option key={fudaIds.join(",")} value={index}>
                    {index + 1}枚目
                  </option>
                ))}
              </select>
            </label>
          )}
          {canCopy && (
            <button
              type="button"
              className={styles.copy}
              disabled={nothingChosen || controlsDisabled}
              onClick={copy}
            >
              {copiedIndex !== null ? "コピーしました ✓" : "画像をコピー"}
            </button>
          )}
          <button
            type="button"
            className={styles.save}
            disabled={nothingChosen || controlsDisabled}
            onClick={() => void save()}
          >
            {pageCount > 1 ? `${pageCount}枚まとめて保存（PNG）` : "PNGで保存"}
          </button>
        </div>
      </div>
    </>
  );
}
