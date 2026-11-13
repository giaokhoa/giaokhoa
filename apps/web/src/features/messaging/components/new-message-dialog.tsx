import { Copy } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@giaokhoa/ui/components/dialog';
import { Input } from '@giaokhoa/ui/components/input';
import { useTranslation } from 'react-i18next';
import { PeoplePicker } from './people-picker';
import type {
  ContactRequestView,
  MessagingCourse,
  PeoplePickerContext,
  RosterMember,
} from '../types/types';
import { initialsOf } from '../utils/utils';

interface NewMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incomingRequests: ContactRequestView[];
  outgoingRequests: ContactRequestView[];
  contacts: string[];
  contactMessage: string | null;
  blocked: string[];
  blockMessage: string | null;
  nameOf: (userId: string) => string;
  onMessageContact: (userId: string) => void;
  onSendContactRequest: (userId: string) => void;
  onRespondContactRequest: (userId: string, action: 'accept' | 'decline') => void;
  onUnblockContact: (userId: string) => void;
  pickerContext: PeoplePickerContext;
  onSelectPickerContext: (context: PeoplePickerContext) => void;
  pickerClasses: { classId: string; name: string }[];
  pickerCourses: MessagingCourse[];
  pickerMembers: RosterMember[];
  pickerRosterError: string | null;
  pickerRosterCursor: string | null;
  onLoadMorePicker: () => void;
}

export function NewMessageDialog({
  open, onOpenChange, incomingRequests, outgoingRequests, contacts, contactMessage,
  blocked, blockMessage, nameOf, onMessageContact, onSendContactRequest,
  onRespondContactRequest, onUnblockContact, pickerContext, onSelectPickerContext,
  pickerClasses, pickerCourses, pickerMembers, pickerRosterError, pickerRosterCursor,
  onLoadMorePicker,
}: NewMessageDialogProps) {
  const { t } = useTranslation('app');

  const renderMemberAction = (m: RosterMember) => (
    <>
      {m.canDirectMessage && m.relationship !== 'contact' ? (
        <Button type="button" variant="outline" onClick={() => void onMessageContact(m.userId)}>
          {t('messageWithContact')}
        </Button>
      ) : null}
      {m.relationship === 'none' ? (
        <Button type="button" variant="outline" onClick={() => void onSendContactRequest(m.userId)}>
          {t('addContact')}
        </Button>
      ) : null}
      {m.relationship === 'pending_outgoing' ? (
        <span className="text-sm text-muted-foreground">{t('contactRequestPendingSuffix')}</span>
      ) : null}
      {m.relationship === 'pending_incoming' ? (
        <>
          <Button type="button" variant="outline" onClick={() => void onRespondContactRequest(m.userId, 'accept')}>
            {t('acceptContactRequest')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void onRespondContactRequest(m.userId, 'decline')}>
            {t('declineContactRequest')}
          </Button>
        </>
      ) : null}
      {m.relationship === 'contact' ? (
        <Button type="button" variant="outline" onClick={() => void onMessageContact(m.userId)}>
          {t('messageWithContact')}
        </Button>
      ) : null}
    </>
  );

  const recipientContextLabel = pickerContext.kind === 'contacts'
    ? t('newMessageContactsContext')
    : pickerContext.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('newMessage')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {contactMessage ? <p role="status" className="text-sm">{contactMessage}</p> : null}
          {incomingRequests.length > 0 ? (
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {t('incomingRequestsTitle')}
                <Badge>{incomingRequests.length}</Badge>
              </h3>
              <ul className="space-y-1">
                {incomingRequests.map((r) => (
                  <li key={r.userId} data-testid={`incoming-request-${r.userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                    <Avatar>
                      <AvatarFallback>{initialsOf(r.displayName ?? nameOf(r.userId))}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm">{r.displayName ?? nameOf(r.userId)}</span>
                    <Button type="button" variant="outline" onClick={() => void onRespondContactRequest(r.userId, 'accept')}>
                      {t('acceptContactRequest')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void onRespondContactRequest(r.userId, 'decline')}>
                      {t('declineContactRequest')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {outgoingRequests.length > 0 ? (
            <div className="space-y-2">
              <h3 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('outgoingRequestsTitle')}</h3>
              <ul className="space-y-1">
                {outgoingRequests.map((r) => (
                  <li key={r.userId} className="px-2 py-2.5 text-sm">
                    {r.displayName ?? nameOf(r.userId)} {t('contactRequestPendingSuffix')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1">
              <span className="shrink-0 text-sm text-muted-foreground">{t('messageToLabel')}</span>
              <span className="min-w-0 truncate text-sm">{recipientContextLabel}</span>
            </div>
            <PeoplePicker
              context={pickerContext}
              onSelectContext={onSelectPickerContext}
              classes={pickerClasses}
              courses={pickerCourses}
              members={pickerMembers}
              rosterError={pickerRosterError}
              rosterCursor={pickerRosterCursor}
              onLoadMore={onLoadMorePicker}
              renderMemberAction={renderMemberAction}
            />
            {pickerContext.kind === 'contacts' ? (
              <>
                <ul className="space-y-1">
                  {contacts.map((userId) => (
                    <li key={userId} data-testid={`contact-${userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                      <Avatar>
                        <AvatarFallback>{initialsOf(nameOf(userId))}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm">{nameOf(userId)}</span>
                      <Button type="button" variant="outline" onClick={() => void onMessageContact(userId)}>
                        {t('messageWithContact')}
                      </Button>
                    </li>
                  ))}
                </ul>
                {contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noContacts')}</p>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('blockedContactsTitle')}</h3>
            {blockMessage ? <p role="status" className="text-sm">{blockMessage}</p> : null}
            <ul className="space-y-1">
              {blocked.map((userId) => (
                <li key={userId} data-testid={`blocked-${userId}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                  <span className="min-w-0 flex-1 truncate text-sm">{nameOf(userId)}</span>
                  <Button type="button" variant="outline" onClick={() => void onUnblockContact(userId)}>
                    {t('unblockContact')}
                  </Button>
                </li>
              ))}
            </ul>
            {blocked.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noBlockedContacts')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('inviteLinkLabel')}</h3>
            <div className="flex gap-2">
              <Input
                aria-label={t('inviteLinkLabel')}
                placeholder={t('inviteLinkPlaceholder')}
                disabled
                value=""
                readOnly
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('copyInviteLink')} disabled>
                <Copy className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
