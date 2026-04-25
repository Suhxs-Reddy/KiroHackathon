// ─── Core Data Models ────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';

export interface PolicyLink {
  url: string;
  linkText: string;
  linkType: 'privacy_policy' | 'terms_of_service' | 'cookie_policy' | 'data_processing' | 'unknown';
}

export interface Page_Metadata {
  domain: string;
  pageTitle: string;
  pageUrl: string;
  detectedPolicyLinks: PolicyLink[];
  hasConsentDialog: boolean;
  detectionTimestamp: string; // ISO 8601
}

export interface RawDocument {
  content: string | ArrayBuffer;
  format: 'html' | 'pdf' | 'text';
  finalUrl: string;
  fetchedAt: string; // ISO 8601
}

export interface Section {
  heading: string;
  text: string;
  level: number;
}

export interface Parsed_Policy {
  sourceUrl: string;
  format: 'html' | 'pdf' | 'text' | 'manual';
  fullText: string;
  sections: Section[];
  parsedAt: string; // ISO 8601
}

// ─── Opt-Out Guidance Types ───────────────────────────────────────────────────

export type OptOutStatus = 'available' | 'vague' | 'unavailable';

export type OptOutMechanismType = 'settings_url' | 'email' | 'web_form' | 'account_steps' | 'postal_mail';

export interface OptOutMechanism {
  type: OptOutMechanismType;
  value: string;
  instructionText: string | null;
}

export interface OptOutGuidance {
  status: OptOutStatus;
  mechanisms: OptOutMechanism[];
  summary: string;
  warningNote: string | null;
}

// ─── Opt-Out Automation Types ─────────────────────────────────────────────────

export type ActionType = 'opened_url' | 'composed_email' | 'reminder_set';

export type ReminderType = 'postal_mail' | 'follow_up' | 'renewal';

export interface ActionRecord {
  id: string;
  domain: string;
  dataType: string;
  mechanismType: OptOutMechanismType;
  action: ActionType;
  timestamp: string; // ISO 8601
}

export interface ReminderMetadata {
  alarmName: string;
  domain: string;
  dataType: string;
  reminderType: ReminderType;
  scheduledTime: string; // ISO 8601
  delayMinutes: number;
}

// ─── Data Type Entry ─────────────────────────────────────────────────────────

export interface DataTypeEntry {
  dataType: string;
  riskLevel: RiskLevel;
  purposes: string[];
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[];
  warningNote: string | null;
  deviationNote: string | null;
  optOutGuidance?: OptOutGuidance;
}

export interface Risk_Analysis {
  schemaVersion: string;
  policyUrl: string;
  targetDomain: string;
  analyzedAt: string; // ISO 8601
  overallRiskLevel: RiskLevel;
  dataTypes: DataTypeEntry[];
  analysisWarnings: string[];
  policySummary?: string[];
  modelUsed: string;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export type AnalysisErrorCode =
  | 'FETCH_ERROR'
  | 'PARSE_ERROR'
  | 'AI_UNAVAILABLE'
  | 'AI_INVALID_RESPONSE'
  | 'NO_API_KEY'
  | 'API_KEY_INVALID'
  | 'UNSUPPORTED_FORMAT';

export class AnalysisError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    public readonly message: string,
    public readonly retryable: boolean,
    public readonly manualInputFallback: boolean,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

// ─── LLM Adapter Interface ───────────────────────────────────────────────────

export interface LLMAdapter {
  complete(systemPrompt: string, userMessage: string, timeoutMs?: number): Promise<string>;
  modelId: string;
}

// ─── Extension Message Types ─────────────────────────────────────────────────

export interface PolicyDetectedMessage {
  type: 'POLICY_DETECTED';
  payload: Page_Metadata;
}

export interface ShowAlertPopupMessage {
  type: 'SHOW_ALERT_POPUP';
  payload: { policyLinks: PolicyLink[]; hasConsentDialog: boolean };
}

export interface InitiateAnalysisMessage {
  type: 'INITIATE_ANALYSIS';
  payload: { policyUrl: string } | { manualText: string };
}

export interface AnalysisCompleteMessage {
  type: 'ANALYSIS_COMPLETE';
  payload: Risk_Analysis;
}

export interface AnalysisErrorMessage {
  type: 'ANALYSIS_ERROR';
  payload: {
    code: AnalysisErrorCode;
    message: string;
    retryable: boolean;
    manualInputFallback: boolean;
  };
}

export interface ValidateApiKeyMessage {
  type: 'VALIDATE_API_KEY';
  payload: { apiKey: string; adapterType: 'saulm' | 'openai' };
}

export interface ApiKeyValidationResultMessage {
  type: 'API_KEY_VALIDATION_RESULT';
  payload: { success: boolean; error?: string };
}

// ─── Opt-Out Automation Message Types ─────────────────────────────────────────

export interface OpenTabMessage {
  type: 'OPEN_TAB';
  payload: { url: string };
}

export interface SaveActionMessage {
  type: 'SAVE_ACTION';
  payload: Omit<ActionRecord, 'id'>;
}

export interface SaveActionResultMessage {
  type: 'SAVE_ACTION_RESULT';
  payload: { success: boolean; record?: ActionRecord; error?: string };
}

export interface GetActionsMessage {
  type: 'GET_ACTIONS';
  payload: { domain: string };
}

export interface ClearActionsMessage {
  type: 'CLEAR_ACTIONS';
  payload: { domain: string };
}

export interface ScheduleReminderMessage {
  type: 'SCHEDULE_REMINDER';
  payload: {
    domain: string;
    dataType: string;
    reminderType: ReminderType;
    delayMinutes: number;
  };
}

export interface CancelReminderMessage {
  type: 'CANCEL_REMINDER';
  payload: { alarmName: string };
}

export interface GetRemindersMessage {
  type: 'GET_REMINDERS';
  payload: { domain: string };
}

export type ExtensionMessage =
  | PolicyDetectedMessage
  | ShowAlertPopupMessage
  | InitiateAnalysisMessage
  | AnalysisCompleteMessage
  | AnalysisErrorMessage
  | ValidateApiKeyMessage
  | ApiKeyValidationResultMessage
  | OpenTabMessage
  | SaveActionMessage
  | SaveActionResultMessage
  | GetActionsMessage
  | ClearActionsMessage
  | ScheduleReminderMessage
  | CancelReminderMessage
  | GetRemindersMessage;
