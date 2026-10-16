// 定義の編集（roadmap T3-6）の入口
export type {
  AddBoostGroupInput,
  AddFudaInput,
  AddStageInput,
  BoostGroupPatch,
  CreateDefinitionInput,
  DefinitionDoc,
  EditError,
  EditErrorCode,
  EditMode,
  EditPermissions,
  EditPermissionsInput,
  EditResult,
  EventInfoError,
  EventInfoErrorCode,
  EventInfoField,
  EventInfoInput,
  EventPatch,
  FudaPatch,
  ProtectedEventField,
  Role,
  StagePatch,
  StagePosition,
  UpdatePermissionInput,
  UpdatePermissionResult,
} from "./types";
export { addArea, canRemoveArea, removeArea } from "./areas";
export {
  addBoostGroup,
  addShipNames,
  deleteBoostGroup,
  parseShipNameList,
  removeShipName,
  updateBoostGroup,
} from "./boosts";
export { createDefinition } from "./create";
export { isEventEnded, updateEvent, validateEventInfo } from "./event";
export { addFuda, canDeleteFuda, deleteFuda, FUDA_COLOR_CHOICES, moveFuda, updateFuda } from "./fudas";
export { checkUpdatePermission, editPermissions } from "./permissions";
export { addStage, canDeleteStage, deleteStage, moveStage, updateStage } from "./stages";
