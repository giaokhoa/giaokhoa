import { MULTIPLE_CHOICE_COUNT } from '@giaokhoa/shared/questions';
import type { JSONContent } from '@tiptap/core';
import { memo, type ReactNode, useId, useLayoutEffect, useRef } from 'react';
import { splitMultipleChoiceDocument } from './multiple-choice.js';
import { TiptapContent, getTextContent } from './tiptap-content.js';

type OptionColumns = 1 | 2 | typeof MULTIPLE_CHOICE_COUNT;

function chooseOptionColumns(width: number, widest: number, gap: number): OptionColumns {
  return (
    ([MULTIPLE_CHOICE_COUNT, 2, 1] as const).find(
      (columns) => columns * widest + (columns - 1) * gap <= width,
    ) ?? 1
  );
}

function applyOptionColumns(element: HTMLDivElement, columns: OptionColumns) {
  if (element.dataset.optionColumns === String(columns)) return;

  element.dataset.optionColumns = String(columns);
  element.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
}

function measureWidestOption(source: HTMLDivElement, measurement: HTMLDivElement) {
  measurement.replaceChildren(
    ...Array.from(source.children, (item) => {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input').forEach((input) => input.remove());
      clone.style.flex = '0 0 max-content';
      clone.style.width = 'max-content';
      clone.style.maxWidth = 'none';
      return clone;
    }),
  );

  return Math.max(
    0,
    ...Array.from(measurement.children, (item) => item.getBoundingClientRect().width),
  );
}

function OptionLayout({
  children,
  compact,
  layoutKey,
}: {
  children: ReactNode;
  compact: boolean;
  layoutKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const measurement = measurementRef.current;
    if (!element || !measurement) return;

    if (!compact) {
      applyOptionColumns(element, 1);
      return;
    }

    let width = element.getBoundingClientRect().width;

    const measureContent = () => {
      const widest = measureWidestOption(element, measurement);
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      applyOptionColumns(element, chooseOptionColumns(width, widest, gap));
    };

    measureContent();
    document.fonts.addEventListener('loadingdone', measureContent);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      measureContent();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      document.fonts.removeEventListener('loadingdone', measureContent);
    };
  }, [compact, layoutKey]);

  return (
    <div className="@container">
      {/* Khớp chiều rộng đáp án rỗng trước hydration, gồm badge, khoảng cách, padding và viền. */}
      <div
        ref={ref}
        data-compact={compact}
        className="mt-4 grid grid-cols-1 gap-x-3 gap-y-2 *:max-w-full @[calc(15.25rem+8px)]:data-[compact=true]:grid-cols-4 @[calc(7.25rem+4px)]:@max-[calc(15.25rem+8px)]:data-[compact=true]:grid-cols-2"
      >
        {children}
      </div>
      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible fixed top-0 right-full flex w-max flex-nowrap gap-x-3 gap-y-2"
        style={{ contain: 'layout style paint' }}
      />
    </div>
  );
}

export const MultipleChoicePreview = memo(function MultipleChoicePreview({
  content,
}: {
  content: JSONContent;
}) {
  const groupName = useId();
  const { question, choices } = splitMultipleChoiceDocument(content);
  const compact =
    choices.length === MULTIPLE_CHOICE_COUNT &&
    choices.every(
      (choice) => choice.content?.length === 1 && choice.content[0]?.type === 'paragraph',
    );
  const layoutKey = choices.map(getTextContent).join('\u0000');

  return (
    <div>
      <TiptapContent content={question} />
      <OptionLayout compact={compact} layoutKey={layoutKey}>
        {choices.map((choice, index) => (
          <label
            key={choice.attrs?.id}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors hover:bg-muted/30 has-[:checked]:bg-muted/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
          >
            <input
              className="peer sr-only"
              type="radio"
              name={groupName}
              value={choice.attrs?.id}
            />
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground"
              aria-hidden="true"
            >
              {String.fromCharCode(65 + index)}
            </span>
            <span className="min-w-0 flex-1 leading-6">
              <TiptapContent content={{ type: 'doc', content: choice.content }} />
            </span>
          </label>
        ))}
      </OptionLayout>
    </div>
  );
});
