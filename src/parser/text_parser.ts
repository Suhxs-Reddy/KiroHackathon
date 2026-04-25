import { Parsed_Policy, Section } from '../types.js';

// ─── Task 4.4: Plain Text Parser ──────────────────────────────────────────────

export function parsePlainText(content: string, url: string): Parsed_Policy {
  const sections: Section[] = [];
  const lines = content.split('\n');
  
  let currentHeading = '';
  let currentText: string[] = [];
  let currentLevel = 0;
  let previousLineWasBlank = true;

  const isHeading = (line: string, prevBlank: boolean): boolean => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;

    // ALL_CAPS heading (must be at least 3 chars and all uppercase letters/numbers/spaces)
    if (/^[A-Z0-9\s\W]+$/.test(trimmed) && trimmed.length >= 3 && /[A-Z]/.test(trimmed)) {
      // But not if it looks like a sentence (ends with period, question mark, etc.)
      if (/[.!?]$/.test(trimmed)) return false;
      return true;
    }

    // Ends with colon (but not if it's a full sentence)
    if (trimmed.endsWith(':') && !trimmed.includes('.')) return true;

    // Short line preceded by blank line (but must be very short and not end with punctuation)
    if (prevBlank && trimmed.length <= 40 && trimmed.length > 2 && !/[.!?]$/.test(trimmed)) {
      // Additional check: should not contain common sentence words
      const lowerTrimmed = trimmed.toLowerCase();
      if (lowerTrimmed.startsWith('text for') || lowerTrimmed.startsWith('we ') || lowerTrimmed.startsWith('this ')) {
        return false;
      }
      return true;
    }

    return false;
  };

  const saveSection = () => {
    if (currentHeading || currentText.length > 0) {
      sections.push({
        heading: currentHeading,
        text: currentText.join('\n').trim(),
        level: currentLevel,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      previousLineWasBlank = true;
      continue;
    }

    if (isHeading(trimmed, previousLineWasBlank)) {
      // Save previous section
      saveSection();

      // Start new section
      currentHeading = trimmed;
      currentText = [];
      currentLevel = 1;
      previousLineWasBlank = false;
    } else {
      currentText.push(trimmed);
      previousLineWasBlank = false;
    }
  }

  // Save final section
  saveSection();

  // Build fullText from all section texts (not headings)
  const fullText = sections
    .map(s => s.text)
    .filter(text => text.length > 0)
    .join('\n\n');

  return {
    sourceUrl: url,
    format: 'text',
    fullText,
    sections,
    parsedAt: new Date().toISOString(),
  };
}
