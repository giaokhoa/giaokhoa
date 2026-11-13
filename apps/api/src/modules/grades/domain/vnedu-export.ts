import ExcelJS from 'exceljs';

export interface VneduExportItem {
  id: string;
  name: string;
  gradeMin: number;
  gradeMax: number;
}

export interface VneduExportStudent {
  code: string;
  fullName: string;
  grades: ReadonlyMap<string, number | null>;
}

export interface VneduExportModel {
  className: string;
  subjectName: string;
  semester: 1 | 2;
  schoolYear: string;
  regular: readonly VneduExportItem[];
  midterm: VneduExportItem;
  final: VneduExportItem;
  students: readonly VneduExportStudent[];
}

export interface VneduMerge {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface VneduGrid {
  rows: (string | number | null)[][];
  merges: VneduMerge[];
  columnCount: number;
}

export const VNEDU_DATA_START_ROW = 6;

export function roundToOneDecimal(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

export function toTenScale(finalGrade: number, gradeMin: number, gradeMax: number): number {
  return roundToOneDecimal(((finalGrade - gradeMin) / (gradeMax - gradeMin)) * 10);
}

export function semesterAverage(
  regularValues: readonly (number | null)[],
  midterm: number | null,
  final: number | null,
): number | null {
  if (!regularValues.length || midterm === null || final === null) return null;
  if (regularValues.some((v) => v === null)) return null;
  const totalRegular = regularValues.reduce((sum: number, v) => sum + (v as number), 0);
  return roundToOneDecimal((totalRegular + 2 * midterm + 3 * final) / (regularValues.length + 5));
}

function studentValue(student: VneduExportStudent, item: VneduExportItem): number | null {
  const raw = student.grades.get(item.id);
  if (raw === null || raw === undefined) return null;
  return toTenScale(raw, item.gradeMin, item.gradeMax);
}

export function buildVneduGrid(model: VneduExportModel): VneduGrid {
  const regularCount = model.regular.length;
  const firstRegularCol = 4;
  const lastRegularCol = firstRegularCol + regularCount - 1;
  const midtermCol = lastRegularCol + 1;
  const finalCol = midtermCol + 1;
  const averageCol = finalCol + 1;
  const columnCount = averageCol;

  const blankRow = (): (string | number | null)[] => Array.from({ length: columnCount }, () => null);

  const titleRow = blankRow();
  titleRow[0] = 'BẢNG ĐIỂM MÔN HỌC';

  const infoRow = blankRow();
  infoRow[0] = `Lớp: ${model.className} · Môn học: ${model.subjectName} · Học kỳ: ${model.semester === 1 ? 'I' : 'II'} · Năm học: ${model.schoolYear}`;

  const groupRow = blankRow();
  groupRow[0] = 'STT';
  groupRow[1] = 'Mã học sinh';
  groupRow[2] = 'Họ và tên';
  groupRow[firstRegularCol - 1] = 'Điểm đánh giá thường xuyên';
  groupRow[midtermCol - 1] = 'Điểm đánh giá định kỳ';
  groupRow[averageCol - 1] = 'Điểm trung bình môn học kỳ (ĐTBmhk)';

  const labelRow = blankRow();
  model.regular.forEach((item, i) => { labelRow[firstRegularCol - 1 + i] = item.name; });
  labelRow[midtermCol - 1] = 'ĐĐGgk (hệ số 2)';
  labelRow[finalCol - 1] = 'ĐĐGck (hệ số 3)';

  const rows: (string | number | null)[][] = [titleRow, infoRow, blankRow(), groupRow, labelRow];
  model.students.forEach((student, index) => {
    const row = blankRow();
    row[0] = index + 1;
    row[1] = student.code;
    row[2] = student.fullName;
    const regularValues = model.regular.map((item, i) => {
      const value = studentValue(student, item);
      row[firstRegularCol - 1 + i] = value;
      return value;
    });
    const midtermValue = studentValue(student, model.midterm);
    const finalValue = studentValue(student, model.final);
    row[midtermCol - 1] = midtermValue;
    row[finalCol - 1] = finalValue;
    row[averageCol - 1] = semesterAverage(regularValues, midtermValue, finalValue);
    rows.push(row);
  });

  const merges: VneduMerge[] = [
    { top: 1, left: 1, bottom: 1, right: columnCount },
    { top: 2, left: 1, bottom: 2, right: columnCount },
    { top: 4, left: 1, bottom: 5, right: 1 },
    { top: 4, left: 2, bottom: 5, right: 2 },
    { top: 4, left: 3, bottom: 5, right: 3 },
    { top: 4, left: midtermCol, bottom: 4, right: finalCol },
    { top: 4, left: averageCol, bottom: 5, right: averageCol },
  ];
  if (regularCount > 1) merges.push({ top: 4, left: firstRegularCol, bottom: 4, right: lastRegularCol });

  return { rows, merges, columnCount };
}

export async function renderVneduWorkbook(model: VneduExportModel): Promise<Buffer> {
  const grid = buildVneduGrid(model);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bảng điểm');

  grid.rows.forEach((values, rowIndex) => {
    const row = sheet.getRow(rowIndex + 1);
    values.forEach((value, colIndex) => {
      if (value !== null) row.getCell(colIndex + 1).value = value;
    });
  });
  for (const merge of grid.merges) {
    sheet.mergeCells(merge.top, merge.left, merge.bottom, merge.right);
  }

  const thin = { style: 'thin' as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEEAF6' } };

  const titleCell = sheet.getCell(1, 1);
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };

  for (let r = 4; r <= 5; r += 1) {
    for (let c = 1; c <= grid.columnCount; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = headerFill;
      cell.border = border;
    }
  }
  for (let r = VNEDU_DATA_START_ROW; r < VNEDU_DATA_START_ROW + model.students.length; r += 1) {
    for (let c = 1; c <= grid.columnCount; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.border = border;
      if (c === 1 || c >= 4) cell.alignment = { horizontal: 'center' };
      if (c >= 4 && typeof cell.value === 'number') cell.numFmt = '0.0';
    }
  }

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 28;
  for (let c = 4; c <= grid.columnCount; c += 1) sheet.getColumn(c).width = 15;
  sheet.views = [{ state: 'frozen', ySplit: VNEDU_DATA_START_ROW - 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
