import { RawDocument, AnalysisError } from './types.js';

// ─── Task 3.1: Fetch Document with Redirect Resolution ───────────────────────

export async function fetchDocument(url: string): Promise<RawDocument> {
  try {
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      throw new AnalysisError(
        'FETCH_ERROR',
        `The policy page returned an error (HTTP ${response.status}).`,
        true,
        true,
        `HTTP ${response.status} from ${url}`
      );
    }

    // Capture final URL after redirects
    const finalUrl = response.url;
    const fetchedAt = new Date().toISOString();

    // Detect format from Content-Type header
    const contentType = response.headers.get('content-type') || '';
    
    let format: RawDocument['format'];
    let content: string | ArrayBuffer;

    if (contentType.includes('text/html')) {
      format = 'html';
      content = await response.text();
    } else if (contentType.includes('application/pdf')) {
      format = 'pdf';
      content = await response.arrayBuffer();
    } else if (contentType.includes('text/plain')) {
      format = 'text';
      content = await response.text();
    } else {
      throw new AnalysisError(
        'UNSUPPORTED_FORMAT',
        'This policy format is not supported. You can paste the text manually.',
        false,
        true,
        `Unsupported Content-Type: ${contentType}`
      );
    }

    return {
      content,
      format,
      finalUrl,
      fetchedAt,
    };
  } catch (error) {
    if (error instanceof AnalysisError) {
      throw error;
    }

    // Network error or other fetch failure
    throw new AnalysisError(
      'FETCH_ERROR',
      'Could not retrieve the policy document. Check your connection.',
      true,
      true,
      error instanceof Error ? error.message : String(error)
    );
  }
}

// ─── Task 3.4: Manual Text Input Wrapping ─────────────────────────────────────

export function wrapManualText(text: string): RawDocument {
  return {
    content: text,
    format: 'text',
    finalUrl: 'manual',
    fetchedAt: new Date().toISOString(),
  };
}
