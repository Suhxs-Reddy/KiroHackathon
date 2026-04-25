import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Parsed_Policy, Section } from '../types.js';

// ─── Task 4.1: HTML Parser ────────────────────────────────────────────────────

export function parseHtml(content: string, url: string): Parsed_Policy {
  // Use JSDOM to parse HTML
  const dom = new JSDOM(content, { url });
  const document = dom.window.document;

  // Try Readability first
  const reader = new Readability(document.cloneNode(true) as Document);
  const article = reader.parse();

  let targetDoc = document;
  
  if (article && article.content) {
    // Use Readability's extracted content
    const articleDom = new JSDOM(article.content);
    targetDoc = articleDom.window.document;
  }

  // Extract sections from the document
  const sections: Section[] = [];
  const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  
  // Find all headings and their following content
  const allElements = targetDoc.body?.querySelectorAll('*') || [];
  
  let currentHeading = '';
  let currentLevel = 0;
  let currentText: string[] = [];

  const saveSection = () => {
    if (currentHeading || currentText.length > 0) {
      sections.push({
        heading: currentHeading,
        text: currentText.join('\n').trim(),
        level: currentLevel,
      });
    }
  };

  for (const element of allElements) {
    const tagName = element.tagName.toLowerCase();

    if (headingSelectors.includes(tagName)) {
      // Save previous section
      saveSection();

      // Start new section
      currentHeading = element.textContent?.trim() || '';
      currentLevel = parseInt(tagName.charAt(1)); // h1 -> 1, h2 -> 2, etc.
      currentText = [];
    } else if (element.tagName === 'P' || element.tagName === 'DIV' || element.tagName === 'LI') {
      // Add paragraph/div/list text to current section
      const text = element.textContent?.trim();
      if (text && text.length > 0) {
        currentText.push(text);
      }
    }
  }

  // Save final section
  saveSection();

  // If no sections were found, extract all body text
  if (sections.length === 0) {
    const bodyText = targetDoc.body?.textContent?.trim() || '';
    if (bodyText) {
      sections.push({
        heading: '',
        text: bodyText,
        level: 0,
      });
    }
  }

  const fullText = sections.map(s => s.text).join('\n\n');

  return {
    sourceUrl: url,
    format: 'html',
    fullText,
    sections,
    parsedAt: new Date().toISOString(),
  };
}
