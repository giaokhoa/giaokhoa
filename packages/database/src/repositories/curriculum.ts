import { ClientError } from '@giaokhoa/application/common/client-error';
import type {
  CurriculumRepository,
  UpdateNodeTreeResult,
} from '@giaokhoa/application/curriculum/repository';
import {
  curriculumNodeSchema,
  curriculumSchema,
  learningOutcomeSchema,
  subjectSchema,
  type CurriculumCreate,
  type CurriculumNodeCreate,
  type CurriculumNodePatch,
  type CurriculumPatch,
  type LearningOutcomeCreate,
  type LearningOutcomePatch,
  type SubjectCreate,
  type SubjectPatch,
} from '@giaokhoa/shared/curriculum';
import { and, asc, eq } from 'drizzle-orm';
import { curricula, curriculumNodes, learningOutcomes, subjects } from '../schema/curriculum.js';
import type { Database } from '../types.js';

/**
 * Dò mã lỗi PostgreSQL qua chuỗi nguyên nhân lỗi được thư viện truy vấn bọc lại.
 * Giới hạn số tầng duyệt để tránh lặp vô hạn; dùng để chuyển lỗi ràng buộc cơ sở dữ liệu sang lỗi nghiệp vụ.
 */
function hasPostgresCode(error: unknown, code: string) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('code' in current && (current as { code?: unknown }).code === code) return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/**
 * Lớp truy cập PostgreSQL cho môn học, chương trình, cây nội dung và yêu cầu cần đạt.
 * Giữ quan hệ cha-con trong cùng chương trình, đồng thời liên kết câu hỏi với môn và yêu cầu cần đạt.
 */
export class PostgresCurriculumRepository implements CurriculumRepository {
  constructor(private readonly db: Database) {}

  /**
   * Lấy toàn bộ môn học theo thứ tự hiển thị rồi đến tên để ổn định kết quả.
   * Kiểm tra định dạng từng bản ghi qua sơ đồ dữ liệu dùng chung trước khi trả về.
   */
  async listSubjects() {
    const rows = await this.db
      .select()
      .from(subjects)
      .orderBy(asc(subjects.position), asc(subjects.name));
    return rows.map((row) => subjectSchema.parse(row));
  }

  /**
   * Thêm môn học mới; trả về bản ghi vừa tạo đã được xác thực.
   * Chuyển lỗi PostgreSQL 23505 do trùng mã đường dẫn (slug) thành lỗi xung đột môn học.
   */
  async createSubject(data: SubjectCreate) {
    try {
      const [subject] = await this.db.insert(subjects).values(data).returning();
      return subjectSchema.parse(subject);
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError('conflict', 'subject_slug_conflict', 'Slug môn học đã tồn tại');
      throw error;
    }
  }

  /**
   * Tìm môn học theo mã; trả về undefined nếu không tồn tại.
   * Giữ kiểu dữ liệu đầu ra theo hợp đồng môn học dùng chung.
   */
  async findSubject(id: string) {
    const [subject] = await this.db.select().from(subjects).where(eq(subjects.id, id)).limit(1);
    return subject ? subjectSchema.parse(subject) : undefined;
  }

  /**
   * Cập nhật tên, mã đường dẫn hoặc thứ tự môn học theo phần thay đổi được cung cấp.
   * Chuyển lỗi trùng mã đường dẫn sang lỗi nghiệp vụ thay vì để lộ thông báo cơ sở dữ liệu.
   */
  async updateSubject(id: string, data: SubjectPatch) {
    try {
      const [subject] = await this.db
        .update(subjects)
        .set(data)
        .where(eq(subjects.id, id))
        .returning();
      return subject ? subjectSchema.parse(subject) : undefined;
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError('conflict', 'subject_slug_conflict', 'Slug môn học đã tồn tại');
      throw error;
    }
  }

  /**
   * Xóa môn học theo mã và chỉ trả thông tin định danh bản ghi đã xóa.
   * Các bản ghi phụ thuộc được xử lý theo quan hệ khóa ngoại đã khai báo, không xóa thủ công từng bảng ở đây.
   */
  async deleteSubject(id: string) {
    const [subject] = await this.db
      .delete(subjects)
      .where(eq(subjects.id, id))
      .returning({ id: subjects.id });
    return subject;
  }

  /**
   * Liệt kê mọi chương trình học, sắp xếp theo môn rồi theo khối lớp.
   * Dùng khi cần xem danh mục chung thay vì giới hạn theo một môn.
   */
  async listAllCurricula() {
    const rows = await this.db
      .select()
      .from(curricula)
      .orderBy(asc(curricula.subjectId), asc(curricula.grade));
    return rows.map((row) => curriculumSchema.parse(row));
  }

  /**
   * Liệt kê chương trình của một môn theo khối lớp tăng dần.
   * Điều kiện theo mã môn ngăn lẫn chương trình của môn khác.
   */
  async listCurricula(subjectId: string) {
    const rows = await this.db
      .select()
      .from(curricula)
      .where(eq(curricula.subjectId, subjectId))
      .orderBy(asc(curricula.grade));
    return rows.map((row) => curriculumSchema.parse(row));
  }

  /**
   * Thêm chương trình cho một môn và một khối lớp.
   * Ràng buộc duy nhất bảo vệ dữ liệu khi có hai thao tác tạo đồng thời; lỗi trùng và khóa ngoại được đổi sang lỗi nghiệp vụ.
   */
  async createCurriculum(data: CurriculumCreate) {
    try {
      const [curriculum] = await this.db.insert(curricula).values(data).returning();
      return curriculumSchema.parse(curriculum);
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError(
          'conflict',
          'curriculum_conflict',
          'Chương trình của môn và lớp này đã tồn tại',
        );
      if (hasPostgresCode(error, '23503'))
        throw new ClientError('not_found', 'subject_not_found', 'Môn học không còn tồn tại');
      throw error;
    }
  }

  /**
   * Đọc một chương trình theo mã, trả về undefined nếu không có.
   * Kiểm tra cấu trúc bản ghi trước khi chuyển sang tầng nghiệp vụ.
   */
  async findCurriculum(id: string) {
    const [curriculum] = await this.db
      .select()
      .from(curricula)
      .where(eq(curricula.id, id))
      .limit(1);
    return curriculum ? curriculumSchema.parse(curriculum) : undefined;
  }

  /**
   * Tra chương trình bằng cặp môn học và khối lớp vốn được cơ sở dữ liệu bảo đảm duy nhất.
   * Tránh phải lấy toàn bộ chương trình rồi lọc trong bộ nhớ.
   */
  async findCurriculumBySubjectAndGrade(subjectId: string, grade: number) {
    const [curriculum] = await this.db
      .select()
      .from(curricula)
      .where(and(eq(curricula.subjectId, subjectId), eq(curricula.grade, grade)))
      .limit(1);
    return curriculum ? curriculumSchema.parse(curriculum) : undefined;
  }

  /**
   * Cập nhật các trường được phép sửa của chương trình.
   * Nếu thay đổi làm trùng cặp môn và khối lớp hoặc sai khóa ngoại thì trả lỗi nghiệp vụ tương ứng.
   */
  async updateCurriculum(id: string, data: CurriculumPatch) {
    try {
      const [curriculum] = await this.db
        .update(curricula)
        .set(data)
        .where(eq(curricula.id, id))
        .returning();
      return curriculum ? curriculumSchema.parse(curriculum) : undefined;
    } catch (error) {
      if (hasPostgresCode(error, '23505'))
        throw new ClientError(
          'conflict',
          'curriculum_conflict',
          'Chương trình của môn và lớp này đã tồn tại',
        );
      if (hasPostgresCode(error, '23503'))
        throw new ClientError('not_found', 'subject_not_found', 'Môn học không còn tồn tại');
      throw error;
    }
  }

  /**
   * Xóa chương trình theo mã, trả về định danh nếu đã xóa.
   * Để cơ sở dữ liệu áp dụng các quy tắc xóa dây chuyền (cascade) đã khai báo cho cây nội dung.
   */
  async deleteCurriculum(id: string) {
    const [curriculum] = await this.db
      .delete(curricula)
      .where(eq(curricula.id, id))
      .returning({ id: curricula.id });
    return curriculum;
  }

  /**
   * Liệt kê các nút nội dung của một chương trình, sắp xếp theo vị trí và mã nút.
   * Kết quả gồm cả nút gốc và nút con; trường cha quyết định cấu trúc cây.
   */
  async listNodes(curriculumId: string) {
    const rows = await this.db
      .select()
      .from(curriculumNodes)
      .where(eq(curriculumNodes.curriculumId, curriculumId))
      .orderBy(asc(curriculumNodes.position), asc(curriculumNodes.id));
    return rows.map((row) => curriculumNodeSchema.parse(row));
  }

  /**
   * Tạo một nút nội dung trong chương trình học.
   * Quan hệ cha và chương trình được ràng buộc ở cơ sở dữ liệu; chuyển lỗi khóa ngoại thành lỗi yêu cầu không hợp lệ.
   */
  async createNode(data: CurriculumNodeCreate) {
    try {
      const [node] = await this.db.insert(curriculumNodes).values(data).returning();
      return curriculumNodeSchema.parse(node);
    } catch (error) {
      if (hasPostgresCode(error, '23503'))
        throw new ClientError(
          'invalid',
          'curriculum_parent_invalid',
          'Chương trình hoặc nút cha không hợp lệ',
        );
      throw error;
    }
  }

  /**
   * Tìm nút nội dung theo mã; không có thì trả về undefined.
   * Trả về cấu trúc dữ liệu đã xác thực để tầng sử dụng không phụ thuộc kiểu bản ghi Drizzle.
   */
  async findNode(id: string) {
    const [node] = await this.db
      .select()
      .from(curriculumNodes)
      .where(eq(curriculumNodes.id, id))
      .limit(1);
    return node ? curriculumNodeSchema.parse(node) : undefined;
  }

  /**
   * Cập nhật các trường cơ bản của nút nội dung theo mã.
   * Thay đổi cấu trúc cha-con cần đi qua phương thức updateNodeTree để kiểm tra vòng lặp trong cây.
   */
  async updateNode(id: string, data: CurriculumNodePatch) {
    const [node] = await this.db
      .update(curriculumNodes)
      .set(data)
      .where(eq(curriculumNodes.id, id))
      .returning();
    return node ? curriculumNodeSchema.parse(node) : undefined;
  }

  /**
   * Di chuyển nút sang vị trí mới trong cây mà không tạo chu trình (cycle).
   * Khóa chương trình trước khi đọc chuỗi tổ tiên để đồng bộ các lần di chuyển song song; từ chối nút cha khác chương trình, nút tự làm cha và nhánh gây vòng lặp.
   * Trả trạng thái chi tiết: đã cập nhật, không tồn tại, cha không hợp lệ hoặc tạo chu trình.
   */
  async updateNodeTree(
    id: string,
    data: CurriculumNodePatch & { parentId: string | null },
  ): Promise<UpdateNodeTreeResult> {
    return this.db.transaction(async (tx) => {
      const [lookup] = await tx
        .select({ curriculumId: curriculumNodes.curriculumId })
        .from(curriculumNodes)
        .where(eq(curriculumNodes.id, id))
        .limit(1);
      if (!lookup) return { status: 'not_found' };

      const [curriculum] = await tx
        .select({ id: curricula.id })
        .from(curricula)
        .where(eq(curricula.id, lookup.curriculumId))
        .limit(1)
        .for('update');
      if (!curriculum) return { status: 'not_found' };

      const [current] = await tx
        .select()
        .from(curriculumNodes)
        .where(eq(curriculumNodes.id, id))
        .limit(1);
      if (!current) return { status: 'not_found' };

      if (data.parentId) {
        if (data.parentId === id) return { status: 'cycle' };

        const [parent] = await tx
          .select({ id: curriculumNodes.id, curriculumId: curriculumNodes.curriculumId })
          .from(curriculumNodes)
          .where(eq(curriculumNodes.id, data.parentId))
          .limit(1);
        if (!parent || parent.curriculumId !== current.curriculumId) {
          return { status: 'invalid_parent' };
        }

        const visited = new Set<string>();
        let ancestorId: string | null = data.parentId;
        while (ancestorId) {
          if (ancestorId === id || visited.has(ancestorId)) return { status: 'cycle' };
          visited.add(ancestorId);

          const [ancestor] = await tx
            .select({ parentId: curriculumNodes.parentId })
            .from(curriculumNodes)
            .where(eq(curriculumNodes.id, ancestorId))
            .limit(1);
          if (!ancestor) return { status: 'invalid_parent' };
          ancestorId = ancestor.parentId;
        }
      }

      const [node] = await tx
        .update(curriculumNodes)
        .set(data)
        .where(eq(curriculumNodes.id, id))
        .returning();
      return node
        ? { status: 'updated', node: curriculumNodeSchema.parse(node) }
        : { status: 'not_found' };
    });
  }

  /**
   * Xóa nút nội dung theo mã; quan hệ phụ thuộc được xử lý bằng ràng buộc khóa ngoại.
   * Trả về định danh khi xóa thành công, undefined khi không có nút.
   */
  async deleteNode(id: string) {
    const [node] = await this.db
      .delete(curriculumNodes)
      .where(eq(curriculumNodes.id, id))
      .returning({ id: curriculumNodes.id });
    return node;
  }

  /**
   * Lấy các yêu cầu cần đạt (learning outcome) của một nút nội dung theo thứ tự hiển thị.
   * Nếu nhiều mục có cùng vị trí thì sắp theo mã để kết quả luôn ổn định.
   */
  async listOutcomes(nodeId: string) {
    const rows = await this.db
      .select()
      .from(learningOutcomes)
      .where(eq(learningOutcomes.nodeId, nodeId))
      .orderBy(asc(learningOutcomes.position), asc(learningOutcomes.id));
    return rows.map((row) => learningOutcomeSchema.parse(row));
  }

  /**
   * Thêm yêu cầu cần đạt vào một nút nội dung cụ thể.
   * Trả về dữ liệu đã xác thực; chuyển lỗi khóa ngoại nếu nút bị xóa trước khi ghi.
   */
  async createOutcome(data: LearningOutcomeCreate) {
    try {
      const [outcome] = await this.db.insert(learningOutcomes).values(data).returning();
      return learningOutcomeSchema.parse(outcome);
    } catch (error) {
      if (hasPostgresCode(error, '23503'))
        throw new ClientError(
          'not_found',
          'curriculum_node_not_found',
          'Nút chương trình không còn tồn tại',
        );
      throw error;
    }
  }

  /**
   * Đọc yêu cầu cần đạt theo mã; không tồn tại thì trả về undefined.
   * Không ghép thêm thông tin nút cha vì phương thức chỉ trả một yêu cầu.
   */
  async findOutcome(id: string) {
    const [outcome] = await this.db
      .select()
      .from(learningOutcomes)
      .where(eq(learningOutcomes.id, id))
      .limit(1);
    return outcome ? learningOutcomeSchema.parse(outcome) : undefined;
  }

  /**
   * Cập nhật nội dung hoặc thứ tự một yêu cầu cần đạt.
   * Dùng thao tác cập nhật và trả bản ghi mới trong một câu lệnh để tránh tra lại.
   */
  async updateOutcome(id: string, data: LearningOutcomePatch) {
    const [outcome] = await this.db
      .update(learningOutcomes)
      .set(data)
      .where(eq(learningOutcomes.id, id))
      .returning();
    return outcome ? learningOutcomeSchema.parse(outcome) : undefined;
  }

  /**
   * Xóa yêu cầu cần đạt theo mã; trả về định danh nếu có bản ghi bị xóa.
   * Các liên kết phân loại câu hỏi chịu quy tắc khóa ngoại của bảng quan hệ.
   */
  async deleteOutcome(id: string) {
    const [outcome] = await this.db
      .delete(learningOutcomes)
      .where(eq(learningOutcomes.id, id))
      .returning({ id: learningOutcomes.id });
    return outcome;
  }
}
