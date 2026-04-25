import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDocument, wrapManualText } from '../../src/fetcher.js';
import { AnalysisError } from '../../src/types.js';

describe('Fetcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns format: html for text/html MIME type (Req 2.3)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.com/privacy',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><body>Privacy Policy</body></html>',
    } as any);

    const result = await fetchDocument('https://example.com/privacy');

    expect(result.format).toBe('html');
    expect(typeof result.content).toBe('string');
    expect(result.finalUrl).toBe('https://example.com/privacy');
  });

  it('returns format: pdf for application/pdf MIME type (Req 2.3)', async () => {
    const mockArrayBuffer = new ArrayBuffer(8);
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.com/privacy.pdf',
      headers: new Map([['content-type', 'application/pdf']]),
      arrayBuffer: async () => mockArrayBuffer,
    } as any);

    const result = await fetchDocument('https://example.com/privacy.pdf');

    expect(result.format).toBe('pdf');
    expect(result.content).toBeInstanceOf(ArrayBuffer);
    expect(result.finalUrl).toBe('https://example.com/privacy.pdf');
  });

  it('returns format: text for text/plain MIME type (Req 2.3)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.com/privacy.txt',
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'Privacy Policy Text',
    } as any);

    const result = await fetchDocument('https://example.com/privacy.txt');

    expect(result.format).toBe('text');
    expect(typeof result.content).toBe('string');
  });

  it('throws FETCH_ERROR with manualInputFallback: true on network failure (Req 2.5)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchDocument('https://example.com/privacy')).rejects.toThrow(AnalysisError);
    
    try {
      await fetchDocument('https://example.com/privacy');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisError);
      expect((error as AnalysisError).code).toBe('FETCH_ERROR');
      expect((error as AnalysisError).manualInputFallback).toBe(true);
      expect((error as AnalysisError).retryable).toBe(true);
    }
  });

  it('throws FETCH_ERROR on HTTP 403 response (Req 2.5)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      url: 'https://example.com/privacy',
    } as any);

    await expect(fetchDocument('https://example.com/privacy')).rejects.toThrow(AnalysisError);
    
    try {
      await fetchDocument('https://example.com/privacy');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisError);
      expect((error as AnalysisError).code).toBe('FETCH_ERROR');
      expect((error as AnalysisError).message).toContain('403');
    }
  });

  it('throws UNSUPPORTED_FORMAT for unsupported MIME type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://example.com/privacy',
      headers: new Map([['content-type', 'application/json']]),
    } as any);

    await expect(fetchDocument('https://example.com/privacy')).rejects.toThrow(AnalysisError);
    
    try {
      await fetchDocument('https://example.com/privacy');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisError);
      expect((error as AnalysisError).code).toBe('UNSUPPORTED_FORMAT');
      expect((error as AnalysisError).manualInputFallback).toBe(true);
    }
  });

  it('wrapManualText returns format: text RawDocument (Req 2.6)', () => {
    const text = 'Manual privacy policy text';
    const result = wrapManualText(text);

    expect(result.format).toBe('text');
    expect(result.content).toBe(text);
    expect(result.finalUrl).toBe('manual');
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
  });
});
