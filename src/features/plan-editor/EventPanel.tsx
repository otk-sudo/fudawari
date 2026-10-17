"use client";

import Link from "next/link";
import { type ReactNode, useId } from "react";
import {
  type EditMode,
  type EditPermissions,
  formatDateTimeJst,
  toDateTimeLocalValue,
} from "@/domain/definition-edit";
import type { DefinitionChange } from "@/domain/merge";
import { ROUTES } from "@/lib/routes";
import { versionLabel, type Workspace } from "./editor-model";
import type { BaseEventOption, EditorMember, EditorUser } from "./types";
import controls from "./controls.module.css";
import styles from "./EventPanel.module.css";

/** イベント名・日時の入力欄 */
export type EventField = "name" | "startAt" | "endAt";

/** イベント名・日時の入力欄の、まだ確定していない値（null は保存済みの値を出す） */
export interface FieldTexts {
  readonly name: string | null;
  readonly startAt: string | null;
  readonly endAt: string | null;
}

/** 「元にするイベント」の選択欄で、イベントを作成した後に出す値（作成した後は選び直せないので、作成済みと出す） */
const CREATED_VALUE = "__created__";

const MODE_CHOICES: ReadonlyArray<readonly [EditMode, string]> = [
  ["update", "既存を更新"],
  ["create", "新規作成"],
];

export type EventPanelProps = {
  user: EditorUser;
  members: readonly EditorMember[];
  mode: EditMode;
  /** 「既存を更新」に切り替えられるか（最新のイベントがあるか） */
  canSwitchToUpdate: boolean;
  onSwitchMode: (mode: EditMode) => void;
  /** イベント名の欄の横に出す状態（「新規」「開催中」「開始前」。なければ null） */
  nameSuffix: string | null;
  /** 最新のイベントの名前（「更新するイベント：」に出す。なければ null） */
  latestName: string | null;
  workspace: Workspace;
  permissions: EditPermissions;
  texts: FieldTexts;
  /** イベント名・日時の検証の文（その場で出す。なければ null） */
  fieldError: string | null;
  onChangeText: (field: EventField, value: string) => void;
  /** 入力欄を確定した（フォーカスを外した・Enter を押した） */
  onCommitText: (field: EventField) => void;
  onClearEnd: () => void;
  /** イベント名・日時の欄と「終了日時を消す」を操作できなくする（保存・公開の途中。新規作成のイベントの作成を含む） */
  metaLocked: boolean;
  baseEventOptions: readonly BaseEventOption[];
  /** 「元にするイベント」を選べるか（イベントを作る前で、作成の途中でもないときだけ） */
  canChooseBase: boolean;
  onChooseBase: (baseEventId: string) => void;
  /** 公開中の版からの変更（未公開の変更） */
  pending: readonly DefinitionChange[];
  /** 文書の問題の文（理由の文を出す） */
  issues: readonly string[];
  saveDisabled: boolean;
  publishDisabled: boolean;
  publishLabel: string;
  onSaveDraft: () => void;
  onPublish: () => void;
};

/** 日時の表示（「2026/08/07 12:00」） */
function dateText(value: string): string {
  return formatDateTimeJst(value);
}

/** 期間の表示（開始日時が未入力なら null） */
function periodText(startAt: string, endAt: string | null): string | null {
  if (startAt === "") return null;
  return `期間：${dateText(startAt)} 〜 ${endAt === null ? "終了日時は未定" : dateText(endAt)}`;
}

type DateFieldProps = {
  label: string;
  /** 必須の欄か */
  required: boolean;
  /** 「必須」「任意」の印（モックでは、既存を更新の開始日時には印を付けない） */
  badge?: "必須" | "任意";
  value: string;
  /** 操作できなくする */
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
};

/** 日時の入力欄（分まで。日本時間） */
function DateField({ label, required, badge, value, disabled, onChange, onCommit }: DateFieldProps): ReactNode {
  const id = useId();
  return (
    <span className={styles.dateField}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
        {badge !== undefined && (
          <>
            {" "}
            <span className={badge === "必須" ? styles.requiredBadge : styles.optionalBadge}>{badge}</span>
          </>
        )}
      </label>
      <input
        id={id}
        type="datetime-local"
        className={controls.input}
        value={value}
        disabled={disabled}
        required={required}
        aria-required={required || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={(event) => {
          // 入力の途中（年月日・時分の一部だけ）なら確定しない
          if (!event.currentTarget.validity.badInput) onCommit();
        }}
      />
    </span>
  );
}

/**
 * 定義画面の上部の欄（要件 3.7「上部の欄」）。
 * 新規か更新かの切り替え、更新するイベント、イベント名・日時、状態の表示（期間・公開中の版・未公開の変更・共有の下書き・
 * 編集できる人）、「下書きを保存」「変更を公開する」（新規作成では「公開して最新にする」）
 */
export function EventPanel(props: EventPanelProps): ReactNode {
  const { user, mode, workspace, permissions, texts } = props;
  const { meta } = workspace;
  const isAdmin = user.role === "admin";
  const isCreate = mode === "create";
  const radioName = useId();
  const baseSelectId = useId();

  const startValue = texts.startAt ?? toDateTimeLocalValue(meta.startAt) ?? "";
  const endValue = texts.endAt ?? toDateTimeLocalValue(meta.endAt) ?? "";
  const nameValue = texts.name ?? meta.name;
  const period = periodText(meta.startAt, meta.endAt);
  const baseName = props.baseEventOptions.find((option) => option.id === workspace.baseEventId)?.name;
  const firstPending = props.pending[0];
  const { draftNote } = workspace;

  return (
    <section className={styles.panel} aria-label="イベントの情報">
      <div className={styles.topRow}>
        {isAdmin && (
          <div role="radiogroup" aria-label="新規か更新か" className={controls.segment}>
            {MODE_CHOICES.map(([value, label]) => (
              <label key={value} className={controls.segmentItem}>
                <input
                  type="radio"
                  name={radioName}
                  value={value}
                  className={controls.segmentInput}
                  checked={mode === value}
                  disabled={value === "update" && !props.canSwitchToUpdate}
                  onChange={() => props.onSwitchMode(value)}
                />
                <span className={controls.segmentLabel}>{label}</span>
              </label>
            ))}
          </div>
        )}

        {!isCreate && props.latestName !== null && (
          <>
            <span className={styles.target}>
              更新するイベント：<b>{props.latestName}（最新）</b>
            </span>
            <span className={styles.hint}>
              {isAdmin
                ? "札割りできるのは最新のイベントだけなので、更新も最新のイベントだけです"
                : "協力者は最新イベントの更新だけができます。新規作成は管理者が行います"}
            </span>
          </>
        )}

        {!isCreate && permissions.canEditEndAt && (
          <>
            <span className={styles.break} aria-hidden="true" />
            {permissions.canEditStartAt ? (
              <DateField
                label="開始日時"
                required
                value={startValue}
                disabled={props.metaLocked}
                onChange={(value) => props.onChangeText("startAt", value)}
                onCommit={() => props.onCommitText("startAt")}
              />
            ) : (
              <span className={styles.readonlyDate}>
                開始日時 <b>{dateText(meta.startAt)}</b>
              </span>
            )}
            <DateField
              label="終了日時"
              required={false}
              badge="任意"
              value={endValue}
              disabled={props.metaLocked}
              onChange={(value) => props.onChangeText("endAt", value)}
              onCommit={() => props.onCommitText("endAt")}
            />
            {meta.endAt !== null && (
              <button type="button" className={controls.ghostButton} disabled={props.metaLocked} onClick={props.onClearEnd}>
                終了日時を消す
              </button>
            )}
            <span className={styles.hint}>終了日時を過ぎると「開催中」でなくなります。延長されたときはここで直せます</span>
          </>
        )}

        {isCreate && (
          <>
            <span className={styles.dateField}>
              <label htmlFor={baseSelectId} className={styles.fieldLabel}>
                元にするイベント
              </label>
              <select
                id={baseSelectId}
                className={controls.input}
                value={
                  workspace.eventId !== null ? CREATED_VALUE : (workspace.loadingBaseEventId ?? workspace.baseEventId)
                }
                disabled={!props.canChooseBase}
                onChange={(event) => props.onChooseBase(event.currentTarget.value)}
              >
                {workspace.eventId !== null && (
                  <option value={CREATED_VALUE}>
                    {baseName === undefined ? "作成済み（変えられません）" : `作成済み（${baseName}を元に作成）`}
                  </option>
                )}
                <option value="">使わない（空から作る）</option>
                {props.baseEventOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </span>
            <span className={styles.hint}>元にすると札と段階をコピーして始めます（特効は空）</span>
            <span className={styles.break} aria-hidden="true" />
            <DateField
              label="開始日時"
              required
              badge="必須"
              value={startValue}
              disabled={props.metaLocked}
              onChange={(value) => props.onChangeText("startAt", value)}
              onCommit={() => props.onCommitText("startAt")}
            />
            <DateField
              label="終了日時"
              required={false}
              badge="任意"
              value={endValue}
              disabled={props.metaLocked}
              onChange={(value) => props.onChangeText("endAt", value)}
              onCommit={() => props.onCommitText("endAt")}
            />
            <span className={styles.hint}>終了日時は未定なら空欄で構いません（あとから入れられます）</span>
          </>
        )}

        {props.fieldError !== null && (
          <p role="alert" className={styles.fieldError}>
            {props.fieldError}
          </p>
        )}
      </div>

      <div className={styles.info}>
        {permissions.canEditName ? (
          <span className={styles.nameRow}>
            <span className={styles.fieldLabel}>
              イベント名{isCreate && <span className={styles.requiredBadge}>必須</span>}
            </span>
            <input
              type="text"
              aria-label="イベント名"
              className={`${controls.input} ${styles.nameInput}`}
              placeholder="例：2026秋イベ"
              value={nameValue}
              disabled={props.metaLocked}
              onChange={(event) => props.onChangeText("name", event.currentTarget.value)}
              onBlur={() => props.onCommitText("name")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) props.onCommitText("name");
              }}
            />
            {props.nameSuffix !== null && <span className={styles.nameSuffix}>{props.nameSuffix}</span>}
          </span>
        ) : (
          <span className={styles.eventTitle}>{meta.name}</span>
        )}
        {period !== null && <span className={styles.line}>{period}</span>}
        <span className={styles.line}>
          {workspace.published === null
            ? `まだ公開していません${isCreate && baseName !== undefined ? `（${baseName}を元に作成）` : ""}`
            : `公開中：${versionLabel(workspace.published.versionDate)}`}
          {firstPending !== undefined && (
            <span>
              {" ／ "}
              <span className={styles.pending}>未公開の変更 {props.pending.length} 件</span>（{firstPending.text}
              {props.pending.length > 1 ? " ほか" : ""}）
            </span>
          )}
        </span>
        <span className={styles.line}>
          共有の下書き：
          {draftNote === null
            ? "まだ保存していません"
            : `${dateText(draftNote.updatedAt)} に${draftNote.updatedByName}が保存`}
          （保存すると管理者・協力者全員の定義画面に反映されます。一般の画面には公開するまで出ません）
        </span>
        <span className={styles.line}>
          編集できる人：{props.members.map((member) => member.displayName).join("・")}
          {isAdmin && (
            <>
              {"　"}
              <Link href={ROUTES.collaborators} className={styles.link}>
                協力者を管理
              </Link>
            </>
          )}
        </span>
      </div>

      {permissions.canEditContent && (
        <div className={styles.actions}>
          <button type="button" className={controls.secondaryButton} disabled={props.saveDisabled} onClick={props.onSaveDraft}>
            下書きを保存
          </button>
          <button type="button" className={controls.primaryButton} disabled={props.publishDisabled} onClick={props.onPublish}>
            {props.publishLabel}
          </button>
        </div>
      )}

      {props.issues.length > 0 && (
        <ul className={styles.issues}>
          {props.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
