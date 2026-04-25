# Product Overview

**Privacy Tool** is a Manifest V3 browser extension that automatically detects privacy policies on web pages, analyzes them using AI, and identifies data collection risks.

## Core Capabilities

- **Automatic Detection**: Scans web pages for privacy policy, Terms of Service, and cookie policy links
- **AI-Powered Analysis**: Uses legal-specialized AI models (SaulLM-7B-Instruct or GPT-4o) to extract structured risk information
- **Multi-Format Support**: Parses HTML, PDF, and plain text policy documents
- **Risk Assessment**: Identifies data types collected, purposes, third-party sharing, and risk levels
- **Privacy-First**: API keys stored locally; no data sent to third parties except chosen AI provider

## Target Users

Users who want to understand what data websites collect and how it's used, without reading lengthy privacy policies.

## AI Models

- **SaulLM-7B-Instruct** (Recommended): Legal domain specialist via HuggingFace
- **GPT-4o** (Fallback): General-purpose via OpenAI

## Current Limitations

- Risk breakdown UI not yet implemented
- API keys stored in plaintext (production would use encryption)
- PDF parsing relies on font-size heuristics
