# Requirements Document

## Introduction

This document covers the **Opt-Out Guidance** feature for the Privacy Tool browser extension. The scope is limited to extracting opt-out instructions from privacy policy text during AI analysis and presenting actionable opt-out guidance to the user alongside the existing risk breakdown.

This feature extends the existing detect → fetch → parse → analyze → display pipeline by adding opt-out extraction to the AI analysis step and opt-out guidance to the results UI. The AI_Engine prompt is expanded to extract opt-out mechanisms (URLs, settings paths, email addresses, web forms) for each identified data type. The content script UI is extended to display opt-out availability and instructions per data type, and to flag cases where opt-out language is vague or no mechanism is described.

**Explicitly out of scope for this phase:** automated opt-out execution (clicking links, sending emails, submitting forms), pre-filled email/form templates, opt-out status tracking, reminders, and any interaction with external services on the user's behalf. This phase is identification and guidance only.

## Glossary

- **Privacy_Tool**: The browser extension that detects privacy policies, analyzes them with AI, and displays risk and opt-out information to the user
- **User**: An individual who has installed the Privacy_Tool browser extension
- **Policy_Document**: A privacy policy, Terms of Service, or data processing agreement published by a website, available as an HTML page, PDF file, or plain text
- **Parsed_Policy**: The structured internal representation of a Policy_Document after parsing, containing extracted full text, section headings, source URL, format, and parse timestamp
- **Risk_Analysis**: The structured output produced by the AI_Engine from a Parsed_Policy, containing identified data types, risk levels, purposes, third-party sharing, and opt-out guidance
- **Data_Type**: A category of personal data identified in a Policy_Document (e.g., location data, browsing history, email address)
- **Risk_Level**: A three-value classification — low, medium, or high — assigned to each Data_Type based on sensitivity and scope of collection or sharing
- **AI_Engine**: The AI analysis component that processes Parsed_Policy text and produces structured Risk_Analysis output, accessed via the HuggingFace Inference Providers API or OpenAI API using a user-provided API key
- **Opt_Out_Guidance**: A structured description of how a User can opt out of a specific Data_Type's collection or sharing, extracted from the Policy_Document text by the AI_Engine
- **Opt_Out_Mechanism**: A specific actionable method described in a Policy_Document for opting out — one of: a URL to a settings page, an email address to contact, a web form URL, a sequence of navigation steps within account settings, or a postal mail address
- **Opt_Out_Status**: A classification of opt-out availability for a Data_Type — one of: available (at least one Opt_Out_Mechanism is described), vague (opt-out language exists but no concrete mechanism is provided), or unavailable (no opt-out information is mentioned)
- **Risk_Breakdown**: The UI panel displayed by the content script overlay showing the Risk_Analysis results, including data types, risk levels, and opt-out guidance
- **Alert_Popup**: The notification overlay injected into the page by the content script

## Requirements

### Requirement 1: Opt-Out Information Extraction

**User Story:** As a User, I want the AI analysis to extract opt-out instructions from the privacy policy text, so that I know what options are available to limit data collection and sharing.

#### Acceptance Criteria

1. WHEN a Parsed_Policy is analyzed by the AI_Engine, THE AI_Engine SHALL extract Opt_Out_Guidance for each identified Data_Type by reading the Policy_Document text for opt-out instructions, settings references, contact information, and opt-out URLs
2. THE AI_Engine SHALL classify each Data_Type with an Opt_Out_Status of available, vague, or unavailable based on the specificity of opt-out information found in the Policy_Document text
3. WHEN the Policy_Document describes a concrete Opt_Out_Mechanism for a Data_Type, THE AI_Engine SHALL extract the mechanism type (settings_url, email, web_form, account_steps, postal_mail) and the associated details (URL, address, or step-by-step instructions)
4. WHEN the Policy_Document mentions opt-out language for a Data_Type but does not describe a specific Opt_Out_Mechanism, THE AI_Engine SHALL set the Opt_Out_Status to vague and include a plain-language description of what the policy states
5. WHEN the Policy_Document contains no opt-out information for a Data_Type, THE AI_Engine SHALL set the Opt_Out_Status to unavailable
6. THE AI_Engine SHALL extract all Opt_Out_Guidance exclusively from the Policy_Document text and SHALL NOT fabricate or infer opt-out mechanisms that are not described in the policy

### Requirement 2: Opt-Out Guidance Data Schema

**User Story:** As a developer, I want the opt-out extraction results to follow a well-defined schema, so that the UI can reliably render opt-out guidance for each data type.

#### Acceptance Criteria

1. THE Risk_Analysis output SHALL include an optOutGuidance field for each Data_Type entry containing: the Opt_Out_Status, a list of extracted Opt_Out_Mechanisms, and a plain-language summary of the opt-out situation
2. WHEN an Opt_Out_Mechanism is extracted, THE AI_Engine SHALL represent it as a structured object containing: the mechanism type (settings_url, email, web_form, account_steps, postal_mail), the mechanism value (URL string, email address, or step description), and an optional instructionText field with human-readable instructions
3. THE Risk_Analysis schema SHALL validate that every Data_Type entry contains exactly one Opt_Out_Status value from the set: available, vague, unavailable
4. THE Risk_Analysis schema SHALL validate that the mechanisms list is non-empty when Opt_Out_Status is available, and empty when Opt_Out_Status is unavailable
5. FOR ALL valid Risk_Analysis objects, serializing to JSON and deserializing from JSON SHALL produce an equivalent Risk_Analysis object including all Opt_Out_Guidance fields (round-trip property)

### Requirement 3: AI Prompt Extension for Opt-Out Extraction

**User Story:** As a developer, I want the AI system prompt to instruct the model to extract opt-out information alongside risk data, so that a single AI call produces both risk analysis and opt-out guidance.

#### Acceptance Criteria

1. THE AI_Engine system prompt SHALL instruct the model to extract opt-out mechanisms for each identified Data_Type in addition to the existing risk analysis fields
2. THE AI_Engine system prompt SHALL define the Opt_Out_Status classification rules: available when a concrete mechanism is described, vague when opt-out is mentioned without a specific mechanism, unavailable when no opt-out information exists for that data type
3. THE AI_Engine system prompt SHALL instruct the model to extract mechanism details including URLs, email addresses, account settings paths, and step-by-step instructions exactly as stated in the policy text
4. THE AI_Engine system prompt SHALL instruct the model to write all opt-out guidance text in plain language at or below an 8th-grade reading level
5. WHEN the AI_Engine receives a response, THE AI_Engine SHALL validate the opt-out guidance fields against the extended schema and reject responses where Opt_Out_Guidance fields are missing or malformed

### Requirement 4: Opt-Out Guidance Display

**User Story:** As a User, I want to see opt-out instructions alongside the risk breakdown for each data type, so that I can take action to protect my privacy.

#### Acceptance Criteria

1. WHEN a Risk_Analysis is displayed in the Risk_Breakdown panel, THE Privacy_Tool SHALL show the Opt_Out_Status for each Data_Type as a visual indicator (available, vague, or unavailable)
2. WHEN a Data_Type has an Opt_Out_Status of available, THE Risk_Breakdown SHALL display each Opt_Out_Mechanism with its type and actionable details — URLs displayed as clickable links that open in a new tab, email addresses displayed as clickable mailto links, and account settings steps displayed as a numbered list
3. WHEN a Data_Type has an Opt_Out_Status of vague, THE Risk_Breakdown SHALL display a warning indicator and the plain-language summary describing what the policy states about opting out
4. WHEN a Data_Type has an Opt_Out_Status of unavailable, THE Risk_Breakdown SHALL display a notice indicating that no opt-out option was found in the policy for that data type
5. THE Risk_Breakdown SHALL display an opt-out summary section showing the total count of data types with available opt-outs, vague opt-outs, and unavailable opt-outs
6. THE Risk_Breakdown SHALL render all opt-out guidance text in plain language at or below an 8th-grade reading level, consistent with the existing risk breakdown text

### Requirement 5: Vague Opt-Out Language Flagging

**User Story:** As a User, I want to be warned when a privacy policy uses vague opt-out language, so that I know the policy does not provide a clear way to opt out.

#### Acceptance Criteria

1. WHEN the AI_Engine identifies vague opt-out language for a Data_Type, THE AI_Engine SHALL include a warningNote in the Opt_Out_Guidance explaining what makes the language vague (e.g., "policy says you 'may' be able to opt out but provides no link or instructions")
2. WHEN a Data_Type has an Opt_Out_Status of vague, THE Risk_Breakdown SHALL display the vague opt-out warning with a distinct visual style (warning color and icon) that differentiates it from available and unavailable statuses
3. WHEN the overall Risk_Analysis contains one or more Data_Types with vague Opt_Out_Status, THE Risk_Breakdown opt-out summary section SHALL include a count of vague opt-outs with a warning indicator

### Requirement 6: Backward Compatibility

**User Story:** As a developer, I want the extended Risk_Analysis schema to remain backward compatible with cached analysis results, so that previously analyzed policies continue to display correctly.

#### Acceptance Criteria

1. WHEN the Privacy_Tool loads a cached Risk_Analysis that does not contain Opt_Out_Guidance fields, THE Privacy_Tool SHALL treat all Data_Types in that analysis as having an Opt_Out_Status of unavailable and display the Risk_Breakdown without opt-out guidance sections
2. THE extended Risk_Analysis schema SHALL add Opt_Out_Guidance as an optional field on each Data_Type entry so that existing cached results remain valid
3. IF a cached Risk_Analysis lacks Opt_Out_Guidance fields, THEN THE Risk_Breakdown SHALL display a notice indicating that opt-out information is not available for this analysis and offer a button to re-analyze the policy with opt-out extraction
