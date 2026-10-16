import type { ReactNode } from "react";

// 線で描くアイコンの形（モック SideNav.dc.html・Home.dc.html の SVG の path と同じ）
const ICON_PATHS = {
  board: "M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z",
  assign: "M4 7h9M4 12h6M4 17h9M15 9l5 5-5 5",
  import: "M12 3v12M7 10l5 5 5-5M4 20h16",
  diff: "M7 4v16M17 4v16M3 8h8M13 16h8",
  gear: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3",
  plan: "M5 3h10l4 4v14H5zM9 12h6M9 16h6",
  users:
    "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 4 2 4 5",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export type LineIconProps = {
  name: IconName;
  /** 縦横の大きさ（px） */
  size: number;
  className?: string;
};

/**
 * 線で描くアイコン。色は文字の色（currentColor）に従う。
 * 飾りなので支援技術からは隠す（名前は隣の文字や aria-label で付ける）。
 */
export function LineIcon({ name, size, className }: LineIconProps): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
