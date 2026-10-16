// 設定のウィンドウを開く・閉じるの入口。左メニューの「設定」とホームの「設定」タイルの両方から使う。
// ウィンドウ（SettingsDialog）はレイアウトに 1 つだけ置き、この開閉の状態に従って表示する
import { create } from "zustand";

type SettingsDialogState = { open: boolean };

const useSettingsDialogStore = create<SettingsDialogState>(() => ({
  open: false,
}));

/**
 * 設定のウィンドウを開く。画面は移動しない。
 */
export function openSettingsDialog(): void {
  useSettingsDialogStore.setState({ open: true });
}

/**
 * 設定のウィンドウを閉じる。
 */
export function closeSettingsDialog(): void {
  useSettingsDialogStore.setState({ open: false });
}

/**
 * 設定のウィンドウが開いているかを返す。開閉が変わると、使っている部品は描き直される。
 */
export function useSettingsDialogOpen(): boolean {
  return useSettingsDialogStore((state) => state.open);
}
