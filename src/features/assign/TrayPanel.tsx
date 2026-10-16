"use client";

// 控え（割り当てていない艦。要件 3.3「控え」、モック Assign.dc.html の <section aria-label="控えの艦">）
//
// - 見出し「控え」、「表示数 / 控えの総数隻」、表示の詰め具合（一行／カード）
// - 検索欄（図鑑 ID・名称）、「絞り込み」（改造状態・特効・特効が効く札。条件の数のバッジ）、「リセット」、並び順、艦種タブ
// - 「特効を表示中：n隻」の帯と「すべて閉じる」（特効を開いている艦があるときだけ）
// - 区切りの見出しと艦カードの一覧（TrayGroupList）。条件に合う艦がいなければ「条件に合う艦はいません」
//
// 絞り込み・並び順・表示の条件と、絞り込みの開閉・区切りの折りたたみはこの部品の中で持つ（画面を移ると初めに戻る）。
// 控えの組み立て（絞り込み・並べ替え・区切り）は buildTray（tray.ts）が行う。
// 控えへのドロップ（PR-06）は、この部品の <section> に dnd-kit の useDroppable を付ける想定。
import { type KeyboardEvent, type ReactNode, useId, useMemo, useState } from "react";
import type { PublicDefinition } from "@/domain/definition/types";
import type { RemodelStage, ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { TraySort, TrayView } from "@/lib/storage";
import {
  buildTray,
  countActiveFilters,
  createInitialTrayOptions,
  resetTrayOptions,
  SHIP_TYPE_TABS,
  type ShipTypeTabId,
  type TrayEntry,
  type TrayOptions,
  type TrayOptionsInit,
} from "./tray";
import { TrayGroupList } from "./TrayGroupList";
import styles from "./TrayPanel.module.css";

/** 改造状態のチェックボックス（並べる順） */
const REMODEL_STAGE_OPTIONS: readonly { readonly stage: RemodelStage; readonly label: string }[] = [
  { stage: "unremodeled", label: "未改造" },
  { stage: "intermediate", label: "中間改造" },
  { stage: "final", label: "最終改造" },
];

/** 並び順のプルダウン（並べる順） */
const SORT_OPTIONS: readonly { readonly value: TraySort; readonly label: string }[] = [
  { value: "class", label: "艦型" },
  { value: "lv", label: "Lv" },
  { value: "boost", label: "特効の強さ" },
  { value: "name", label: "名前" },
];

/** 表示の詰め具合のボタン（並べる順） */
const VIEW_OPTIONS: readonly { readonly value: TrayView; readonly label: string }[] = [
  { value: "dense", label: "一行" },
  { value: "card", label: "カード" },
];

export interface TrayPanelProps {
  /** 最新イベントの公開定義（特効・「特効が効く札」の札） */
  definition: PublicDefinition;
  /** 艦船マスタ */
  master: ShipMaster;
  /** 取り込んだ艦の個体 */
  ships: readonly OwnedShip[];
  /** 今の割り当て（割り当てのない艦が控え） */
  assignments: AssignmentMap;
  /** 並び順・表示の初期値（設定の traySort・trayView） */
  trayInit?: TrayOptionsInit;
  /** 特効を開いている艦の数（「特効を表示中：n隻」。0 なら帯を出さない） */
  openCount: number;
  /** 「すべて閉じる」を押したとき */
  onCloseAll: () => void;
  /** 控えの艦のカードを描く（dense：一行表示か） */
  renderCard: (entry: TrayEntry, dense: boolean) => ReactNode;
}

/** 控え */
export function TrayPanel({
  definition,
  master,
  ships,
  assignments,
  trayInit,
  openCount,
  onCloseAll,
  renderCard,
}: TrayPanelProps): ReactNode {
  const [options, setOptions] = useState<TrayOptions>(() => createInitialTrayOptions(trayInit));
  const [filterOpen, setFilterOpen] = useState(false);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const tabIdPrefix = useId();
  const listId = useId();
  const filterId = useId();

  const tray = useMemo(
    () => buildTray({ definition, master, ships, assignments, options }),
    [definition, master, ships, assignments, options],
  );
  const filterCount = countActiveFilters(options);
  const dense = options.view === "dense";
  const tabIdOf = (tab: ShipTypeTabId): string => `${tabIdPrefix}-${tab}`;

  /** 条件の一部を変える */
  const update = (patch: Partial<TrayOptions>): void => setOptions((current) => ({ ...current, ...patch }));

  const toggleGroup = (key: string): void =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const toggleFuda = (fudaId: string): void =>
    setOptions((current) => ({
      ...current,
      fudaIds: current.fudaIds.includes(fudaId)
        ? current.fudaIds.filter((id) => id !== fudaId)
        : [...current.fudaIds, fudaId],
    }));

  /** 艦種タブの矢印キー・Home・End（選んだタブを移し、そのタブに焦点を移す） */
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = SHIP_TYPE_TABS.findIndex((tab) => tab.id === options.tab);
    const last = SHIP_TYPE_TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (current + 1) % SHIP_TYPE_TABS.length
        : event.key === "ArrowLeft"
          ? (current - 1 + SHIP_TYPE_TABS.length) % SHIP_TYPE_TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    update({ tab: SHIP_TYPE_TABS[next].id });
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <section aria-label="控えの艦" className={styles.tray}>
      <div className={styles.controls}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>控え</h2>
          <span className={styles.titleSide}>
            <span className={styles.count}>
              {tray.shownCount} / {tray.totalCount}隻
            </span>
            <span role="group" aria-label="表示の詰め具合" className={styles.viewToggle}>
              {VIEW_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={styles.viewButton}
                  aria-pressed={options.view === value}
                  onClick={() => update({ view: value })}
                >
                  {label}
                </button>
              ))}
            </span>
          </span>
        </div>

        <div className={styles.search}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            type="search"
            className={styles.searchInput}
            aria-label="図鑑ID・名称で検索"
            placeholder="図鑑ID 名称検索"
            value={options.query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>

        <div className={styles.toolRow}>
          <button
            type="button"
            className={styles.filterButton}
            aria-expanded={filterOpen}
            aria-controls={filterOpen ? filterId : undefined}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 4h18l-7 8v6l-4 2v-8z" />
            </svg>
            絞り込み
            {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
          </button>
          <button type="button" className={styles.resetButton} onClick={() => setOptions(resetTrayOptions)}>
            リセット
          </button>
          <span className={styles.spacer} />
          <label className={styles.sort}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 6h10M4 12h7M4 18h4M17 4v16M14 17l3 3 3-3" />
            </svg>
            <select
              className={styles.sortSelect}
              aria-label="並び順"
              value={options.sort}
              onChange={(event) => {
                const picked = SORT_OPTIONS.find(({ value }) => value === event.target.value);
                if (picked !== undefined) update({ sort: picked.value });
              }}
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filterOpen && (
          <div id={filterId} className={styles.filters}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>改造状態</legend>
              <div className={styles.checks}>
                {REMODEL_STAGE_OPTIONS.map(({ stage, label }) => (
                  <label key={stage} className={styles.check}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={options.remodelStages[stage]}
                      onChange={() =>
                        update({ remodelStages: { ...options.remodelStages, [stage]: !options.remodelStages[stage] } })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>特効</legend>
              <div className={styles.checks}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={options.boostOnly}
                    onChange={() => update({ boostOnly: !options.boostOnly })}
                  />
                  特効のある艦だけ
                </label>
              </div>
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>特効が効く札</legend>
              <div className={styles.checks}>
                {definition.fudas.map((fuda) => (
                  <label key={fuda.id} className={styles.check}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={options.fudaIds.includes(fuda.id)}
                      onChange={() => toggleFuda(fuda.id)}
                    />
                    {fuda.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div role="tablist" aria-label="艦種" className={styles.tabs} onKeyDown={handleTabKeyDown}>
          {SHIP_TYPE_TABS.map((tab) => {
            const selected = tab.id === options.tab;
            return (
              <button
                key={tab.id}
                id={tabIdOf(tab.id)}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={selected}
                aria-controls={listId}
                tabIndex={selected ? 0 : -1}
                onClick={() => update({ tab: tab.id })}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {openCount > 0 && (
        <div className={styles.band}>
          <span className={styles.bandText}>特効を表示中：{openCount}隻</span>
          <button type="button" className={styles.closeAll} onClick={onCloseAll}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
            すべて閉じる
          </button>
        </div>
      )}

      <div id={listId} role="tabpanel" aria-labelledby={tabIdOf(options.tab)} className={styles.list}>
        <TrayGroupList
          groups={tray.groups}
          folded={folded}
          onToggleGroup={toggleGroup}
          dense={dense}
          renderCard={(entry) => renderCard(entry, dense)}
        />
        {tray.shownCount === 0 && <p className={styles.empty}>条件に合う艦はいません</p>}
      </div>
    </section>
  );
}
