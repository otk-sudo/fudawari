import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * 描き直しのたびに最新の値を写した ref を返す（何度描いても同じ ref）。
 * イベント処理・非同期の処理の後で、その時点の最新の値（共有の札割りのデータなど）を読むために使う。
 * 描画の後（useLayoutEffect）に写すので、描画中には読まない
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
