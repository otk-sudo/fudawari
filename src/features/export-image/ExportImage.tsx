"use client";

import { type ReactNode, type Ref, useId, useMemo } from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { buildFudaViews, buildTimeline, type FudaView, inkOn } from "@/features/list/list-view";
import { APP_NAME } from "@/lib/app-name";
import { areaRowHeight, fitShipsInColumn, shipRowCapacity } from "./image-layout";
import styles from "./ExportImage.module.css";

/** 出力する画像 1 枚（ExportImage）に渡すもの */
export interface ExportImageProps {
  /** 最新イベントの公開定義（イベント名・攻略の流れ・札） */
  definition: PublicDefinition;
  /** 艦船マスタ（艦名を引く） */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
  /** この 1 枚に入れる札の ID（最大 6。渡した順に列を並べる） */
  fudaIds: readonly string[];
  /** 何枚目か（1 から） */
  page: number;
  /** 全部で何枚か（1 なら「n / m」を出さない） */
  pageCount: number;
  /** 画像の一番外側の要素（PNG にするときに modern-screenshot へ渡す） */
  ref?: Ref<HTMLDivElement>;
}

/** 列の数の下限（札が少なくても列の幅は 3 列分。要件 3.9） */
const MIN_COLUMNS = 3;

/** 札の色の上の文字の色のクラス */
function inkClass(color: string): string {
  return inkOn(color) === "light" ? styles.inkLight : styles.inkDark;
}

/**
 * 画像で保存で出力する画像 1 枚（1600×900。要件 3.9、モック ExportImage.dc.html。roadmap T2-10）の DOM。
 * modern-screenshot でこの DOM を PNG にする。X で縮小されても読めるよう文字を大きくし、見た目はダークで固定する。
 *
 * - 上部：イベント名・「札割り」。複数枚なら右に「n / m」
 * - 攻略の流れ：この画像の札に関係なく全海域・全段階（札名と段階名を札の色で）
 * - 札の列：渡した札ごとに、札名・全隻数と、艦（Lv の高い順に艦名・Lv・運・「特効」か「－」）。
 *   列に入らない艦は載せず「ほか n 隻」と書く（U15）。倍率は載せない
 * - 下部：「札」のロゴ・ツール名・凡例
 */
export function ExportImage({
  definition,
  master,
  ships,
  assignments,
  fudaIds,
  page,
  pageCount,
  ref,
}: ExportImageProps): ReactNode {
  const baseId = useId();
  const timeline = useMemo(
    () => buildTimeline(definition, master, ships, assignments),
    [definition, master, ships, assignments],
  );
  const viewById = useMemo(
    () => new Map(buildFudaViews(definition, master, ships, assignments).map((view) => [view.fuda.id, view])),
    [definition, master, ships, assignments],
  );
  const columns = fudaIds.flatMap((id) => {
    const view = viewById.get(id);
    return view === undefined ? [] : [view];
  });
  const rowHeight = areaRowHeight(definition.areas.length);
  const capacity = shipRowCapacity(definition.areas.length);

  return (
    <div ref={ref} className={styles.image}>
      <div className={styles.header}>
        <span className={styles.eventName}>{definition.event.name}</span>
        <span className={styles.title}>札割り</span>
        <span className={styles.spacer} />
        {pageCount > 1 && (
          <span className={styles.pageLabel}>
            {page} / {pageCount}
          </span>
        )}
      </div>

      <div className={styles.timeline}>
        {timeline.map(({ area, steps }, areaIndex) => {
          const labelId = `${baseId}-area-${areaIndex}`;
          return (
            <div key={area.id} className={styles.areaRow} style={{ height: rowHeight }}>
              <span id={labelId} className={styles.areaName}>
                {area.name}
              </span>
              <ol aria-labelledby={labelId} className={styles.steps}>
                {steps.map(({ stage, fuda }) => {
                  const color = fuda?.color ?? "";
                  return (
                    <li
                      key={stage.id}
                      className={`${styles.step} ${inkClass(color)}`}
                      style={{ backgroundColor: color || undefined }}
                      data-fuda-color={color}
                    >
                      <span className={styles.stepFuda}>{fuda?.name ?? stage.fudaId}</span>
                      <span className={styles.stepStage}>{stage.name}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>

      <div
        className={styles.columns}
        style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, MIN_COLUMNS)}, minmax(0, 1fr))` }}
      >
        {columns.map((view) => (
          <FudaColumn key={view.fuda.id} view={view} capacity={capacity} />
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.logo}>札</span>
        <span>{APP_NAME}</span>
        <span className={styles.spacer} />
        <span className={styles.legend}>
          <span className={styles.markOn}>特効</span>
          <span>その札で特効あり</span>
          <span className={styles.legendNone}>－</span>
          <span>特効なし</span>
        </span>
      </div>
    </div>
  );
}

/** 札の列 1 つ（上端に札の色、札名・全隻数、艦。入らない艦は「ほか n 隻」） */
function FudaColumn({ view, capacity }: { view: FudaView; capacity: number }): ReactNode {
  const nameId = useId();
  const { fuda, ships } = view;
  const { shown, rest } = fitShipsInColumn(ships.length, capacity);

  return (
    <section
      aria-labelledby={nameId}
      className={styles.column}
      style={{ borderTopColor: fuda.color }}
      data-fuda-color={fuda.color}
    >
      <div className={styles.columnHead}>
        <span id={nameId} className={styles.columnName} style={{ color: fuda.color }}>
          {fuda.name}
        </span>
        <span className={styles.columnCount}>{ships.length}隻</span>
      </div>
      <ol className={styles.shipList}>
        {ships.slice(0, shown).map(({ ship, name, hasBoost }) => (
          <li key={ship.uid} className={styles.ship}>
            <span className={styles.shipName}>{name}</span>
            <span className={styles.shipStats}>
              <span>Lv{ship.level}</span>
              <span>運{ship.luck}</span>
            </span>
            {hasBoost ? <span className={styles.markOn}>特効</span> : <span className={styles.markOff}>－</span>}
          </li>
        ))}
      </ol>
      {rest > 0 && <p className={styles.more}>ほか {rest} 隻</p>}
    </section>
  );
}
