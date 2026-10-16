"use client";

// 選択中の艦のパネル（要件 3.3「選択中の艦のパネル（右側）」、モック Assign.dc.html の <section aria-label="選択中の艦">）
//
// - 艦名、「艦種 ・ Lv ・ いま：（札名または控え）」、選択をやめる「×」
// - 「この艦の特効（効く札の順）」：特効がある札ごとのブロック（スコアの高い順）。札の色・札名・スコア・効く段階の倍率と、
//   「（札名）に置く」ボタン（いまその札にいるときは代わりに「いまこの札にいます」）
// - 特効がない札は最後に「特効なし：札A、札B」と 1 行にまとめる（定義の札の順）
// 艦種補正は扱わない（U5・U11）。札のブロックは region にしない（札の列と名前がぶつかるため）。
import type { ReactNode } from "react";
import type { Fuda, PublicDefinition } from "@/domain/definition/types";
import { boostLines, formatMultiplier, shipTypeLabel } from "./ship-view";
import type { TrayEntry } from "./tray";
import styles from "./SelectedShipPanel.module.css";

export interface SelectedShipPanelProps {
  /** 最新イベントの公開定義（段階の表示名） */
  definition: PublicDefinition;
  /** 札 ID → 札 */
  fudas: ReadonlyMap<string, Fuda>;
  /** 選択中の艦 */
  entry: TrayEntry;
  /** いまいる札の ID（控えなら null） */
  placedFudaId: string | null;
  /** 「（札名）に置く」を押したとき（札 ID を渡す） */
  onPlace: (fudaId: string) => void;
  /** 「×」（選択をやめる）を押したとき */
  onClose: () => void;
}

/** 選択中の艦のパネル */
export function SelectedShipPanel({
  definition,
  fudas,
  entry,
  placedFudaId,
  onPlace,
  onClose,
}: SelectedShipPanelProps): ReactNode {
  const { ship, info, boost } = entry;
  const placedName = placedFudaId === null ? "控え" : (fudas.get(placedFudaId)?.name ?? "控え");
  const noBoostNames = boost.ineffectiveFudaIds.flatMap((fudaId) => fudas.get(fudaId)?.name ?? []);

  return (
    <section aria-label="選択中の艦" className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.heading}>
          <h2 className={styles.name}>{info.name}</h2>
          <span className={styles.sub}>
            {shipTypeLabel(info)} ・ Lv{ship.level} ・ いま：{placedName}
          </span>
        </div>
        <button type="button" className={styles.close} aria-label="選択をやめる" onClick={onClose}>
          ×
        </button>
      </div>

      <div className={styles.body}>
        <span className={styles.caption}>この艦の特効（効く札の順）</span>
        {boost.effective.map((fudaBoost) => {
          const fuda = fudas.get(fudaBoost.fudaId);
          if (fuda === undefined) return null;
          const here = fuda.id === placedFudaId;
          return (
            <div
              key={fuda.id}
              className={here ? `${styles.block} ${styles.blockHere}` : styles.block}
              style={{ boxShadow: `inset 4px 0 0 ${fuda.color}` }}
            >
              <div className={styles.blockHead}>
                <span className={styles.dot} style={{ background: fuda.color }} aria-hidden="true" />
                <span className={styles.blockName}>{fuda.name}</span>
                <span className={styles.score}>+{fudaBoost.score}</span>
              </div>
              <ul className={styles.lines}>
                {boostLines(definition, fudas, [fudaBoost]).map((line) => (
                  <li key={line.key} className={styles.line}>
                    <span className={styles.lineLabel}>{line.label}</span>
                    <span className={styles.multiplier}>{formatMultiplier(line.multiplier)}</span>
                  </li>
                ))}
              </ul>
              {here ? (
                <span className={styles.here}>いまこの札にいます</span>
              ) : (
                <button type="button" className={styles.place} onClick={() => onPlace(fuda.id)}>
                  {fuda.name}に置く
                </button>
              )}
            </div>
          );
        })}
        {noBoostNames.length > 0 && <span className={styles.none}>特効なし：{noBoostNames.join("、")}</span>}
      </div>
    </section>
  );
}
