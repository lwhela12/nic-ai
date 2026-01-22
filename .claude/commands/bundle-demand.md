---
allowed-tools: Read, Bash, Write, Glob
description: Bundle demand letter with exhibits into PDF package
---

# Bundle Demand Package

Combine the finalized demand letter with all supporting exhibits into a single PDF.

## Prerequisites

- Demand letter exists at `3P/3P Demand - DRAFT.md` (or finalized version)
- Manifest exists at `.pi_tool/demand_manifest.json`

If either is missing, inform the user they need to run `/draft-demand` first.

## Steps

### 1. Read the Manifest

Read `.pi_tool/demand_manifest.json` to get the list of exhibits and their order.

### 2. Convert Demand Letter to PDF

```bash
pandoc "3P/3P Demand - DRAFT.md" -o ".pi_tool/demand_letter.pdf" \
  --pdf-engine=wkhtmltopdf \
  --css=.pi_tool/demand.css \
  -V margin-top=1in \
  -V margin-bottom=1in \
  -V margin-left=1in \
  -V margin-right=1in
```

If wkhtmltopdf is not installed, fall back to using macOS Preview via AppleScript:
```bash
# Convert markdown to HTML first
pandoc "3P/3P Demand - DRAFT.md" -o ".pi_tool/demand_letter.html" -s

# Use macOS to convert HTML to PDF
/usr/bin/textutil -convert rtf ".pi_tool/demand_letter.html" -output ".pi_tool/demand_letter.rtf"
/usr/sbin/cupsfilter ".pi_tool/demand_letter.rtf" > ".pi_tool/demand_letter.pdf" 2>/dev/null
```

### 3. Create Separator Page

Create a blank separator page to insert between sections:

```bash
echo '<html><body style="text-align:center;padding-top:4in;font-family:Times New Roman">This Page Left Blank Intentionally</body></html>' > .pi_tool/separator.html
/usr/bin/textutil -convert rtf ".pi_tool/separator.html" -output ".pi_tool/separator.rtf"
/usr/sbin/cupsfilter ".pi_tool/separator.rtf" > ".pi_tool/separator.pdf" 2>/dev/null
```

### 4. Combine All PDFs

Use pdfunite to merge everything in order:

```bash
pdfunite \
  ".pi_tool/demand_letter.pdf" \
  ".pi_tool/separator.pdf" \
  ".pi_tool/separator.pdf" \
  [exhibits in chronological order from manifest...] \
  "3P/3P Demand Package.pdf"
```

**Order of documents:**
1. Demand letter
2. Two separator pages (intentionally blank)
3. Exhibits in the order specified by the manifest (chronological)

### 5. Report Results

After bundling, report:
```bash
pdfinfo "3P/3P Demand Package.pdf"
```

Show the user:
- Total page count
- File size
- List of included exhibits

### 6. Clean Up

Remove temporary files:
```bash
rm -f ".pi_tool/demand_letter.pdf" ".pi_tool/separator.pdf"
```

## Output

- `3P/3P Demand Package.pdf` - Complete demand package ready to send

## Error Handling

**If pandoc not installed:**
```
Pandoc is required for PDF conversion. Install with:
  brew install pandoc
```

**If pdfunite not installed:**
```
pdfunite is required for combining PDFs. Install with:
  brew install poppler
```

**If exhibit file missing:**
- Warn the user which file(s) are missing
- Ask if they want to continue without missing exhibits
- If yes, proceed with available files

**If demand letter missing:**
- Stop and instruct user to run `/draft-demand` first

**If manifest missing:**
- Stop and instruct user to run `/draft-demand` first (it generates the manifest)
