import type { Metadata } from "next";
import Link from "next/link";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ROUTES } from "@/lib/routes";
import styles from "./not-found.module.css";

const TITLE = "ページが見つかりません";

export const metadata: Metadata = { title: TITLE };

// 存在しない URL の画面（PR-14。静的書き出しでは 404.html になる）。Next.js の既定の英語の画面の代わりに、
// 日本語の見出しとホームへのリンクを出す。左メニュー（共通の枠）の中に出すので、ほかの画面と同じヘッダー帯を使う
export default function NotFound() {
  return (
    <>
      <ScreenHeader title={TITLE} />
      <div className={styles.body}>
        <p className={styles.text}>お探しのページはありません。URL が正しいか確かめてください。</p>
        <Link href={ROUTES.home} className={styles.action}>
          ホームへ戻る
        </Link>
      </div>
    </>
  );
}
