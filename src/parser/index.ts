import { RawDocument, Parsed_Policy, AnalysisError } from '../types.js';
import { parseHtml } from './html_parser.js';
import { parsePdf } from './pdf_parser.js';
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
        if (!(raw.content instanceof ArrayBuffer)) {
          throw new Error('PDF content must be an ArrayBuffer');
        }
        return await parsePdf(raw.content, raw.finalUrl);

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
