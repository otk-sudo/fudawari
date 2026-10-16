// 割り当て（計画）の型（要件 4.1）
// 1 個体につき 0 または 1 つの札。どの札にも置いていない個体が「控え」。
import type { ShipUid } from "@/domain/ship/types";

/** 個体 ID → 置いた札の ID。キーがない個体は控え */
export type AssignmentMap = Readonly<Record<ShipUid, string>>;
