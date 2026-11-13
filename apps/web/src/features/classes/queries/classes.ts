/**
 * Tầng dữ liệu của feature classes (F-01, rà soát #133): options dùng chung cho hook của trang và clientLoader của route module (prefetch cùng khoá).
 * Lời gọi API thuần nằm ở tầng `api/` của feature; khoá truy vấn riêng của classes nằm ở `keys.ts` cùng tầng này, riêng khoá danh sách lớp
 * `classes` là khoá dùng chung ở factory tập trung (`#lib/query-keys`).
 *
 * Đột biến tự invalidate các khoá liên quan khi thành công (theo mẫu của feature matrices): trang chỉ còn xử lý thông báo/điều hướng của riêng nó
 * qua `mutateAsync` + try/catch, không tự invalidate tay.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys as sharedQueryKeys } from '#lib/query-keys';
import {
  addRosterMember,
  addRosterStudentByIdentity,
  archiveClass,
  createClass,
  createClassFeePayment,
  decideJoinRequest,
  deleteClass,
  fetchClass,
  fetchClassOverview,
  fetchClassPublic,
  fetchClassStaff,
  fetchJoinRequests,
  fetchPayment,
  fetchRoster,
  fetchClasses,
  fetchSuspendedMembers,
  importRosterFile,
  joinClassByCode,
  previewJoinClass,
  removeRosterMember,
  setClassStaffRoles,
  updateClass,
} from '../api/classes';
import { queryKeys } from './keys';
import type { ClassFeePaymentView, ClassStaffRole, RosterStudentIdentity } from '../types/classes';

/** Tuỳ chọn truy vấn danh sách lớp của người gọi (GET /classes). */
export function classesQueryOptions() {
  return queryOptions({
    queryKey: sharedQueryKeys.classes,
    queryFn: fetchClasses,
  });
}

/** Danh sách lớp của người gọi. */
export function useClasses() {
  return useQuery(classesQueryOptions());
}

/** Tuỳ chọn truy vấn chi tiết một lớp (GET /classes/:id). */
export function classDetailQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classDetail(classId),
    queryFn: () => fetchClass(classId),
  });
}

/** Chi tiết một lớp; chỉ tải khi có `classId`. */
export function useClassDetail(classId: string) {
  return useQuery({ ...classDetailQueryOptions(classId), enabled: Boolean(classId) });
}

/** Tuỳ chọn truy vấn gói tổng quan của lớp (nguồn vai duy nhất của trang chi tiết). */
export function classOverviewQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classOverview(classId),
    queryFn: () => fetchClassOverview(classId),
  });
}

/** Gói tổng quan của lớp; chỉ tải khi có `classId`. */
export function useClassOverview(classId: string) {
  return useQuery({ ...classOverviewQueryOptions(classId), enabled: Boolean(classId) });
}

/** Tuỳ chọn truy vấn đội ngũ đồng giảng dạy của lớp. */
export function classStaffQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classStaff(classId),
    queryFn: () => fetchClassStaff(classId),
  });
}

/** Đội ngũ đồng giảng dạy của lớp; chỉ tải khi có `classId`. */
export function useClassStaff(classId: string) {
  return useQuery({ ...classStaffQueryOptions(classId), enabled: Boolean(classId) });
}

/** Tuỳ chọn truy vấn roster của lớp. */
export function classRosterQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classRoster(classId),
    queryFn: () => fetchRoster(classId),
  });
}

/** Roster của lớp; chỉ tải khi `enabled` (trang chi tiết bật theo vai). */
export function useClassRoster(classId: string, enabled: boolean) {
  return useQuery({ ...classRosterQueryOptions(classId), enabled: Boolean(classId) && enabled });
}

/** Tuỳ chọn truy vấn thành viên bị đình chỉ của lớp. */
export function classSuspendedQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classSuspended(classId),
    queryFn: () => fetchSuspendedMembers(classId),
  });
}

/** Thành viên bị đình chỉ của lớp; chỉ tải khi `enabled` (quyền quản roster). */
export function useClassSuspendedMembers(classId: string, enabled: boolean) {
  return useQuery({ ...classSuspendedQueryOptions(classId), enabled: Boolean(classId) && enabled });
}

/** Tuỳ chọn truy vấn hàng chờ duyệt vào lớp. */
export function classJoinRequestsQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classJoinRequests(classId),
    queryFn: () => fetchJoinRequests(classId),
  });
}

/** Hàng chờ duyệt vào lớp; chỉ tải khi `enabled` (quyền quản roster). */
export function useClassJoinRequests(classId: string, enabled: boolean) {
  return useQuery({ ...classJoinRequestsQueryOptions(classId), enabled: Boolean(classId) && enabled });
}

/** Tuỳ chọn truy vấn gói công khai của lớp. */
export function classPublicQueryOptions(classId: string) {
  return queryOptions({
    queryKey: queryKeys.classPublic(classId),
    queryFn: () => fetchClassPublic(classId),
  });
}

/** Gói công khai của lớp; chỉ tải khi có `classId`. */
export function useClassPublic(classId: string) {
  return useQuery({ ...classPublicQueryOptions(classId), enabled: Boolean(classId) });
}

/**
 * Trạng thái payment học phí gói lớp (poll sau khi tạo): khoảng poll tính theo trạng thái MỚI NHẤT đã biết (đáp ứng poll gần nhất; chưa có
 * thì bản tạo ban đầu trong state) — payment rời `pending` là poll dừng hẳn.
 */
export function useClassFeePaymentStatus(payment: ClassFeePaymentView | null) {
  return useQuery({
    queryKey: queryKeys.payment(payment?.id ?? ''),
    queryFn: () => fetchPayment(payment!.id),
    enabled: Boolean(payment),
    refetchInterval: (query) => ((query.state.data?.status ?? payment?.status) === 'pending' ? 3000 : false),
  });
}

/** Lưu trữ một lớp: xong thì danh sách lớp nạp lại. */
export function useArchiveClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId: string) => archiveClass(classId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.classes });
    },
  });
}

/** Xoá một lớp: xong thì danh sách lớp nạp lại. */
export function useDeleteClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (classId: string) => deleteClass(classId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.classes });
    },
  });
}

/** Tạo lớp mới: xong thì danh sách lớp nạp lại. */
export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createClass>[0]) => createClass(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.classes });
    },
  });
}

/** Lưu thay đổi của một lớp: xong thì chi tiết + danh sách lớp nạp lại. */
export function useUpdateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; input: Parameters<typeof updateClass>[1] }) => updateClass(vars.classId, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoot(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: sharedQueryKeys.classes });
    },
  });
}

/** Xem trước lớp theo mã tham gia (POST đọc, không invalidate). */
export function usePreviewJoinClass() {
  return useMutation({
    mutationFn: (code: string) => previewJoinClass(code),
  });
}

/** Xin vào lớp theo mã (POST, không invalidate — danh sách lớp nạp mới khi mở lại). */
export function useJoinClassByCode() {
  return useMutation({
    mutationFn: (code: string) => joinClassByCode(code),
  });
}

/** Thêm học sinh theo định danh: xong thì roster + danh sách đình chỉ nạp lại. */
export function useAddRosterStudentByIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; input: RosterStudentIdentity }) =>
      addRosterStudentByIdentity(vars.classId, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoster(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.classSuspended(vars.classId) });
    },
  });
}

/** Nhập roster từ file: xong thì roster + danh sách đình chỉ nạp lại. */
export function useImportRosterFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; file: File }) => importRosterFile(vars.classId, vars.file),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoster(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.classSuspended(vars.classId) });
    },
  });
}

/** Đình chỉ một thành viên: xong thì roster + danh sách đình chỉ nạp lại. */
export function useRemoveRosterMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; userId: string }) => removeRosterMember(vars.classId, vars.userId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoster(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.classSuspended(vars.classId) });
    },
  });
}

/** Kích hoạt lại một thành viên bị đình chỉ: xong thì roster + danh sách đình chỉ nạp lại. */
export function useAddRosterMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; userId: string }) => addRosterMember(vars.classId, vars.userId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoster(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.classSuspended(vars.classId) });
    },
  });
}

/** Duyệt/từ chối yêu cầu vào lớp: xong thì hàng chờ + roster nạp lại. */
export function useDecideJoinRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; requestId: string; approve: boolean }) =>
      decideJoinRequest(vars.classId, vars.requestId, vars.approve),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classJoinRequests(vars.classId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.classRoster(vars.classId) });
    },
  });
}

/** Đặt vai trò đồng giảng dạy: xong thì đội ngũ của lớp nạp lại. */
export function useSetClassStaffRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { classId: string; input: { userId?: string; email?: string; roles: ClassStaffRole[] } }) =>
      setClassStaffRoles(vars.classId, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.classStaff(vars.classId) });
    },
  });
}

/** Tạo payment học phí gói lớp (POST, không invalidate — trạng thái theo dõi bằng poll). */
export function useCreateClassFeePayment() {
  return useMutation({
    mutationFn: (classId: string) => createClassFeePayment(classId),
  });
}
