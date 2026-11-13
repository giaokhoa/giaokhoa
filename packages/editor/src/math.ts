import { renderToString } from 'katex';
import 'katex/contrib/mhchem';


export function renderMathHtml(latex: string, displayMode: boolean): string {
  return renderToString(latex, { displayMode, throwOnError: false, trust: false });
}

export function validateMathLatex(latex: string): string | null {
  if (!latex.trim()) {
    return 'Chưa nhập công thức.';
  }
  try {
    renderToString(latex, { displayMode: false, throwOnError: true, trust: false });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Công thức LaTeX không hợp lệ.';
  }
}
