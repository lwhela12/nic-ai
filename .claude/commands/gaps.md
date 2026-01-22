---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Identify missing documents and recommended next actions
---

# Gap Analysis

Scan the case folder and identify missing documents, incomplete records, and recommended next actions.

## Gap Categories

### 1. Intake Gaps
- [ ] Signed retainer agreement
- [ ] Client ID (driver's license)
- [ ] Client contact information in intake
- [ ] Signed HIPAA authorizations
- [ ] Health insurance information

### 2. Insurance Gaps
- [ ] 1P (client's) insurance dec page
- [ ] 3P (adverse) insurance dec page
- [ ] Policy limits confirmed
- [ ] LOR sent to 1P insurer
- [ ] LOR sent to 3P insurer
- [ ] Claim numbers documented

### 3. Liability Gaps
- [ ] Police report (if officers responded - check intake)
- [ ] Scene photos
- [ ] Vehicle damage photos
- [ ] Witness statements (if witnesses existed - check intake)

### 4. Medical Documentation Gaps
Cross-reference these sources to find gaps:
- Providers mentioned in intake form
- Providers in demand letter (if exists)
- Providers in Records & Bills folder

Flag:
- [ ] Provider mentioned but no records received
- [ ] Provider mentioned but no bills received
- [ ] Imaging referenced but report not in file
- [ ] Treatment gap > 2 weeks without explanation

### 5. Pre-Settlement Gaps
- [ ] All medical bills totaled and verified
- [ ] Balance confirmations from all providers
- [ ] Lien amounts confirmed
- [ ] Reduction negotiations completed

### 6. Settlement Gaps
- [ ] Settlement authorization from client
- [ ] Release signed
- [ ] Disbursement letters prepared
- [ ] Final accounting completed

## How to Check

1. **Read the intake form** - note all providers mentioned, whether police responded, witnesses
2. **List folders and files** - inventory what actually exists
3. **Cross-reference** - compare what should exist vs. what does exist
4. **Check dates** - look for treatment gaps, statute of limitations concerns

## Output Format

```markdown
# Gap Analysis: [Case Name]

**Date:** [Today's date]
**Case Phase:** [Current phase]
**Days Since DOL:** [X days]
**SOL Date:** [2 years from DOL]

## Critical Gaps (Action Required)

| Gap | Details | Recommended Action |
|-----|---------|-------------------|
| [Item] | [Specifics] | [What to do] |

## Moderate Gaps (Should Address)

| Gap | Details | Recommended Action |
|-----|---------|-------------------|
| [Item] | [Specifics] | [What to do] |

## Minor Gaps (Low Priority)

| Gap | Details | Recommended Action |
|-----|---------|-------------------|
| [Item] | [Specifics] | [What to do] |

## Document Inventory

### Present
- [x] [Document] - [Location]

### Missing
- [ ] [Document] - [Why needed]

## Recommended Next Steps

1. [Most urgent action]
2. [Second priority]
3. [Third priority]
```

## Output Location

Save to: `.pi_tool/gap_analysis.md`

## Priority Levels

**Critical:**
- Missing documents that block case progress
- Statute of limitations concerns (< 6 months remaining)
- Missing records from major treating providers

**Moderate:**
- Missing supporting documentation
- Incomplete records
- Unrequested reductions

**Minor:**
- Administrative gaps
- Nice-to-have documentation
- Organizational improvements
