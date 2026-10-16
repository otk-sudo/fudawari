// 割り当て（計画）の型（要件 4.1）
// 1 個体につき 0 または 1 つの札。どの札にも置いていない個体が「控え」。
import type { ShipUid } from "@/domain/ship/types";

/**
 * 個体 ID → 置いた札の ID。キーがない個体は控え。
 * 控えの個体を読むと undefined なので、値の型は string | undefined（Partial）。
 * 読み取り専用なので、変えるときは新しいオブジェクトを作る
 */
export type AssignmentMap = Readonly<Partial<Record<ShipUid, string>>>;
