import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v5 as uuidv5 } from 'uuid';


export interface ProgramRecordSource {
  document: string;
  file: string;
  portal: string;
  pdf_pages: number[];
}

export interface ProgramOutcomeDocNode {
  type: string;
  text?: string;
  marks?: unknown[];
  content?: ProgramOutcomeDocNode[];
}

export interface ProgramOutcomeDoc {
  type: 'doc';
  content?: ProgramOutcomeDocNode[];
}

export interface ProgramRecord {
  id: string;
  subject: string;
  grade: number | null;
  level: string;
  stream: string | null;
  section: string | null;
  topic: string | null;
  content: string;
  kind: string;
  outcomes: (string | ProgramOutcomeDoc)[];
  outcome_text: string;
  source: ProgramRecordSource;
}

export interface ProgramDatasetFile {
  subject: string;
  issued_with: string;
  records: ProgramRecord[];
}

export interface ProgramDatasetDef {
  key: string;
  subjectName: string;
  slug: string;
  fileName: string;
}

export const PROGRAM_DATASETS: readonly ProgramDatasetDef[] = [
  { key: 'toan', subjectName: 'Toán', slug: 'toan', fileName: 'program-toan.json' },
  { key: 'nguvan', subjectName: 'Ngữ văn', slug: 'ngu-van', fileName: 'program-nguvan.json' },
  { key: 'tienganh-1-2', subjectName: 'Tiếng Anh', slug: 'tieng-anh', fileName: 'program-tienganh-1-2.json' },
  { key: 'tienganh-3-12', subjectName: 'Tiếng Anh', slug: 'tieng-anh', fileName: 'program-tienganh-3-12.json' },
  { key: 'daoduc', subjectName: 'Đạo đức', slug: 'dao-duc', fileName: 'program-daoduc.json' },
  { key: 'gdcd', subjectName: 'Giáo dục công dân', slug: 'giao-duc-cong-dan', fileName: 'program-gdcd.json' },
  { key: 'gdktpl', subjectName: 'Giáo dục kinh tế và pháp luật', slug: 'giao-duc-kinh-te-va-phap-luat', fileName: 'program-gdktpl.json' },
  { key: 'tnxh', subjectName: 'Tự nhiên và Xã hội', slug: 'tu-nhien-va-xa-hoi', fileName: 'program-tnxh.json' },
  { key: 'khoahoc', subjectName: 'Khoa học', slug: 'khoa-hoc', fileName: 'program-khoahoc.json' },
  { key: 'lsdl-th', subjectName: 'Lịch sử và Địa lí', slug: 'lich-su-va-dia-li', fileName: 'program-lsdl-th.json' },
  { key: 'lsdl-thcs', subjectName: 'Lịch sử và Địa lí', slug: 'lich-su-va-dia-li', fileName: 'program-lsdl-thcs.json' },
  { key: 'lichsu', subjectName: 'Lịch sử', slug: 'lich-su', fileName: 'program-lichsu.json' },
  { key: 'diali', subjectName: 'Địa lí', slug: 'dia-li', fileName: 'program-diali.json' },
  { key: 'khtn', subjectName: 'Khoa học tự nhiên', slug: 'khoa-hoc-tu-nhien', fileName: 'program-khtn.json' },
  { key: 'vatli', subjectName: 'Vật lí', slug: 'vat-li', fileName: 'program-vatli.json' },
  { key: 'hoahoc', subjectName: 'Hoá học', slug: 'hoa-hoc', fileName: 'program-hoahoc.json' },
  { key: 'sinhhoc', subjectName: 'Sinh học', slug: 'sinh-hoc', fileName: 'program-sinhhoc.json' },
  { key: 'tinhoc', subjectName: 'Tin học', slug: 'tin-hoc', fileName: 'program-tinhoc.json' },
  { key: 'congnghe', subjectName: 'Công nghệ', slug: 'cong-nghe', fileName: 'program-congnghe.json' },
  { key: 'gdtc', subjectName: 'Giáo dục thể chất', slug: 'giao-duc-the-chat', fileName: 'program-gdtc.json' },
  { key: 'amnhac', subjectName: 'Âm nhạc', slug: 'am-nhac', fileName: 'program-amnhac.json' },
  { key: 'mithuat', subjectName: 'Mĩ thuật', slug: 'mi-thuat', fileName: 'program-mithuat.json' },
  { key: 'hdtn', subjectName: 'Hoạt động trải nghiệm', slug: 'hoat-dong-trai-nghiem', fileName: 'program-hdtn.json' },
  { key: 'hdtn-hn', subjectName: 'Hoạt động trải nghiệm, hướng nghiệp', slug: 'hoat-dong-trai-nghiem-huong-nghiep', fileName: 'program-hdtn-hn.json' },
];

export function programDatasetByKey(key: string): ProgramDatasetDef | undefined {
  return PROGRAM_DATASETS.find((d) => d.key === key);
}

export function loadProgramDataset(def: ProgramDatasetDef): ProgramDatasetFile {
  const raw = readFileSync(join(__dirname, 'program-data', def.fileName), 'utf8');
  const file = JSON.parse(raw) as ProgramDatasetFile;
  for (const record of file.records) assertProgramRecordOutcomeIntegrity(def.key, record);
  return file;
}

export function programRecordHash(record: ProgramRecord): string {
  const canonical = JSON.stringify([
    record.id, record.subject, record.grade, record.level, record.stream,
    record.section, record.topic, record.content, record.kind,
    record.outcomes, record.outcome_text, record.source,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function programOutcomeDocLines(doc: ProgramOutcomeDoc): string[] {
  const lines: string[] = [];
  const walk = (node: ProgramOutcomeDocNode): void => {
    if (node.type === 'paragraph') {
      const text = (node.content ?? [])
        .filter((child) => child.type === 'text')
        .map((child) => child.text ?? '')
        .join('');
      lines.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return lines;
}

export function programOutcomeDocText(doc: ProgramOutcomeDoc): string {
  return programOutcomeDocLines(doc).join('\n').trim();
}

export function programOutcomeComparisonKey(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token !== '' && !/^[–−+•-]$/.test(token))
    .map((token) => (/^[–−•+]/.test(token) ? token.slice(1) : token))
    .map((token) => token.replace(/[,;]+$/, ''))
    .join(' ');
}

export function assertProgramRecordOutcomeIntegrity(datasetKey: string, record: ProgramRecord): void {
  if (!record.outcomes.some((outcome) => typeof outcome !== 'string')) return;
  const lines = record.outcomes.flatMap((outcome) =>
    typeof outcome === 'string' ? [outcome] : programOutcomeDocLines(outcome),
  );
  const fromOutcomes = programOutcomeComparisonKey(lines.join('\n'));
  const fromText = programOutcomeComparisonKey(record.outcome_text);
  if (fromOutcomes !== fromText) {
    throw new Error(
      `Dataset ${datasetKey}, bản ghi ${record.id}: YCCĐ dạng doc không khớp outcome_text nguyên văn ` +
        `(trích doc: "${fromOutcomes.slice(0, 120)}…" — outcome_text: "${fromText.slice(0, 120)}…"). ` +
        'Không nạp dataset lệch toàn vẹn; đối chiếu lại văn bản nguồn.',
    );
  }
}

export function programOutcomeTextToDoc(text: string): ProgramOutcomeDoc {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line === '' ? [] : [{ type: 'text', text: line }],
    })),
  };
}

export function programRecordOutcomeTexts(record: ProgramRecord): string[] {
  if (record.outcomes.length > 0) {
    return record.outcomes.map((outcome) =>
      typeof outcome === 'string' ? outcome : programOutcomeDocText(outcome),
    );
  }
  if (record.outcome_text.trim().length > 0) return [record.outcome_text];
  return [];
}

export function programRecordSourceRef(record: ProgramRecord): string {
  const pages = record.source.pdf_pages.join(', ');
  return `${record.source.document} — ${record.source.file}, trang ${pages} — bản ghi ${record.id}`;
}

export function programRecordAncestors(record: ProgramRecord): { kind: 'strand' | 'topic'; title: string }[] {
  const titles = [record.stream, record.section, record.topic]
    .filter((title): title is string => title !== null && title.trim() !== '');
  return titles.map((title, i) => ({ kind: i === 0 ? ('strand' as const) : ('topic' as const), title }));
}

export function programRecordTitle(record: ProgramRecord): string {
  for (const title of [record.content, record.topic, record.section]) {
    if (title !== null && title.trim() !== '') return title;
  }
  return record.id;
}

export function programRecordEffectiveGrade(records: readonly ProgramRecord[], record: ProgramRecord): number {
  if (record.grade !== null) return record.grade;
  const graded = records.filter((r) => r.grade !== null);
  const sameLevel = graded.filter((r) => r.level === record.level).map((r) => r.grade as number);
  const pool = sameLevel.length > 0 ? sameLevel : graded.map((r) => r.grade as number);
  return Math.min(...pool);
}


export const PROGRAM_ID_NAMESPACE = '057667e9-ad06-49ca-80ea-50756ad6c0e6';

export function programId(kind: string, naturalKey: string): string {
  return uuidv5(`${kind}|${naturalKey}`, PROGRAM_ID_NAMESPACE);
}

export function programSubjectId(slug: string): string {
  return programId('subject', slug);
}

export function programCurriculumId(slug: string, grade: number): string {
  return programId('curriculum', `${slug}|${grade}`);
}

export function programAncestorNodeId(
  slug: string,
  grade: number,
  path: readonly (readonly [kind: string, title: string])[],
): string {
  return programId('node', `${slug}|${grade}|${JSON.stringify(path)}`);
}

export function programLessonNodeId(datasetKey: string, recordId: string): string {
  return programId('record', `${datasetKey}|${recordId}`);
}

export function programRecordOutcomeEntries(
  record: ProgramRecord,
): { text: string; position: number }[] {
  return programRecordOutcomeTexts(record).map((text, i) => ({
    text,
    position: i + 1,
  }));
}

export function programRecordOutcomeDocs(
  record: ProgramRecord,
): { doc: ProgramOutcomeDoc; text: string; position: number }[] {
  if (record.outcomes.length > 0) {
    return record.outcomes.map((outcome, i) => {
      const doc = typeof outcome === 'string' ? programOutcomeTextToDoc(outcome) : outcome;
      return { doc, text: programOutcomeDocText(doc), position: i + 1 };
    });
  }
  if (record.outcome_text.trim().length > 0) {
    const doc = programOutcomeTextToDoc(record.outcome_text);
    return [{ doc, text: programOutcomeDocText(doc), position: 1 }];
  }
  return [];
}
