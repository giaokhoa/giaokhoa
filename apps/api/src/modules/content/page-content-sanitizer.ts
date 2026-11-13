import sanitizeHtml from 'sanitize-html';


const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol',
  'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong', 'sub',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
];

const CSS_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,30})$/i;

export function sanitizePageContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['class', 'style'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      ol: ['start', 'type'],
      li: ['value'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        color: [CSS_COLOR_PATTERN],
        'background-color': [CSS_COLOR_PATTERN],
        'font-weight': [/^(bold|normal|bolder|lighter|[1-9]00)$/],
        'font-style': [/^(italic|normal|oblique)$/],
        'text-decoration': [/^(underline|line-through|overline|none)( (underline|line-through|overline))*$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
  });
}

export function isSafeExternalResourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
