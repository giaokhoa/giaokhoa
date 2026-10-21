import type { RenderTikz } from '@giaokhoa/editor';
import { hasUnsafeSvgCss, MAX_TIKZ_SOURCE_LENGTH } from '@giaokhoa/shared/files';

const TIKZ_RUNTIME_VERSION = '0.3.1';
const TIKZ_RUNTIME_DIRECTORY = `vendor/tikz-runtime/v${TIKZ_RUNTIME_VERSION}/`;
const TIKZ_STALL_TIMEOUT_MS = 20_000;
const TIKZ_HARD_TIMEOUT_MS = 60_000;

type Diagnostic = {
  severity: 'error' | 'warning';
  source?: string;
  message: string;
  line?: number;
};

type LatexResult = {
  status: 'ok' | 'warning' | 'error' | 'fatal';
  pages: string[];
  diagnostics: Diagnostic[];
};

type WorkerSuccess = {
  id: number;
  ok: true;
  result?: LatexResult;
};

type WorkerFailure = {
  id: number;
  ok: false;
  error: string;
};

type WorkerEvent = {
  event: 'started' | 'progress' | 'log';
  id?: number;
};

type WorkerMessage = WorkerSuccess | WorkerFailure | WorkerEvent;

type PendingCall = {
  resolve: (value: LatexResult | undefined) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
};

let enginePromise: Promise<BrowserTikzEngine> | undefined;

function runtimeBaseUrl() {
  const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(TIKZ_RUNTIME_DIRECTORY, appBaseUrl).href;
}

class BrowserTikzEngine {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private activeRequestId: number | undefined;
  private disposed = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      this.failAll(new Error(event.message || 'TikZ runtime gặp lỗi.'));
    });
    worker.addEventListener('messageerror', () => {
      this.failAll(new Error('TikZ runtime trả về dữ liệu không hợp lệ.'));
    });
  }

  static async create(): Promise<BrowserTikzEngine> {
    const worker = new Worker(new URL('browser-worker.js', runtimeBaseUrl()), {
      type: 'module',
      name: 'giaokhoa-tikz',
    });
    const engine = new BrowserTikzEngine(worker);

    try {
      await engine.call('init', {
        options: {
          bundleBaseUrl: new URL('bundles/', runtimeBaseUrl()).href,
          prefetch: ['latex'],
          logLevel: 'warn',
        },
      });
      return engine;
    } catch (cause) {
      engine.dispose();
      throw cause;
    }
  }

  async latex(source: string, options: Record<string, unknown>): Promise<LatexResult> {
    const result = await this.call('latex', { source, options });
    if (!result) throw new Error('TikZ runtime không trả về kết quả.');
    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.activeRequestId = undefined;
    this.failAll(new Error('TikZ runtime đã dừng.'));
  }

  private call(
    op: 'init' | 'latex',
    payload: Record<string, unknown>,
  ): Promise<LatexResult | undefined> {
    if (this.disposed) return Promise.reject(new Error('TikZ runtime đã dừng.'));

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const pending: PendingCall = { resolve, reject };
      pending.deadlineTimer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        this.clearTimer(pending);
        reject(new Error(`TikZ vượt quá ${TIKZ_HARD_TIMEOUT_MS} ms; worker đã dừng.`));
        this.dispose();
      }, TIKZ_HARD_TIMEOUT_MS);
      this.pending.set(id, pending);
      this.worker.postMessage({ id, op, ...payload });
    });
  }

  private handleMessage(message: WorkerMessage) {
    if ('event' in message) {
      if (message.event === 'started' && message.id !== undefined) {
        this.activeRequestId = message.id;
        this.armStallTimer(message.id);
      } else if (message.event === 'progress' || message.event === 'log') {
        const id = message.id ?? this.activeRequestId;
        if (id !== undefined) this.armStallTimer(id);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.clearTimer(pending);
    this.pending.delete(message.id);
    if (this.activeRequestId === message.id) this.activeRequestId = undefined;
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error));
    }
  }

  private armStallTimer(id: number) {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.clearStallTimer(pending);
    pending.timer = setTimeout(() => {
      const stalled = this.pending.get(id);
      if (!stalled) return;

      this.pending.delete(id);
      this.clearTimer(stalled);
      stalled.reject(
        new Error(
          `mp-tikz-wasm: latex made no progress for ${TIKZ_STALL_TIMEOUT_MS} ms; worker terminated`,
        ),
      );
      this.dispose();
    }, TIKZ_STALL_TIMEOUT_MS);
  }

  private clearStallTimer(pending: PendingCall) {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }
  }

  private clearTimer(pending: PendingCall) {
    this.clearStallTimer(pending);
    if (pending.deadlineTimer !== undefined) {
      clearTimeout(pending.deadlineTimer);
      pending.deadlineTimer = undefined;
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      this.clearTimer(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function getEngine(): Promise<BrowserTikzEngine> {
  if (enginePromise) return enginePromise;

  const promise = BrowserTikzEngine.create();
  enginePromise = promise;
  void promise.catch(() => {
    if (enginePromise === promise) enginePromise = undefined;
  });
  return promise;
}

function latexDocument(source: string) {
  if (/\\documentclass(?:\s|\[|\{)/.test(source)) return source;

  return String.raw`\documentclass[tikz,border=2pt]{standalone}
\begin{document}
${source}
\end{document}`;
}

async function sanitizeSvg(svg: string) {
  const { default: DOMPurify } = await import('dompurify');
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
  });

  const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('SVG TikZ không hợp lệ.');

  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    throw new Error('TikZ không tạo được SVG hợp lệ.');
  }

  // Kiểm tra ngay lúc preview để không tải tài nguyên ngoài; API cũng phải
  // sanitize độc lập vì dữ liệu từ browser không đáng tin cậy.
  for (const element of [root, ...root.querySelectorAll('style, [style]')]) {
    const css =
      element.localName === 'style'
        ? (element.textContent ?? '')
        : (element.getAttribute('style') ?? '');
    if (hasUnsafeSvgCss(css)) throw new Error('SVG TikZ chứa tham chiếu CSS không an toàn.');
  }

  for (const element of root.querySelectorAll('[href], [xlink\\:href]')) {
    const href = element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#')) element.remove();
  }

  return new XMLSerializer().serializeToString(root);
}

export const renderTikz: RenderTikz = async (source) => {
  if (source.length > MAX_TIKZ_SOURCE_LENGTH) {
    throw new Error(`Mã TikZ không được vượt quá ${MAX_TIKZ_SOURCE_LENGTH} ký tự.`);
  }
  const currentEnginePromise = getEngine();
  const engine = await currentEnginePromise;
  let result: LatexResult;

  try {
    result = await engine.latex(latexDocument(source), {
      engine: 'auto',
      output: 'svg',
      fonts: 'paths',
      bbox: 'min',
      svg: { units: 'px' },
    });
  } catch (cause) {
    engine.dispose();
    if (enginePromise === currentEnginePromise) enginePromise = undefined;
    throw cause;
  }

  const diagnostics = result.diagnostics.map(({ severity, source, message, line }) => ({
    severity,
    source,
    message,
    line,
  }));

  if (result.status === 'error' || result.status === 'fatal') {
    const first = diagnostics.find(({ severity }) => severity === 'error');
    throw new Error(first?.message ?? 'TikZ không biên dịch được.');
  }
  if (result.pages.length !== 1) {
    throw new Error('Mỗi hình TikZ phải tạo đúng một trang SVG.');
  }

  return {
    svg: await sanitizeSvg(result.pages[0]),
    diagnostics,
  };
};
