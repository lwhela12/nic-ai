---
allowed-tools: Bash, Read, Glob
description: Export a markdown document to DOCX or PDF format
---

# Export Document

Convert a markdown document to DOCX (Word) or PDF format using the server's export API.

## IMPORTANT: Binary File Handling

**NEVER write .docx or .pdf files directly using the Write tool.** These are binary formats that cannot be created from plain text. Always use this export process instead.

## Usage

To export a document, call the export API:

```bash
curl -s -X POST http://localhost:3001/api/docs/export \
  -H "Content-Type: application/json" \
  -d '{
    "caseFolder": "/path/to/case",
    "sourcePath": "3P/3P Demand - DRAFT.md",
    "format": "docx",
    "openAfter": true
  }'
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `caseFolder` | Yes | Full path to the case folder |
| `sourcePath` | Yes | Relative path to the markdown file within the case |
| `format` | Yes | Either `docx` or `pdf` |
| `targetPath` | No | Custom output path (defaults to same location with new extension) |
| `openAfter` | No | If `true`, automatically opens the file in the default application (Word/Preview) |

**Always use `openAfter: true`** so the user can immediately see and review the exported document.

## Examples

### Export demand letter to Word (opens automatically)

```bash
curl -s -X POST http://localhost:3001/api/docs/export \
  -H "Content-Type: application/json" \
  -d '{
    "caseFolder": "/Users/lucaswhelan/Cases/Smith v. Jones",
    "sourcePath": "3P/3P Demand - DRAFT.md",
    "format": "docx",
    "openAfter": true
  }'
```

Output: `3P/3P Demand - DRAFT.docx` (opens in Microsoft Word)

### Export case memo to PDF (opens automatically)

```bash
curl -s -X POST http://localhost:3001/api/docs/export \
  -H "Content-Type: application/json" \
  -d '{
    "caseFolder": "/Users/lucaswhelan/Cases/Smith v. Jones",
    "sourcePath": ".pi_tool/case_memo.md",
    "format": "pdf",
    "openAfter": true
  }'
```

Output: `.pi_tool/case_memo.pdf` (opens in Preview)

### Export with custom output path

```bash
curl -s -X POST http://localhost:3001/api/docs/export \
  -H "Content-Type: application/json" \
  -d '{
    "caseFolder": "/Users/lucaswhelan/Cases/Smith v. Jones",
    "sourcePath": "3P/3P Demand - DRAFT.md",
    "format": "docx",
    "targetPath": "3P/Final Demand.docx",
    "openAfter": true
  }'
```

## Response

Success:
```json
{
  "success": true,
  "outputPath": "3P/3P Demand - DRAFT.docx",
  "fullPath": "/Users/lucaswhelan/Cases/Smith v. Jones/3P/3P Demand - DRAFT.docx",
  "message": "Exported 3P/3P Demand - DRAFT.md to 3P/3P Demand - DRAFT.docx and opened in default application"
}
```

Error:
```json
{
  "error": "Export failed: [reason]"
}
```

## Supported Source Formats

The export API converts **markdown (.md) files only**. The markdown is:
1. Converted to styled HTML with legal document formatting
2. Then converted to the target format (DOCX or PDF)

## Document Styling

Exported documents include professional legal formatting:
- Times New Roman font, 12pt
- 1-inch margins on all sides
- Justified paragraphs
- Proper heading hierarchy
- Table formatting with borders
- Page size: Letter (8.5" x 11")

## When to Use

Use this export process when:
- User requests a Word document
- User requests a PDF
- Finalizing a demand letter for sending
- Creating a printable version of any markdown document

## Workflow Example

1. Generate content and save as markdown:
   ```
   Write the demand letter to: 3P/3P Demand - DRAFT.md
   ```

2. Export to the requested format (with auto-open):
   ```bash
   curl -s -X POST http://localhost:3001/api/docs/export \
     -H "Content-Type: application/json" \
     -d '{"caseFolder": "...", "sourcePath": "3P/3P Demand - DRAFT.md", "format": "docx", "openAfter": true}'
   ```

3. Report success:
   ```
   Created 3P/3P Demand - DRAFT.docx - the document has been opened in Word for your review.
   ```
