import { NotFoundException } from '@nestjs/common';

export function categoryNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Question category ${id} not found`, code: 'question.category_not_found' });
}

export function questionNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Question ${id} not found`, code: 'question.not_found' });
}

export function stimulusNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Stimulus ${id} not found`, code: 'stimulus.not_found' });
}

export function usageNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Question usage ${id} not found`, code: 'question.usage_not_found' });
}

export function attemptNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Question attempt ${id} not found`, code: 'question.attempt_not_found' });
}

export function bankNotFound(id: string): NotFoundException {
  return new NotFoundException({ message: `Question bank ${id} not found`, code: 'question.bank_not_found' });
}

export function questionEntryMissing(id: string): NotFoundException {
  return new NotFoundException({ message: `Question ${id} has no bank entry`, code: 'question.entry_missing' });
}

export function questionVersionMissing(id: string): NotFoundException {
  return new NotFoundException({ message: `Question ${id} latest version missing`, code: 'question.version_missing' });
}

export function questionVersionNotFound(versionId: string): NotFoundException {
  return new NotFoundException({ message: `Question version ${versionId} not found`, code: 'question.version_missing' });
}

export function questionVersionNotFoundForQuestion(versionId: string, questionId: string): NotFoundException {
  return new NotFoundException({
    message: `Question version ${versionId} not found for question ${questionId}`,
    code: 'question.version_not_found',
  });
}

export function questionCurriculumLinkNotFound(kind: 'subject' | 'outcome'): NotFoundException {
  if (kind === 'subject') {
    return new NotFoundException({ message: 'Question is not linked to this subject', code: 'question.subject_link_not_found' });
  }
  return new NotFoundException({ message: 'Question is not linked to this learning outcome', code: 'question.outcome_link_not_found' });
}

export interface ServiceGuardCategory {
  id: string;
  bankId: string | null;
  contextId: string;
}

export interface ServiceGuardQuestion {
  id: string;
  category: string;
}

export interface ServiceGuardBank {
  id: string;
  scope: string;
  ownerId: string | null;
  contextId: string;
}

export interface ServiceGuardCategoryStore<C extends ServiceGuardCategory = ServiceGuardCategory> {
  getCategory(id: string): Promise<C | undefined>;
}

export interface ServiceGuardQuestionStore<Q extends ServiceGuardQuestion = ServiceGuardQuestion> {
  getQuestion(id: string): Promise<Q | undefined>;
}

export interface ServiceGuardBankStore<B extends ServiceGuardBank = ServiceGuardBank> {
  getBankById(id: string): Promise<B | undefined>;
  getBankByContextId(contextId: string): Promise<B | undefined>;
}

export interface ServiceGuardCapabilityChecks {
  requireCapability(actorId: string, capability: string, contextId: string): Promise<void>;
  hasCapability(actorId: string, capability: string, contextId: string): Promise<boolean>;
  isSiteAdmin(actorId: string): Promise<boolean>;
}

export interface ServiceGuardDeps<
  C extends ServiceGuardCategory = ServiceGuardCategory,
  Q extends ServiceGuardQuestion = ServiceGuardQuestion,
  B extends ServiceGuardBank = ServiceGuardBank,
> extends ServiceGuardCategoryStore<C>, ServiceGuardQuestionStore<Q>, ServiceGuardBankStore<B>, ServiceGuardCapabilityChecks {}

export async function canUseBank(
  deps: ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  contextId: string,
  useCapability = 'question:useall',
): Promise<boolean> {
  const bank = await deps.getBankByContextId(contextId).catch(() => undefined);
  if (bank && bank.scope === 'personal' && bank.ownerId !== actorId) {
    const isAdmin = await deps.isSiteAdmin(actorId).catch(() => false);
    if (!isAdmin) return false;
  }
  return deps.hasCapability(actorId, useCapability, contextId).catch(() => false);
}

async function bankOfCategory(deps: ServiceGuardBankStore, category: ServiceGuardCategory): Promise<ServiceGuardBank | undefined> {
  if (category.bankId) {
    const byId = await deps.getBankById(category.bankId).catch(() => undefined);
    if (byId) return byId;
  }
  return deps.getBankByContextId(category.contextId).catch(() => undefined);
}

async function assertCategoryNotForeignPersonal(
  deps: ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  category: ServiceGuardCategory,
  notFound: () => NotFoundException,
): Promise<void> {
  const bank = await bankOfCategory(deps, category);
  if (!bank || bank.scope !== 'personal' || bank.ownerId === actorId) return;
  const isAdmin = await deps.isSiteAdmin(actorId).catch(() => false);
  if (!isAdmin) throw notFound();
}

export async function assertQuestionReadable<Q extends ServiceGuardQuestion>(
  deps: ServiceGuardQuestionStore<Q> & ServiceGuardCategoryStore & ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  questionId: string,
  useCapability = 'question:useall',
): Promise<Q> {
  const question = await deps.getQuestion(questionId);
  if (!question) throw questionNotFound(questionId);
  const category = await deps.getCategory(question.category);
  if (!category || !(await canUseBank(deps, actorId, category.contextId, useCapability))) throw questionNotFound(questionId);
  return question;
}

export async function assertCategoryReadable<C extends ServiceGuardCategory>(
  deps: ServiceGuardCategoryStore<C> & ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  categoryId: string,
  useCapability = 'question:useall',
): Promise<C> {
  const category = await deps.getCategory(categoryId);
  if (!category) throw categoryNotFound(categoryId);
  if (!(await canUseBank(deps, actorId, category.contextId, useCapability))) throw categoryNotFound(categoryId);
  return category;
}

export async function requireCategoryWritable<C extends ServiceGuardCategory>(
  deps: ServiceGuardCategoryStore<C> & ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  categoryId: string,
  capability: string,
  notFound: () => NotFoundException,
): Promise<C> {
  const category = await deps.getCategory(categoryId);
  if (!category) throw categoryNotFound(categoryId);
  await assertCategoryNotForeignPersonal(deps, actorId, category, notFound);
  await deps.requireCapability(actorId, capability, category.contextId);
  return category;
}

export async function requireQuestionWritable<C extends ServiceGuardCategory, Q extends ServiceGuardQuestion>(
  deps: ServiceGuardQuestionStore<Q> & ServiceGuardCategoryStore<C> & ServiceGuardBankStore & ServiceGuardCapabilityChecks,
  actorId: string,
  questionId: string,
  capability: string,
): Promise<{ question: Q; category: C }> {
  const question = await deps.getQuestion(questionId);
  if (!question) throw questionNotFound(questionId);
  const category = await requireCategoryWritable(deps, actorId, question.category, capability, () => questionNotFound(questionId));
  return { question, category };
}
