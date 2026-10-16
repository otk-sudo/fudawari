// ブラウザ内の保存（IndexedDB。Dexie）
//
// 一般利用者の艦娘データ・割り当て・設定は、このブラウザの中だけに保存し、サーバーには送らない（要件 5 章）。
// 割り当ての計算（定義から消えた札を控えに戻すなど）は src/domain/ の純粋な関数で行い、ここは読み書きだけにする。
import Dexie from "dexie";
import type { ImportFilter } from "@/domain/import/types";
import { returnOrphanedAssignments as returnOrphaned } from "@/domain/plan/orphan";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import { DEFAULT_THEME_MODE, type ThemeMode } from "@/features/theme";
import { STORAGE_SCHEMA_VERSIONS, STORAGE_TABLES, type StorageSchemaVersion } from "./schema";
import type { FontSize, FudawariStorage, ImportRecord, Settings, TraySort, TrayView } from "./types";

/** 既定の DB 名 */
export const DEFAULT_STORAGE_NAME = "fudawari";

/** openStorage の引数 */
export interface OpenStorageOptions {
  /** DB 名（省略すると DEFAULT_STORAGE_NAME。テストではテストごとに別の名前を使う） */
  name?: string;
  /** 保存の形の版の一覧（省略すると STORAGE_SCHEMA_VERSIONS。移行のテストで、新しい版を足した一覧を渡す） */
  versions?: readonly StorageSchemaVersion[];
}

// ---- テーブルの行の形（版 1） ----

/** 最終取り込みの行の主キー（行は 1 つだけ） */
const LAST_IMPORT_ID = "last";

/** 設定の行の主キー（行は 1 つだけ） */
const SETTINGS_ID = "settings";

interface ImportRecordRow extends ImportRecord {
  id: typeof LAST_IMPORT_ID;
}

interface AssignmentRow {
  eventId: string;
  /** 個体 ID → 札 ID（控えの個体のキーは持たない） */
  assignments: Record<ShipUid, string>;
}

interface SettingsRow {
  id: typeof SETTINGS_ID;
  /** 保存した項目だけ（ない項目は読むときに初期値で補う） */
  values: Partial<Settings>;
}

// ---- 設定の初期値と、読んだ値の確かめ ----

/** 設定の初期値（モック SettingsDialog.dc.html どおり：ダーク・標準・一行・艦型） */
const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  themeMode: DEFAULT_THEME_MODE,
  fontSize: "mid",
  trayView: "dense",
  traySort: "class",
});

// 型の値をすべて並べる（型に値が増えたら、ここが型の誤りになって気付ける）
const THEME_MODES: Readonly<Record<ThemeMode, true>> = { dark: true, light: true, system: true };
const FONT_SIZES: Readonly<Record<FontSize, true>> = { small: true, mid: true, large: true };
const TRAY_VIEWS: Readonly<Record<TrayView, true>> = { dense: true, card: true };
const TRAY_SORTS: Readonly<Record<TraySort, true>> = { class: true, lv: true, boost: true, name: true };

/** 値が、並べた値のどれかか */
function isOneOf<K extends string>(value: unknown, options: Readonly<Record<K, true>>): value is K {
  return typeof value === "string" && Object.hasOwn(options, value);
}

/** 値がオブジェクト（null・配列を除く）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 設定の一部のうち、正しい値の項目だけを取り出す（知らない値・undefined の項目は捨てる） */
function validSettings(value: unknown): Partial<Settings> {
  const result: Partial<Settings> = {};
  if (!isRecord(value)) return result;
  if (isOneOf(value.themeMode, THEME_MODES)) result.themeMode = value.themeMode;
  if (isOneOf(value.fontSize, FONT_SIZES)) result.fontSize = value.fontSize;
  if (isOneOf(value.trayView, TRAY_VIEWS)) result.trayView = value.trayView;
  if (isOneOf(value.traySort, TRAY_SORTS)) result.traySort = value.traySort;
  return result;
}

// ---- 割り当て ----

/** 割り当てのうち、札 ID が文字列のものだけを写した新しいオブジェクト（控え〔undefined〕のキーは入れない） */
function copyAssignments(assignments: AssignmentMap | undefined): Record<ShipUid, string> {
  const result: Record<ShipUid, string> = {};
  if (assignments === undefined) return result;
  for (const [uid, fudaId] of Object.entries(assignments)) {
    if (typeof fudaId === "string") result[uid] = fudaId;
  }
  return result;
}

/** 割り当てから、残す個体の一覧にない個体を外す。外した個体がなければ null */
function keepOnlyShips(
  assignments: AssignmentMap,
  uids: ReadonlySet<ShipUid>,
): Record<ShipUid, string> | null {
  const kept: Record<ShipUid, string> = {};
  let removed = false;
  for (const [uid, fudaId] of Object.entries(assignments)) {
    if (typeof fudaId !== "string") continue;
    if (uids.has(uid)) kept[uid] = fudaId;
    else removed = true;
  }
  return removed ? kept : null;
}

// ---- 個体 ----

/** 個体の項目だけを写す（ほかの項目を DB に入れない） */
function copyShip(ship: OwnedShip): OwnedShip {
  return { uid: ship.uid, shipId: ship.shipId, level: ship.level, luck: ship.luck, sallyArea: ship.sallyArea };
}

/** 同じ個体 ID の個体を除く（先の個体を残す） */
function uniqueShips(ships: readonly OwnedShip[]): OwnedShip[] {
  const byUid = new Map<ShipUid, OwnedShip>();
  for (const ship of ships) {
    if (!byUid.has(ship.uid)) byUid.set(ship.uid, copyShip(ship));
  }
  return [...byUid.values()];
}

function copyFilter(filter: ImportFilter): ImportFilter {
  return { lockedOnly: filter.lockedOnly, minLevel: filter.minLevel };
}

/** ブラウザ内の保存を開く（DB への接続は最初の読み書きのときに行う） */
export function openStorage(options: OpenStorageOptions = {}): FudawariStorage {
  const db = new Dexie(options.name ?? DEFAULT_STORAGE_NAME);
  for (const schema of options.versions ?? STORAGE_SCHEMA_VERSIONS) {
    const version = db.version(schema.version).stores(schema.stores);
    if (schema.upgrade !== undefined) version.upgrade(schema.upgrade);
  }

  const ships = db.table<OwnedShip, ShipUid>(STORAGE_TABLES.ships);
  const importRecords = db.table<ImportRecordRow, string>(STORAGE_TABLES.importRecords);
  const assignments = db.table<AssignmentRow, string>(STORAGE_TABLES.assignments);
  const settings = db.table<SettingsRow, string>(STORAGE_TABLES.settings);

  async function readSettingsValues(): Promise<Partial<Settings>> {
    const row = await settings.get(SETTINGS_ID);
    return validSettings(row?.values);
  }

  return {
    async saveImport(input) {
      const newShips = uniqueShips(input.ships);
      const keepUids = new Set(newShips.map((ship) => ship.uid));
      await db.transaction("rw", [ships, importRecords, assignments], async () => {
        await ships.clear();
        await ships.bulkPut(newShips);
        await importRecords.put({
          id: LAST_IMPORT_ID,
          importedAt: input.importedAt,
          filter: copyFilter(input.filter),
          shipCount: newShips.length,
          hasUid: input.hasUid,
        });

        if (!input.hasUid) {
          // 個体 ID がない古い形式：どの個体が同じ艦か分からないため、すべてのイベントの割り当てを消す（U9）
          await assignments.clear();
          return;
        }
        // 個体 ID がある形式：今回の取り込みにいない個体の割り当てを、すべてのイベントで外す
        const changed: AssignmentRow[] = [];
        for (const row of await assignments.toArray()) {
          const kept = keepOnlyShips(row.assignments, keepUids);
          if (kept !== null) changed.push({ eventId: row.eventId, assignments: kept });
        }
        if (changed.length > 0) await assignments.bulkPut(changed);
      });
    },

    async loadShips() {
      return ships.toArray();
    },

    async loadLastImport() {
      const row = await importRecords.get(LAST_IMPORT_ID);
      if (row === undefined) return null;
      return {
        importedAt: row.importedAt,
        filter: copyFilter(row.filter),
        shipCount: row.shipCount,
        hasUid: row.hasUid,
      };
    },

    async clearImportedShips() {
      await db.transaction("rw", [ships, importRecords], async () => {
        await ships.clear();
        await importRecords.clear();
      });
    },

    async loadAssignments(eventId) {
      const row = await assignments.get(eventId);
      return copyAssignments(row?.assignments);
    },

    async saveAssignments(eventId, map) {
      await assignments.put({ eventId, assignments: copyAssignments(map) });
    },

    async returnOrphanedAssignments(eventId, fudaIds) {
      return db.transaction("rw", assignments, async () => {
        const row = await assignments.get(eventId);
        const result = returnOrphaned(copyAssignments(row?.assignments), fudaIds);
        if (result.returnedCount > 0) {
          await assignments.put({ eventId, assignments: copyAssignments(result.assignments) });
        }
        return result;
      });
    },

    async loadSettings() {
      return { ...DEFAULT_SETTINGS, ...(await readSettingsValues()) };
    },

    async saveSettings(patch) {
      return db.transaction("rw", settings, async () => {
        const values = { ...(await readSettingsValues()), ...validSettings(patch) };
        await settings.put({ id: SETTINGS_ID, values });
        return { ...DEFAULT_SETTINGS, ...values };
      });
    },

    close() {
      db.close();
    },
  };
}
