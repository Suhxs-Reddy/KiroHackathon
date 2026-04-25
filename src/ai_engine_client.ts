import { Parsed_Policy, Risk_Analysis, RiskLevel, AnalysisError, LLMAdapter } from './types.js';

// ─── Risk_Analysis Validation (CSP-safe, no eval) ────────────────────────────

const VALID_RISK_LEVELS = ['low', 'medium', 'high'];

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateRiskAnalysis(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['Root must be an object'] };
  }

  const obj = data as Record<string, unknown>;

  // Check required top-level fields
  if (!Array.isArray(obj.dataTypes)) {
    errors.push('Missing or invalid "dataTypes" array');
  }
  if (!Array.isArray(obj.analysisWarnings)) {
    errors.push('Missing or invalid "analysisWarnings" array');
  }

  if (errors.length > 0) return { valid: false, errors };

  // Validate each dataType entry
  const dataTypes = obj.dataTypes as unknown[];
  for (let i = 0; i < dataTypes.length; i++) {
    const entry = dataTypes[i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`dataTypes[${i}] must be an object`);
      continue;
    }

    const e = entry as Record<string, unknown>;

    if (typeof e.dataType !== 'string' || e.dataType.length === 0) {
      errors.push(`dataTypes[${i}].dataType must be a non-empty string`);
    }
    if (typeof e.riskLevel !== 'string' || !VALID_RISK_LEVELS.includes(e.riskLevel)) {
      errors.push(`dataTypes[${i}].riskLevel must be 'low', 'medium', or 'high'`);
    }
    if (!Array.isArray(e.purposes)) {
      errors.push(`dataTypes[${i}].purposes must be an array`);
    }
    if (typeof e.sharedWithThirdParties !== 'boolean') {
      errors.push(`dataTypes[${i}].sharedWithThirdParties must be a boolean`);
    }
    if (!Array.isArray(e.thirdPartyCategories)) {
      errors.push(`dataTypes[${i}].thirdPartyCategories must be an array`);
    }
    if (e.warningNote !== null && typeof e.warningNote !== 'string') {
      errors.push(`dataTypes[${i}].warningNote must be a string or null`);
    }
    if (e.deviationNote !== null && typeof e.deviationNote !== 'string') {
      errors.push(`dataTypes[${i}].deviationNote must be a string or null`);
    }
  }

  // Validate analysisWarnings entries
  const warnings = obj.analysisWarnings as unknown[];
  for (let i = 0; i < warnings.length; i++) {
    if (typeof warnings[i] !== 'string') {
      errors.push(`analysisWarnings[${i}] must be a string`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Task 6.1 & 6.2: LLM Adapters ─────────────────────────────────────────────

export class SaulLMAdapter implements LLMAdapter {
  // Use Meta Llama 3.1 8B Instruct via HuggingFace Inference Providers
  // Available on free tier through multiple providers (Cerebras, Novita, etc.)
  // Our legal-specialized system prompt provides the domain expertise
  modelId = 'meta-llama/Llama-3.1-8B-Instruct';

  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userMessage: string, timeoutMs: number = 120000): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log('[HuggingFace] Sending request via Inference Providers API...');
      // Use the new HuggingFace Inference Providers API (OpenAI-compatible)
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 2000,
          temperature: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      });

      console.log('[HuggingFace] Response status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error('[HuggingFace] Error response body:', errorBody);

        if (response.status === 503) {
          throw new AnalysisError(
            'AI_UNAVAILABLE',
            'The AI model is loading. Please try again in a minute.',
            true,
            false,
            `HTTP 503. Body: ${errorBody.substring(0, 200)}`
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new AnalysisError(
            'API_KEY_INVALID',
            'API key is invalid or does not have Inference Providers permission.',
            false,
            false,
            `HTTP ${response.status}`
          );
        }
        if (response.status === 404 || response.status === 422) {
          throw new AnalysisError(
            'AI_UNAVAILABLE',
            'Model not available. The model may not be supported on serverless inference.',
            true,
            false,
            `HTTP ${response.status}. Body: ${errorBody.substring(0, 200)}`
          );
        }
        if (response.status >= 500) {
          throw new AnalysisError(
            'AI_UNAVAILABLE',
            'The AI service is unavailable. Check your API key and network, then retry.',
            true,
            false,
            `HTTP ${response.status} from HuggingFace`
          );
        }
        throw new AnalysisError(
          'API_KEY_INVALID',
          `API request failed (HTTP ${response.status}).`,
          false,
          false,
          `HTTP ${response.status}. Body: ${errorBody.substring(0, 200)}`
        );
      }

      const result = await response.json();
      console.log('[HuggingFace] Response received');

      // OpenAI-compatible response format
      if (result.choices?.[0]?.message?.content) {
        return result.choices[0].message.content;
      }

      // Error in response body
      if (result?.error && typeof result.error === 'string') {
        console.warn('[HuggingFace] API returned error:', result.error);
        throw new AnalysisError(
          'AI_UNAVAILABLE',
          `HuggingFace: ${result.error}`,
          true,
          false,
          result.error
        );
      }

      throw new AnalysisError(
        'AI_INVALID_RESPONSE',
        'Analysis returned unexpected data. Please retry.',
        true,
        false,
        `Unexpected response format: ${JSON.stringify(result).substring(0, 200)}`
      );
    } catch (error) {
      if (error instanceof AnalysisError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AnalysisError(
          'AI_UNAVAILABLE',
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Try again in a minute.`,
          true,
          false,
          'AbortError: fetch timed out'
        );
      }

      throw new AnalysisError(
        'AI_UNAVAILABLE',
        'Network error connecting to HuggingFace. Check your internet connection.',
        true,
        false,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class OpenAIAdapter implements LLMAdapter {
  modelId = 'gpt-4o';

  constructor(private apiKey: string) {}

  async complete(systemPrompt: string, userMessage: string, timeoutMs: number = 120000): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log('[OpenAI] Sending request...');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      console.log('[OpenAI] Response status:', response.status);

      if (!response.ok) {
        if (response.status === 401) {
          throw new AnalysisError(
            'API_KEY_INVALID',
            'API key is invalid.',
            false,
            false,
            `HTTP 401 from OpenAI`
          );
        }
        if (response.status >= 500) {
          throw new AnalysisError(
            'AI_UNAVAILABLE',
            'The AI service is unavailable. Check your API key and network, then retry.',
            true,
            false,
            `HTTP ${response.status} from OpenAI`
          );
        }
        throw new AnalysisError(
          'API_KEY_INVALID',
          'API key validation failed.',
          false,
          false,
          `HTTP ${response.status}`
        );
      }

      const result = await response.json();
      console.log('[OpenAI] Response received');
      return result.choices[0].message.content;
    } catch (error) {
      if (error instanceof AnalysisError) throw error;

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AnalysisError(
          'AI_UNAVAILABLE',
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          true,
          false,
          'AbortError: fetch timed out'
        );
      }

      throw new AnalysisError(
        'AI_UNAVAILABLE',
        'Network error connecting to OpenAI. Check your internet connection.',
        true,
        false,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── Task 6.3: Prompt Construction ────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a privacy policy analyst. Your job is to read the full text of a privacy policy or Terms of Service document and extract structured information about personal data collection and risk.

You MUST respond with a single valid JSON object that conforms exactly to this schema:

{
  "dataTypes": [
    {
      "dataType": "<string: category of personal data, e.g. 'location data'>",
      "riskLevel": "<'low' | 'medium' | 'high'>",
      "purposes": ["<string: stated purpose from policy text>"],
      "sharedWithThirdParties": <boolean>,
      "thirdPartyCategories": ["<string: category of third party, e.g. 'advertising networks'>"],
      "warningNote": "<string or null: flag if language is ambiguous or vague>",
      "deviationNote": "<string or null: flag if data access is unusually broad>"
    }
  ],
  "analysisWarnings": ["<string: top-level issues, e.g. policy text was truncated>"]
}

Risk level assignment rules:
- HIGH: biometric data, precise location, health/medical data, financial account data, government ID numbers, data sold to third parties, data used for profiling
- MEDIUM: browsing history, device identifiers, IP address, email address, inferred interests, data shared with advertising partners
- LOW: anonymized/aggregated data, technical logs not linked to identity, data used solely for service operation with no third-party sharing

Ambiguity rules (set warningNote):
- Set warningNote when the policy uses vague phrases like "may share", "partners", "affiliates", "service providers" without specifying who or for what purpose
- Set warningNote when opt-out language is present but the mechanism is not described

Deviation rules (set deviationNote):
- Set deviationNote when the policy claims rights to sell, license, or transfer data beyond what is needed to operate the service
- Set deviationNote when data retention is indefinite or unusually long (> 5 years)
- Set deviationNote when the policy grants rights to combine data across unrelated services

Extract ALL distinct data types mentioned. Do not summarize multiple data types into one unless they are genuinely the same category. If no personal data collection is mentioned, return an empty dataTypes array.

All text in your response MUST be in plain language at or below an 8th-grade reading level. Do not use legal jargon in purposes, warningNote, or deviationNote fields.`;
}

function buildUserMessage(parsed: Parsed_Policy, targetDomain: string): string {
  return `Analyze the following privacy policy text and extract structured risk information.
The policy is from: ${targetDomain}
Policy URL: ${parsed.sourceUrl}

--- POLICY TEXT START ---
${parsed.fullText}
--- POLICY TEXT END ---`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateText(text: string, maxTokens: number): { text: string; wasTruncated: boolean } {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) {
    return { text, wasTruncated: false };
  }

  const maxChars = maxTokens * 4;
  return {
    text: text.substring(0, maxChars) + '\n[TRUNCATED — policy text exceeded context limit]',
    wasTruncated: true,
  };
}

// ─── Task 6.4: JSON Validation and Risk_Analysis Assembly ─────────────────────

function computeOverallRiskLevel(dataTypes: Risk_Analysis['dataTypes']): RiskLevel {
  if (dataTypes.length === 0) return 'low';

  const riskLevels: RiskLevel[] = ['low', 'medium', 'high'];
  let maxLevel: RiskLevel = 'low';

  for (const entry of dataTypes) {
    if (riskLevels.indexOf(entry.riskLevel) > riskLevels.indexOf(maxLevel)) {
      maxLevel = entry.riskLevel;
    }
  }

  return maxLevel;
}

async function parseAndValidateResponse(
  responseText: string,
  adapter: LLMAdapter,
  systemPrompt: string,
  userMessage: string,
  retryCount: number = 0
): Promise<{ dataTypes: Risk_Analysis['dataTypes']; analysisWarnings: string[] }> {
  try {
    const parsed = JSON.parse(responseText);

    const validation = validateRiskAnalysis(parsed);
    if (validation.valid) {
      return parsed;
    }

    // Schema validation failed
    if (retryCount === 0) {
      // Retry once with correction prompt
      const correctionPrompt = `${userMessage}\n\nYour previous response was not valid JSON matching the required schema. Please respond with only the JSON object.`;
      const retryResponse = await adapter.complete(systemPrompt, correctionPrompt);
      return parseAndValidateResponse(retryResponse, adapter, systemPrompt, userMessage, 1);
    }

    throw new AnalysisError(
      'AI_INVALID_RESPONSE',
      'Analysis returned unexpected data. Please retry.',
      true,
      false,
      `Schema validation failed: ${validation.errors.join('; ')}`
    );
  } catch (error) {
    if (error instanceof AnalysisError) throw error;

    // JSON parse error
    if (retryCount === 0) {
      const correctionPrompt = `${userMessage}\n\nYour previous response was not valid JSON. Please respond with only the JSON object.`;
      const retryResponse = await adapter.complete(systemPrompt, correctionPrompt);
      return parseAndValidateResponse(retryResponse, adapter, systemPrompt, userMessage, 1);
    }

    throw new AnalysisError(
      'AI_INVALID_RESPONSE',
      'Analysis returned unexpected data. Please retry.',
      true,
      false,
      error instanceof Error ? error.message : String(error)
    );
  }
}

// ─── Task 6.8: Public API ──────────────────────────────────────────────────────

export async function analyzePolicy(parsed: Parsed_Policy): Promise<Risk_Analysis> {
  // Load API key from storage
  const storage = await chrome.storage.local.get(['apiKey', 'adapterType']);
  
  if (!storage.apiKey) {
    throw new AnalysisError(
      'NO_API_KEY',
      'Please configure your AI API key in Settings before running analysis.',
      false,
      false
    );
  }

  // Instantiate adapter
  const adapterType = storage.adapterType || 'saulm';
  const adapter: LLMAdapter = adapterType === 'openai'
    ? new OpenAIAdapter(storage.apiKey)
    : new SaulLMAdapter(storage.apiKey);

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  
  // Apply token budget (28k for SaulLM, 100k for OpenAI)
  const maxTokens = adapterType === 'openai' ? 100000 : 28000;
  const { text: fullText, wasTruncated } = truncateText(parsed.fullText, maxTokens);
  
  const targetDomain = new URL(parsed.sourceUrl).hostname;
  const userMessage = buildUserMessage({ ...parsed, fullText }, targetDomain);

  // Call AI
  const responseText = await adapter.complete(systemPrompt, userMessage);

  // Validate and parse
  const { dataTypes, analysisWarnings } = await parseAndValidateResponse(
    responseText,
    adapter,
    systemPrompt,
    userMessage
  );

  // Add truncation warning if needed
  if (wasTruncated) {
    analysisWarnings.push('Policy text was truncated due to length');
  }

  // Assemble final Risk_Analysis
  const overallRiskLevel = computeOverallRiskLevel(dataTypes);

  return {
    schemaVersion: '1.0',
    policyUrl: parsed.sourceUrl,
    targetDomain,
    analyzedAt: new Date().toISOString(),
    overallRiskLevel,
    dataTypes,
    analysisWarnings,
    modelUsed: adapter.modelId,
  };
}

// ─── Task 8.2: API Key Testing ────────────────────────────────────────────────

export async function testApiKey(apiKey: string, adapterType: 'saulm' | 'openai'): Promise<void> {
  const adapter: LLMAdapter = adapterType === 'openai'
    ? new OpenAIAdapter(apiKey)
    : new SaulLMAdapter(apiKey);

  // Simple test prompt — just needs a valid response, not a full analysis
  const testPrompt = 'Respond with exactly this JSON: {"dataTypes":[], "analysisWarnings":[]}';
  const testMessage = 'Test connection';

  // Use a 30-second timeout for validation (shorter than analysis)
  const validationTimeout = 30000;

  try {
    console.log(`[testApiKey] Starting validation with ${adapterType} (timeout: ${validationTimeout / 1000}s)`);

    const response = await adapter.complete(testPrompt, testMessage, validationTimeout);

    console.log('[testApiKey] Got response:', response.substring(0, 200));

    // For validation, we just need any response — don't require valid JSON
    // The model might not return perfect JSON for a test prompt, and that's fine
    // What matters is that the API key works and the model responds
    console.log('[testApiKey] Validation successful — API key is valid');
  } catch (error) {
    console.error('[testApiKey] Validation failed:', error);

    if (error instanceof AnalysisError) {
      // Re-throw with user-friendly messages
      if (error.code === 'API_KEY_INVALID') throw error;
      if (error.code === 'AI_UNAVAILABLE') {
        throw new AnalysisError(
          'AI_UNAVAILABLE',
          error.message,
          true,
          false,
          error.detail
        );
      }
    }

    throw new AnalysisError(
      'API_KEY_INVALID',
      'API key validation failed. Check your key and try again.',
      false,
      false,
      error instanceof Error ? error.message : String(error)
    );
  }
}
