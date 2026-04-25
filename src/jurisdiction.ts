/**
 * jurisdiction.ts — Jurisdiction-Based Privacy Rights Detection (Phase 1 Req 5)
 * Maintains a database of privacy regulations and identifies applicable rights.
 */

import type { JurisdictionId, JurisdictionInfo, PrivacyRight } from './types.js';

// ─── Privacy Laws Database (Req 5.2) ─────────────────────────────────────────

const PRIVACY_LAWS: JurisdictionInfo[] = [
  {
    id: 'GDPR',
    name: 'GDPR',
    fullName: 'General Data Protection Regulation',
    region: 'European Union / EEA',
    rights: [
      { id: 'gdpr-access', law: 'GDPR', name: 'Right of Access', description: 'You can ask any company what personal data they have about you and get a copy of it.', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-rectification', law: 'GDPR', name: 'Right to Rectification', description: 'You can ask a company to fix any wrong or incomplete personal data they have about you.', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-erasure', law: 'GDPR', name: 'Right to Erasure', description: 'You can ask a company to delete your personal data. This is also called the "right to be forgotten."', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-portability', law: 'GDPR', name: 'Right to Data Portability', description: 'You can get your data in a format that lets you move it to another service.', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-object', law: 'GDPR', name: 'Right to Object', description: 'You can tell a company to stop using your data for things like marketing or profiling.', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-restrict', law: 'GDPR', name: 'Right to Restrict Processing', description: 'You can ask a company to limit how they use your data while a dispute is being resolved.', applicableTo: 'EU/EEA residents' },
      { id: 'gdpr-automated', law: 'GDPR', name: 'Right Against Automated Decisions', description: 'You can object to decisions made entirely by computers that significantly affect you.', applicableTo: 'EU/EEA residents' },
    ],
  },
  {
    id: 'CCPA',
    name: 'CCPA',
    fullName: 'California Consumer Privacy Act',
    region: 'California, USA',
    rights: [
      { id: 'ccpa-know', law: 'CCPA', name: 'Right to Know', description: 'You can ask a business what personal information they collect about you and why.', applicableTo: 'California residents' },
      { id: 'ccpa-delete', law: 'CCPA', name: 'Right to Delete', description: 'You can ask a business to delete the personal information they collected from you.', applicableTo: 'California residents' },
      { id: 'ccpa-optout', law: 'CCPA', name: 'Right to Opt-Out of Sale', description: 'You can tell a business to stop selling your personal information to others.', applicableTo: 'California residents' },
      { id: 'ccpa-nondiscrimination', law: 'CCPA', name: 'Right to Non-Discrimination', description: 'A business cannot treat you differently for exercising your privacy rights.', applicableTo: 'California residents' },
    ],
  },
  {
    id: 'CPRA',
    name: 'CPRA',
    fullName: 'California Privacy Rights Act',
    region: 'California, USA',
    rights: [
      { id: 'cpra-correct', law: 'CPRA', name: 'Right to Correct', description: 'You can ask a business to fix inaccurate personal information they have about you.', applicableTo: 'California residents' },
      { id: 'cpra-limit', law: 'CPRA', name: 'Right to Limit Use of Sensitive Data', description: 'You can tell a business to only use your sensitive personal information for basic purposes.', applicableTo: 'California residents' },
      { id: 'cpra-optout-sharing', law: 'CPRA', name: 'Right to Opt-Out of Sharing', description: 'You can tell a business to stop sharing your personal information for targeted advertising.', applicableTo: 'California residents' },
    ],
  },
  {
    id: 'VCDPA',
    name: 'VCDPA',
    fullName: 'Virginia Consumer Data Protection Act',
    region: 'Virginia, USA',
    rights: [
      { id: 'vcdpa-access', law: 'VCDPA', name: 'Right to Access', description: 'You can ask a business to confirm whether they process your data and get a copy.', applicableTo: 'Virginia residents' },
      { id: 'vcdpa-delete', law: 'VCDPA', name: 'Right to Delete', description: 'You can ask a business to delete your personal data.', applicableTo: 'Virginia residents' },
      { id: 'vcdpa-correct', law: 'VCDPA', name: 'Right to Correct', description: 'You can ask a business to fix inaccurate personal data.', applicableTo: 'Virginia residents' },
      { id: 'vcdpa-optout', law: 'VCDPA', name: 'Right to Opt-Out', description: 'You can opt out of targeted advertising, sale of personal data, and profiling.', applicableTo: 'Virginia residents' },
    ],
  },
  {
    id: 'CPA',
    name: 'CPA',
    fullName: 'Colorado Privacy Act',
    region: 'Colorado, USA',
    rights: [
      { id: 'cpa-access', law: 'CPA', name: 'Right to Access', description: 'You can ask a business to confirm whether they process your data and get a copy.', applicableTo: 'Colorado residents' },
      { id: 'cpa-delete', law: 'CPA', name: 'Right to Delete', description: 'You can ask a business to delete your personal data.', applicableTo: 'Colorado residents' },
      { id: 'cpa-correct', law: 'CPA', name: 'Right to Correct', description: 'You can ask a business to fix inaccurate personal data.', applicableTo: 'Colorado residents' },
      { id: 'cpa-optout', law: 'CPA', name: 'Right to Opt-Out', description: 'You can opt out of targeted advertising, sale of personal data, and profiling.', applicableTo: 'Colorado residents' },
    ],
  },
  {
    id: 'CTDPA',
    name: 'CTDPA',
    fullName: 'Connecticut Data Privacy Act',
    region: 'Connecticut, USA',
    rights: [
      { id: 'ctdpa-access', law: 'CTDPA', name: 'Right to Access', description: 'You can ask a business to confirm whether they process your data and get a copy.', applicableTo: 'Connecticut residents' },
      { id: 'ctdpa-delete', law: 'CTDPA', name: 'Right to Delete', description: 'You can ask a business to delete your personal data.', applicableTo: 'Connecticut residents' },
      { id: 'ctdpa-correct', law: 'CTDPA', name: 'Right to Correct', description: 'You can ask a business to fix inaccurate personal data.', applicableTo: 'Connecticut residents' },
      { id: 'ctdpa-optout', law: 'CTDPA', name: 'Right to Opt-Out', description: 'You can opt out of targeted advertising, sale of personal data, and profiling.', applicableTo: 'Connecticut residents' },
    ],
  },
];

// ─── Jurisdiction Storage Key ─────────────────────────────────────────────────

const JURISDICTION_KEY = 'dg_user_jurisdiction';

// ─── Public API ───────────────────────────────────────────────────────────────

/** Get all supported privacy laws (Req 5.2) */
export function getAllJurisdictions(): JurisdictionInfo[] {
  return PRIVACY_LAWS;
}

/** Get a specific jurisdiction by ID */
export function getJurisdiction(id: JurisdictionId): JurisdictionInfo | undefined {
  return PRIVACY_LAWS.find(j => j.id === id);
}

/** Save user's jurisdiction preference (Req 5.1) */
export async function saveUserJurisdiction(jurisdictionIds: JurisdictionId[]): Promise<void> {
  await chrome.storage.local.set({ [JURISDICTION_KEY]: jurisdictionIds });
}

/** Load user's jurisdiction preference */
export async function loadUserJurisdiction(): Promise<JurisdictionId[]> {
  const result = await chrome.storage.local.get([JURISDICTION_KEY]);
  return result[JURISDICTION_KEY] || [];
}

/** Get applicable privacy rights for the user's jurisdiction (Req 5.3) */
export async function getApplicableRights(): Promise<PrivacyRight[]> {
  const userJurisdictions = await loadUserJurisdiction();
  if (userJurisdictions.length === 0) return [];

  const rights: PrivacyRight[] = [];
  for (const jId of userJurisdictions) {
    const jurisdiction = getJurisdiction(jId);
    if (jurisdiction) {
      rights.push(...jurisdiction.rights);
    }
  }
  return rights;
}

/**
 * Compare user's jurisdiction protections against target service's jurisdiction (Req 5.5).
 * Returns rights the user has that may be stronger than the target's local laws.
 */
export function compareJurisdictions(
  userJurisdictions: JurisdictionId[],
  targetDomain: string
): { strongerRights: PrivacyRight[]; message: string } {
  // Heuristic: if user has GDPR and target is a .com (likely US), GDPR is stronger
  const userRights: PrivacyRight[] = [];
  for (const jId of userJurisdictions) {
    const j = getJurisdiction(jId);
    if (j) userRights.push(...j.rights);
  }

  const hasGDPR = userJurisdictions.includes('GDPR');
  const isLikelyUS = targetDomain.endsWith('.com') || targetDomain.endsWith('.us');

  if (hasGDPR && isLikelyUS) {
    const gdprRights = userRights.filter(r => r.law === 'GDPR');
    return {
      strongerRights: gdprRights,
      message: 'As an EU resident, you have stronger privacy protections under GDPR than what this service may offer under US law. You can exercise these rights regardless of where the service is based.',
    };
  }

  return {
    strongerRights: [],
    message: '',
  };
}
