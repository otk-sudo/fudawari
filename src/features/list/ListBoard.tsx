"use client";

import { type ReactNode, useId, useMemo, useState } from "react";
import type { PublicDefinition } from "@/domain/definition";
import type { ShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import {
  buildFudaViews,
  buildTimeline,
  type FudaShipView,
  type FudaView,
  formatMultiplier,
  groupByShipType,
  readableInkOn,
  type TimelineArea,
} from "./list-view";
import styles from "./ListBoard.module.css";

/** 一覧の本文（ListBoard）に渡すもの。どれも読み込み済みの値（読み込み中・失敗・未取り込みの出し分けはページ側で行う） */
export interface ListBoardProps {
  /** 最新イベントの公開定義 */
  definition: PublicDefinition;
  /** 艦船マスタ（艦 ID から艦名・艦種を引く） */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 最新イベントの割り当て（個体 ID → 札 ID） */
  assignments: AssignmentMap;
}

/**
 * 札の色の上の文字の色のクラス：黒と白のうちコントラスト比の高い方（UI／UX レビュー 中12）。
 * 色が "#RRGGBB" でなければ（札の色で塗らないので）画面モードの文字の色のまま
 */
function inkClass(color: string): string {
  const ink = readableInkOn(color);
  if (ink === null) return "";
  return ink === "white" ? styles.inkWhite : styles.inkBlack;
}

/**
 * 一覧の本文（要件 3.2、モック Main.dc.html。roadmap T2-9）：攻略の流れ、表示の切り替え、札ごとの行。
 * 見るだけの画面で、割り振りの操作はしない。
 *
 * 表示の切り替え（U24）
 * - 「艦種ごとに並べる」（初めは ON）：OFF にすると艦種の区切りをなくして、札の中を Lv の高い順に並べる
 * - 「特効艦だけ」（初めは OFF）：その札で特効がない艦を隠す（札の色帯の隻数は変えない）
 */
export function ListBoard({ definition, master, ships, assignments }: ListBoardProps): ReactNode {
  const togglesLabelId = useId();
  const [groupByType, setGroupByType] = useState(true);
  const [boostOnly, setBoostOnly] = useState(false);
  const timeline = useMemo(
    () => buildTimeline(definition, master, ships, assignments),
    [definition, master, ships, assignments],
  );
  const fudaViews = useMemo(
    () => buildFudaViews(definition, master, ships, assignments),
    [definition, master, ships, assignments],
  );

  return (
    <div className={styles.board}>
      <Timeline areas={timeline} />

      <div role="group" aria-labelledby={togglesLabelId} className={styles.toggles}>
        <span id={togglesLabelId} className={styles.togglesLabel}>
          表示
        </span>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={groupByType}
          onClick={() => setGroupByType((on) => !on)}
        >
          艦種ごとに並べる
        </button>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={boostOnly}
          onClick={() => setBoostOnly((on) => !on)}
        >
          特効艦だけ
        </button>
      </div>

      <div className={styles.rows}>
        {fudaViews.map((view) => (
          <FudaRow key={view.fuda.id} view={view} groupByType={groupByType} boostOnly={boostOnly} />
        ))}
      </div>
    </div>
  );
}

// ---- 攻略の流れ ----

/** 攻略の流れ：海域ごとに 1 行、段階を左から順に並べて、使う札の色で塗る */
function Timeline({ areas }: { areas: readonly TimelineArea[] }): ReactNode {
  const baseId = useId();
  return (
    <section aria-label="攻略の流れ" className={styles.timeline}>
      {areas.map(({ area, steps }, areaIndex) => {
        const labelId = `${baseId}-area-${areaIndex}`;
        return (
          <div key={area.id} className={styles.areaRow}>
            <span id={labelId} className={styles.areaName}>
              {area.name}
            </span>
            <ol aria-labelledby={labelId} className={styles.steps}>
              {steps.map(({ stage, fuda, boostedCount }) => {
                const color = fuda?.color ?? "";
                return (
                  <li
                    key={stage.id}
                    className={`${styles.step} ${inkClass(color)}`}
                    style={{ backgroundColor: color || undefined }}
                    data-fuda-color={color}
                  >
                    {/* 段階名・札名・「特効 n隻」・難所の印を 1 行に横並びにし、長ければ省略記号で切る（UI／UX レビュー 中5） */}
                    <span className={styles.stepStage} title={stage.name}>
                      {stage.name}
                    </span>
                    <span className={styles.stepFuda} title={fuda?.name ?? stage.fudaId}>
                      {fuda?.name ?? stage.fudaId}
                    </span>
                    {/* 全段階に出す（特効グループのない段階や、特効のある艦がいない段階は「特効 0隻」） */}
                    <span className={styles.stepBoost}>特効 {boostedCount}隻</span>
                    {stage.importance === "hard" && <span className={styles.hard}>難所</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

// ---- 札ごとの行 ----

/** 札ごとの行：左端の色帯（札名・使う段階・隻数）と、置いた艦 */
function FudaRow({
  view,
  groupByType,
  boostOnly,
}: {
  view: FudaView;
  groupByType: boolean;
  boostOnly: boolean;
}): ReactNode {
  const nameId = useId();
  const { fuda, stageLabels, ships, boostedCount } = view;
  const shown = boostOnly ? ships.filter((ship) => ship.hasBoost) : ships;

  return (
    <section aria-labelledby={nameId} className={styles.row} data-fuda-color={fuda.color}>
      <div className={`${styles.rowHead} ${inkClass(fuda.color)}`} style={{ backgroundColor: fuda.color }}>
        <span id={nameId} className={styles.rowName}>
          {fuda.name}
        </span>
        <span className={styles.rowStages}>{stageLabels.join("・")}</span>
        <span className={styles.rowCount}>
          {ships.length}隻 ・ 特効 {boostedCount}隻
        </span>
      </div>
      <div className={styles.rowBody}>
        {ships.length === 0 ? (
          <span className={styles.empty}>まだ割り当てがありません</span>
        ) : shown.length === 0 ? (
          <span className={styles.empty}>特効艦はいません</span>
        ) : groupByType ? (
          groupByShipType(shown).map((group) => (
            <TypeGroup key={group.label} label={group.label} ships={group.ships} color={fuda.color} />
          ))
        ) : (
          <ShipGrid ships={shown} color={fuda.color} />
        )}
      </div>
    </section>
  );
}

/** 艦種のまとまり（見出しは艦種の略称） */
function TypeGroup({
  label,
  ships,
  color,
}: {
  label: string;
  ships: readonly FudaShipView[];
  color: string;
}): ReactNode {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={styles.group}>
      <span id={labelId} className={styles.groupLabel}>
        {label}
      </span>
      <ShipGrid ships={ships} color={color} />
    </div>
  );
}

/** 艦の並び */
function ShipGrid({ ships, color }: { ships: readonly FudaShipView[]; color: string }): ReactNode {
  return (
    <ul className={styles.ships}>
      {ships.map((view) => (
        <ShipItem key={view.ship.uid} view={view} color={color} />
      ))}
    </ul>
  );
}

/** 艦 1 隻：艦名・「Lv 運」・その札での最大倍率のバッジ（特効がなければ「–」で、少し薄くする） */
function ShipItem({ view, color }: { view: FudaShipView; color: string }): ReactNode {
  const { ship, name, hasBoost, maxMultiplier } = view;
  return (
    <li
      className={styles.ship}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
      data-dimmed={hasBoost ? undefined : "true"}
    >
      <span className={styles.shipName}>{name}</span>
      <span className={styles.shipMeta}>
        <span className={styles.shipStats}>
          Lv{ship.level}　運{ship.luck}
        </span>
        {hasBoost ? (
          <span className={styles.badge}>{formatMultiplier(maxMultiplier)}</span>
        ) : (
          <span className={styles.badgeNone}>–</span>
        )}
      </span>
    </li>
  );
}
