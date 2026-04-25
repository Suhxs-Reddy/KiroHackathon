// ─── Reminder Scheduler ───────────────────────────────────────────────────────

import type { ReminderMetadata, ReminderType } from './types.js';

const REMINDER_PREFIX = 'optOutReminders_';
const ALARM_SEPARATOR = '__';

export function reminderStorageKey(domain: string): string {
  return `${REMINDER_PREFIX}${domain}`;
}

export function buildAlarmName(
  domain: string,
  dataType: string,
  reminderType: ReminderType
): string {
  return `optout${ALARM_SEPARATOR}${domain}${ALARM_SEPARATOR}${dataType}${ALARM_SEPARATOR}${reminderType}`;
}

export function parseAlarmName(
  alarmName: string
): { domain: string; dataType: string; reminderType: ReminderType } | null {
  const parts = alarmName.split(ALARM_SEPARATOR);
  if (parts.length < 4 || parts[0] !== 'optout') return null;
  return {
    domain: parts[1],
    dataType: parts[2],
    reminderType: parts[3] as ReminderType,
  };
}

export async function scheduleReminder(params: {
  domain: string;
  dataType: string;
  reminderType: ReminderType;
  delayMinutes: number;
}): Promise<ReminderMetadata> {
  const alarmName = buildAlarmName(params.domain, params.dataType, params.reminderType);

  // Check for existing reminder with same alarm name (Req 3.9)
  const existing = await getReminders(params.domain);
  const duplicate = existing.find(r => r.alarmName === alarmName);
  if (duplicate) {
    return duplicate; // Return existing — caller can offer cancel/reschedule
  }

  // Create chrome alarm
  await chrome.alarms.create(alarmName, { delayInMinutes: params.delayMinutes });

  // Store metadata (Req 3.8)
  const metadata: ReminderMetadata = {
    alarmName,
    domain: params.domain,
    dataType: params.dataType,
    reminderType: params.reminderType,
    scheduledTime: new Date(Date.now() + params.delayMinutes * 60 * 1000).toISOString(),
    delayMinutes: params.delayMinutes,
  };

  const key = reminderStorageKey(params.domain);
  const result = await chrome.storage.local.get(key);
  const reminders: ReminderMetadata[] = result[key] ?? [];
  reminders.push(metadata);
  await chrome.storage.local.set({ [key]: reminders });

  return metadata;
}

export async function cancelReminder(alarmName: string): Promise<void> {
  // Clear the chrome alarm
  await chrome.alarms.clear(alarmName);

  // Remove from storage
  const parsed = parseAlarmName(alarmName);
  if (!parsed) return;

  const key = reminderStorageKey(parsed.domain);
  const result = await chrome.storage.local.get(key);
  const reminders: ReminderMetadata[] = result[key] ?? [];
  const filtered = reminders.filter(r => r.alarmName !== alarmName);
  await chrome.storage.local.set({ [key]: filtered });
}

export async function getReminders(domain: string): Promise<ReminderMetadata[]> {
  const key = reminderStorageKey(domain);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? [];
}

export function handleAlarmFired(alarm: chrome.alarms.Alarm): void {
  const parsed = parseAlarmName(alarm.name);
  if (!parsed) return;

  const bodyMap: Record<ReminderType, string> = {
    postal_mail: `Reminder: Send your opt-out letter for "${parsed.dataType}" data to ${parsed.domain}.`,
    follow_up: `Follow-up: Check if ${parsed.domain} has processed your opt-out request for "${parsed.dataType}" data.`,
    renewal: `Renewal: It may be time to renew your opt-out for "${parsed.dataType}" data on ${parsed.domain}.`,
  };

  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Privacy Tool — ${parsed.domain}`,
    message: bodyMap[parsed.reminderType],
  });
}

export function validateReminderMetadata(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['ReminderMetadata must be an object'] };
  }
  const r = data as Record<string, unknown>;

  if (typeof r.alarmName !== 'string' || r.alarmName.length === 0) errors.push('alarmName must be a non-empty string');
  if (typeof r.domain !== 'string' || r.domain.length === 0) errors.push('domain must be a non-empty string');
  if (typeof r.dataType !== 'string' || r.dataType.length === 0) errors.push('dataType must be a non-empty string');

  const validReminderTypes: ReminderType[] = ['postal_mail', 'follow_up', 'renewal'];
  if (typeof r.reminderType !== 'string' || !validReminderTypes.includes(r.reminderType as ReminderType)) {
    errors.push('reminderType must be one of: postal_mail, follow_up, renewal');
  }

  if (typeof r.scheduledTime !== 'string' || r.scheduledTime.length === 0) {
    errors.push('scheduledTime must be a non-empty ISO 8601 string');
  }

  if (typeof r.delayMinutes !== 'number' || r.delayMinutes <= 0) {
    errors.push('delayMinutes must be a positive number');
  }

  return { valid: errors.length === 0, errors };
}
