"use client";

// 控えの艦の一覧（区切りの見出しと艦カード。要件 3.3「控え」、モック Assign.dc.html。仮想スクロールとドラッグは roadmap T2-8）
//
// - 区切りの見出し（aria-expanded を持つボタン）：見出しの文字と隻数。押すとその区切りを折りたたむ（折りたたんだ区切りの艦は描かない）
// - 艦カードの中身は呼ぶ側（renderCard）が描き、ここでドラッグする li（DraggableShipItem）に包む
//
// 仮想スクロール（TanStack Virtual。600 隻以上でも重くならないように）
// - 区切りの見出しと艦を 1 列の行に並べ、控えの一覧（TrayPanel の role="tabpanel"。scrollElement）のスクロールに合わせて、
//   見える範囲と前後の少しの行だけを描く。行の高さは描いた行を測り（開いたカードの高さの変化も測り直す）、測るまでは見積もりを使う
// - 見出しの固定：一覧の一番上にかかっている区切りの見出しを、描く範囲の外でも描き、その行だけを position: sticky にする。
//   固定した見出しで折りたたむと、その見出しが一覧の一番上に来るまで戻す（折りたたんだ見出しが上へ流れて見えなくならないように）
// - 行の DOM：見出しの行（div）と、区切りごとの ul（描く艦の li）を並べる。行は外側の箱を基準に position: absolute で縦に置くので、
//   ul は高さ 0 のまま。固定する見出しの行だけは通常の流れ（箱の一番上）に置き、sticky で一覧の上端に留める
// - 固定した見出しの行は、艦カードの落とす先の cover として渡す（その下に隠れたカードに当てず、控えの落とす先に任せる）
// - フォーカスした艦カード（キーボードで Tab して来たカードなど）は、スクロールで見える範囲の外に出ても描き続ける
//   （外すとフォーカスが document.body に落ちるため）。同じ区切りの艦は 1 つの ul にまとめるので、離れた行でも ul の key は重ならない
// - 大きさを測れない（一覧の高さが 0。jsdom など）ときは、すべての行を描く（見える範囲の高さを大きな値に置き換える）。
//   行の高さが 0 と測れたときも見積もりのままにする（全行が同じ位置に重なると、描く範囲を決められないため）
import {
  defaultRangeExtractor,
  measureElement,
  observeElementRect,
  type Range,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { type CSSProperties, type FocusEvent, type ReactNode, useCallback, useMemo, useState } from "react";
import { DraggableShipItem } from "./DraggableShipItem";
import type { TrayEntry, TrayGroup } from "./tray";
import styles from "./TrayGroupList.module.css";

export interface TrayGroupListProps {
  /** 区切り（buildTray の groups。並び順どおり） */
  groups: readonly TrayGroup[];
  /** 折りたたんだ区切りのキー */
  folded: ReadonlySet<string>;
  /** 区切りの見出しを押したとき（キーを渡す） */
  onToggleGroup: (key: string) => void;
  /** 一行表示か（カードの間を詰める） */
  dense: boolean;
  /** 艦カードを描く */
  renderCard: (entry: TrayEntry) => ReactNode;
  /** 控えの一覧のスクロールする要素（TrayPanel の role="tabpanel"）。描く前は null */
  scrollElement: HTMLElement | null;
}

/** 行の下の間隔（次の行との間）。item：同じ区切りの艦の間、header：見出しと最初の艦の間、group：次の区切りの前、end：一覧の最後 */
type RowSpace = "item" | "header" | "group" | "end";

/** 一覧の 1 行（区切りの見出しか艦） */
type TrayRow =
  | {
      readonly kind: "header";
      readonly key: string;
      readonly group: TrayGroup;
      readonly open: boolean;
      readonly space: RowSpace;
    }
  | {
      readonly kind: "ship";
      readonly key: string;
      readonly entry: TrayEntry;
      /** 艦のいる区切りのキー */
      readonly groupKey: string;
      readonly space: RowSpace;
    };

/** 見える範囲の前後に余分に描く行の数 */
const OVERSCAN = 5;
/** 一覧の最後の行の下の余白（px） */
const LIST_PADDING_END = 8;
/** 大きさを測れないときの、見える範囲の高さ（すべての行を描くための大きな値） */
const UNMEASURED_VIEWPORT_HEIGHT = Number.MAX_SAFE_INTEGER;
/** 行の高さの見積もり（px。測るまでの仮の値。間隔は ROW_SPACE_ESTIMATE を足す） */
const HEADER_HEIGHT_ESTIMATE = 28;
const DENSE_CARD_HEIGHT_ESTIMATE = 32;
const CARD_HEIGHT_ESTIMATE = 58;
/** 行の下の間隔の見積もり（px。TrayGroupList.module.css の .space* と同じ値） */
const ROW_SPACE_ESTIMATE: Readonly<Record<RowSpace, { dense: number; card: number }>> = {
  item: { dense: 2, card: 6 },
  header: { dense: 4, card: 4 },
  group: { dense: 6, card: 6 },
  end: { dense: 0, card: 0 },
};
/** 行の下の間隔のクラス */
const ROW_SPACE_CLASS: Readonly<Record<RowSpace, string | undefined>> = {
  item: styles.spaceItem,
  header: styles.spaceHeader,
  group: styles.spaceGroup,
  end: undefined,
};

/** 区切りを 1 列の行に並べる（折りたたんだ区切りは見出しだけ） */
function buildRows(groups: readonly TrayGroup[], folded: ReadonlySet<string>): TrayRow[] {
  const rows: TrayRow[] = [];
  groups.forEach((group, groupIndex) => {
    const open = !folded.has(group.key);
    const groupEnd: RowSpace = groupIndex === groups.length - 1 ? "end" : "group";
    const entries = open ? group.entries : [];
    rows.push({
      kind: "header",
      key: `header:${group.key}`,
      group,
      open,
      space: entries.length > 0 ? "header" : groupEnd,
    });
    entries.forEach((entry, index) => {
      rows.push({
        kind: "ship",
        key: `ship:${entry.ship.uid}`,
        entry,
        groupKey: group.key,
        space: index === entries.length - 1 ? groupEnd : "item",
      });
    });
  });
  return rows;
}

/** 行の高さの見積もり */
function estimateRowSize(row: TrayRow | undefined, dense: boolean): number {
  if (row === undefined) return 0;
  const body =
    row.kind === "header" ? HEADER_HEIGHT_ESTIMATE : dense ? DENSE_CARD_HEIGHT_ESTIMATE : CARD_HEIGHT_ESTIMATE;
  const space = ROW_SPACE_ESTIMATE[row.space];
  return body + (dense ? space.dense : space.card);
}

/** headerIndexes（昇順）のうち、index 以下で一番大きいもの。なければ null */
function lastHeaderAtOrBefore(headerIndexes: readonly number[], index: number): number | null {
  let found: number | null = null;
  for (const headerIndex of headerIndexes) {
    if (headerIndex > index) break;
    found = headerIndex;
  }
  return found;
}

/** 見える範囲の高さを測る。0（測れない）なら、すべての行を描くよう大きな値に置き換える */
function observeListRect(instance: Virtualizer<HTMLElement, HTMLElement>, cb: (rect: { width: number; height: number }) => void) {
  return observeElementRect(instance, (rect) =>
    cb(rect.height > 0 ? rect : { width: rect.width, height: UNMEASURED_VIEWPORT_HEIGHT }),
  );
}

/** 行の高さを測る。0（測れない）なら見積もりのままにする */
function measureRow(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): number {
  const size = measureElement(element, entry, instance);
  return size > 0 ? size : instance.options.estimateSize(instance.indexFromElement(element));
}

type HeaderRow = Extract<TrayRow, { kind: "header" }>;
type ShipRow = Extract<TrayRow, { kind: "ship" }>;

/** DOM に並べるまとまり：見出しの行 1 つか、同じ区切りで続けて描く艦の行（1 つの ul にまとめる） */
type RenderBlock =
  | { readonly kind: "header"; readonly row: HeaderRow; readonly item: VirtualItem }
  | { readonly kind: "ships"; readonly groupKey: string; readonly ships: { row: ShipRow; item: VirtualItem }[] };

/** 描く行（番号の順）を、DOM に並べるまとまりに分ける */
function toBlocks(items: readonly VirtualItem[], rows: readonly TrayRow[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  for (const item of items) {
    const row = rows.at(item.index);
    if (row === undefined) continue;
    if (row.kind === "header") {
      blocks.push({ kind: "header", row, item });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === "ships" && last.groupKey === row.groupKey) {
      last.ships.push({ row, item });
    } else {
      blocks.push({ kind: "ships", groupKey: row.groupKey, ships: [{ row, item }] });
    }
  }
  return blocks;
}

/** クラス名をつなぐ（undefined は飛ばす） */
function joinClasses(...names: (string | undefined)[]): string {
  return names.filter((name) => name !== undefined).join(" ");
}

/** 行の位置（固定する見出しは通常の流れに置いて sticky、ほかは外側の箱の上端からの距離） */
function rowStyle(item: VirtualItem, sticky: boolean): CSSProperties {
  return sticky ? { position: "sticky", top: 0 } : { position: "absolute", top: item.start };
}

/** 控えの艦の一覧 */
export function TrayGroupList({
  groups,
  folded,
  onToggleGroup,
  dense,
  renderCard,
  scrollElement,
}: TrayGroupListProps): ReactNode {
  const rows = useMemo(() => buildRows(groups, folded), [groups, folded]);
  const headerIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.kind === "header" ? [index] : [])),
    [rows],
  );
  // フォーカスしている艦カードの艦と、その行の番号（なければ null）
  const [focusedUid, setFocusedUid] = useState<string | null>(null);
  const focusedIndex = useMemo(() => {
    if (focusedUid === null) return null;
    const index = rows.findIndex((row) => row.kind === "ship" && row.entry.ship.uid === focusedUid);
    return index < 0 ? null : index;
  }, [rows, focusedUid]);
  // 描く範囲の外でも描く行：一番上にかかっている区切りの見出し（その行を sticky にして固定する）と、フォーカスしている艦カード
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const indexes = new Set(defaultRangeExtractor(range));
      const sticky = lastHeaderAtOrBefore(headerIndexes, range.startIndex);
      if (sticky !== null) indexes.add(sticky);
      if (focusedIndex !== null && focusedIndex < range.count) indexes.add(focusedIndex);
      return [...indexes].sort((a, b) => a - b);
    },
    [headerIndexes, focusedIndex],
  );
  // 固定した見出しの行（艦カードの落とす先の cover）。行が替わるたびに付け替える
  const [stickyRow, setStickyRow] = useState<HTMLDivElement | null>(null);

  // useVirtualizer は描き直しのたびに同じインスタンスの中身を変えて返す（React Compiler はこの部品を自動の memo 化から外すという知らせ。
  // このプロジェクトは React Compiler を使っておらず、戻り値を memo した部品にも渡さないので、知らせを止める）
  // eslint-disable-next-line react-hooks/incompatible-library -- 上の理由
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateRowSize(rows.at(index), dense),
    getItemKey: (index) => rows.at(index)?.key ?? index,
    overscan: OVERSCAN,
    paddingEnd: LIST_PADDING_END,
    rangeExtractor,
    measureElement: measureRow,
    observeElementRect: observeListRect,
  });
  const measureRef = virtualizer.measureElement;
  const stickyRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      measureRef(element);
      setStickyRow(element);
    },
    [measureRef],
  );
  const items = virtualizer.getVirtualItems();
  const range = virtualizer.range;
  const stickyIndex = range === null ? null : lastHeaderAtOrBefore(headerIndexes, range.startIndex);

  /** 区切りの見出しを押した：固定して見えている見出しで折りたたむなら、その見出しの位置まで戻してから折りたたむ */
  const toggleGroup = (row: HeaderRow, item: VirtualItem): void => {
    if (row.open && scrollElement !== null && scrollElement.scrollTop > item.start) {
      // jsdom の要素には scrollTo がない
      scrollElement.scrollTo?.({ top: item.start });
    }
    onToggleGroup(row.group.key);
  };

  /** 艦カードにフォーカスが来た：その艦を覚える（区切りの見出しなど、艦カードの外なら忘れる） */
  const handleFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const card = event.target.closest<HTMLElement>("[data-ship-uid]");
    setFocusedUid(card?.dataset.shipUid ?? null);
  };

  /** 一覧の外へフォーカスが出た：覚えた艦を忘れる */
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusedUid(null);
  };

  return (
    <div
      className={dense ? `${styles.rows} ${styles.dense}` : styles.rows}
      style={{ height: virtualizer.getTotalSize() }}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {toBlocks(items, rows).map((block) => {
        if (block.kind === "header") {
          const { row, item } = block;
          const sticky = item.index === stickyIndex;
          return (
            <div
              key={row.key}
              ref={sticky ? stickyRowRef : measureRef}
              data-index={item.index}
              className={joinClasses(styles.row, styles.headerRow, sticky ? styles.stickyRow : undefined, ROW_SPACE_CLASS[row.space])}
              style={rowStyle(item, sticky)}
            >
              <button type="button" className={styles.header} aria-expanded={row.open} onClick={() => toggleGroup(row, item)}>
                <span className={styles.chevron} aria-hidden="true">
                  {row.open ? "▾" : "▸"}
                </span>
                <span className={styles.title}>{row.group.title}</span>
                <span className={styles.count}>{row.group.count}隻</span>
              </button>
            </div>
          );
        }
        return (
          <ul key={`list:${block.groupKey}`} className={styles.list}>
            {block.ships.map(({ row, item }) => (
              <DraggableShipItem
                key={row.entry.ship.uid}
                uid={row.entry.ship.uid}
                clip={scrollElement}
                cover={stickyRow}
                className={joinClasses(styles.row, ROW_SPACE_CLASS[row.space])}
                style={rowStyle(item, false)}
                virtualIndex={item.index}
                measureRef={measureRef}
              >
                {renderCard(row.entry)}
              </DraggableShipItem>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
