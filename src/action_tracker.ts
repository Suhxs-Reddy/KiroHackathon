// ─── Action Tracker ───────────────────────────────────────────────────────────

import type { ActionRecord, OptOutMechanismType, ActionType } from './types.js';

const STORAGE_PREFIX = 'optOutActions_';

export function storageKey(domain: string): string {
  return `${STORAGE_PREFIX}${domain}`;
}

export function generateActionId(record: Omit<ActionRecord, 'id'>): string {
  return `${record.domain}__${record.dataType}__${record.mechanismType}__${record.timestamp}`;
}

export async function saveActionRecord(
  record: Omit<ActionRecord, 'id'>
): Promise<ActionRecord> {
  const key = storageKey(record.domain);
  const result = await chrome.storage.local.get(key);
  const existing: ActionRecord[] = result[key] ?? [];

  const fullRecord: ActionRecord = {
    ...record,
    id: generateActionId(record),
  };

  // Validate uniqueness (Req 8.5) — idempotent for duplicate IDs
  if (existing.some(r => r.id === fullRecord.id)) {
    return fullRecord;
  }

  existing.push(fullRecord);
  await chrome.storage.local.set({ [key]: existing });
  return fullRecord;
}

export async function getActionRecords(domain: string): Promise<ActionRecord[]> {
  const key = storageKey(domain);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? [];
}

export async function clearActionRecords(domain: string): Promise<void> {
  const key = storageKey(domain);
  await chrome.storage.local.remove(key);
}

export function validateActionRecord(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['ActionRecord must be an object'] };
  }
  const r = data as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) errors.push('id must be a non-empty string');
  if (typeof r.domain !== 'string' || r.domain.length === 0) errors.push('domain must be a non-empty string');
  if (typeof r.dataType !== 'string' || r.dataType.length === 0) errors.push('dataType must be a non-empty string');

  const validMechanismTypes: OptOutMechanismType[] = ['settings_url', 'email', 'web_form', 'account_steps', 'postal_mail'];
  if (typeof r.mechanismType !== 'string' || !validMechanismTypes.includes(r.mechanismType as OptOutMechanismType)) {
    errors.push('mechanismType must be a valid OptOutMechanismType');
  }

  const validActions: ActionType[] = ['opened_url', 'composed_email', 'reminder_set'];
  if (typeof r.action !== 'string' || !validActions.includes(r.action as ActionType)) {
    errors.push('action must be one of: opened_url, composed_email, reminder_set');
  }

  if (typeof r.timestamp !== 'string' || r.timestamp.length === 0) {
    errors.push('timestamp must be a non-empty ISO 8601 string');
  }

  return { valid: errors.length === 0, errors };
}
