# Implementation Plan: Opt-Out Guidance

## Overview

Extend the Privacy Tool's AI analysis pipeline to extract opt-out mechanisms from privacy policy text and display actionable opt-out guidance per data type in the content script results UI. The implementation touches four existing files — `src/types.ts`, `src/ai_engine_client.ts`, `src/content_script.ts`, and their corresponding test files — without adding new dependencies or changing the pipeline topology. Backward compatibility with cached `Risk_Analysis` objects is preserved by making the new `optOutGuidance` field optional on `DataTypeEntry`.

---

## Tasks

- [x] 1. Add opt-out type definitions to `src/types.ts`
  - Add `OptOutStatus` type alias: `'available' | 'vague' | 'unavailable'`
  - Add `OptOutMechanismType` type alias: `'settings_url' | 'email' | 'web_form' | 'account_steps' | 'postal_mail'`
  - Add `OptOutMechanism` interface with fields: `type: OptOutMechanismType`, `value: string`, `instructionText: string | null`
  - Add `OptOutGuidance` interface with fields: `status: OptOutStatus`, `mechanisms: OptOutMechanism[]`, `summary: string`, `warningNote: string | null`
  - Add optional `optOutGuidance?: OptOutGuidance` field to the existing `DataTypeEntry` interface
  - Export all new types
  - _Requirements: 2.1, 2.2, 2.3, 6.2_

- [ ] 2. Extend AI prompt and validation in `src/ai_engine_client.ts`
  - [x] 2.1 Extend `buildSystemPrompt()` with opt-out extraction instructions
    - Add the `optOutGuidance` object to the JSON schema example in the prompt
    - Add opt-out status classification rules: available (concrete mechanism), vague (mentioned but no mechanism), unavailable (no info)
    - Add instruction to extract mechanism details (URLs, emails, steps) exactly as stated in the policy text
    - Add instruction that all opt-out text must be plain language at or below 8th-grade reading level
    - Add instruction that the model must not fabricate opt-out mechanisms not found in the policy
    - _Requirements: 1.1, 1.2, 1.6, 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Extend `validateRiskAnalysis()` with opt-out field validation
    - If `optOutGuidance` is present on a `DataTypeEntry`, validate: `status` is one of the three valid values; `mechanisms` is an array; each mechanism has a valid `type`, non-empty `value`, and `instructionText` is string or null; `summary` is a string; `warningNote` is string or null
    - Validate status-mechanisms consistency: `available` requires non-empty mechanisms; `unavailable` requires empty mechanisms
    - If `optOutGuidance` is absent, treat the entry as valid (backward compatibility)
    - _Requirements: 2.3, 2.4, 3.5_

  - [ ]* 2.3 Write unit tests for opt-out prompt content
    - File: `tests/unit/ai_engine_client.test.ts` (extend existing)
    - Test: `buildSystemPrompt()` output contains `optOutGuidance` schema definition (Req 3.1)
    - Test: `buildSystemPrompt()` output contains status classification rules for available, vague, unavailable (Req 3.2)
    - Test: `buildSystemPrompt()` output contains instruction to extract mechanism details exactly as stated (Req 3.3)
    - Test: `buildSystemPrompt()` output contains 8th-grade readability instruction for opt-out text (Req 3.4)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.4 Write unit tests for opt-out validation logic
    - File: `tests/unit/ai_engine_client.test.ts` (extend existing)
    - Test: `validateRiskAnalysis` accepts response with valid `optOutGuidance` on all entries
    - Test: `validateRiskAnalysis` accepts response without `optOutGuidance` (backward compat, Req 6.2)
    - Test: `validateRiskAnalysis` rejects response where `status: 'available'` but `mechanisms` is empty (Req 2.4)
    - Test: `validateRiskAnalysis` rejects response where `mechanism.type` is not in the valid set
    - Test: `validateRiskAnalysis` rejects response where `mechanism.value` is empty string
    - Test: `validateRiskAnalysis` rejects response where `status` is not a valid value
    - _Requirements: 2.3, 2.4, 3.5_

  - [ ]* 2.5 Write property test for OptOutGuidance structural invariant
    - **Property 1: OptOutGuidance Structural Invariant**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
    - File: `tests/property/opt_out_validation.property.test.ts`

  - [ ]* 2.6 Write property test for status-mechanisms consistency
    - **Property 2: Status-Mechanisms Consistency**
    - **Validates: Requirements 2.4, 5.1**
    - File: `tests/property/opt_out_validation.property.test.ts`

  - [ ]* 2.7 Write property test for validation rejects malformed OptOutGuidance
    - **Property 4: Validation Rejects Malformed OptOutGuidance**
    - **Validates: Requirements 3.5**
    - File: `tests/property/opt_out_validation.property.test.ts`

- [x] 3. Checkpoint — AI engine changes
  - Ensure all tests pass: `npx vitest --run tests/unit/ai_engine_client.test.ts`
  - Ensure the build completes without TypeScript errors: `npm run build`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Extend content script UI for opt-out display in `src/content_script.ts`
  - [x] 4.1 Implement `normalizeOptOutGuidance(analysis: Risk_Analysis): Risk_Analysis`
    - For each `DataTypeEntry` missing `optOutGuidance`, fill in a default: `{ status: 'unavailable', mechanisms: [], summary: 'Opt-out information was not extracted for this analysis.', warningNote: null }`
    - Return a new `Risk_Analysis` with all entries normalized
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 Implement opt-out summary section in `showAnalysisResults()`
    - At the top of the results panel, render counts: number of data types with available, vague, and unavailable opt-outs
    - Use green indicator for available count, orange/warning indicator for vague count, gray for unavailable count
    - _Requirements: 4.5, 5.3_

  - [x] 4.3 Extend per-DataType cards with opt-out guidance rendering
    - For `status: 'available'`: green indicator; render each mechanism by type — `settings_url`/`web_form` as clickable `<a>` with `target="_blank"`, `email` as `mailto:` link, `account_steps` as numbered list, `postal_mail` as plain text; show `instructionText` if present
    - For `status: 'vague'`: orange/warning indicator; show `summary` text and `warningNote`
    - For `status: 'unavailable'`: gray indicator; show "No opt-out option found in the policy for this data type."
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 5.1, 5.2_

  - [x] 4.4 Implement legacy cache detection and re-analyze button
    - Before calling `normalizeOptOutGuidance`, check if any `DataTypeEntry` has `optOutGuidance === undefined`
    - If legacy data detected, show notice: "Opt-out information is not available for this analysis." with a "Re-analyze with opt-out extraction" button
    - Button click sends `INITIATE_ANALYSIS` message to re-run the pipeline
    - _Requirements: 6.1, 6.3_

  - [ ]* 4.5 Write unit tests for opt-out UI rendering
    - File: `tests/unit/content_script.test.ts` (extend existing)
    - Test: renders "available" opt-out with clickable URL link (`target="_blank"`) (Req 4.2)
    - Test: renders "available" opt-out with `mailto:` link for email mechanisms (Req 4.2)
    - Test: renders "available" opt-out with numbered list for `account_steps` (Req 4.2)
    - Test: renders "vague" opt-out with warning indicator and summary text (Req 4.3, 5.2)
    - Test: renders "unavailable" opt-out with "no opt-out found" notice (Req 4.4)
    - Test: renders opt-out summary section with correct counts (Req 4.5)
    - Test: renders vague count with warning indicator in summary (Req 5.3)
    - Test: shows "opt-out information not available" notice for legacy cached results (Req 6.3)
    - Test: shows re-analyze button for legacy cached results (Req 6.3)
    - Test: `normalizeOptOutGuidance` fills defaults for entries missing `optOutGuidance` (Req 6.1)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 6.1, 6.3_

  - [ ]* 4.6 Write property test for Risk_Analysis round-trip with OptOutGuidance
    - **Property 3: Risk_Analysis Round-Trip with OptOutGuidance**
    - **Validates: Requirements 2.5**
    - File: `tests/property/opt_out_roundtrip.property.test.ts`

  - [ ]* 4.7 Write property test for UI renders opt-out status and mechanisms
    - **Property 5: UI Renders Opt-Out Status and Mechanisms for Every DataType**
    - **Validates: Requirements 4.1, 4.2**
    - File: `tests/property/opt_out_ui.property.test.ts`

  - [ ]* 4.8 Write property test for opt-out summary counts
    - **Property 6: Opt-Out Summary Counts Match Actual Statuses**
    - **Validates: Requirements 4.5**
    - File: `tests/property/opt_out_ui.property.test.ts`

  - [ ]* 4.9 Write property test for backward compatibility normalization
    - **Property 7: Backward Compatibility Normalization**
    - **Validates: Requirements 6.1, 6.2**
    - File: `tests/property/opt_out_compat.property.test.ts`

- [x] 5. Checkpoint — full feature
  - Run the full test suite: `npx vitest --run`
  - Verify the extension build completes without errors: `npm run build`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Wire everything together and final verification
  - [x] 6.1 Verify end-to-end data flow
    - Confirm `showAnalysisResults` in `content_script.ts` calls `normalizeOptOutGuidance` before rendering
    - Confirm the extended `validateRiskAnalysis` is used in the existing `parseAndValidateResponse` flow (no wiring changes needed — it's the same function)
    - Confirm new types are exported from `src/types.ts` and imported where needed
    - _Requirements: 1.1, 2.1, 4.1, 6.1_

  - [x] 6.2 Verify backward compatibility with existing cached data
    - Confirm that a `Risk_Analysis` object without `optOutGuidance` fields passes `validateRiskAnalysis` without errors
    - Confirm that `normalizeOptOutGuidance` correctly fills defaults for legacy entries
    - Confirm the re-analyze button appears for legacy cached results
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Final checkpoint — all tests pass
  - Run `npx vitest --run` and confirm all non-optional tests pass
  - Verify the extension build completes without errors: `npm run build`
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints (tasks 3, 5, 7) ensure incremental validation at natural boundaries
- Property tests validate universal correctness properties across generated inputs; unit tests validate specific examples and edge cases
- No new dependencies are added — manual JSON validation follows the existing pattern (no Ajv for opt-out fields)
- `background.ts` requires no changes — the pipeline orchestration is unchanged; opt-out data flows through the existing `Risk_Analysis` object
- `schemaVersion` stays at `"1.0"` since the change is additive and backward-compatible
