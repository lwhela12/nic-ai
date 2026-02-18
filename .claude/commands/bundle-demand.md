---
allowed-tools: Read, Bash
description: Bundle demand letter with exhibits into PDF package
---

# Bundle Demand Package

Combine the finalized demand letter with all supporting exhibits into a single PDF.

## Prerequisites

Before bundling, verify:
1. Demand letter markdown exists at `.ai_tool/drafts/demand_letter.md`
2. Manifest exists at `.ai_tool/drafts/manifest.json` with a `demand_letter` entry
3. The `demand_letter` entry has an `exhibits` array

If these are missing, inform the user they need to run `/draft-demand` first.

## Step 1: Check Prerequisites

Read `.ai_tool/drafts/manifest.json` and verify:
- The `demand_letter` key exists
- It has an `exhibits` array with at least one entry
- Each exhibit has a `path` property

Also check that `.ai_tool/drafts/demand_letter.md` exists.

## Step 2: Call the Bundle API

The server has a bundle endpoint that handles PDF conversion and merging. Call it:

```bash
curl -X POST http://localhost:3001/api/docs/bundle-demand \
  -H "Content-Type: application/json" \
  -d '{"caseFolder": "'"$(pwd)"'"}' \
  -o "3P/3P Demand Package.pdf"
```

This endpoint:
1. Reads the demand letter markdown
2. Converts it to PDF using firm letterhead/styling
3. Creates an "EXHIBITS" separator page
4. Appends all exhibit PDFs from the manifest
5. Returns the merged PDF

## Step 3: Verify Output

After the API call, check if the file was created:

```bash
ls -la "3P/3P Demand Package.pdf"
```

Report to the user:
- File size
- Location: `3P/3P Demand Package.pdf`

## Output

- `3P/3P Demand Package.pdf` - Complete demand package ready to send

## Error Handling

**If demand letter missing:**
- Stop and instruct user to run `/draft-demand` first

**If manifest missing or no exhibits:**
- Stop and instruct user to run `/draft-demand` first (it generates the manifest)

**If API call fails:**
- Check if server is running on port 3001
- Check server logs for detailed error message

**If exhibit files are missing:**
- The API will warn about missing exhibits but still create the package with available files
