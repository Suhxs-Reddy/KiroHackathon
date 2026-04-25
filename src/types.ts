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

export interface DataTypeEntry {
  dataType: string;
  riskLevel: RiskLevel;
  purposes: string[];
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[];
  warningNote: string | null;
  deviationNote: string | null;
}

export interface Risk_Analysis {
  schemaVersion: string;
  policyUrl: string;
  targetDomain: string;
  analyzedAt: string; // ISO 8601
  overallRiskLevel: RiskLevel;
  dataTypes: DataTypeEntry[];
  analysisWarnings: string[];
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
  complete(systemPrompt: string, userMessage: string): Promise<string>;
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

export type ExtensionMessage =
  | PolicyDetectedMessage
  | ShowAlertPopupMessage
  | InitiateAnalysisMessage
  | AnalysisCompleteMessage
  | AnalysisErrorMessage
  | ValidateApiKeyMessage
  | ApiKeyValidationResultMessage;
