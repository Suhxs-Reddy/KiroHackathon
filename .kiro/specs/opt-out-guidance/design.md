# Design Document: Opt-Out Guidance

## Overview

This document describes the technical design for adding **opt-out guidance extraction and display** to the Privacy Tool browser extension. The feature extends the existing detect → fetch → parse → analyze → display pipeline by:

1. Expanding the AI system prompt to extract opt-out mechanisms for each identified data type
2. Extending the `DataTypeEntry` and `Risk_Analysis` TypeScript types with opt-out fields
3. Adding manual JSON validation for the new opt-out schema fields (no Ajv — MV3 CSP constraint)
4. Updating the content script results UI to display opt-out guidance per data type
5. Handling backward compatibility with cached `Risk_Analysis` objects that lack opt-out fields

The design preserves the existing single-call AI analysis pattern — opt-out extraction happens in the same LLM request as risk analysis, not as a separate call. This keeps latency and API cost unchanged.

```
Parsed_Policy
    │
    ▼
[AI Engine Client]
    │  (single LLM call — extended prompt)
    ▼
Risk_Analysis (now includes OptOutGuidance per DataTypeEntry)
    │
    ▼
[Content Script UI]
    │  (extended results panel)
    ▼
Risk_Breakdown with opt-out guidance per data type
```

**Constraints carried forward from the existing architecture:**
- Manifest V3 service worker — no DOM APIs in background
- Background bundle is ~27KB — keep additions lean (no new dependencies)
- HTML parser uses regex-based extraction (no DOMParser, no jsdom in production)
- Manual JSON validation (no Ajv — `eval` violates MV3 CSP)
- AI model: `meta-llama/Llama-3.1-8B-Instruct` via HuggingFace Inference Providers API; OpenAI GPT-4o as fallback

---

## Architecture

The opt-out guidance feature does not introduce new components or change the pipeline topology. It extends four existing touchpoints:

```
┌─────────────────────────────────────────────────────────────────┐
│  src/types.ts                                                   │
│  + OptOutMechanism interface                                    │
│  + OptOutGuidance interface                                     │
│  + DataTypeEntry.optOutGuidance? (optional for backward compat) │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  src/ai_engine_client.ts                                        │
│  + buildSystemPrompt() — extended with opt-out extraction rules │
│  + validateRiskAnalysis() — extended with opt-out field checks  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  src/content_script.ts                                          │
│  + showAnalysisResults() — extended with opt-out UI per entry   │
│  + normalizeOptOutGuidance() — backward compat for cached data  │
│  + renderOptOutSummary() — summary counts at top of results     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  src/background.ts                                              │
│  (no changes — pipeline orchestration is unchanged)             │
└─────────────────────────────────────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Single AI call vs. separate opt-out call | Single call | Avoids doubling latency and API cost; the 8B model can handle both tasks in one prompt |
| `optOutGuidance` field optionality | Optional on `DataTypeEntry` | Cached results from before this feature won't have the field; making it optional avoids invalidating the cache |
| New dependency for validation | None | Manual validation matches existing pattern; keeps bundle size stable |
| Opt-out mechanism types | Enum of 5 types | Covers the mechanisms actually found in real privacy policies: settings URLs, email, web forms, account navigation steps, postal mail |
| Schema version bump | Stay at `"1.0"` | The field is optional and additive; existing consumers won't break |

---

## Components and Interfaces

### 1. Type Extensions (`src/types.ts`)

Three new types are added. `DataTypeEntry` gains an optional `optOutGuidance` field.

```typescript
type OptOutStatus = 'available' | 'vague' | 'unavailable';

type OptOutMechanismType = 'settings_url' | 'email' | 'web_form' | 'account_steps' | 'postal_mail';

interface OptOutMechanism {
  type: OptOutMechanismType;
  value: string;               // URL, email address, steps description, or postal address
  instructionText: string | null; // Optional human-readable instructions
}

interface OptOutGuidance {
  status: OptOutStatus;
  mechanisms: OptOutMechanism[];  // Non-empty when status is 'available'; empty when 'unavailable'
  summary: string;                // Plain-language summary of the opt-out situation
  warningNote: string | null;     // Non-null when status is 'vague' — explains what makes it vague
}
```

The existing `DataTypeEntry` is extended:

```typescript
interface DataTypeEntry {
  dataType: string;
  riskLevel: RiskLevel;
  purposes: string[];
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[];
  warningNote: string | null;
  deviationNote: string | null;
  optOutGuidance?: OptOutGuidance;  // Optional for backward compatibility (Req 6.2)
}
```

### 2. AI Prompt Extension (`src/ai_engine_client.ts` — `buildSystemPrompt`)

The system prompt is extended to include opt-out extraction instructions. The JSON schema in the prompt gains an `optOutGuidance` object inside each `dataTypes` entry.

**Added to the system prompt JSON schema:**

```json
{
  "optOutGuidance": {
    "status": "<'available' | 'vague' | 'unavailable'>",
    "mechanisms": [
      {
        "type": "<'settings_url' | 'email' | 'web_form' | 'account_steps' | 'postal_mail'>",
        "value": "<string: URL, email address, steps, or postal address>",
        "instructionText": "<string or null: human-readable instructions>"
      }
    ],
    "summary": "<string: plain-language summary of opt-out situation>",
    "warningNote": "<string or null: explains vague language if status is 'vague'>"
  }
}
```

**Added prompt rules (appended to existing system prompt):**

```
Opt-out extraction rules:
- For each data type, look for opt-out instructions, settings references, contact
  information, and opt-out URLs in the policy text
- Set status to "available" when the policy describes a concrete opt-out mechanism
  (a URL, email address, web form, account settings path, or postal address)
- Set status to "vague" when the policy mentions opting out but does not describe
  a specific mechanism (e.g., "you may opt out" with no link or instructions)
- Set status to "unavailable" when the policy contains no opt-out information
  for that data type
- When status is "available", the mechanisms array MUST contain at least one entry
- When status is "unavailable", the mechanisms array MUST be empty
- Extract mechanism details exactly as stated in the policy text — do NOT fabricate
  URLs, email addresses, or instructions that are not in the policy
- Write all summary and instructionText in plain language at or below an 8th-grade
  reading level
```

### 3. Extended Validation (`src/ai_engine_client.ts` — `validateRiskAnalysis`)

The existing manual `validateRiskAnalysis` function is extended to validate opt-out fields on each `DataTypeEntry`. The validation is lenient: if `optOutGuidance` is missing entirely, the entry is still valid (backward compatibility). But if present, it must conform to the schema.

**Validation rules added:**

```typescript
// Inside the dataTypes[i] validation loop:
if (e.optOutGuidance !== undefined && e.optOutGuidance !== null) {
  const g = e.optOutGuidance;
  
  // status must be one of the three valid values
  if (!['available', 'vague', 'unavailable'].includes(g.status)) {
    errors.push(`dataTypes[${i}].optOutGuidance.status must be 'available', 'vague', or 'unavailable'`);
  }
  
  // mechanisms must be an array
  if (!Array.isArray(g.mechanisms)) {
    errors.push(`dataTypes[${i}].optOutGuidance.mechanisms must be an array`);
  } else {
    // When available, mechanisms must be non-empty
    if (g.status === 'available' && g.mechanisms.length === 0) {
      errors.push(`dataTypes[${i}].optOutGuidance.mechanisms must be non-empty when status is 'available'`);
    }
    // When unavailable, mechanisms must be empty
    if (g.status === 'unavailable' && g.mechanisms.length > 0) {
      errors.push(`dataTypes[${i}].optOutGuidance.mechanisms must be empty when status is 'unavailable'`);
    }
    
    // Validate each mechanism
    const validTypes = ['settings_url', 'email', 'web_form', 'account_steps', 'postal_mail'];
    for (let j = 0; j < g.mechanisms.length; j++) {
      const m = g.mechanisms[j];
      if (typeof m.type !== 'string' || !validTypes.includes(m.type)) {
        errors.push(`dataTypes[${i}].optOutGuidance.mechanisms[${j}].type is invalid`);
      }
      if (typeof m.value !== 'string' || m.value.length === 0) {
        errors.push(`dataTypes[${i}].optOutGuidance.mechanisms[${j}].value must be a non-empty string`);
      }
      if (m.instructionText !== null && typeof m.instructionText !== 'string') {
        errors.push(`dataTypes[${i}].optOutGuidance.mechanisms[${j}].instructionText must be string or null`);
      }
    }
  }
  
  // summary must be a string
  if (typeof g.summary !== 'string') {
    errors.push(`dataTypes[${i}].optOutGuidance.summary must be a string`);
  }
  
  // warningNote must be string or null
  if (g.warningNote !== null && typeof g.warningNote !== 'string') {
    errors.push(`dataTypes[${i}].optOutGuidance.warningNote must be string or null`);
  }
}
```

### 4. Content Script UI Extension (`src/content_script.ts`)

#### Backward Compatibility Normalization

A helper function normalizes cached `Risk_Analysis` objects that lack opt-out fields:

```typescript
function normalizeOptOutGuidance(analysis: Risk_Analysis): Risk_Analysis {
  return {
    ...analysis,
    dataTypes: analysis.dataTypes.map(dt => ({
      ...dt,
      optOutGuidance: dt.optOutGuidance ?? {
        status: 'unavailable' as OptOutStatus,
        mechanisms: [],
        summary: 'Opt-out information was not extracted for this analysis.',
        warningNote: null,
      },
    })),
  };
}
```

#### Opt-Out Summary Section

At the top of the results panel, a summary shows counts:

```
Opt-Out Summary:
  ✅ 3 data types with opt-out available
  ⚠️ 2 data types with vague opt-out language
  ❌ 1 data type with no opt-out found
```

#### Per-DataType Opt-Out Display

Each data type card in the results panel is extended with an opt-out section below the existing risk info:

- **Available**: Green indicator. Each mechanism rendered by type:
  - `settings_url` / `web_form`: Clickable link opening in new tab (`target="_blank"`)
  - `email`: Clickable `mailto:` link
  - `account_steps`: Numbered list of steps
  - `postal_mail`: Displayed as plain text address
  - `instructionText` shown below the mechanism if present
- **Vague**: Orange/warning indicator. Shows the `summary` text and `warningNote`
- **Unavailable**: Gray indicator. Shows "No opt-out option found in the policy for this data type."

#### Re-Analyze Button for Legacy Cache

When a cached result lacks opt-out fields (detected by checking `optOutGuidance === undefined` on any entry before normalization), a notice is shown:

```
ℹ️ Opt-out information is not available for this analysis.
[Re-analyze with opt-out extraction]  ← button
```

Clicking the button sends a new `INITIATE_ANALYSIS` message to re-run the pipeline.

---

## Data Models

### New Types

```typescript
type OptOutStatus = 'available' | 'vague' | 'unavailable';

type OptOutMechanismType = 'settings_url' | 'email' | 'web_form' | 'account_steps' | 'postal_mail';

interface OptOutMechanism {
  type: OptOutMechanismType;
  value: string;
  instructionText: string | null;
}

interface OptOutGuidance {
  status: OptOutStatus;
  mechanisms: OptOutMechanism[];
  summary: string;
  warningNote: string | null;
}
```

### Extended `DataTypeEntry`

```typescript
interface DataTypeEntry {
  dataType: string;
  riskLevel: RiskLevel;
  purposes: string[];
  sharedWithThirdParties: boolean;
  thirdPartyCategories: string[];
  warningNote: string | null;
  deviationNote: string | null;
  optOutGuidance?: OptOutGuidance;  // Optional — absent in cached pre-feature results
}
```

### `Risk_Analysis` (unchanged structure, extended content)

The `Risk_Analysis` interface itself does not change. The opt-out data lives inside each `DataTypeEntry` via the optional `optOutGuidance` field. `schemaVersion` remains `"1.0"` since the change is additive and backward-compatible.

### Validation Invariants

| Invariant | Rule |
|---|---|
| `optOutGuidance.status` | Must be exactly one of: `'available'`, `'vague'`, `'unavailable'` |
| `mechanisms` when `available` | Must be non-empty (at least one mechanism) |
| `mechanisms` when `unavailable` | Must be empty |
| `mechanisms` when `vague` | May be empty or non-empty (policy might mention a partial mechanism) |
| `mechanism.type` | Must be one of the 5 defined types |
| `mechanism.value` | Must be a non-empty string |
| `summary` | Must be a non-empty string |
| `warningNote` | String or null; expected non-null when `status` is `'vague'` |

### Serialization

The extended `Risk_Analysis` (with `optOutGuidance` fields) serializes to JSON and deserializes back to an equivalent object. This is the same round-trip property as the existing design, now covering the new fields. The `JSON.stringify` / `JSON.parse` cycle preserves all opt-out fields because they use only JSON-native types (strings, arrays, objects, null).


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: OptOutGuidance Structural Invariant

*For any* valid `Risk_Analysis` object produced by the extended AI pipeline where `optOutGuidance` is present on a `DataTypeEntry`, the `optOutGuidance` SHALL have a `status` that is exactly one of `'available'`, `'vague'`, or `'unavailable'`; a `mechanisms` array where every entry has a valid `type` from the set (`settings_url`, `email`, `web_form`, `account_steps`, `postal_mail`), a non-empty `value` string, and an `instructionText` that is either a string or null; a `summary` that is a non-empty string; and a `warningNote` that is either a string or null.

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**

### Property 2: Status-Mechanisms Consistency

*For any* `OptOutGuidance` object that passes validation: when `status` is `'available'`, the `mechanisms` array SHALL be non-empty; when `status` is `'unavailable'`, the `mechanisms` array SHALL be empty; and when `status` is `'vague'`, the `warningNote` SHALL be non-null.

**Validates: Requirements 2.4, 5.1**

### Property 3: Risk_Analysis Round-Trip with OptOutGuidance

*For any* valid `Risk_Analysis` object containing `DataTypeEntry` items with `optOutGuidance` fields, serializing to JSON via `JSON.stringify` and deserializing via `JSON.parse` SHALL produce an object that is deeply equal to the original — all opt-out fields (`status`, `mechanisms`, `summary`, `warningNote`, and each mechanism's `type`, `value`, `instructionText`) are preserved without loss or mutation.

**Validates: Requirements 2.5**

### Property 4: Validation Rejects Malformed OptOutGuidance

*For any* `Risk_Analysis`-shaped object where at least one `DataTypeEntry` has an `optOutGuidance` with an invalid `status` value, a mechanism with an empty `value`, a mechanism with an invalid `type`, or a non-string non-null `warningNote`, the `validateRiskAnalysis` function SHALL return `{ valid: false }` with a non-empty `errors` array.

**Validates: Requirements 3.5**

### Property 5: UI Renders Opt-Out Status and Mechanisms for Every DataType

*For any* `Risk_Analysis` with one or more `DataTypeEntry` items each having an `optOutGuidance` field, the rendered results HTML SHALL contain a status indicator for every entry; for entries with `status: 'available'`, the HTML SHALL contain an anchor element (`<a>`) for each mechanism of type `settings_url`, `web_form`, or `email`; and for entries with `status: 'vague'`, the HTML SHALL contain the `summary` text.

**Validates: Requirements 4.1, 4.2**

### Property 6: Opt-Out Summary Counts Match Actual Statuses

*For any* `Risk_Analysis` with `DataTypeEntry` items having `optOutGuidance` fields, the opt-out summary section in the rendered HTML SHALL display counts that exactly match the number of entries with each status — the count of `'available'` entries, the count of `'vague'` entries, and the count of `'unavailable'` entries SHALL each equal the actual count in the `dataTypes` array.

**Validates: Requirements 4.5**

### Property 7: Backward Compatibility Normalization

*For any* valid `Risk_Analysis` object where none of the `DataTypeEntry` items have an `optOutGuidance` field (legacy cached data), applying `normalizeOptOutGuidance` SHALL produce a `Risk_Analysis` where every `DataTypeEntry` has an `optOutGuidance` with `status: 'unavailable'`, an empty `mechanisms` array, and a non-empty `summary` string. Additionally, the original `Risk_Analysis` without `optOutGuidance` fields SHALL pass `validateRiskAnalysis` without errors.

**Validates: Requirements 6.1, 6.2**

---

## Error Handling

### New Error Scenarios

| Error | Detection Point | User-Facing Response | Recovery Path |
|---|---|---|---|
| AI response missing `optOutGuidance` on some entries | `validateRiskAnalysis` | Treated as valid — field is optional; entries without it are normalized to `unavailable` at display time | No action needed |
| AI response has malformed `optOutGuidance` | `validateRiskAnalysis` | Retry once with correction prompt (existing retry logic); if still invalid: "Analysis returned unexpected data. Please retry." | Retry button |
| AI response has `status: 'available'` but empty `mechanisms` | `validateRiskAnalysis` | Validation fails → retry with correction prompt | Retry button |
| Cached result lacks `optOutGuidance` fields | `showAnalysisResults` in content script | Display results without opt-out sections; show "Opt-out information is not available for this analysis" notice with re-analyze button | Re-analyze button |

### Error Handling Strategy

The opt-out feature follows the existing error handling pattern:

1. **Validation errors in AI response**: The extended `validateRiskAnalysis` catches malformed opt-out fields. The existing retry-once-with-correction-prompt logic handles this — no new retry logic needed.

2. **Partial opt-out data**: If the AI returns `optOutGuidance` for some entries but not others, the missing entries are treated as valid (field is optional). At display time, `normalizeOptOutGuidance` fills in defaults.

3. **Legacy cache**: The normalization function handles this gracefully. No errors are thrown — the UI simply shows the "unavailable" state and offers re-analysis.

4. **No new error codes**: The existing `AnalysisErrorCode` union covers all failure modes. Opt-out validation failures surface as `AI_INVALID_RESPONSE`, same as any other schema violation.

---

## Testing Strategy

### Overview

The testing strategy uses the same dual approach as the existing codebase:
- **Unit tests** (Vitest): specific examples, edge cases, prompt content verification, UI rendering checks
- **Property-based tests** (Vitest + fast-check): universal properties across generated inputs

PBT is appropriate for this feature because the core additions — validation logic, normalization, serialization, and UI rendering — are pure functions with clear input/output behavior and meaningful input variation.

### Property-Based Tests

Each property test runs a minimum of **100 iterations** via fast-check's `fc.assert(fc.property(...))`.

Each test is tagged with a comment referencing the design property:
```
// Feature: opt-out-guidance, Property N: <property text>
```

**Test library**: fast-check 3.21.0 (already installed)

#### Property 1: OptOutGuidance Structural Invariant
```typescript
// Feature: opt-out-guidance, Property 1: OptOutGuidance Structural Invariant
fc.assert(fc.property(
  validRiskAnalysisWithOptOutArbitrary(),
  (analysis) => {
    const validation = validateRiskAnalysis(analysis);
    if (!validation.valid) return false;
    return analysis.dataTypes.every(dt => {
      if (!dt.optOutGuidance) return true; // optional field
      const g = dt.optOutGuidance;
      return ['available', 'vague', 'unavailable'].includes(g.status) &&
        Array.isArray(g.mechanisms) &&
        g.mechanisms.every(m =>
          ['settings_url', 'email', 'web_form', 'account_steps', 'postal_mail'].includes(m.type) &&
          typeof m.value === 'string' && m.value.length > 0 &&
          (m.instructionText === null || typeof m.instructionText === 'string')
        ) &&
        typeof g.summary === 'string' && g.summary.length > 0 &&
        (g.warningNote === null || typeof g.warningNote === 'string');
    });
  }
), { numRuns: 100 });
```

#### Property 2: Status-Mechanisms Consistency
```typescript
// Feature: opt-out-guidance, Property 2: Status-Mechanisms Consistency
fc.assert(fc.property(
  validOptOutGuidanceArbitrary(),
  (guidance) => {
    if (guidance.status === 'available') return guidance.mechanisms.length > 0;
    if (guidance.status === 'unavailable') return guidance.mechanisms.length === 0;
    if (guidance.status === 'vague') return guidance.warningNote !== null;
    return false;
  }
), { numRuns: 100 });
```

#### Property 3: Risk_Analysis Round-Trip with OptOutGuidance
```typescript
// Feature: opt-out-guidance, Property 3: Risk_Analysis Round-Trip with OptOutGuidance
fc.assert(fc.property(
  validRiskAnalysisWithOptOutArbitrary(),
  (analysis) => {
    const json = JSON.stringify(analysis);
    const restored = JSON.parse(json);
    return deepEqual(analysis, restored);
  }
), { numRuns: 100 });
```

#### Property 4: Validation Rejects Malformed OptOutGuidance
```typescript
// Feature: opt-out-guidance, Property 4: Validation Rejects Malformed OptOutGuidance
fc.assert(fc.property(
  malformedOptOutRiskAnalysisArbitrary(),  // generates at least one invalid opt-out field
  (analysis) => {
    const result = validateRiskAnalysis(analysis);
    return !result.valid && result.errors.length > 0;
  }
), { numRuns: 100 });
```

#### Property 5: UI Renders Opt-Out Status and Mechanisms for Every DataType
```typescript
// Feature: opt-out-guidance, Property 5: UI Renders Opt-Out Status and Mechanisms
fc.assert(fc.property(
  validRiskAnalysisWithOptOutArbitrary(),
  (analysis) => {
    const normalized = normalizeOptOutGuidance(analysis);
    const html = renderAnalysisResults(normalized);
    return normalized.dataTypes.every(dt => {
      const g = dt.optOutGuidance!;
      if (g.status === 'available') {
        return g.mechanisms.every(m => {
          if (['settings_url', 'web_form', 'email'].includes(m.type)) {
            return html.includes(m.value); // URL or email appears in rendered HTML
          }
          return true;
        });
      }
      if (g.status === 'vague') {
        return html.includes(g.summary);
      }
      return true; // unavailable just shows a static notice
    });
  }
), { numRuns: 100 });
```

#### Property 6: Opt-Out Summary Counts Match Actual Statuses
```typescript
// Feature: opt-out-guidance, Property 6: Opt-Out Summary Counts
fc.assert(fc.property(
  validRiskAnalysisWithOptOutArbitrary(),
  (analysis) => {
    const normalized = normalizeOptOutGuidance(analysis);
    const counts = computeOptOutCounts(normalized);
    const actualAvailable = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'available').length;
    const actualVague = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'vague').length;
    const actualUnavailable = normalized.dataTypes.filter(dt => dt.optOutGuidance?.status === 'unavailable').length;
    return counts.available === actualAvailable &&
           counts.vague === actualVague &&
           counts.unavailable === actualUnavailable;
  }
), { numRuns: 100 });
```

#### Property 7: Backward Compatibility Normalization
```typescript
// Feature: opt-out-guidance, Property 7: Backward Compatibility Normalization
fc.assert(fc.property(
  legacyRiskAnalysisArbitrary(),  // Risk_Analysis without optOutGuidance on any entry
  (analysis) => {
    // Legacy data should pass validation
    const validation = validateRiskAnalysis(analysis);
    if (!validation.valid) return false;
    // After normalization, all entries should have unavailable status
    const normalized = normalizeOptOutGuidance(analysis);
    return normalized.dataTypes.every(dt =>
      dt.optOutGuidance !== undefined &&
      dt.optOutGuidance.status === 'unavailable' &&
      dt.optOutGuidance.mechanisms.length === 0 &&
      typeof dt.optOutGuidance.summary === 'string' &&
      dt.optOutGuidance.summary.length > 0
    );
  }
), { numRuns: 100 });
```

### Unit Tests

**AI Engine Client (`ai_engine_client.test.ts`):**
- `buildSystemPrompt()` output contains opt-out extraction instructions (Req 3.1)
- `buildSystemPrompt()` output contains status classification rules: available, vague, unavailable (Req 3.2)
- `buildSystemPrompt()` output contains instruction to extract mechanism details exactly as stated (Req 3.3)
- `buildSystemPrompt()` output contains 8th-grade readability instruction for opt-out text (Req 3.4)
- `validateRiskAnalysis` accepts response with valid `optOutGuidance` on all entries
- `validateRiskAnalysis` accepts response without `optOutGuidance` (backward compat)
- `validateRiskAnalysis` rejects response where `status: 'available'` but `mechanisms` is empty (Req 2.4)
- `validateRiskAnalysis` rejects response where `mechanism.type` is not in the valid set
- `validateRiskAnalysis` rejects response where `mechanism.value` is empty string

**Content Script (`content_script.test.ts`):**
- Renders "available" opt-out with clickable URL link (`target="_blank"`) (Req 4.2)
- Renders "available" opt-out with `mailto:` link for email mechanisms (Req 4.2)
- Renders "available" opt-out with numbered list for `account_steps` (Req 4.2)
- Renders "vague" opt-out with warning indicator and summary text (Req 4.3, 5.2)
- Renders "unavailable" opt-out with "no opt-out found" notice (Req 4.4)
- Renders opt-out summary section with correct counts (Req 4.5)
- Renders vague count with warning indicator in summary (Req 5.3)
- Shows "opt-out information not available" notice for legacy cached results (Req 6.3)
- Shows re-analyze button for legacy cached results (Req 6.3)
- `normalizeOptOutGuidance` fills defaults for entries missing `optOutGuidance` (Req 6.1)

### Test File Structure

```
tests/
├── unit/
│   ├── ai_engine_client.test.ts      (extended with opt-out validation tests)
│   └── content_script.test.ts        (extended with opt-out UI tests)
└── property/
    ├── opt_out_validation.property.test.ts   (Properties 1, 2, 4)
    ├── opt_out_roundtrip.property.test.ts    (Property 3)
    ├── opt_out_ui.property.test.ts           (Properties 5, 6)
    └── opt_out_compat.property.test.ts       (Property 7)
```
