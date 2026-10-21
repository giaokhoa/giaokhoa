import { hasUnsafeSvgCss } from '@giaokhoa/shared/files';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const purifierWindow = new JSDOM('').window;
const purifier = createDOMPurify(
  purifierWindow as unknown as Parameters<typeof createDOMPurify>[0],
);

const SVG_LENGTH = /^([0-9]+(?:\.[0-9]+)?)(px|pt|pc|in|cm|mm|q)?$/i;
const UNIT_TO_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

function parseLength(value: string | null) {
  if (!value) return undefined;
  const match = value.trim().match(SVG_LENGTH);
  if (!match) return undefined;
  const number = Number(match[1]);
  const factor = UNIT_TO_PX[(match[2] ?? '').toLowerCase()];
  return Number.isFinite(number) && factor ? number * factor : undefined;
}

function parseViewBox(value: string | null) {
  if (!value) return undefined;
  const values = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4 || values.some((part) => !Number.isFinite(part))) return undefined;
  const width = values[2];
  const height = values[3];
  return width > 0 && height > 0 ? { width, height } : undefined;
}

export function sanitizeAndInspectSvg(input: string) {
  const clean = purifier.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
  });

  let dom: JSDOM;
  try {
    dom = new JSDOM(clean, { contentType: 'image/svg+xml' });
  } catch {
    throw new Error('SVG không hợp lệ');
  }

  const root = dom.window.document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('File không phải SVG hợp lệ');
  }

  for (const element of [root, ...root.querySelectorAll('style, [style]')]) {
    const css =
      element.localName === 'style'
        ? (element.textContent ?? '')
        : (element.getAttribute('style') ?? '');
    if (hasUnsafeSvgCss(css)) throw new Error('SVG chứa tham chiếu CSS không an toàn');
  }

  for (const element of root.querySelectorAll('[href], [xlink\\:href]')) {
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#')) element.remove();
  }

  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const width = parseLength(root.getAttribute('width')) ?? viewBox?.width;
  const height = parseLength(root.getAttribute('height')) ?? viewBox?.height;
  if (!width || !height) throw new Error('SVG phải có kích thước hoặc viewBox hợp lệ');

  return {
    svg: root.outerHTML,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}
