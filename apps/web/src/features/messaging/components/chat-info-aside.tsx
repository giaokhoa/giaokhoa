import { Bell, BellOff, Building2, Clock, FileText, Flag, Globe, Mail, MapPin, Phone, Pin, PinOff, Sparkles, Trash, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import { Separator } from '@giaokhoa/ui/components/separator';
import { useTranslation } from 'react-i18next';

import type { PersonProfileView, SharedFileView } from '../api/person-profile-adapter';
import type { ConversationStatePatch, ConversationView, MemberPanelEntry, PresenceStatus } from '../types/types';
import { MemberPanel, type MemberPanelBundle } from './member-panel';
import { FileCard } from './file-card';
import {
  PRESENCE_DOT_CLASS, initialsOf, presenceLabelKey,
} from '../utils/utils';

interface ChatInfoAsideProps {
  active: ConversationView;
  isGroup: boolean;
  otherId: string | undefined;
  title: string;
  avatarLabel: string;
  otherStatus: PresenceStatus | undefined;
  blocked: string[];
  memberPanelBundle: MemberPanelBundle | null;
  newestSeq: number;
  myId: string | undefined;
  onlineUsers: Record<string, boolean>;
  readMarkers: Record<string, number>;
  partnerProfile: PersonProfileView | null;
  sharedFiles: SharedFileView[];
  nameOf: (userId: string) => string;
  onCloseInfo: () => void;
  onUpdateConversationState: (conversation: ConversationView, patch: ConversationStatePatch) => void;
  onBlockContact: (userId: string) => void;
  onUnblockContact: (userId: string) => void;
  onViewProfile: (entry: MemberPanelEntry) => void;
}

export function ChatInfoAside({
  active, isGroup, otherId, title, avatarLabel, otherStatus, blocked, memberPanelBundle,
  newestSeq, myId, onlineUsers, readMarkers, partnerProfile, sharedFiles, nameOf,
  onCloseInfo, onUpdateConversationState, onBlockContact, onUnblockContact, onViewProfile,
}: ChatInfoAsideProps) {
  const { t } = useTranslation('app');
  return (
<aside
  data-testid="info-aside"
  className="absolute inset-y-0 right-0 z-20 flex w-[85vw] max-w-[320px] min-w-0 flex-col overflow-x-hidden overflow-y-auto border-l bg-background shadow-xl md:static md:z-auto md:w-[320px] md:shrink-0 md:shadow-none"
>
  {isGroup && memberPanelBundle ? (
    <>
      <div className="flex justify-end px-3 pt-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('closeDialog')}
          onClick={() => onCloseInfo()}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-b px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onUpdateConversationState(active, { muted: !active.muted })}
        >
          {active.muted ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          {active.muted ? t('unmuteConversation') : t('muteConversation')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onUpdateConversationState(active, { pinned: !active.pinnedAt })}
        >
          {active.pinnedAt ? <PinOff aria-hidden /> : <Pin aria-hidden />}
          {active.pinnedAt ? t('unpinConversation') : t('pinConversation')}
        </Button>
      </div>
      <MemberPanel
        conversation={active}
        bundle={memberPanelBundle}
        myId={myId}
        onlineUsers={onlineUsers}
        readMarkers={readMarkers}
        newestSeq={newestSeq}
        onViewProfile={onViewProfile}
      />
    </>
  ) : null}
  {!isGroup && otherId && partnerProfile ? (
    <div data-testid="partner-panel" className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-start gap-3 bg-background px-4 py-4">
        <span className="relative shrink-0">
          <Avatar size="lg">
            <AvatarFallback>{initialsOf(avatarLabel)}</AvatarFallback>
          </Avatar>
          {otherStatus !== undefined ? (
            <span
              className={cn(
                'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background',
                PRESENCE_DOT_CLASS[otherStatus],
              )}
            />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{title}</p>
          {partnerProfile.roleLine ? (
            <p className="text-xs text-muted-foreground">{partnerProfile.roleLine}</p>
          ) : null}
          {otherStatus !== undefined ? (
            <p className="text-xs text-muted-foreground">
              {t(presenceLabelKey(otherStatus))}
            </p>
          ) : null}
          {blocked.includes(otherId) ? (
            <p className="text-sm">
              {nameOf(otherId)} {t('blockedSuffix')}
            </p>
          ) : null}
          {partnerProfile.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap justify-end gap-1">
              {partnerProfile.tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t('closeDialog')}
          onClick={() => onCloseInfo()}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="space-y-4 px-4 pb-4">
        <Separator />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={() => onUpdateConversationState(active, { muted: !active.muted })}
          >
            {active.muted ? t('unmuteConversation') : t('muteConversation')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={() => onUpdateConversationState(active, { pinned: !active.pinnedAt })}
          >
            {active.pinnedAt ? t('unpinConversation') : t('pinConversation')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start"
            disabled
          >
            {t('clearChat')}
          </Button>
          {blocked.includes(otherId) ? (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => onUnblockContact(otherId)}
            >
              {t('unblockContact')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => onBlockContact(otherId)}
            >
              {t('blockContact')}
            </Button>
          )}
        </div>
        {partnerProfile.bio ? (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" aria-hidden />
              {t('profileBio')}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{partnerProfile.bio}</p>
          </div>
        ) : null}
        <dl className="space-y-2 text-sm">
          {([
            ['profileEmail', partnerProfile.email, Mail],
            ['profilePhone', partnerProfile.phone, Phone],
            ['profileWebsite', partnerProfile.website, Globe],
            ['profileCompany', partnerProfile.company, Building2],
            ['profileCountry', partnerProfile.country, Flag],
            ['profileTimezone', partnerProfile.timezone, Clock],
            ['profileLocation', partnerProfile.location, MapPin],
            ['profileAvailability', partnerProfile.availability, Sparkles],
          ] as const).filter(([, value]) => Boolean(value)).map(([key, value, Icon]) => (
            <div key={key} className="flex items-center gap-2">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-4" aria-hidden />
                {t(key)}
              </dt>
              <dd className="ml-auto min-w-0 truncate">
                {key === 'profileEmail' ? (
                  <a href={`mailto:${value}`} className="hover:underline">{value}</a>
                ) : key === 'profilePhone' ? (
                  <a href={`tel:${value!.replace(/\s+/g, '')}`} className="hover:underline">{value}</a>
                ) : key === 'profileWebsite' ? (
                  <a href={value!} target="_blank" rel="noopener noreferrer" className="hover:underline">{value}</a>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
        {sharedFiles.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t('sharedFilesTitle')}</h4>
            <ul className="space-y-1">
              {sharedFiles.map((file) => (
                <li key={file.id}>
                  <FileCard name={file.name} sizeLabel={file.sizeLabel} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="mt-auto px-4 pb-4 pt-2">
        <Button type="button" variant="destructive" className="w-full gap-2" disabled>
          <Trash className="size-4" aria-hidden />
          {t('deleteConversation')}
        </Button>
      </div>
    </div>
  ) : null}
</aside>
  );
}
