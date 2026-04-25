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
  dataCategoryGrid: DataCategoryGridItem[];
  dataTypes: DataTypeEntry[];
  analysisWarnings: string[];
  modelUsed: string;
}

// ─── Field Classification Types (from DataGuard) ─────────────────────────────

export type FieldCategoryId =
  | 'FINANCIAL'
  | 'GOVERNMENT_ID'
  | 'AUTH'
  | 'IDENTITY'
  | 'CONTACT'
  | 'SENSITIVE';

export interface FieldCategoryMeta {
  id: string;
  label: string;
  icon: string;
  sensitivity: number;
}

export interface FieldDetail {
  category: FieldCategoryId;
  label: string;
  type: string;
}

export interface TrackerInfo {
  name: string;
  category: string;
  pattern?: RegExp;
}

export interface PageScanResult {
  domain: string;
  companyName: string;
  pageType: string;
  categories: FieldCategoryId[];
  fieldDetails: FieldDetail[];
  trackers: TrackerInfo[];
  policyUrl: string | null;
  hasHttps: boolean;
  url: string;
  title: string;
}

export interface PageRiskResult {
  level: RiskLevel;
  reasons: string[];
  score: number;
}

// ─── Breach Types (from DataGuard HIBP integration) ──────────────────────────

export interface HIBPBreach {
  Name: string;
  Domain: string;
  BreachDate: string;
  PwnCount?: number;
  DataClasses?: string[];
}

// ─── Opt-Out Database Types (from DataGuard) ─────────────────────────────────

export interface OptOutAlternative {
  text: string;
  url: string;
}

export interface OptOutDatabaseEntry {
  domain: string;
  data_usage: 'collected' | 'shared' | 'sold' | 'unknown';
  opt_out_url: string;
  method: string;
  difficulty: 'easy' | 'medium' | 'hard';
  estimated_time: string;
  alternatives: (string | OptOutAlternative)[];
  notes?: string;
}

// ─── Jurisdiction Types (Phase 1 Req 5) ──────────────────────────────────────

export type JurisdictionId =
  | 'GDPR'
  | 'CCPA'
  | 'CPRA'
  | 'VCDPA'
  | 'CPA'
  | 'CTDPA';

export interface PrivacyRight {
  id: string;
  law: JurisdictionId;
  name: string;
  description: string;
  applicableTo: string; // e.g. "EU residents"
}

export interface JurisdictionInfo {
  id: JurisdictionId;
  name: string;
  fullName: string;
  region: string;
  rights: PrivacyRight[];
}

// ─── Data Collection Category Colors (Req 2.4-2.5) ──────────────────────────

export type DataCollectionCategory = 'grey' | 'blue' | 'yellow' | 'red';

export interface DataCategoryGridItem {
  category: string; // e.g. "Health", "Financial", "Location"
  collectionStatus: DataCollectionCategory;
  label: string;
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

// DataGuard-specific messages
export interface GetPageDataMessage {
  type: 'GET_PAGE_DATA';
}

export interface GetBreachDataMessage {
  type: 'GET_BREACH_DATA';
  domain: string;
  categories: FieldCategoryId[];
}

export interface RefreshBreachCacheMessage {
  type: 'REFRESH_BREACH_CACHE';
}

export interface GetCacheStatusMessage {
  type: 'GET_CACHE_STATUS';
}

export type ExtensionMessage =
  | PolicyDetectedMessage
  | ShowAlertPopupMessage
  | InitiateAnalysisMessage
  | AnalysisCompleteMessage
  | AnalysisErrorMessage
  | ValidateApiKeyMessage
  | ApiKeyValidationResultMessage
  | GetPageDataMessage
  | GetBreachDataMessage
  | RefreshBreachCacheMessage
  | GetCacheStatusMessage;
