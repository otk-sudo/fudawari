// 設定のウィンドウを開く・閉じるの入口。左メニューの「設定」とホームの「設定」タイルの両方から使う。
// ウィンドウ（SettingsDialog）はレイアウトに 1 つだけ置き、この開閉の状態に従って表示する

/**
 * 設定のウィンドウを開く。画面は移動しない。
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何もしない
 */
export function openSettingsDialog(): void {}

/**
 * 設定のウィンドウを閉じる。
 *
 * TODO(PR-03 実装)：空の入れ物。いまは何もしない
 */
export function closeSettingsDialog(): void {}

/**
 * 設定のウィンドウが開いているかを返す。開閉が変わると、使っている部品は描き直される。
 *
 * TODO(PR-03 実装)：空の入れ物。いまは常に閉じている（false）
 */
export function useSettingsDialogOpen(): boolean {
  return false;
}
