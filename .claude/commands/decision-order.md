---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Draft a workers' compensation Decision and Order after a hearing
---

# Draft Decision and Order

## Critical Output Requirements

You MUST save files to EXACTLY these paths:

1. Decision and Order draft: `.ai_tool/drafts/decision_and_order.md`
2. Draft manifest: `.ai_tool/drafts/manifest.json`

If you save to a different file path, the draft workflow will not detect it correctly.

## Path Requirements

All file paths must be absolute and within the case folder.

- Get `WORKING_DIRECTORY` from prompt context.
- Use: `{WORKING_DIRECTORY}/.ai_tool/drafts/decision_and_order.md`
- Use: `{WORKING_DIRECTORY}/.ai_tool/drafts/manifest.json`

## Purpose

Generate a filing-ready Decision and Order draft that summarizes procedural posture, facts proven, legal analysis, and decretal relief after hearing.

This is a legal filing style document, not a business letter.

## Required Structure

Use this order unless the firm template requires a different sequence:

1. Caption / heading block
2. Introductory hearing paragraph(s):
   - Hearing date(s)
   - Appearances and counsel
   - Appeal/hearing identifiers
3. Exhibits admitted (if known from record)
4. FINDINGS OF FACT (numbered)
5. CONCLUSIONS OF LAW (numbered; cite controlling law only when supported)
6. ORDER (numbered decretal paragraphs tied to issues appealed)
7. Signature / submission block (if applicable)
8. Statutory notice / certificate language (if present in the case style)

## Evidence Discipline (Mandatory)

- Ground all findings/conclusions in the case record.
- Cite sources inline when available (example: `[Claimant's 2 at 4]`, `[Insurer A at 17]`).
- Do NOT invent facts, dates, citations, or exhibits.
- If a required detail is missing, insert a clear placeholder:
  - `[VERIFY: Appeals Officer Name]`
  - `[VERIFY: Appeal Number]`
  - `[VERIFY: Hearing Date]`

## Workflow

1. Read `{WORKING_DIRECTORY}/.ai_tool/document_index.json`.
2. Locate hearing-related source files (`hearing notice`, `hearing decision`, `d9`, appeals correspondence, IME/work status as needed).
3. Read the controlling documents to build a reliable timeline and issue list.
4. Check firm templates in `../.ai_tool/templates/parsed/` and follow a matching Decision/Order template if available.
5. Draft complete Decision and Order content.
6. Save to `{WORKING_DIRECTORY}/.ai_tool/drafts/decision_and_order.md`.
7. Update `{WORKING_DIRECTORY}/.ai_tool/drafts/manifest.json` with:

```json
{
  "decision_and_order": {
    "name": "Decision and Order",
    "type": "hearing_decision",
    "createdAt": "ISO timestamp",
    "targetPath": "Litigation/Decision and Order.pdf"
  }
}
```

8. Tell user: "The Decision and Order draft is ready for review. Open the Drafts tab to preview and approve it."

