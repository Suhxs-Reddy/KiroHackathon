/**
 * field_classifier.js
 * Maps DOM input elements to human-readable data categories.
 * Never reads field values — only inspects attributes and surrounding labels.
 */

'use strict'

// ─── Category definitions ─────────────────────────────────────────────────────

export const CATEGORIES = {
  FINANCIAL:     { id: 'financial',     label: 'Financial',      icon: '💳', sensitivity: 5 },
  GOVERNMENT_ID: { id: 'government_id', label: 'Government ID',  icon: '🪪', sensitivity: 5 },
  AUTH:          { id: 'auth',          label: 'Authentication', icon: '🔐', sensitivity: 4 },
  IDENTITY:      { id: 'identity',      label: 'Identity',       icon: '👤', sensitivity: 3 },
  CONTACT:       { id: 'contact',       label: 'Contact',        icon: '📬', sensitivity: 2 },
  SENSITIVE:     { id: 'sensitive',     label: 'Sensitive',      icon: '⚕️', sensitivity: 5 },
}

// ─── Matching rules ───────────────────────────────────────────────────────────

const RULES = [
  // Financial
  {
    category: 'FINANCIAL',
    typeMatch: [],
    autocompleteMatch: ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-name', 'cc-type'],
    nameRegex: /card|credit|debit|cvv|cvc|ccv|expir|billing/i,
    labelRegex: /card\s*number|credit\s*card|debit\s*card|cvv|cvc|expir/i,
  },
  // Government ID
  {
    category: 'GOVERNMENT_ID',
    typeMatch: [],
    autocompleteMatch: [],
    nameRegex: /ssn|social.?sec|passport|driver.?lic|national.?id|tax.?id|ein|itin/i,
    labelRegex: /social\s*security|ssn|passport|driver.?s\s*licen|national\s*id|tax\s*id/i,
  },
  // Authentication
  {
    category: 'AUTH',
    typeMatch: ['password'],
    autocompleteMatch: ['current-password', 'new-password', 'one-time-code'],
    nameRegex: /password|passwd|secret|pin|otp|mfa|2fa|security.?answer/i,
    labelRegex: /password|secret|pin|one.?time|security\s*question/i,
  },
  // Identity
  {
    category: 'IDENTITY',
    typeMatch: ['date'],
    autocompleteMatch: ['name', 'given-name', 'family-name', 'additional-name', 'honorific-prefix',
                        'honorific-suffix', 'nickname', 'bday', 'bday-day', 'bday-month', 'bday-year',
                        'sex', 'street-address', 'address-line1', 'address-line2', 'address-level1',
                        'address-level2', 'postal-code', 'country', 'country-name'],
    nameRegex: /\bname\b|first.?name|last.?name|full.?name|dob|birth|address|zip|postal|city|state|country/i,
    labelRegex: /\bname\b|date\s*of\s*birth|birthday|address|zip\s*code|postal\s*code/i,
  },
  // Contact
  {
    category: 'CONTACT',
    typeMatch: ['email', 'tel'],
    autocompleteMatch: ['email', 'tel', 'tel-national', 'tel-area-code', 'tel-local', 'tel-extension'],
    nameRegex: /email|e.?mail|phone|mobile|cell|fax|contact/i,
    labelRegex: /email|phone|mobile|telephone|contact/i,
  },
  // Sensitive
  {
    category: 'SENSITIVE',
    typeMatch: [],
    autocompleteMatch: [],
    nameRegex: /health|medical|diagnosis|insurance|biometric|race|ethnicity|religion|political|sexual/i,
    labelRegex: /health|medical|insurance|biometric|race|ethnicity|religion|political|sexual/i,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the text of the nearest <label> for an input element.
 * Checks: aria-label, aria-labelledby, associated <label for="">, parent <label>.
 */
function getLabelText(el) {
  // aria-label
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy)
    if (labelEl) return labelEl.textContent || ''
  }

  // <label for="id">
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (labelEl) return labelEl.textContent || ''
  }

  // parent <label>
  const parentLabel = el.closest('label')
  if (parentLabel) return parentLabel.textContent || ''

  // preceding sibling text (common pattern)
  const prev = el.previousElementSibling
  if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P')) {
    return prev.textContent || ''
  }

  return ''
}

/**
 * Classify a single input element into a category ID, or null if unrecognized.
 */
export function classifyField(el) {
  const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase()
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase()
  const name = (el.getAttribute('name') || el.getAttribute('id') || '').toLowerCase()
  const labelText = getLabelText(el)

  // Skip purely decorative / non-data inputs
  if (['submit', 'button', 'reset', 'image', 'hidden', 'file', 'range', 'color', 'checkbox', 'radio'].includes(type)) {
    return null
  }

  for (const rule of RULES) {
    if (rule.typeMatch.includes(type)) return rule.category
    if (rule.autocompleteMatch.some(ac => autocomplete.includes(ac))) return rule.category
    if (rule.nameRegex.test(name)) return rule.category
    if (rule.labelRegex.test(labelText)) return rule.category
  }

  // Generic text/search/number inputs that didn't match anything specific
  if (['text', 'search', 'number', 'url'].includes(type)) return null

  return null
}

/**
 * Scan all input-like elements on the page and return detected categories.
 * Returns: { categories: string[], fieldDetails: [{category, label, type}] }
 */
export function scanFields() {
  const inputs = document.querySelectorAll('input, textarea, select')
  const categorySet = new Set()
  const fieldDetails = []

  for (const el of inputs) {
    const category = classifyField(el)
    if (!category) continue

    categorySet.add(category)
    const labelText = getLabelText(el).trim().slice(0, 60)
    fieldDetails.push({
      category,
      label: labelText || el.getAttribute('placeholder') || el.getAttribute('name') || 'Unnamed field',
      type: el.getAttribute('type') || el.tagName.toLowerCase(),
    })
  }

  return {
    categories: [...categorySet],
    fieldDetails,
  }
}
