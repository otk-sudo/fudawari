// ブラウザ内の保存（IndexedDB。Dexie）の入口
export type {
  FontSize,
  FudawariStorage,
  ImportRecord,
  SaveImportInput,
  Settings,
  TraySort,
  TrayView,
} from "./types";
export type { StorageSchemaVersion } from "./schema";
export { STORAGE_SCHEMA_VERSION, STORAGE_SCHEMA_VERSIONS } from "./schema";
export type { OpenStorageOptions } from "./storage";
export { DEFAULT_STORAGE_NAME, openStorage } from "./storage";
