import type { FormEvent, RefObject } from 'react';
import { Link2, Paperclip, Send, Smile, X } from 'lucide-react';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@giaokhoa/ui/components/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { useTranslation } from 'react-i18next';

import { QUICK_REPLY_SHAPE_SAMPLES } from '../api/person-profile-adapter';
import type { ConversationView, MessageView } from '../types/types';
import { quoteExcerptOfText } from '../utils/utils';

const EMOJI_GRID_OPTIONS = [
  '😀', '😂', '😊', '😍', '🥳',
  '👍', '👏', '🙏', '❤️', '🔥',
  '✅', '👋', '🎉', '💯', '🤔',
  '😅', '🙌', '💪', '✨', '🚀',
];

interface ChatComposerProps {
  active: ConversationView;
  draft: string;
  noteDraft: string;
  composerTab: 'reply' | 'note';
  onComposerTabChange: (tab: 'reply' | 'note') => void;
  replyTarget: MessageView | null;
  onCancelReply: () => void;
  nameOf: (userId: string) => string;
  sendError: string | null;
  sendInFlight: boolean;
  noteNoticeFor: string | null;
  onSend: (event: FormEvent) => void;
  onSendNote: (event: FormEvent) => void;
  onDraftChange: (value: string) => void;
  onNoteDraftChange: (value: string) => void;
  replyComposerRef: RefObject<HTMLTextAreaElement | null>;
  onApplyReplyBold: () => void;
  onInsertReplyLink: () => void;
  onInsertReplyEmoji: (emoji: string) => void;
  noteComposerRef: RefObject<HTMLTextAreaElement | null>;
  onApplyNoteBold: () => void;
  onInsertNoteLink: () => void;
  onInsertNoteEmoji: (emoji: string) => void;
  emojiOpen: boolean;
  onEmojiOpenChange: (open: boolean) => void;
  noteEmojiOpen: boolean;
  onNoteEmojiOpenChange: (open: boolean) => void;
}

export function ChatComposer({
  active, draft, noteDraft, composerTab, onComposerTabChange, replyTarget, onCancelReply,
  nameOf, sendError, sendInFlight, noteNoticeFor, onSend, onSendNote, onDraftChange,
  onNoteDraftChange, replyComposerRef, onApplyReplyBold, onInsertReplyLink,
  onInsertReplyEmoji, noteComposerRef, onApplyNoteBold, onInsertNoteLink,
  onInsertNoteEmoji, emojiOpen, onEmojiOpenChange, noteEmojiOpen, onNoteEmojiOpenChange,
}: ChatComposerProps) {
  const { t } = useTranslation('app');
  return (
<div className="flex flex-col gap-3 px-3 pb-2">
  {active.enabled === false && !active.canManage ? (
    <p role="status" className="text-sm text-muted-foreground">{t('chatDisabledNotice')}</p>
  ) : (
    <>
      {active.enabled === false ? (
        <p role="status" className="text-sm text-muted-foreground">{t('chatDisabledForMembers')}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REPLY_SHAPE_SAMPLES.map((sample) => (
          <Button
            key={sample}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto rounded-full px-3 py-1 text-xs font-normal text-muted-foreground shadow-none hover:bg-muted"
            disabled
          >
            {sample}
          </Button>
        ))}
      </div>
      <Tabs
        value={composerTab}
        onValueChange={(value) => {
          onComposerTabChange(value === 'note' ? 'note' : 'reply');
        }}
        className="border-border rounded-md border"
      >
        <TabsList
          variant="line"
          className="w-full justify-start gap-2 border-b px-3 group-data-horizontal/tabs:h-10 **:data-[slot=tabs-trigger]:border-x-0 **:data-[slot=tabs-trigger]:px-6"
        >
          <TabsTrigger value="reply" className="flex-none px-1">{t('replyTabLabel')}</TabsTrigger>
          <TabsTrigger value="note" className="flex-none px-1">{t('internalNoteTabLabel')}</TabsTrigger>
        </TabsList>
        <TabsContent value="reply" className="m-0">
          {replyTarget ? (
            <div className="px-3 pt-3">
              <div
                data-testid="reply-chip"
                className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-primary">{t('replyingTo', { user: nameOf(replyTarget.userIdFrom) })}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {replyTarget.recalledAt ? t('quotedMessageUnavailable') : quoteExcerptOfText(replyTarget.fullMessage)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('cancelReply')}
                  onClick={() => onCancelReply()}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
          <form onSubmit={(e) => void onSend(e)} className="flex flex-col gap-2 px-3 pb-2">
            <Textarea
              ref={replyComposerRef}
              aria-label={t('messageText')}
              placeholder={t('messagePlaceholder')}
              rows={1}
              className="max-h-32 min-h-10 min-w-0 resize-none rounded-none border-0 px-0 py-2 text-sm shadow-none focus-visible:ring-0"
              value={draft}
              onChange={(e) => {
                onDraftChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!sendInFlight) e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('boldLabel')}
                  onClick={onApplyReplyBold}
                >
                  <span className="text-base leading-none font-medium">B</span>
                </Button>
                <Popover open={emojiOpen} onOpenChange={onEmojiOpenChange}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('emojiPickerLabel')}
                      />
                    }
                  >
                    <Smile aria-hidden />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={4}
                    data-testid="emoji-picker-popover"
                    className="w-64 p-2"
                  >
                    <div className="grid grid-cols-5 gap-1">
                      {EMOJI_GRID_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="rounded-md p-2 text-lg transition-colors hover:bg-muted"
                          onClick={() => onInsertReplyEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('attachFileLabel')}
                  disabled
                >
                  <Paperclip aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('insertLinkLabel')}
                  onClick={onInsertReplyLink}
                >
                  <Link2 aria-hidden />
                </Button>
              </div>
              <Button
                type="submit"
                size="icon-sm"
                aria-label={t('send')}
                disabled={sendInFlight || !draft.trim()}
              >
                <Send aria-hidden />
              </Button>
            </div>
          </form>
        </TabsContent>
        <TabsContent value="note" className="m-0">
          <form onSubmit={onSendNote} className="flex flex-col gap-2 px-3 pb-2">
            <Textarea
              ref={noteComposerRef}
              aria-label={t('internalNoteTabLabel')}
              placeholder={t('internalNotePlaceholder')}
              rows={1}
              className="max-h-32 min-h-10 min-w-0 resize-none rounded-none border-0 px-0 py-2 text-sm shadow-none focus-visible:ring-0"
              value={noteDraft}
              onChange={(e) => {
                onNoteDraftChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('boldLabel')}
                  onClick={onApplyNoteBold}
                >
                  <span className="text-base leading-none font-medium">B</span>
                </Button>
                <Popover open={noteEmojiOpen} onOpenChange={onNoteEmojiOpenChange}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('emojiPickerLabel')}
                      />
                    }
                  >
                    <Smile aria-hidden />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={4}
                    data-testid="note-emoji-picker-popover"
                    className="w-64 p-2"
                  >
                    <div className="grid grid-cols-5 gap-1">
                      {EMOJI_GRID_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="rounded-md p-2 text-lg transition-colors hover:bg-muted"
                          onClick={() => onInsertNoteEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('attachFileLabel')}
                  disabled
                >
                  <Paperclip aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('insertLinkLabel')}
                  onClick={onInsertNoteLink}
                >
                  <Link2 aria-hidden />
                </Button>
              </div>
              <Button
                type="submit"
                size="icon-sm"
                aria-label={t('send')}
                disabled={!noteDraft.trim()}
              >
                <Send aria-hidden />
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
      {noteNoticeFor === active.id ? (
        <p role="status" className="text-sm text-muted-foreground">{t('internalNoteLocalNotice')}</p>
      ) : null}
      {sendError ? (
        <p role="alert" className="text-sm text-destructive">{sendError}</p>
      ) : null}
    </>
  )}
</div>
  );
}
