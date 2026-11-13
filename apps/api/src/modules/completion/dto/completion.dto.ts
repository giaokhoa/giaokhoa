import {
  markCourseCriteriaCompletionSchema,
  markCourseSelfCompletionSchema,
  markManualCompletionSchema,
  setCompletionCriteriaSchema,
  type MarkCourseCriteriaCompletion,
  type MarkCourseSelfCompletion,
  type MarkManualCompletion,
  type SetCompletionCriteria,
} from '@giaokhoa/contracts';

export { markCourseCriteriaCompletionSchema, markCourseSelfCompletionSchema, markManualCompletionSchema, setCompletionCriteriaSchema };
export type SetCriteriaDto = SetCompletionCriteria;
export type MarkManualDto = MarkManualCompletion;
export type MarkSelfDto = MarkCourseSelfCompletion;
export type MarkCriteriaDto = MarkCourseCriteriaCompletion;
