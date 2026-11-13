import { useState } from 'react';
import { X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Button } from '@giaokhoa/ui/components/button';
import { Input } from '@giaokhoa/ui/components/input';
import { Label } from '@giaokhoa/ui/components/label';
import { Separator } from '@giaokhoa/ui/components/separator';
import { Sheet, SheetContent, SheetTitle } from '@giaokhoa/ui/components/sheet';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import { cn } from '@giaokhoa/ui/lib/utils';
import { useTranslation } from 'react-i18next';
import { PRESENCE_DOT_CLASS, initialsOf, presenceLabelKey } from '../utils/utils';
import type { PresenceStatus } from '../types/types';

export type SelfPresenceChoice = 'online' | 'offline';


interface OwnProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  usernameLine: string | null;
  email: string | null;
  selfPresence: SelfPresenceChoice;
  onSelfPresenceChange: (presence: SelfPresenceChoice) => void;
}

const SELF_STATUSES: PresenceStatus[] = ['online', 'away', 'busy', 'offline'];

export function OwnProfileSheet({
  open, onOpenChange, name, usernameLine, email, selfPresence, onSelfPresenceChange,
}: OwnProfileSheetProps) {
  const { t } = useTranslation('app');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [about, setAbout] = useState('');
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [timezone, setTimezone] = useState('');
  const [availability, setAvailability] = useState('');
  const draftName = nameDraft ?? name;
  const draftEmail = emailDraft ?? email ?? '';

  const fields: { key: string; label: string; value: string; set: (value: string) => void }[] = [
    { key: 'avatarUrl', label: t('profileAvatarUrl'), value: avatarUrl, set: setAvatarUrl },
    { key: 'email', label: t('profileEmail'), value: draftEmail, set: setEmailDraft },
    { key: 'phone', label: t('profilePhone'), value: phone, set: setPhone },
    { key: 'company', label: t('profileCompany'), value: company, set: setCompany },
    { key: 'country', label: t('profileCountry'), value: country, set: setCountry },
    { key: 'website', label: t('profileWebsite'), value: website, set: setWebsite },
    { key: 'location', label: t('profileLocation'), value: location, set: setLocation },
    { key: 'timezone', label: t('profileTimezone'), value: timezone, set: setTimezone },
    { key: 'availability', label: t('profileAvailability'), value: availability, set: setAvailability },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">{t('myProfile')}</SheetTitle>
        <div className="flex max-h-dvh flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-start gap-3 border-b bg-background px-4 py-4">
              <span className="relative shrink-0">
                <Avatar size="lg">
                  <AvatarFallback>{initialsOf(draftName || name)}</AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-background',
                    PRESENCE_DOT_CLASS[selfPresence],
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={t('fullName')}
                  value={draftName}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-auto truncate rounded-none border-none p-0 leading-5 font-medium shadow-none ring-0 focus-visible:ring-0"
                />
                {usernameLine ? (
                  <p className="truncate text-xs wrap-break-word text-muted-foreground">{usernameLine}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('closeDialog')}
                onClick={() => onOpenChange(false)}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="space-y-4 px-4 py-4">
              {fields.slice(0, 1).map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`own-profile-${field.key}`}>{field.label}</Label>
                  <Input id={`own-profile-${field.key}`} value={field.value} onChange={(e) => field.set(e.target.value)} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="own-profile-about">{t('profileBio')}</Label>
                <Textarea id="own-profile-about" value={about} onChange={(e) => setAbout(e.target.value)} className="min-h-20" />
              </div>
              {fields.slice(1).map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`own-profile-${field.key}`}>{field.label}</Label>
                  <Input id={`own-profile-${field.key}`} value={field.value} onChange={(e) => field.set(e.target.value)} />
                </div>
              ))}
              <Separator />
              <div className="space-y-2">
                <p className="text-sm leading-none font-medium">{t('memberProfilePresence')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {SELF_STATUSES.map((status) => {
                    const wired = status === 'online' || status === 'offline';
                    const selected = selfPresence === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={!wired}
                        aria-pressed={wired ? selected : undefined}
                        onClick={() => {
                          if (status === 'online' || status === 'offline') onSelfPresenceChange(status);
                        }}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium capitalize transition-colors',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <span className={cn('size-2 rounded-full', PRESENCE_DOT_CLASS[status])} />
                        {t(presenceLabelKey(status))}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button type="button" className="w-full" disabled>
                {t('saveChanges')}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
