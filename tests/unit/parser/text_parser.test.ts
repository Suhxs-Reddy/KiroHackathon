import { describe, it, expect } from 'vitest';
import { parsePlainText } from '../../../src/parser/text_parser.js';

describe('Plain Text Parser', () => {
  it('identifies ALL_CAPS headings (Req 3.4)', () => {
    const content = `
PRIVACY POLICY

This is the introduction text.

DATA COLLECTION

We collect the following data.
    `.trim();

    const result = parsePlainText(content, 'https://example.com/privacy.txt');

    expect(result.format).toBe('text');
    expect(result.sections.length).toBeGreaterThan(0);
    
    const headings = result.sections.map(s => s.heading).filter(Boolean);
    expect(headings).toContain('PRIVACY POLICY');
    expect(headings).toContain('DATA COLLECTION');
  });

  it('identifies colon-terminated headings (Req 3.4)', () => {
    const content = `
Introduction:

This is the introduction text.

Data We Collect:

We collect personal information.
    `.trim();

    const result = parsePlainText(content, 'https://example.com/privacy.txt');

    const headings = result.sections.map(s => s.heading).filter(Boolean);
    expect(headings).toContain('Introduction:');
    expect(headings).toContain('Data We Collect:');
  });

  it('identifies short lines preceded by blank lines as headings (Req 3.4)', () => {
    const content = `
This is some introductory text that goes on for a while.

Privacy Policy

This section describes our privacy practices.

Data Collection

We collect various types of data.
    `.trim();

    const result = parsePlainText(content, 'https://example.com/privacy.txt');

    const headings = result.sections.map(s => s.heading).filter(Boolean);
    expect(headings).toContain('Privacy Policy');
    expect(headings).toContain('Data Collection');
  });

  it('handles empty document gracefully (Req 3.8)', () => {
    const result = parsePlainText('', 'https://example.com/empty.txt');

    expect(result.format).toBe('text');
    expect(result.fullText).toBe('');
    expect(result.sections).toHaveLength(0);
  });

  it('extracts full text from all sections', () => {
    const content = `
SECTION ONE

Text for section one.

SECTION TWO

Text for section two.
    `.trim();

    const result = parsePlainText(content, 'https://example.com/privacy.txt');

    // Debug: log the result
    console.log('Sections:', result.sections);
    console.log('Full text:', result.fullText);

    expect(result.fullText).toContain('Text for section one');
    expect(result.fullText).toContain('Text for section two');
  });
});
