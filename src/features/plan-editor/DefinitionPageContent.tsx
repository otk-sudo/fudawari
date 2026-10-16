"use client";

import type { ReactNode } from "react";
import { DefinitionScreen } from "./DefinitionScreen";
import { unconnectedRepository } from "./unconnected-repository";

/**
 * /definition のページの中身。保管庫を選んで DefinitionScreen に渡す
 * （保管庫は関数を持つため、サーバーで描くページ〔page.tsx〕から渡せない。ここで渡す）。
 *
 * PR-11a では、まだ DB に接続していない仮の保管庫を渡す（読み込みに失敗し、理由を出す）。
 * PR-11b で Supabase の保管庫に差し替え、艦船マスタから knownShipNames を渡す。
 */
export function DefinitionPageContent(): ReactNode {
  return <DefinitionScreen repository={unconnectedRepository} />;
}
