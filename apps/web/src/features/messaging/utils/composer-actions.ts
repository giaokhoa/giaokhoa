import { useRef } from "react";
import { boldSelection, linkSelection } from "./composer-format";

interface ComposerOptions {
  draft: string;
  conversationId: string | undefined;
  onReplace: (nextDraft: string) => void;
  onEmojiInserted: () => void;
  promptForLink: () => string | null;
}

export function useComposerActions(options: ComposerOptions) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    draft,
    conversationId,
    onReplace,
    onEmojiInserted,
    promptForLink,
  } = options;

  const replaceRange = (
    start: number,
    end: number,
    inserted: string,
    selectStart: number,
    selectEnd: number,
  ) => {
    if (!conversationId) return;
    onReplace(`${draft.slice(0, start)}${inserted}${draft.slice(end)}`);
    requestAnimationFrame(() => {
      const element = composerRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(selectStart, selectEnd);
    });
  };

  return {
    composerRef,
    applyBold: () => {
      const element = composerRef.current;
      if (!element) return;
      const start = element.selectionStart ?? draft.length;
      const end = element.selectionEnd ?? draft.length;
      const inserted = boldSelection(draft, start, end);
      replaceRange(start, end, inserted, start, start + inserted.length);
    },
    insertLink: () => {
      const element = composerRef.current;
      const raw = promptForLink();
      if (raw === null) return;
      const start = element?.selectionStart ?? draft.length;
      const end = element?.selectionEnd ?? draft.length;
      const inserted = linkSelection(draft, start, end, raw);
      if (inserted === null) return;
      replaceRange(start, end, inserted, start, start + inserted.length);
    },
    insertEmojiAtCursor: (emoji: string) => {
      const element = composerRef.current;
      const start = element?.selectionStart ?? draft.length;
      const end = element?.selectionEnd ?? start;
      replaceRange(
        start,
        end,
        emoji,
        start + emoji.length,
        start + emoji.length,
      );
      onEmojiInserted();
    },
  };
}
