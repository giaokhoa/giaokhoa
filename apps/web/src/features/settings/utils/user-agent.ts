import { UAParser } from 'ua-parser-js';

const MAX_RAW_USER_AGENT_LENGTH = 48;

export type DeviceDescriptionFormatter = (browser: string, os: string) => string;

export function describeUserAgent(
  userAgent: string | null,
  unknownLabel: string,
  formatDescription: DeviceDescriptionFormatter,
): string {
  if (!userAgent || userAgent.trim() === '') return unknownLabel;

  const { browser, os } = UAParser(userAgent);
  if (browser.name && os.name) return formatDescription(browser.name, os.name);
  if (browser.name) return browser.name;
  if (os.name) return os.name;

  return userAgent.length > MAX_RAW_USER_AGENT_LENGTH ? `${userAgent.slice(0, MAX_RAW_USER_AGENT_LENGTH)}…` : userAgent;
}
