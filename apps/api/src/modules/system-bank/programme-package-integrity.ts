/**
 * Kiểm chứng ảnh chụp gói chương trình trước khi duyệt hoặc cài.
 *
 * Các id và quan hệ phải tự chứa; checksum dùng thứ tự định danh ổn định
 * để không phụ thuộc thứ tự truy vấn PostgreSQL. Chỉ nhận tập nội dung
 * nguyên vẹn, không phục hồi một phần hoặc tự ghép id khác nhau.
 */
import { createHash } from "node:crypto";
import { richTextInputSchema } from "@giaokhoa/contracts";
import type {
  SystemOutcomePackageCurriculumRow,
  SystemOutcomePackageMappingRow,
  SystemOutcomePackageNodeRow,
  SystemOutcomePackageOutcomeRow,
} from "@giaokhoa/db/repositories/system-bank";
import { canonicalizeJson } from "./system-bank-package";

export interface ProgrammePackageItems {
  curricula: Array<
    Pick<
      SystemOutcomePackageCurriculumRow,
      | "curriculumId"
      | "subjectSlug"
      | "subjectName"
      | "subjectPosition"
      | "grade"
    >
  >;
  nodes: Array<
    Pick<
      SystemOutcomePackageNodeRow,
      | "nodeId"
      | "curriculumId"
      | "parentId"
      | "title"
      | "kind"
      | "position"
      | "durationPeriods"
      | "durationPercent"
    >
  >;
  outcomes: Array<
    Pick<
      SystemOutcomePackageOutcomeRow,
      | "outcomeId"
      | "nodeId"
      | "position"
      | "content"
      | "sourceKind"
      | "sourceRef"
    >
  >;
  mappings: Array<
    Pick<
      SystemOutcomePackageMappingRow,
      "fromOutcomeId" | "toOutcomeId" | "note"
    >
  >;
}

/** Bỏ các khoá nội bộ của bảng ngân hàng khỏi checksum phát hành. */
export function programmePackagePayload(
  items: ProgrammePackageItems,
  legacy = false,
) {
  const curricula = items.curricula.map((r) => ({
    curriculumId: r.curriculumId,
    subjectSlug: r.subjectSlug,
    ...(legacy
      ? {}
      : { subjectName: r.subjectName, subjectPosition: r.subjectPosition }),
    grade: r.grade,
  }));
  const nodes = items.nodes.map((r) => ({
    nodeId: r.nodeId,
    curriculumId: r.curriculumId,
    parentId: r.parentId,
    title: r.title,
    kind: r.kind,
    position: r.position,
    durationPeriods: r.durationPeriods,
    durationPercent: r.durationPercent,
  }));
  const outcomes = items.outcomes.map((r) => ({
    outcomeId: r.outcomeId,
    nodeId: r.nodeId,
    position: r.position,
    content: r.content,
    sourceKind: r.sourceKind,
    sourceRef: r.sourceRef,
  }));
  const mappings = items.mappings.map((r) => ({
    fromOutcomeId: r.fromOutcomeId,
    toOutcomeId: r.toOutcomeId,
    note: r.note,
  }));
  if (!legacy) {
    curricula.sort((a, b) => a.curriculumId.localeCompare(b.curriculumId));
    nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    outcomes.sort((a, b) => a.outcomeId.localeCompare(b.outcomeId));
    mappings.sort((a, b) => a.fromOutcomeId.localeCompare(b.fromOutcomeId));
  }
  return { curricula, nodes, outcomes, mappings };
}

/** Tính checksum toàn vẹn cho dữ liệu phát hành, không tính id dòng bao bọc. */
export function programmePackageChecksum(
  items: ProgrammePackageItems,
  legacy = false,
): string {
  return createHash("sha256")
    .update(canonicalizeJson(programmePackagePayload(items, legacy)))
    .digest("hex");
}

/**
 * Kiểm tra tất cả FK logic xuyên những bảng của gói (DB hệ thống
 * không có FK đến kho trung tâm), chu trình và checksum.
 *
 * @throws Error với lý do kỹ thuật để caller trả `system_bank.bad_package`.
 */
export function assertProgrammePackageIntegrity(
  pkg: {
    version: string;
    scope: string;
    checksum: string;
    outcomeCount: number;
    centreSlug: string | null;
  },
  items: ProgrammePackageItems,
): void {
  const invalid = (detail: string): never => {
    throw new Error(detail);
  };
  if (!items.curricula.length || !items.nodes.length || !items.outcomes.length)
    invalid("empty programme package");
  const curricula = new Map<string, (typeof items.curricula)[number]>();
  const byGrade = new Set<string>();
  for (const row of items.curricula) {
    if (curricula.has(row.curriculumId) || !row.subjectSlug)
      invalid("duplicate curriculum or missing subject");
    const key = JSON.stringify([row.subjectSlug, row.grade]);
    if (byGrade.has(key)) invalid("duplicate subject and grade");
    if (pkg.scope !== "all" && row.subjectSlug !== pkg.scope)
      invalid("curriculum outside package scope");
    if (pkg.centreSlug && (!row.subjectName?.trim() || row.subjectPosition < 1))
      invalid("missing subject snapshot");
    byGrade.add(key);
    curricula.set(row.curriculumId, row);
  }
  const nodes = new Map<string, (typeof items.nodes)[number]>();
  for (const row of items.nodes) {
    if (nodes.has(row.nodeId) || !curricula.has(row.curriculumId))
      invalid("duplicate node or missing curriculum");
    nodes.set(row.nodeId, row);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) invalid("cyclic programme node");
    const node = nodes.get(id);
    if (!node) invalid("missing programme node");
    visiting.add(id);
    if (node!.parentId) {
      const parent = nodes.get(node!.parentId);
      if (!parent || parent.curriculumId !== node!.curriculumId)
        invalid("missing or foreign programme parent");
      visit(parent!.nodeId);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const id of nodes.keys()) visit(id);
  const outcomes = new Set<string>();
  for (const row of items.outcomes) {
    if (outcomes.has(row.outcomeId) || !nodes.has(row.nodeId))
      invalid("duplicate outcome or missing node");
    if (
      row.sourceKind !== "program" ||
      !richTextInputSchema.safeParse(row.content).success
    ) {
      invalid("invalid programme outcome content");
    }
    outcomes.add(row.outcomeId);
  }
  if (outcomes.size !== pkg.outcomeCount) invalid("outcome count mismatch");
  const mappings = new Set<string>();
  for (const row of items.mappings) {
    if (mappings.has(row.fromOutcomeId) || !outcomes.has(row.toOutcomeId))
      invalid("invalid outcome mapping");
    mappings.add(row.fromOutcomeId);
  }
  if (programmePackageChecksum(items, pkg.centreSlug === null) !== pkg.checksum)
    invalid("package checksum mismatch");
}

/** Xếp node cha trước con theo quan hệ đã được kiểm chứng. */
export function programmeNodesParentsFirst(items: ProgrammePackageItems) {
  const byId = new Map(items.nodes.map((node) => [node.nodeId, node]));
  const depth = (id: string): number => {
    const parentId = byId.get(id)!.parentId;
    return parentId ? 1 + depth(parentId) : 0;
  };
  return [...items.nodes].sort(
    (a, b) =>
      depth(a.nodeId) - depth(b.nodeId) || a.nodeId.localeCompare(b.nodeId),
  );
}
