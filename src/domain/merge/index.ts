// 3 方向マージと保存の記録の文（roadmap T3-8 の単体部分）の入口
export type {
  AutoMergedChange,
  BoostGroupField,
  ChangeKind,
  ChangeLocation,
  ConflictChoice,
  ConflictChoices,
  DefinitionChange,
  EventField,
  FudaField,
  MergeConflict,
  MergeInput,
  MergeResult,
  ResolveResult,
  SaveSummary,
  StageField,
} from "./types";
export { describeChanges, summarizeSave } from "./changes";
export { mergeDefinitions, resolveMerge } from "./merge";
