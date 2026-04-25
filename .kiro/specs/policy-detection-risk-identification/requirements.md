# Requirements Document

## Introduction

This document covers **Step 1** of the Privacy Customization Tool: Privacy Policy Detection and Data Risk Identification. The scope is limited to the browser extension's ability to detect privacy policy links on a page, fetch and parse the policy document (HTML, PDF, or plain text), send the parsed content to an AI engine for structured data risk extraction, and display a plain-language risk breakdown to the user.

This step is the foundational pipeline: detect → fetch → parse → analyze → display. Opt-out extraction, security track record research, revisit alerts, policy change diffing, and search/filter history are explicitly out of scope for this step.

The browser extension targets Chrome, Edge, and Safari.

## Glossary

- **Privacy_Tool**: The browser extension implementing Step 1 of the Privacy Customization Tool, running in Chrome, Edge, and Safari
- **User**: An individual who has installed the Privacy_Tool browser extension
- **Target_Page**: The web page the User is currently viewing in the browser
- **Target_Service**: The website or web application that published the Policy_Document
- **Policy_Link**: A hyperlink on a Target_Page that points to a Policy_Document (e.g., a "Privacy Policy" or "Terms of Service" link in the page footer or header)
- **Policy_Document**: A privacy policy, Terms of Service, or data processing agreement published by a Target_Service, available as an HTML page, PDF file, or plain text
- **Parsed_Policy**: The structured internal representation of a Policy_Document after parsing, containing extracted full text, section headings, and document metadata (source URL, format, parse timestamp)
- **Risk_Analysis**: The structured output produced by the AI_Engine from a Parsed_Policy, containing identified data types collected, stated purposes, third-party sharing disclosures, and a risk level per data type
- **Risk_Breakdown**: The plain-language UI panel displayed to the User summarizing the Risk_Analysis results
- **Data_Type**: A category of personal data identified in a Policy_Document (e.g., location data, browsing history, email address, biometric data)
- **Risk_Level**: A three-value classification — low, medium, or high — assigned to each Data_Type based on sensitivity and scope of collection or sharing
- **AI_Engine**: The AI analysis component configured with a user-provided cloud API key, used to extract structured risk information from a Parsed_Policy
- **Alert_Popup**: A non-blocking notification overlay displayed by the browser extension to inform the User of a detected Policy_Document
- **Page_Metadata**: Structured information extracted from a Target_Page used solely to locate Policy_Links — includes the page title, domain, detected Policy_Links, and presence of consent dialogs or cookie banners. Page_Metadata is NOT used as a source of data risk information; all risk data is derived exclusively from the full text of the Policy_Document itself

## Requirements

### Requirement 1: Privacy Policy Detection

**User Story:** As a User, I want the Privacy_Tool to automatically detect when I am on a page that has a privacy policy or Terms of Service link, so that I know a policy is available to review before I agree to anything.

#### Acceptance Criteria

1. WHEN a User navigates to a Target_Page, THE Privacy_Tool SHALL scan the page DOM for Policy_Links by matching link text and href patterns associated with privacy policies and Terms of Service
2. WHEN one or more Policy_Links are detected on a Target_Page, THE Privacy_Tool SHALL display an Alert_Popup indicating that a privacy policy or Terms of Service has been found
3. WHEN a privacy consent dialog or cookie banner is present on a Target_Page, THE Privacy_Tool SHALL detect it and include it in the Alert_Popup alongside any detected Policy_Links
4. WHEN the Alert_Popup is displayed, THE Privacy_Tool SHALL present a button that allows the User to initiate analysis of the detected Policy_Document
5. THE Privacy_Tool SHALL allow the User to manually trigger detection and analysis on any Target_Page via the browser extension toolbar icon, regardless of whether a Policy_Link was automatically detected
6. IF no Policy_Link is detected on a Target_Page, THEN THE Privacy_Tool SHALL not display an Alert_Popup automatically, but SHALL still allow manual triggering via the toolbar icon
7. WHEN the Privacy_Tool detects Page_Metadata for a Target_Page, THE Privacy_Tool SHALL extract and store the domain, page title, detected Policy_Links, and detection timestamp as structured Page_Metadata

### Requirement 2: Policy Document Fetching

**User Story:** As a User, I want the Privacy_Tool to retrieve the full policy document when I request analysis, so that the AI engine has the complete text to work with.

#### Acceptance Criteria

1. WHEN a User initiates analysis from the Alert_Popup or toolbar, THE Privacy_Tool SHALL fetch the Policy_Document from the resolved URL of the detected Policy_Link
2. WHEN fetching a Policy_Document, THE Privacy_Tool SHALL follow HTTP redirects and resolve the final document URL before parsing
3. THE Privacy_Tool SHALL support fetching Policy_Documents delivered as HTML pages, PDF files, and plain text responses
4. WHEN a Policy_Document fetch completes, THE Privacy_Tool SHALL pass the raw document content and its detected format to the Parser for processing
5. IF a Policy_Document cannot be fetched due to a network error, access restriction, or unsupported response type, THEN THE Privacy_Tool SHALL notify the User with a descriptive error message and offer a manual text input option to paste the policy text directly
6. WHEN a manual text input is submitted by the User, THE Privacy_Tool SHALL treat the submitted text as a plain-text Policy_Document and proceed with parsing

### Requirement 3: Privacy Policy Parsing

**User Story:** As a User, I want the Privacy_Tool to accurately parse privacy policies from various formats, so that the analysis works regardless of how the policy is presented.

#### Acceptance Criteria

1. THE Parser SHALL parse Policy_Documents from HTML web pages, PDF files, and plain text formats into a Parsed_Policy
2. WHEN parsing an HTML Policy_Document, THE Parser SHALL extract the full visible text content while preserving section headings and their hierarchy
3. WHEN parsing a PDF Policy_Document, THE Parser SHALL extract the full text content in reading order, preserving section headings where detectable
4. WHEN parsing a plain text Policy_Document, THE Parser SHALL extract the full text content and identify section headings based on formatting conventions such as all-caps lines, lines ending with a colon, or lines preceded by blank lines
5. WHEN a Policy_Document is parsed, THE Parser SHALL produce a Parsed_Policy containing: the full extracted text, an ordered list of section headings with their associated text, the source URL, the detected document format, and the parse timestamp
6. THE Privacy_Tool SHALL serialize a Parsed_Policy to JSON for storage and deserialize JSON back into a Parsed_Policy for retrieval
7. FOR ALL valid Policy_Documents, parsing the document into a Parsed_Policy, serializing to JSON, and deserializing from JSON SHALL produce a Parsed_Policy equivalent to the original (round-trip property)
8. IF a Policy_Document format cannot be determined or parsed, THEN THE Privacy_Tool SHALL inform the User and provide a manual text input option as a fallback

### Requirement 4: AI-Powered Data Risk Extraction

**User Story:** As a User, I want the Privacy_Tool to use AI to identify what personal data is collected and how risky each data type is, so that I can quickly understand what I am agreeing to share.

#### Acceptance Criteria

1. WHEN a Parsed_Policy is ready for analysis, THE AI_Engine SHALL extract a structured Risk_Analysis by reading the full text of the Policy_Document — all identified Data_Types, stated purposes, third-party sharing disclosures, and Risk_Levels SHALL be derived exclusively from the Policy_Document text, not from page metadata or any external source
2. THE AI_Engine SHALL assign a Risk_Level of low, medium, or high to each identified Data_Type based on the sensitivity of the data and the scope of its collection, use, and sharing as described in the Policy_Document text
3. WHEN a Policy_Document contains ambiguous or vague language about how a Data_Type is used or shared, THE AI_Engine SHALL flag that Data_Type with a warning note in the Risk_Analysis
4. WHEN a Policy_Document grants unusually broad data access or deviates from common privacy practices for a Data_Type, THE AI_Engine SHALL include a plain-language explanation of the deviation in the Risk_Analysis for that Data_Type
5. THE AI_Engine SHALL produce the Risk_Analysis as a structured object that can be serialized to JSON
6. FOR ALL valid Parsed_Policy inputs, the Risk_Analysis produced by the AI_Engine SHALL contain at least one Data_Type entry if the policy text contains any mention of personal data collection
7. IF the AI_Engine is unavailable or returns an error during analysis, THEN THE Privacy_Tool SHALL notify the User with a descriptive error message and allow the User to retry the analysis

### Requirement 5: AI Engine Configuration

**User Story:** As a User, I want to configure the Privacy_Tool with my own cloud AI API key, so that I control which AI model is used for policy analysis.

#### Acceptance Criteria

1. THE Privacy_Tool SHALL require a User-provided cloud API key before performing any AI_Engine analysis
2. WHEN a User provides an API key, THE Privacy_Tool SHALL store it in encrypted local browser storage
3. THE Privacy_Tool SHALL validate the API key by performing a lightweight test request to the AI_Engine before saving the configuration
4. WHEN the API key validation succeeds, THE Privacy_Tool SHALL save the configuration and allow analysis to proceed
5. IF the API key validation fails, THEN THE Privacy_Tool SHALL display a descriptive error message and not save the invalid key
6. THE Privacy_Tool SHALL not transmit any Policy_Document content or User data to external servers unless the User has explicitly saved a valid cloud API key
7. IF the configured AI_Engine is unavailable during an analysis request, THEN THE Privacy_Tool SHALL notify the User and prompt them to verify their API key and network connectivity

### Requirement 6: Risk Breakdown Display

**User Story:** As a User, I want to see a plain-language breakdown of what data is at risk after analysis, so that I can quickly understand the privacy implications without reading the full policy.

#### Acceptance Criteria

1. WHEN a Risk_Analysis is available, THE Privacy_Tool SHALL display a Risk_Breakdown panel in the browser extension UI
2. THE Risk_Breakdown SHALL list each identified Data_Type with its Risk_Level displayed as a visual indicator (low, medium, or high)
3. THE Risk_Breakdown SHALL display the stated purpose for each Data_Type in plain language at or below an 8th-grade reading level
4. THE Risk_Breakdown SHALL indicate for each Data_Type whether it is shared with third parties
5. WHEN a Data_Type has been flagged with a warning by the AI_Engine, THE Risk_Breakdown SHALL display the warning note alongside that Data_Type
6. THE Risk_Breakdown SHALL display an overall summary risk level for the Policy_Document, derived from the highest Risk_Level among all identified Data_Types
7. WHEN the Risk_Breakdown is displayed, THE Privacy_Tool SHALL show the Target_Service domain and the URL of the analyzed Policy_Document
8. IF the Risk_Analysis contains no identified Data_Types, THEN THE Risk_Breakdown SHALL display a message indicating that no personal data collection was detected in the policy text
