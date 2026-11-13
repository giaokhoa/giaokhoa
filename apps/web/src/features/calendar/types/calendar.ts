
export interface CalendarEventView {
  id: string;
  name: string;
  description: string;
  eventType: string;
  timeStart: string;
  timeDuration: number;
  repeatId: string;
  isException: boolean;
}

export interface CalendarSubscriptionView {
  id: string;
  name: string;
  url: string | null;
  eventType: string;
  pollInterval: number;
}

export interface CalendarExportTokenView {
  token: string;
  url: string;
}
