/**
 * Panel thông tin của khung chat (tách từ ChatPanel, S23): cột bên phải
 * khi mở — nhóm thì hiện hàng hành động ghim/tắt tiếng + panel thành
 * viên, chat 1–1 thì hiện hồ sơ đối tác + khối tệp đã chia sẻ. Component
 * chỉ nhận dữ kiện đã tính sẵn qua props, không tự nạp gì; nút Xoá cuộc
 * trò chuyện vẫn chỉ là hình dạng vô hiệu (chưa có đường dữ kiện).
 */

import { Bell, BellOff, Building2, Clock, FileText, Flag, Globe, Mail, MapPin, Phone, Pin, PinOff, Sparkles, Trash, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { Separator } from '@giaokhoa/ui/components/separator';
import { cn } from '@giaokhoa/ui/lib/utils';
import { useTranslation } from 'react-i18next';
import type { PersonProfileView, SharedFileView } from '../api/person-profile-adapter';
import type { ConversationStatePatch, ConversationView, MemberPanelEntry, PresenceStatus } from '../types/types';
import { MemberPanel, type MemberPanelBundle } from './member-panel';
import { FileCard } from './file-card';
import { PRESENCE_DOT_CLASS, initialsOf, presenceLabelKey } from '../utils/utils';

interface ChatInfoPanelProps {
  /** Hội thoại đang mở (không null — panel chỉ render khi có hội thoại). */
  active: ConversationView;
  /** Đúng khi hội thoại là nhóm (nhánh panel thành viên) thay vì 1–1 (nhánh hồ sơ). */
  isGroup: boolean;
  /** Gói panel thành viên đã bổ sung chặn/bỏ chặn; null khi chưa xác định được ngữ cảnh nhóm. */
  memberPanelBundle: MemberPanelBundle | null;
  /** Id người xem (đưa xuống MemberPanel). */
  myId: string | undefined;
  /** Bản đồ trực tuyến theo userId (đưa xuống MemberPanel). */
  onlineUsers: Record<string, boolean>;
  /** Mốc đã đọc theo từng thành viên (đưa xuống MemberPanel). */
  readMarkers: Record<string, number>;
  /** Seq tin mới nhất — mốc so "đã xem" ở panel thông tin. */
  newestSeq: number;
  /** Mở sheet hồ sơ rút gọn của một thành viên nhóm. */
  onViewMemberProfile: (entry: MemberPanelEntry) => void;
  /** Đặt cờ trạng thái cá nhân (ghim / tắt tiếng) cho hội thoại đang mở. */
  onUpdateConversationState: (conversation: ConversationView, patch: ConversationStatePatch) => void;
  /** Id đối tác của chat 1–1; undefined ở nhóm. */
  otherId: string | undefined;
  /** Hồ sơ đối tác qua adapter; null ở nhóm hoặc khi chưa xác định được đối tác. */
  partnerProfile: PersonProfileView | null;
  /** Tiêu đề đầu khung (tên hội thoại hoặc tên đối tác). */
  title: string;
  /** Nhãn avatar (tên hội thoại hoặc tên đối tác). */
  avatarLabel: string;
  /** Trạng thái hiện diện hiển thị của đối tác; undefined = chưa biết. */
  otherStatus: PresenceStatus | undefined;
  /** Id các liên hệ đã chặn (để hiện nút Bỏ chặn thay vì Chặn). */
  blocked: string[];
  /** Tên hiển thị của một userId. */
  nameOf: (userId: string) => string;
  /** Chặn / bỏ chặn đối tác 1–1. */
  onBlockContact: (userId: string) => void;
  onUnblockContact: (userId: string) => void;
  /** Tệp đã chia sẻ của hội thoại (qua adapter, hiện rỗng). */
  sharedFiles: SharedFileView[];
  /** Đóng panel. */
  onClose: () => void;
}

/**
 * Panel thông tin của khung chat.
 *
 * @param props - Hội thoại + dữ kiện đã tính sẵn + các handler (xem `ChatInfoPanelProps`).
 * @returns Cột panel bên phải của khung chat.
 */
export function ChatInfoPanel({
  active, isGroup, memberPanelBundle, myId, onlineUsers, readMarkers, newestSeq,
  onViewMemberProfile, onUpdateConversationState, otherId, partnerProfile, title,
  avatarLabel, otherStatus, blocked, nameOf, onBlockContact, onUnblockContact, sharedFiles, onClose,
}: ChatInfoPanelProps) {
  const { t } = useTranslation('app');
  return (
    <aside
      data-testid="info-aside"
      className="absolute inset-y-0 right-0 z-20 flex w-[85vw] max-w-[320px] min-w-0 flex-col overflow-x-hidden overflow-y-auto border-l bg-background shadow-xl md:static md:z-auto md:w-[320px] md:shrink-0 md:shadow-none"
    >
      {/*
        Panel không còn thanh tiêu đề riêng và nút đóng
        riêng như trước (issue #608): phía demo đầu panel
        là chính khối hồ sơ, panel là một cột của khung —
        đóng panel bằng nút avatar ở đầu khung. Riêng ở
        di động panel là lớp phủ che mất nút avatar đó
        nên giữ một nút đóng nhỏ chỉ hiện ở di động.
      */}
      {isGroup && memberPanelBundle ? (
        <>
          <div className="flex justify-end px-3 pt-2 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('closeDialog')}
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </div>
          {/*
            Hàng hành động của panel nhóm (issue #591):
            Tắt/Bật tiếng và Ghim/Bỏ ghim là hành động
            THẬT trên trạng thái cá nhân của hội thoại —
            cùng đường đổi trạng thái với menu đầu khung —
            để trạng thái tắt tiếng hiện và đổi được nhất
            quán ở mọi bề mặt của nhóm.
          */}
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
            onViewProfile={onViewMemberProfile}
          />
        </>
      ) : null}
      {!isGroup && otherId && partnerProfile ? (
        /*
          Panel HỒ SƠ NGƯỜI của chat 1–1 (issue #591;
          hình dạng căn lại theo demo ở issue #608) —
          đầu panel là khối hồ sơ dính trên cùng (avatar
          40px bên trái tên, các thẻ), danh sách hành
          động dọc bề ngang đầy đủ, các hàng trường kèm
          icon, đoạn giới thiệu riêng và khối tệp đã
          chia sẻ; nút Xoá nằm ở đáy panel. Dữ kiện đi
          qua lớp adapter (`partnerProfile`): trường nào
          backend chưa có thì KHÔNG dựng hàng tương ứng
          (luật của demo, thay luật hiện dấu "—" trước
          đây), không bịa giá trị, chờ đợt backend thay
          nguồn.
        */
        <div data-testid="partner-panel" className="flex min-h-full flex-col">
          {/*
            Đầu panel là CHÍNH khối hồ sơ, dính trên cùng
            khi cuộn (issue #608): avatar 40px ở bên trái
            tên, dòng vai trò và dòng trạng thái chỉ hiện
            khi có dữ kiện (trường trống không dựng hàng
            — cùng luật với các trường hồ sơ bên dưới),
            các thẻ là huy hiệu outline ở cuối khối.
          */}
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
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </div>
          <div className="space-y-4 px-4 pb-4">
            <Separator />
            {/*
              Danh sách hành động của panel theo đúng
              hình dạng demo (issue #608, trích từ chunk
              JS của demo): các nút outline bề ngang đầy
              đủ, chữ căn trái, xếp dọc cách 8px, chỉ chữ.
              Tắt tiếng / Ghim / Chặn là hành động THẬT
              qua cùng đường đổi trạng thái và chặn liên
              lạc như mọi bề mặt khác; Xoá lịch sử trò
              chuyện là chức năng sản phẩm chưa có — chỉ
              dựng hình dạng ở trạng thái vô hiệu theo
              luật điểm chưa quyết, ghi rõ trong thân PR.
              (Mục Thêm vào yêu thích từng đứng ở đây đã
              gỡ hẳn theo phán quyết issue #623 — yêu
              thích không có dữ kiện ở bất kỳ tầng nào.)
            */}
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
                  onClick={() => void onUnblockContact(otherId)}
                >
                  {t('unblockContact')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => void onBlockContact(otherId)}
                >
                  {t('blockContact')}
                </Button>
              )}
            </div>
            {/*
              Đoạn giới thiệu (About) là một đoạn văn
              riêng màu muted như demo — không còn là một
              hàng trong bảng trường. Chỉ dựng khi adapter
              có dữ kiện.
            */}
            {partnerProfile.bio ? (
              <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-4" aria-hidden />
                  {t('profileBio')}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{partnerProfile.bio}</p>
              </div>
            ) : null}
            {/*
              Các hàng trường hồ sơ theo khuôn demo: nhãn
              màu muted kèm icon 16px, giá trị đẩy phải
              (`ml-auto`) và cắt đúng một dòng. Trường nào
              adapter chưa có dữ kiện thì KHÔNG dựng hàng
              (issue #608 — thay luật hiện dấu "—" trước
              đây); dữ kiện vẫn đi qua lớp adapter như
              cũ, không bịa giá trị. Ba trường liên lạc
              (email/điện thoại/website) dựng giá trị thành
              LIÊN KẾT thật — mailto:, tel: (bỏ khoảng
              trắng) và mở tab mới — đúng hành vi neo của
              bản demo (giai đoạn 2 của vòng sửa PR #610,
              mục T-17); các trường còn lại giữ chữ thường.
            */}
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
            {/*
              Khối tệp đã chia sẻ (điểm G9): đúng hành vi
              của bản demo — khối CHỈ hiện khi hội thoại
              có tệp đã chia sẻ, mỗi tệp là thẻ tệp theo
              khuôn demo (điểm E19, component FileCard).
              Nguồn dữ kiện qua adapter hiện luôn rỗng vì
              đính kèm chưa có phán quyết chức năng, nên
              khối không hiện ở trạng thái hiện tại; đợt
              backend chỉ thay nguồn của adapter.
            */}
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
          {/*
            Nút Xoá ở ĐÁY panel theo đúng vị trí demo
            (issue #608): nút destructive bề ngang đầy
            đủ, icon thùng rác 16px, bị đẩy xuống đáy
            bằng `mt-auto`. Chức năng xoá cuộc trò
            chuyện chưa có đường dữ kiện phía client
            nên chỉ dựng hình dạng ở trạng thái vô hiệu
            như trước.
          */}
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
