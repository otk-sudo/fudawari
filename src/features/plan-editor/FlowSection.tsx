"use client";

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { Area, Fuda, Stage } from "@/domain/definition";
import { addArea, canRemoveArea, type DefinitionDoc } from "@/domain/definition-edit";
import { inkFor } from "./colors";
import { useAreaEndDrop, useStageDnd } from "./editor-dnd";
import { stagesInArea } from "./editor-model";
import controls from "./controls.module.css";
import styles from "./FlowSection.module.css";

const EMPTY_AREA_TEXT = "まだ段階がありません。右の＋で札を選ぶか、札をここに落としてください";

/** 札がないときの色（段階の札が見つからないとき） */
const UNKNOWN_FUDA_COLOR = "#8B93A1";

export type FlowSectionProps = {
  doc: DefinitionDoc;
  /** 選んでいる段階の ID */
  selectedStageId: string | null;
  /** 操作できない（終了したイベント） */
  disabled: boolean;
  onSelectStage: (stageId: string) => void;
  /** 「＋」のメニューで札を選んだ：その海域の最後に段階を追加する */
  onAddStage: (fudaId: string, areaId: string) => void;
  /** 「＋ E4 を追加」：海域を追加し、追加した海域の ID を返す（追加できなければ null） */
  onAddArea: () => string | null;
  onRemoveArea: (areaId: string) => void;
  /** 段階の印（保存の衝突の確認。段階の ID → 印）。省略なら付けない */
  marks?: ReadonlyMap<string, StageMark>;
};

/**
 * 段階の印（要件 3.7「同時編集」）
 * - conflict：2 人とも変えた段階（赤く光らせ「要選択」）
 * - merged：相手だけが変えた段階（橙の枠と「（名前）が変更」）
 */
export type StageMark = { readonly kind: "conflict" } | { readonly kind: "merged"; readonly name: string };

const NO_MARKS: ReadonlyMap<string, StageMark> = new Map();

/**
 * 攻略の流れ（要件 3.7「攻略の流れ」）。海域ごとに 1 行で、段階を左から順に札の色で並べる。
 * 段階を押すと選ぶ。行の右端の「＋」で札を選んで最後に追加する。札・段階のドラッグ＆ドロップは editor-dnd
 */
export function FlowSection(props: FlowSectionProps): ReactNode {
  const { doc } = props;
  const headingId = useId();
  // 「＋」のメニューを開いている海域
  const [menuAreaId, setMenuAreaId] = useState<string | null>(null);
  const next = addArea(doc);
  const nextAreaName = next.ok ? (next.doc.areas[next.doc.areas.length - 1]?.name ?? "") : "";

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          攻略の流れ
        </h2>
        <span className={styles.hints}>
          <span className={styles.hint}>押す：右下で編集・削除</span>
          <span className={styles.hint}>札を段階へドラッグ：その前に割り込み</span>
          <span className={styles.hint}>＋：最後に追加</span>
          <span className={styles.hint}>段階をドラッグ：並べ替え</span>
        </span>
      </div>
      {doc.areas.map((area) => (
        <AreaRow
          key={area.id}
          area={area}
          stages={stagesInArea(doc, area.id)}
          fudas={doc.fudas}
          selectedStageId={props.selectedStageId}
          disabled={props.disabled}
          canRemove={canRemoveArea(doc, area.id)}
          marks={props.marks ?? NO_MARKS}
          menuOpen={menuAreaId === area.id}
          onToggleMenu={(open) => setMenuAreaId(open ? area.id : null)}
          onSelectStage={props.onSelectStage}
          onAddStage={(fudaId) => {
            setMenuAreaId(null);
            props.onAddStage(fudaId, area.id);
          }}
          onRemove={() => {
            setMenuAreaId(null);
            props.onRemoveArea(area.id);
          }}
        />
      ))}
      <button
        type="button"
        className={`${controls.dashedButton} ${styles.addArea}`}
        onClick={() => {
          const areaId = props.onAddArea();
          if (areaId !== null) setMenuAreaId(areaId);
        }}
      >
        ＋ {nextAreaName} を追加
      </button>
    </section>
  );
}

type AreaRowProps = {
  area: Area;
  stages: readonly Stage[];
  fudas: readonly Fuda[];
  selectedStageId: string | null;
  disabled: boolean;
  canRemove: boolean;
  marks: ReadonlyMap<string, StageMark>;
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onSelectStage: (stageId: string) => void;
  onAddStage: (fudaId: string) => void;
  onRemove: () => void;
};

/** 攻略の流れの海域の行（group。名前は海域名） */
function AreaRow(props: AreaRowProps): ReactNode {
  const { area, stages, fudas } = props;
  const fudaById = new Map(fudas.map((fuda) => [fuda.id, fuda]));
  const { setNodeRef: setAddDropRef, isOver: addOver } = useAreaEndDrop(
    `area-end:${area.id}`,
    area.id,
    `${area.name}の最後`,
    props.disabled,
  );
  const { setNodeRef: setEmptyDropRef, isOver: emptyOver } = useAreaEndDrop(
    `area-empty:${area.id}`,
    area.id,
    `${area.name}の最後`,
    props.disabled,
  );
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const setAddButtonRef = useCallback(
    (element: HTMLButtonElement | null) => {
      addButtonRef.current = element;
      setAddDropRef(element);
    },
    [setAddDropRef],
  );

  return (
    <div role="group" aria-label={area.name} className={styles.row}>
      <span className={styles.areaName} aria-hidden="true">
        {area.name}
      </span>
      {stages.map((stage) => (
        <StageChip
          key={stage.id}
          stage={stage}
          areaName={area.name}
          fuda={fudaById.get(stage.fudaId)}
          selected={stage.id === props.selectedStageId}
          mark={props.marks.get(stage.id)}
          disabled={props.disabled}
          onSelect={() => props.onSelectStage(stage.id)}
        />
      ))}
      {stages.length === 0 && (
        <span ref={setEmptyDropRef} className={`${styles.empty} ${emptyOver ? styles.emptyOver : ""}`}>
          <span className={styles.emptyText}>{EMPTY_AREA_TEXT}</span>
          {props.canRemove && (
            <button type="button" className={controls.ghostButton} onClick={props.onRemove}>
              この海域を外す
            </button>
          )}
        </span>
      )}
      <span className={styles.addCell}>
        <button
          ref={setAddButtonRef}
          type="button"
          aria-label="段階を追加"
          aria-haspopup="menu"
          aria-expanded={props.menuOpen}
          className={`${styles.addButton} ${addOver ? styles.addButtonOver : ""}`}
          onClick={() => props.onToggleMenu(!props.menuOpen)}
        >
          ＋
        </button>
        {props.menuOpen && (
          <AddStageMenu
            areaName={area.name}
            fudas={fudas}
            onPick={props.onAddStage}
            onClose={(returnFocus) => {
              props.onToggleMenu(false);
              if (returnFocus) addButtonRef.current?.focus();
            }}
            anchor={addButtonRef}
          />
        )}
      </span>
    </div>
  );
}

type StageChipProps = {
  stage: Stage;
  areaName: string;
  fuda: Fuda | undefined;
  selected: boolean;
  /** 段階の印（なければ undefined） */
  mark: StageMark | undefined;
  disabled: boolean;
  onSelect: () => void;
};

/** 攻略の流れの段階のボタン（押すと選ぶ。ドラッグで並べ替え・札を落とすとその前に割り込み） */
function StageChip({ stage, areaName, fuda, selected, mark, disabled, onSelect }: StageChipProps): ReactNode {
  const color = fuda?.color ?? UNKNOWN_FUDA_COLOR;
  const stageName = stage.name === "" ? "（名前なし）" : stage.name;
  const { setNodeRef, attributes, listeners, isDragging, showDropLine } = useStageDnd(
    { kind: "stage", stageId: stage.id, label: `${areaName} ${stageName}`, color },
    disabled,
  );
  const className = [
    styles.stage,
    selected ? styles.stageSelected : "",
    isDragging ? styles.stageDragging : "",
    showDropLine ? styles.stageDropBefore : "",
    mark?.kind === "conflict" ? styles.stageConflict : "",
    mark?.kind === "merged" ? styles.stageMerged : "",
  ].join(" ");

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      // dnd-kit の attributes の aria-pressed（ドラッグ中）を、選んでいるかどうかで上書きする
      aria-pressed={selected}
      className={className}
      style={{ background: color, color: inkFor(color) }}
      onClick={onSelect}
    >
      <span className={styles.stageName}>{stageName}</span>
      <span className={styles.stageFuda}>{fuda?.name ?? "（札なし）"}</span>
      {mark !== undefined && (
        <span className={mark.kind === "conflict" ? styles.markConflict : styles.markMerged}>
          {mark.kind === "conflict" ? "要選択" : `${mark.name}が変更`}
        </span>
      )}
    </button>
  );
}

type AddStageMenuProps = {
  areaName: string;
  fudas: readonly Fuda[];
  onPick: (fudaId: string) => void;
  /** 閉じる（returnFocus なら「＋」にフォーカスを戻す） */
  onClose: (returnFocus: boolean) => void;
  /** 「＋」のボタン（外側のクリックの判定に使う） */
  anchor: { readonly current: HTMLElement | null };
};

/** 「＋」のメニュー（「（海域）の最後に追加する札」）。開いたら最初の札にフォーカスを移す */
function AddStageMenu({ areaName, fudas, onPick, onClose, anchor }: AddStageMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], button')?.focus();
  }, []);

  useEffect(() => {
    // メニューと「＋」の外を押したら閉じる
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [anchor, onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div ref={menuRef} role="menu" aria-label="追加する札" className={styles.menu} onKeyDown={handleKeyDown}>
      <span className={styles.menuTitle}>{areaName}の最後に追加する札</span>
      {fudas.length === 0 && <span className={styles.menuEmpty}>札がありません。左下の「＋ 札を追加」で作ってください</span>}
      {fudas.map((fuda) => (
        <button
          key={fuda.id}
          type="button"
          role="menuitem"
          className={styles.menuItem}
          style={{ background: fuda.color, color: inkFor(fuda.color) }}
          onClick={() => onPick(fuda.id)}
        >
          {fuda.name}
        </button>
      ))}
      <button type="button" className={controls.ghostButton} onClick={() => onClose(true)}>
        やめる
      </button>
    </div>
  );
}
