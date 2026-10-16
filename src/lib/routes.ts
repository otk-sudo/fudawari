// 画面の経路（URL のパス）を 1 か所にまとめる。左メニュー・ホームのタイル・共通の枠から使う

/** 各画面のパス */
export const ROUTES = {
  home: "/",
  list: "/list",
  assign: "/assign",
  import: "/import",
  drift: "/drift",
  definition: "/definition",
  collaborators: "/collaborators",
  login: "/login",
  invite: "/invite",
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];

/** 左メニューを出さない単独の画面（ログイン、招待。招待は /invite/（コード）でも開く） */
const STANDALONE_ROUTES: readonly Route[] = [ROUTES.login, ROUTES.invite];

// path が route そのもの、または route の下の階層かを返す（"/list" は "/list" と "/list/..." に当たり、"/listing" には当たらない）
function isSameOrBelow(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

/**
 * 今いる画面（currentPath）が、メニューの項目（href）に当たるかを返す。
 * ホーム（"/"）は "/" のときだけ当たる。
 */
export function isCurrentRoute(currentPath: string, href: Route): boolean {
  if (href === ROUTES.home) return currentPath === ROUTES.home;
  return isSameOrBelow(currentPath, href);
}

/** 左メニューを出さない単独の画面かを返す */
export function isStandalonePath(path: string): boolean {
  return STANDALONE_ROUTES.some((route) => isSameOrBelow(path, route));
}
