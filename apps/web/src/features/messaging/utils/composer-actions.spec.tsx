import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerActions } from "./composer-actions";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type ComposerActions = ReturnType<typeof useComposerActions>;

interface DualComposerProps {
  conversationId: string | undefined;
  promptForLink: () => string | null;
  onMessageReplace: (nextDraft: string) => void;
  onNoteReplace: (nextDraft: string) => void;
  onNoteTyping: () => void;
  onMessageEmojiInserted: () => void;
  onReady: (actions: { message: ComposerActions; note: ComposerActions }) => void;
}

function DualComposer({
  conversationId,
  promptForLink,
  onMessageReplace,
  onNoteReplace,
  onNoteTyping,
  onMessageEmojiInserted,
  onReady,
}: DualComposerProps) {
  const [messageDraft, setMessageDraft] = useState("xin chào");
  const [noteDraft, setNoteDraft] = useState("ghi chú");
  const {
    composerRef: messageComposerRef,
    applyBold: applyMessageBold,
    insertLink: insertMessageLink,
    insertEmojiAtCursor: insertMessageEmojiAtCursor,
  } = useComposerActions({
    draft: messageDraft,
    conversationId,
    onReplace: (nextDraft) => {
      onMessageReplace(nextDraft);
      setMessageDraft(nextDraft);
      onNoteTyping();
    },
    onEmojiInserted: onMessageEmojiInserted,
    promptForLink,
  });
  const {
    composerRef: noteComposerRef,
    applyBold: applyNoteBold,
    insertLink: insertNoteLink,
    insertEmojiAtCursor: insertNoteEmojiAtCursor,
  } = useComposerActions({
    draft: noteDraft,
    conversationId,
    onReplace: (nextDraft) => {
      onNoteReplace(nextDraft);
      setNoteDraft(nextDraft);
    },
    onEmojiInserted: () => undefined,
    promptForLink,
  });
  useEffect(() => {
    onReady({
      message: {
        composerRef: messageComposerRef,
        applyBold: applyMessageBold,
        insertLink: insertMessageLink,
        insertEmojiAtCursor: insertMessageEmojiAtCursor,
      },
      note: {
        composerRef: noteComposerRef,
        applyBold: applyNoteBold,
        insertLink: insertNoteLink,
        insertEmojiAtCursor: insertNoteEmojiAtCursor,
      },
    });
  });
  return (
    <>
      <textarea
        data-testid="message-composer"
        ref={messageComposerRef}
        value={messageDraft}
        onChange={(event) => setMessageDraft(event.target.value)}
      />
      <textarea
        data-testid="note-composer"
        ref={noteComposerRef}
        value={noteDraft}
        onChange={(event) => setNoteDraft(event.target.value)}
      />
    </>
  );
}

function renderDualComposer(overrides: Partial<DualComposerProps> = {}) {
  const onMessageReplace = vi.fn();
  const onNoteReplace = vi.fn();
  const onNoteTyping = vi.fn();
  const onMessageEmojiInserted = vi.fn();
  const promptForLink = vi.fn(() => "example.org");
  const holder: { current: { message: ComposerActions; note: ComposerActions } | null } = { current: null };
  render(
    <DualComposer
      conversationId="conv-1"
      promptForLink={promptForLink}
      onMessageReplace={onMessageReplace}
      onNoteReplace={onNoteReplace}
      onNoteTyping={onNoteTyping}
      onMessageEmojiInserted={onMessageEmojiInserted}
      onReady={(actions) => {
        holder.current = actions;
      }}
      {...overrides}
    />,
  );
  if (!holder.current) throw new Error("composer hooks not attached");
  return { captured: holder.current, onMessageReplace, onNoteReplace, onNoteTyping, onMessageEmojiInserted, promptForLink };
}

describe("Thao tác soạn thảo của hai ô tin nhắn và ghi chú", () => {
  afterEach(() => {
    cleanup();
  });

  it("hai ô soạn thảo gắn đúng ref riêng của từng hook", () => {
    const { captured } = renderDualComposer();
    const messageComposer = screen.getByTestId("message-composer");
    const noteComposer = screen.getByTestId("note-composer");
    expect(captured.message.composerRef.current).toBe(messageComposer);
    expect(captured.note.composerRef.current).toBe(noteComposer);
    expect(captured.message.composerRef.current).not.toBe(captured.note.composerRef.current);
  });

  it("bôi đậm bản nháp tin nhắn khôi phục vùng chọn phủ đúng đoạn đã bọc và chỉ báo đang gõ ở bản nháp tin nhắn", async () => {
    const { captured, onMessageReplace, onNoteTyping } = renderDualComposer();
    const composer = screen.getByTestId("message-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(0, 8);
    act(() => {
      captured.message.applyBold();
    });
    expect(onMessageReplace).toHaveBeenCalledWith("**xin chào**");
    expect(onNoteTyping).toHaveBeenCalledTimes(1);
    expect(composer.value).toBe("**xin chào**");
    await waitFor(() => {
      expect(document.activeElement).toBe(composer);
      expect(composer.selectionStart).toBe(0);
      expect(composer.selectionEnd).toBe(12);
    });
  });

  it("bôi đậm bản nháp ghi chú không báo đang gõ", () => {
    const { captured, onNoteReplace, onNoteTyping } = renderDualComposer();
    const composer = screen.getByTestId("note-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(0, 7);
    act(() => {
      captured.note.applyBold();
    });
    expect(onNoteReplace).toHaveBeenCalledWith("**ghi chú**");
    expect(onNoteTyping).not.toHaveBeenCalled();
  });

  it("chèn liên kết vào bản nháp tin nhắn bọc vùng chọn và khôi phục vùng chọn phủ đúng liên kết", async () => {
    const { captured, onMessageReplace } = renderDualComposer();
    const composer = screen.getByTestId("message-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(4, 8);
    act(() => {
      captured.message.insertLink();
    });
    expect(onMessageReplace).toHaveBeenCalledWith("xin [chào](https://example.org)");
    expect(composer.value).toBe("xin [chào](https://example.org)");
    await waitFor(() => {
      expect(composer.selectionStart).toBe(4);
      expect(composer.selectionEnd).toBe(4 + "[chào](https://example.org)".length);
    });
  });

  it("hủy nhập liên kết thì bản nháp tin nhắn không đổi", () => {
    const promptForLink = vi.fn(() => null);
    const { captured, onMessageReplace } = renderDualComposer({ promptForLink });
    const composer = screen.getByTestId("message-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(4, 8);
    act(() => {
      captured.message.insertLink();
    });
    expect(promptForLink).toHaveBeenCalledTimes(1);
    expect(onMessageReplace).not.toHaveBeenCalled();
    expect(composer.value).toBe("xin chào");
  });

  it("nhập liên kết rỗng thì bản nháp tin nhắn không đổi", () => {
    const promptForLink = vi.fn(() => "");
    const { captured, onMessageReplace } = renderDualComposer({ promptForLink });
    const composer = screen.getByTestId("message-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(4, 8);
    act(() => {
      captured.message.insertLink();
    });
    expect(promptForLink).toHaveBeenCalledTimes(1);
    expect(onMessageReplace).not.toHaveBeenCalled();
    expect(composer.value).toBe("xin chào");
  });

  it("không có cuộc trò chuyện thì bôi đậm, chèn emoji và chèn liên kết đều không thay bản nháp", () => {
    const { captured, onMessageReplace, promptForLink } = renderDualComposer({
      conversationId: undefined,
    });
    const composer = screen.getByTestId("message-composer") as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(0, 8);
    act(() => {
      captured.message.applyBold();
      captured.message.insertEmojiAtCursor("😀");
      captured.message.insertLink();
    });
    expect(promptForLink).toHaveBeenCalledTimes(1);
    expect(onMessageReplace).not.toHaveBeenCalled();
    expect(composer.value).toBe("xin chào");
  });
});
