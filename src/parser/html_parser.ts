import { Parsed_Policy, Section } from '../types.js';

// ─── Task 4.1: HTML Parser (Service Worker Compatible) ────────────────────────
// Service workers don't have DOMParser or document APIs.
// We use regex-based extraction which works in any JS context.

// Strip HTML tags and decode common entities
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract headings and their content from HTML
function extractSections(html: string): Section[] {
  const sections: Section[] = [];

  // Match heading tags (h1-h6) and capture content between them
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: Array<{ level: number; text: string; index: number }> = [];

  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      text: stripHtml(match[2]),
      index: match.index,
    });
  }

  if (headings.length === 0) {
    // No headings found — extract body content as single section
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    const text = stripHtml(bodyContent);

    if (text.length > 0) {
      sections.push({ heading: '', text, level: 0 });
    }
    return sections;
  }

  // Extract text between headings
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];

    // Get content between this heading and the next one
    const startIdx = heading.index + html.substring(heading.index).indexOf('>') + 1;
    const closingTag = `</h${heading.level}>`;
    const afterHeading = html.indexOf(closingTag, startIdx) + closingTag.length;
    const endIdx = nextHeading ? nextHeading.index : html.length;

    const sectionHtml = html.substring(afterHeading, endIdx);
    const sectionText = stripHtml(sectionHtml);

    if (heading.text.length > 0 || sectionText.length > 0) {
      sections.push({
        heading: heading.text,
        text: sectionText,
        level: heading.level,
      });
    }
  }

  return sections;
}

export function parseHtml(content: string, url: string): Parsed_Policy {
  const sections = extractSections(content);
  const fullText = sections.map(s => {
    if (s.heading) {
      return `${s.heading}\n${s.text}`;
    }
    return s.text;
  }).join('\n\n');

  return {
    sourceUrl: url,
    format: 'html',
    fullText,
    sections,
    parsedAt: new Date().toISOString(),
  };
}
