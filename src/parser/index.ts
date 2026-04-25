import { RawDocument, Parsed_Policy, AnalysisError } from '../types.js';
import { parseHtml } from './html_parser.js';
import { parsePlainText } from './text_parser.js';

// ─── Task 4.6: Parser Dispatcher ──────────────────────────────────────────────

export async function parseDocument(raw: RawDocument): Promise<Parsed_Policy> {
  try {
    switch (raw.format) {
      case 'html':
        if (typeof raw.content !== 'string') {
          throw new Error('HTML content must be a string');
        }
        return parseHtml(raw.content, raw.finalUrl);

      case 'pdf':
        // PDF parsing requires pdfjs-dist which uses DOM/canvas APIs
        // not available in the service worker. For now, return an error
        // directing the user to use the HTML version of the policy.
        // PDF support will be added via offscreen document in a future version.
        throw new AnalysisError(
          'UNSUPPORTED_FORMAT',
          'PDF policies are not yet supported. Please try the HTML version of the privacy policy page instead.',
          false,
          true,
          'PDF parsing disabled — pdfjs-dist incompatible with MV3 service worker'
        );

      case 'text':
        if (typeof raw.content !== 'string') {
          throw new Error('Text content must be a string');
        }
        return parsePlainText(raw.content, raw.finalUrl);

      default:
        throw new AnalysisError(
          'PARSE_ERROR',
          'Unsupported document format.',
          false,
          true,
          `Unknown format: ${raw.format}`
        );
    }
  } catch (error) {
    if (error instanceof AnalysisError) {
      throw error;
    }

    throw new AnalysisError(
      'PARSE_ERROR',
      'Could not parse the policy document.',
      false,
      true,
      error instanceof Error ? error.message : String(error)
    );
  }
}

// ─── Task 4.7: Serialization ──────────────────────────────────────────────────

export function serializeParsedPolicy(p: Parsed_Policy): string {
  return JSON.stringify(p);
}

export function deserializeParsedPolicy(json: string): Parsed_Policy {
  try {
    return JSON.parse(json) as Parsed_Policy;
  } catch (error) {
    throw new AnalysisError(
      'PARSE_ERROR',
      'Invalid JSON format.',
      false,
      false,
      error instanceof Error ? error.message : String(error)
    );
  }
}
