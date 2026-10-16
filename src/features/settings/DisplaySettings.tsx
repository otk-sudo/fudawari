"use client";

// 設定のウィンドウの「表示」（要件 3.6、U13、モック SettingsDialog.dc.html）
//
// - 画面モード・文字の大きさ・控えの表示・控えの並び順を、このブラウザに保存した設定（getPlanStorage().loadSettings()）から出し、
//   選ぶと getPlanStorage().saveSettings() で保存する（保存は選んだ項目だけ。ほかの設定は変えない）
// - 画面モードと文字の大きさは、選んだらすぐ画面に反映する（保存を待たない。chooseThemeMode・chooseFontSize）
// - 艦娘のバナー画像の項目は出さない（U13：ゲームの画像は配信しない）
// - 保存した設定を読み終えるまでは選べない（読み終えた値で、読む前に選んだ値を上書きしないように）
import { type ReactNode, useEffect, useId, useState } from "react";
import { DEFAULT_THEME_MODE, type ThemeMode, useThemeMode } from "@/features/theme";
import { getPlanStorage } from "@/lib/plan";
import type { FontSize, Settings, TraySort, TrayView } from "@/lib/storage";
import { chooseFontSize, chooseThemeMode, currentFontSize } from "./display-store";
import { SETTINGS_SAVE_FAILED_MESSAGE } from "./settings-text";
import { useLatestRef } from "./useLatestRef";
import styles from "./SettingsContent.module.css";

/** 選択肢 1 つ（保存する値と画面の名前） */
interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

const THEME_OPTIONS: readonly Option<ThemeMode>[] = [
  { value: "dark", label: "ダーク" },
  { value: "light", label: "ライト" },
  { value: "system", label: "端末に合わせる" },
];

const FONT_SIZE_OPTIONS: readonly Option<FontSize>[] = [
  { value: "small", label: "小" },
  { value: "mid", label: "標準" },
  { value: "large", label: "大" },
];

const TRAY_VIEW_OPTIONS: readonly Option<TrayView>[] = [
  { value: "dense", label: "一行" },
  { value: "card", label: "カード" },
];

const TRAY_SORT_OPTIONS: readonly Option<TraySort>[] = [
  { value: "class", label: "艦型" },
  { value: "lv", label: "Lv" },
  { value: "boost", label: "特効の強さ" },
  { value: "name", label: "名前" },
];

/** 保存した設定を読めなかったときに出す値（設定の初期値。画面モード・文字の大きさは今の画面のもの） */
const FALLBACK_SETTINGS: Readonly<Settings> = {
  themeMode: DEFAULT_THEME_MODE,
  fontSize: "mid",
  trayView: "dense",
  traySort: "class",
};

/** 設定のウィンドウの「表示」 */
export function DisplaySettings(): ReactNode {
  /** 保存した設定（読み終えるまでは null） */
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const liveThemeMode = useLatestRef(useThemeMode());
  const headingId = useId();

  useEffect(() => {
    let active = true;
    getPlanStorage()
      .loadSettings()
      .then(
        (loaded) => {
          if (active) setSettings(loaded);
        },
        () => {
          // 読めなくても選べるようにする（保存できなければ、選んだときに知らせる）
          if (!active) return;
          setSettings({
            ...FALLBACK_SETTINGS,
            themeMode: liveThemeMode.current,
            fontSize: currentFontSize() ?? FALLBACK_SETTINGS.fontSize,
          });
        },
      );
    return () => {
      active = false;
    };
  }, [liveThemeMode]);

  /** 選んだ項目を画面の選択に出して保存する */
  function save(patch: Partial<Settings>): void {
    setSettings((prev) => (prev === null ? prev : { ...prev, ...patch }));
    getPlanStorage()
      .saveSettings(patch)
      .then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        表示
      </h2>
      <SegmentedRow
        title="画面モード"
        note="明るい場所ではライトが見やすくなります"
        options={THEME_OPTIONS}
        value={settings?.themeMode ?? null}
        onChange={(themeMode) => {
          chooseThemeMode(themeMode);
          save({ themeMode });
        }}
      />
      <SegmentedRow
        title="文字の大きさ"
        note="一覧・割り振り画面の文字の大きさ"
        options={FONT_SIZE_OPTIONS}
        value={settings?.fontSize ?? null}
        onChange={(fontSize) => {
          chooseFontSize(fontSize);
          save({ fontSize });
        }}
      />
      <SegmentedRow
        title="控えの表示"
        note="割り振り画面の控えを開いたときの表示"
        options={TRAY_VIEW_OPTIONS}
        value={settings?.trayView ?? null}
        onChange={(trayView) => save({ trayView })}
      />
      <SegmentedRow
        title="控えの並び順"
        note="割り振り画面を開いたときの並び順"
        options={TRAY_SORT_OPTIONS}
        value={settings?.traySort ?? null}
        onChange={(traySort) => save({ traySort })}
      />
      {saveFailed && (
        <p role="alert" className={styles.rowAlert}>
          {SETTINGS_SAVE_FAILED_MESSAGE}
        </p>
      )}
    </section>
  );
}

type SegmentedRowProps<T extends string> = {
  /** 項目名（radiogroup の名前） */
  title: string;
  /** 項目の説明 */
  note: string;
  /** 選択肢（画面の順） */
  options: readonly Option<T>[];
  /** 選ばれている値。保存した設定を読み終えるまでは null（どれも選ばず、選べない） */
  value: T | null;
  /** 選んだとき */
  onChange: (value: T) => void;
};

/**
 * 表示の設定の 1 行（項目名・説明と、横に並べた選択肢。モックの区切りのボタンの見た目）。
 * 選択肢は <input type="radio">（矢印キーで選び直せる）を見えなくして、名前の部分をボタンの形に見せる
 */
function SegmentedRow<T extends string>({ title, note, options, value, onChange }: SegmentedRowProps<T>): ReactNode {
  const titleId = useId();
  const noteId = useId();
  const name = useId();
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span id={titleId} className={styles.rowTitle}>
          {title}
        </span>
        <span id={noteId} className={styles.rowNote}>
          {note}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} aria-describedby={noteId} className={styles.segmented}>
        {options.map((option) => (
          <label key={option.value} className={styles.segment}>
            <input
              type="radio"
              className={styles.segmentInput}
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={value === null}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.segmentLabel}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
