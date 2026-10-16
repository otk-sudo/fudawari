"use client";

// 艦カード（要件 3.3「艦カード」、モック ShipCard.dc.html）
//
// 控えと札の列の両方で使う、見た目と押したときの知らせだけの部品。何を出すか（左端の色・特効の印・開いたときの段階）は呼ぶ側が決める。
// - 一行表示（控えの「一行」）：艦名、「Lv 運」、特効の印「特効」／「－」
// - カード表示（控えの「カード」と札の列）：艦名、特効の印「特効あり」／「特効なし」、2 行目に「艦種 ・ Lv ・ 運」
// - 開いたとき（aria-expanded）：段階ごとの倍率（■ 段階名 ×1.24）。なければ noBoostText（「特効なし」「この札では特効なし」）
// - 選択中は aria-pressed。サブ艦の表記は出さない（同名艦は Lv と運で見分ける）
//
// ドラッグ（PR-06）は、この部品を包む要素（札の列・控えの <li>）に dnd-kit の useDraggable を付ける想定で、ここには入れない。
import type { CSSProperties, ReactNode } from "react";
import type { ShipUid } from "@/domain/ship/types";
import { type BoostLine, formatMultiplier } from "./ship-view";
import styles from "./ShipCard.module.css";

/** CSS 変数を含む style（React の CSSProperties は CSS 変数の名前を知らないため、型を足す） */
type StyleWithVariables = CSSProperties & Record<`--${string}`, string>;

export interface ShipCardProps {
  /** 個体 ID（押したときに onPress へ渡す） */
  uid: ShipUid;
  /** 艦名（マスタにない艦は「名前が分からない艦」） */
  name: string;
  /** 艦種の略称（カード表示の 2 行目） */
  typeLabel: string;
  level: number;
  /** 運の表示値 */
  luck: number;
  /** 一行表示か（控えの「一行」）。札の列はいつもカード表示 */
  dense: boolean;
  /** 特効の印を「あり」にするか（控えはどれかの札で、札の列はその札で効くか） */
  hasBoost: boolean;
  /** 左端の色（札の色 "#RRGGBB"。null は灰色＝特効のない控えの艦） */
  stripeColor: string | null;
  /** 選択中か */
  selected: boolean;
  /** 特効を開いているか */
  expanded: boolean;
  /** 開いたときに並べる段階の倍率（閉じているときは空でよい） */
  lines: readonly BoostLine[];
  /** 開いたときに、効く段階がなければ出す文 */
  noBoostText: string;
  /** カードを押したとき */
  onPress: (uid: ShipUid) => void;
}

/** 艦カード */
export function ShipCard({
  uid,
  name,
  typeLabel,
  level,
  luck,
  dense,
  hasBoost,
  stripeColor,
  selected,
  expanded,
  lines,
  noBoostText,
  onPress,
}: ShipCardProps): ReactNode {
  const flag = dense ? (hasBoost ? "特効" : "－") : hasBoost ? "特効あり" : "特効なし";
  const style: StyleWithVariables | undefined = stripeColor === null ? undefined : { "--card-stripe": stripeColor };
  const className = [styles.card, dense ? styles.dense : "", selected ? styles.selected : expanded ? styles.expanded : ""]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-pressed={selected}
      aria-expanded={expanded}
      data-stripe-color={stripeColor ?? "none"}
      onClick={() => onPress(uid)}
    >
      <span className={styles.banner}>
        <span className={styles.name}>{name}</span>
        {dense && (
          <span className={styles.stats}>
            Lv{level} 運{luck}
          </span>
        )}
        <span className={hasBoost ? styles.flagOn : styles.flagOff}>{flag}</span>
      </span>
      {!dense && (
        <span className={styles.meta}>
          {typeLabel} ・ Lv{level} ・ 運{luck}
        </span>
      )}
      {expanded && (
        <span className={styles.lines}>
          {lines.map((line) => (
            <span key={line.key} className={styles.line}>
              <span className={styles.dot} style={{ background: line.color }} aria-hidden="true" />
              <span className={styles.lineLabel}>{line.label}</span>
              <span className={styles.multiplier}>{formatMultiplier(line.multiplier)}</span>
            </span>
          ))}
          {lines.length === 0 && <span className={styles.noBoost}>{noBoostText}</span>}
        </span>
      )}
    </button>
  );
}
