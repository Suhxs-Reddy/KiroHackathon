/**
 * risk_scorer.js
 * Combines detected data categories + breach data + page signals
 * to produce a 3-tier risk score with human-readable reasoning.
 */

'use strict'

export const RISK = {
  HIGH:   { id: 'high',   label: 'HIGH RISK',  icon: '🔴', color: '#DC2626', darkColor: '#FCA5A5' },
  MEDIUM: { id: 'medium', label: 'MEDIUM',      icon: '🟡', color: '#D97706', darkColor: '#FCD34D' },
  LOW:    { id: 'low',    label: 'LOW',         icon: '🟢', color: '#059669', darkColor: '#6EE7B7' },
}

// Category sensitivity weights (higher = more sensitive)
const SENSITIVITY = {
  FINANCIAL:     5,
  GOVERNMENT_ID: 5,
  SENSITIVE:     5,
  AUTH:          4,
  IDENTITY:      3,
  CONTACT:       2,
}

const HIGH_SENSITIVITY_CATS = new Set(['FINANCIAL', 'GOVERNMENT_ID', 'SENSITIVE', 'AUTH'])

/**
 * Compute risk score.
 *
 * @param {object} params
 * @param {string[]} params.categories - detected category IDs
 * @param {object[]} params.breaches   - breach objects from HIBP for this domain
 * @param {boolean}  params.hasHttps   - whether the page uses HTTPS
 * @param {string|null} params.policyUrl - privacy policy URL if found
 * @returns {{ level: 'high'|'medium'|'low', reasons: string[], score: number }}
 */
export function computeRisk({ categories, breaches, hasHttps, policyUrl }) {
  const reasons = []
  let score = 0

  // No inputs at all → LOW
  if (categories.length === 0) {
    return {
      level: 'low',
      reasons: ['No data input fields detected on this page.'],
      score: 0,
    }
  }

  // Score from categories
  const maxSensitivity = Math.max(...categories.map(c => SENSITIVITY[c] ?? 1))
  score += maxSensitivity * 10

  const hasHighSensitivity = categories.some(c => HIGH_SENSITIVITY_CATS.has(c))

  if (categories.includes('FINANCIAL')) {
    reasons.push('This page collects financial information (card number, CVV, or billing details).')
  }
  if (categories.includes('GOVERNMENT_ID')) {
    reasons.push('This page collects government-issued ID information (SSN, passport, driver\'s license).')
  }
  if (categories.includes('AUTH')) {
    reasons.push('This page collects authentication credentials (password or security questions).')
  }
  if (categories.includes('SENSITIVE')) {
    reasons.push('This page collects sensitive personal data (health, biometric, or demographic information).')
  }
  if (categories.includes('IDENTITY')) {
    reasons.push('This page collects identity information (name, date of birth, or address).')
  }
  if (categories.includes('CONTACT')) {
    reasons.push('This page collects contact information (email or phone number).')
  }

  // HTTPS check
  if (!hasHttps) {
    score += 30
    reasons.push('⚠️ This page does not use HTTPS — data is transmitted unencrypted.')
  }

  // Privacy policy
  if (!policyUrl) {
    score += 10
    reasons.push('No privacy policy link was found on this page.')
  }

  // Recent breaches (last 5 years)
  const fiveYearsAgo = new Date()
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  const recentBreaches = (breaches || []).filter(b => new Date(b.BreachDate) >= fiveYearsAgo)

  if (recentBreaches.length > 0) {
    score += recentBreaches.length * 15
    const latest = recentBreaches[0]
    reasons.push(
      `This domain had ${recentBreaches.length} confirmed breach${recentBreaches.length > 1 ? 'es' : ''} in the last 5 years` +
      (latest ? ` (most recent: ${latest.Name}, ${latest.BreachDate.slice(0, 4)})` : '') + '.'
    )
  }

  // Determine level
  let level
  if (score >= 50 || (hasHighSensitivity && recentBreaches.length > 0) || !hasHttps) {
    level = 'high'
  } else if (score >= 20 || hasHighSensitivity || categories.length >= 2) {
    level = 'medium'
  } else {
    level = 'low'
  }

  return { level, reasons, score }
}
