"use client";

import { type ReactNode, useState } from "react";
import { DefinitionScreen } from "./DefinitionScreen";
import { createLazySupabaseDefinitionRepository } from "./lazy-repository";

/**
 * /definition のページの中身。Supabase の保管庫を作って DefinitionScreen に渡す
 * （保管庫は関数を持つため、サーバーで描くページ〔page.tsx〕から渡せない。ここで作る）。
 * - 保管庫は supabase-js を、管理者・協力者が開いて読み込むときに初めて読み込む（lazy-repository.ts）
 * - 艦船マスタを読み、知らない艦名の警告に使う（読めなければ警告しない）
 */
export function DefinitionPageContent(): ReactNode {
  // 描き直しのたびに作り直さない（作り直すと読み込み直し、編集画面を作り直してしまう）
  const [repository] = useState(createLazySupabaseDefinitionRepository);
  return <DefinitionScreen repository={repository} withShipMaster />;
}
