import * as pdfjsLib from 'pdfjs-dist';
import { Parsed_Policy, Section } from '../types.js';

// ─── Task 4.3: PDF Parser ─────────────────────────────────────────────────────

export async function parsePdf(content: ArrayBuffer, url: string): Promise<Parsed_Policy> {
  try {
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({ data: content });
    const pdf = await loadingTask.promise;

    const textItems: Array<{ text: string; fontSize: number }> = [];

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        if ('str' in item && item.str.trim()) {
          // @ts-ignore - pdfjs types are incomplete
          const fontSize = item.transform?.[0] || 12;
          textItems.push({
            text: item.str.trim(),
            fontSize: Math.abs(fontSize),
          });
        }
      }
    }

    if (textItems.length === 0) {
      return {
        sourceUrl: url,
        format: 'pdf',
        fullText: '',
        sections: [],
        parsedAt: new Date().toISOString(),
      };
    }

    // Calculate median font size for body text
    const fontSizes = textItems.map(item => item.fontSize).sort((a, b) => a - b);
    const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)];
    const headingThreshold = medianFontSize * 1.2;

    // Build sections based on font size heuristic
    const sections: Section[] = [];
    let currentHeading = '';
    let currentText: string[] = [];
    let currentLevel = 0;

    for (const item of textItems) {
      if (item.fontSize >= headingThreshold) {
        // This is likely a heading
        if (currentHeading || currentText.length > 0) {
          sections.push({
            heading: currentHeading,
            text: currentText.join(' ').trim(),
            level: currentLevel,
          });
        }

        currentHeading = item.text;
        currentLevel = item.fontSize > headingThreshold * 1.2 ? 1 : 2;
        currentText = [];
      } else {
        // Body text
        currentText.push(item.text);
      }
    }

    // Save final section
    if (currentHeading || currentText.length > 0) {
      sections.push({
        heading: currentHeading,
        text: currentText.join(' ').trim(),
        level: currentLevel,
      });
    }

    const fullText = sections.map(s => s.text).join('\n\n');

    return {
      sourceUrl: url,
      format: 'pdf',
      fullText,
      sections,
      parsedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
