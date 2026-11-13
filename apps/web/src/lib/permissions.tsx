import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Course, MyAccessView } from '@giaokhoa/contracts';
import { apiJson } from '#lib/api';
import { useAuth } from '#lib/auth';
import { queryKeys } from '#lib/query-keys';

export interface CourseAccess {
  course: Course;
  capabilities: string[];
}

const CONTEXT_LEVEL = { SYSTEM: 10, TENANT: 20, COURSECAT: 40, COURSE: 50 } as const;

const QUESTION_CAPABILITIES = [
  'question:useall',
  'question:add',
  'question:editall',
  'question:managecategory',
] as const;

export interface PermissionsState {
  ready: boolean;
  access: MyAccessView | null;
  capabilitiesError: Error | null;
  canViewUsers: boolean;
  canManageRoles: boolean;
  canAdminister: boolean;
  canViewPlatformTenants: boolean;
  canManagePlatformTenants: boolean;
  canViewTenantAdmin: boolean;
  canManageTenantAdmin: boolean;
  canManageGuardians: boolean;
  canUseQuestionBank: boolean;
  courses: CourseAccess[];
  teaching: CourseAccess[];
  learning: CourseAccess[];
  hasLearnerFootprint: boolean;
}

const PermissionsContext = createContext<PermissionsState | null>(null);

async function probe<T>(path: string): Promise<T | null> {
  try {
    return await apiJson<T>(path);
  } catch {
    return null;
  }
}

export function systemCapabilities(access: MyAccessView): string[] {
  return access.contexts.find((c) => c.contextLevel === CONTEXT_LEVEL.SYSTEM)?.capabilities ?? [];
}

export function courseCapabilities(access: MyAccessView, course: Course): string[] {
  const capsByContext = new Map(access.contexts.map((c) => [c.contextId, c.capabilities]));
  const levels = [
    { level: CONTEXT_LEVEL.COURSE, instanceId: course.id },
    { level: CONTEXT_LEVEL.COURSECAT, instanceId: course.category },
  ];
  for (const { level, instanceId } of levels) {
    const caps = new Set<string>();
    let matched = false;
    for (const assignment of access.assignments) {
      if (assignment.contextLevel === level && assignment.instanceId === instanceId) {
        matched = true;
        for (const cap of capsByContext.get(assignment.contextId) ?? []) caps.add(cap);
      }
    }
    if (matched) return [...caps];
  }
  return systemCapabilities(access);
}

export function tenantCapabilities(access: MyAccessView | null, tenantId: string): string[] {
  if (!access) return [];
  const caps = new Set(systemCapabilities(access));
  const capsByContext = new Map(access.contexts.map((c) => [c.contextId, c.capabilities]));
  for (const assignment of access.assignments) {
    if (assignment.contextLevel !== CONTEXT_LEVEL.TENANT || assignment.instanceId !== tenantId) continue;
    for (const cap of capsByContext.get(assignment.contextId) ?? []) caps.add(cap);
  }
  return [...caps];
}

function hasTenantCapabilitySomewhere(access: MyAccessView, capability: string): boolean {
  if (access.isSiteAdmin || systemCapabilities(access).includes(capability)) return true;
  const capsByContext = new Map(access.contexts.map((c) => [c.contextId, c.capabilities]));
  return access.assignments.some(
    (assignment) =>
      assignment.contextLevel === CONTEXT_LEVEL.TENANT &&
      (capsByContext.get(assignment.contextId) ?? []).includes(capability),
  );
}

function isCourseStaff(access: MyAccessView | null, courseAccess: CourseAccess): boolean {
  if (!access) return false;
  return access.isSiteAdmin || courseAccess.capabilities.includes('grade:viewall');
}

export function hasCourseAssignment(access: MyAccessView | null, course: Course): boolean {
  if (!access) return false;
  return access.assignments.some(
    (a) => a.contextLevel === CONTEXT_LEVEL.COURSE && a.instanceId === course.id,
  );
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const enabled = !!user;

  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.capabilities,
    queryFn: () => apiJson<MyAccessView>('/api/v1/users/me/capabilities'),
    enabled,
    staleTime: 60_000,
  });
  const coursesQuery = useQuery({
    queryKey: queryKeys.courses,
    queryFn: () => probe<Course[]>('/api/v1/courses'),
    enabled,
  });
  const courseList = useMemo(() => coursesQuery.data ?? [], [coursesQuery.data]);
  const accessSnapshot = capabilitiesQuery.data ?? null;

  const value = useMemo<PermissionsState>(() => {
    if (!user) {
      return {
        ready: true,
        access: null,
        capabilitiesError: null,
        canViewUsers: false,
        canManageRoles: false,
        canAdminister: false,
        canViewPlatformTenants: false,
        canManagePlatformTenants: false,
        canViewTenantAdmin: false,
        canManageTenantAdmin: false,
        canManageGuardians: false,
        canUseQuestionBank: false,
        courses: [],
        teaching: [],
        learning: [],
        hasLearnerFootprint: false,
      };
    }
    const access = accessSnapshot;
    const courses: CourseAccess[] = courseList.map((course) => ({
      course,
      capabilities: access ? courseCapabilities(access, course) : [],
    }));
    const sysCaps = access ? systemCapabilities(access) : [];
    const canViewUsers = (access?.isSiteAdmin ?? false) || sysCaps.includes('user:viewdetails');
    const canManageRoles = (access?.isSiteAdmin ?? false) || sysCaps.includes('role:manage');
    const canViewPlatformTenants =
      (access?.isSiteAdmin ?? false) || sysCaps.includes('tenant:viewall') || sysCaps.includes('tenant:manage');
    const canManagePlatformTenants = (access?.isSiteAdmin ?? false) || sysCaps.includes('tenant:manage');
    const canViewTenantAdmin =
      canViewPlatformTenants ||
      (access
        ? hasTenantCapabilitySomewhere(access, 'tenant:viewall') || hasTenantCapabilitySomewhere(access, 'tenant:manage')
        : false);
    const canManageTenantAdmin =
      canManagePlatformTenants || (access ? hasTenantCapabilitySomewhere(access, 'tenant:manage') : false);
    const teaching = courses.filter(
      (c) => hasCourseAssignment(access, c.course) && isCourseStaff(access, c),
    );
    const learning = courses.filter(
      (c) => hasCourseAssignment(access, c.course) && !isCourseStaff(access, c),
    );
    return {
      ready: !capabilitiesQuery.isPending && !coursesQuery.isPending,
      access,
      capabilitiesError: capabilitiesQuery.error ?? null,
      canViewUsers,
      canManageRoles,
      canAdminister: (access?.isSiteAdmin ?? false) || canManageRoles || sysCaps.includes('site:config'),
      canViewPlatformTenants,
      canManagePlatformTenants,
      canViewTenantAdmin,
      canManageTenantAdmin,
      canManageGuardians:
        (access?.isSiteAdmin ?? false) ||
        (access?.contexts.some((c) => c.capabilities.includes('guardian:manage')) ?? false),
      canUseQuestionBank:
        (access?.isSiteAdmin ?? false) ||
        (access?.contexts.some((c) =>
          c.capabilities.some((cap) => (QUESTION_CAPABILITIES as readonly string[]).includes(cap)),
        ) ??
          false),
      courses,
      teaching,
      learning,
      hasLearnerFootprint: learning.length > 0 || (access?.hasLearnerArtifacts ?? false),
    };
  }, [
    user,
    accessSnapshot,
    capabilitiesQuery.isPending,
    capabilitiesQuery.error,
    coursesQuery.isPending,
    courseList,
  ]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider');
  return ctx;
}
