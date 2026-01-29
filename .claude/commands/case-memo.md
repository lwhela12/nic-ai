---
allowed-tools: Read, Write, Bash
description: Generate a case memo from the document index
---

Read `.pi_tool/document_index.json` and generate a comprehensive case memo.

## Include

- **Header**: Case name, DOL, case phase, SOL date
- **Summary**: 2-3 sentence overview
- **Parties**: Client, adverse party, insurers with contact info
- **Incident**: Date, location, narrative, liability assessment
- **Injuries & Treatment**: Diagnoses, providers, treatment timeline
- **Financials**: Medical specials by provider, policy limits, valuation
- **Issues**: Problems identified in the index
- **Next Steps**: Specific actions based on case phase

## Case Phase

Determine from the index:
- **Intake**: No LORs
- **Investigation**: LORs sent, gathering info
- **Treatment**: Records accumulating, no demand
- **Demand**: Ready for or demand sent
- **Settlement**: Negotiating or disbursing

## Output

### Step 1: Create drafts folder if needed

```bash
mkdir -p ".pi_tool/drafts"
```

### Step 2: Save Case Memo

Save to: `.pi_tool/drafts/case_memo.md`

### Step 3: Update Drafts Manifest

Read `.pi_tool/drafts/manifest.json` if it exists, then merge:

```json
{
  "case_memo": {
    "name": "Case Memo",
    "type": "memo",
    "createdAt": "ISO timestamp",
    "targetPath": ".pi_tool/case_memo.pdf"
  }
}
```

### Step 4: Notify User

Tell the user: "The case memo draft is ready for review. Open the **Drafts** tab in the right panel to preview and approve it."
