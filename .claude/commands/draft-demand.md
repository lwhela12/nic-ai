---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Generate a demand letter from case documents
---

# Draft Demand Letter

Generate a professional demand letter for the third-party insurance company.

## Step 1: Determine Demand Type (DO THIS FIRST)

Before reading any documents or writing anything, you MUST determine whether this is a Policy Limits demand or a Specific Amount demand.

1. Read `.pi_tool/document_index.json`
2. Check for `summary.policy_limits.3P`:
   - If `policy_limits.3P.bodily_injury` is missing or empty → **STOP**. Flag: "Cannot draft demand: Missing 3P policy limits. Need adverse party's dec page."
3. Extract these values:
   - **Total Medical Specials** = `summary.total_charges`
   - **3P Per-Person BI Limit** = first number from `policy_limits.3P.bodily_injury` (e.g., "$50,000/$100,000" → $50,000)
4. **DECISION:**
   - IF Total Specials > 40% of 3P Per-Person Limit → **POLICY LIMITS DEMAND**
   - IF Total Specials × 2.5 > 3P Per-Person Limit → **POLICY LIMITS DEMAND**
   - ELSE → **SPECIFIC AMOUNT DEMAND**

**State your determination before proceeding:** "This is a POLICY LIMITS demand because [specials of $X exceed 40% of the $Y limit]" or "This is a SPECIFIC AMOUNT demand because [specials of $X are well within the $Y limit]."

**You CANNOT demand more than 3P policy limits. The insurer cannot pay more than their policy allows.**

## Step 2: Verify Prerequisites

Confirm these exist in the index or case folder:
- Intake form (client info, accident narrative)
- 3P insurance dec page (policy limits, claim number)
- Medical records and bills from all providers
- Photos of vehicle damage (optional but helpful)

If critical documents are missing, list them and stop.

## Step 3: Extract Information

1. **Header Information** - Date, insurance company, claim number, client name, insured name, date of loss
2. **Medical Expenses** - Provider name, dates of treatment, charges per provider, total specials
3. **Accident Narrative** - How it happened, liability factors
4. **Injury Summary** - Diagnoses, treatment, current status

## Step 4: Write the Demand Letter

Use the template that matches your Step 1 determination.

### Template A: POLICY LIMITS DEMAND

Use this when specials exceed 40% of limits OR calculated demand exceeds limits.

```
[Date]

Sent via [Facsimile/Email/Mail]: [Fax number or address]

[Insurance Company Name]
[Address]
[City, State ZIP]

Re:
    My Client:      [Client Name]
    Insured:        [Defendant Name]
    Date of Loss:   [MM/DD/YYYY]
    Claim No.:      [Claim Number]

                    TIME LIMIT SETTLEMENT DEMAND
                    DEMAND DEADLINE: [30 days from letter date]

TO WHOM IT MAY CONCERN:

Please be advised that I represent [Client Name] for personal injuries sustained
in the above-referenced accident. Attached are pertinent medical records, medical
billings, and other documentation for your review and consideration.

It is hereby demanded that [Insurance Company] tender its policy limits to
[Client Name] immediately upon review of this demand letter.

                                DAMAGES

Details of [Client Name]'s injuries, treatment, and pain are documented within
the medical records attached hereto. [Client Name] has incurred the following
accident-related medical expenses:

Medical Providers          Dates of Treatment       Damages
-----------------------------------------------------------------
[Provider 1]               [Start] - [End]          $[Amount]
[Provider 2]               [Start] - [End]          $[Amount]
[Provider 3]               [Start] - [End]          $[Amount]
-----------------------------------------------------------------
Total Medical Damages                               $[Total]

                            LIABILITY

[Describe the accident and why defendant is at fault. Include:]
- How accident occurred
- Any citations issued
- Rear-end presumption if applicable
- Witness observations if any

                            INJURIES

[Describe injuries and treatment:]
- Initial presentation and complaints
- Diagnoses
- Treatment received
- Injections or procedures
- Current status and prognosis

                              DEMAND

Considering the above medical damages and extent of injuries, we are confident
that a jury will award our client the monetary damages to which [Client Name]
is entitled. Accordingly, demand is made for: pain and suffering, loss of
enjoyment of life, medical expenses and other damages sustained, or that may
be sustained in the future based on the treating doctors' medical opinions,
and all other damages and loss resulting from this collision.

My client(s) will give full and final release of the injury claim in exchange
for POLICY LIMITS.

Therefore, a demand is hereby made for POLICY LIMITS. Please contact me by
the demand deadline date of this letter with an evaluation of this claim.

Sincerely,

MUSLUSKY LAW


Adam L. Muslusky, Esq.

ALM/tl
Enclosures: supporting documents
```

### Template B: SPECIFIC AMOUNT DEMAND

Use this ONLY when the calculated demand is clearly under 3P policy limits.

```
[Date]

Sent via [Facsimile/Email/Mail]: [Fax number or address]

[Insurance Company Name]
[Address]
[City, State ZIP]

Re:
    My Client:      [Client Name]
    Insured:        [Defendant Name]
    Date of Loss:   [MM/DD/YYYY]
    Claim No.:      [Claim Number]

                    TIME LIMIT SETTLEMENT DEMAND
                    DEMAND DEADLINE: [30 days from letter date]

TO WHOM IT MAY CONCERN:

Please be advised that I represent [Client Name] for personal injuries sustained
in the above-referenced accident. Attached are pertinent medical records, medical
billings, and other documentation for your review and consideration.

                                DAMAGES

Details of [Client Name]'s injuries, treatment, and pain are documented within
the medical records attached hereto. [Client Name] has incurred the following
accident-related medical expenses:

Medical Providers          Dates of Treatment       Damages
-----------------------------------------------------------------
[Provider 1]               [Start] - [End]          $[Amount]
[Provider 2]               [Start] - [End]          $[Amount]
[Provider 3]               [Start] - [End]          $[Amount]
-----------------------------------------------------------------
Total Medical Damages                               $[Total]
Past, Future Pain and Suffering                     $[P&S Amount]

                            LIABILITY

[Describe the accident and why defendant is at fault. Include:]
- How accident occurred
- Any citations issued
- Rear-end presumption if applicable
- Witness observations if any

                            INJURIES

[Describe injuries and treatment:]
- Initial presentation and complaints
- Diagnoses
- Treatment received
- Injections or procedures
- Current status and prognosis

                              DEMAND

Considering the above medical damages and extent of injuries, we are confident
that a jury will award our client the monetary damages to which [Client Name]
is entitled. Accordingly, demand is made for: pain and suffering, loss of
enjoyment of life, medical expenses and other damages sustained, or that may
be sustained in the future based on the treating doctors' medical opinions,
and all other damages and loss resulting from this collision.

My client(s) will give full and final release of the injury claim in exchange
for $[DEMAND AMOUNT - must be less than 3P per-person limit].

Sincerely,

MUSLUSKY LAW


Adam L. Muslusky, Esq.

ALM/tl
Enclosures: supporting documents
```

## Pain & Suffering Calculation (Template B only)

Use the multiplier guidelines from `agent/practice-guide.md` Section IV (Valuation Framework) to determine the appropriate pain and suffering multiplier based on injury tier. Round to a clean number for the demand.

## Step 5: Verify Before Saving

**REQUIRED CHECKS:**
- [ ] If this is a policy limits demand, the demand section says "POLICY LIMITS" (NOT a dollar amount)
- [ ] If this is a specific amount demand, the amount is LESS than the 3P per-person BI limit
- [ ] My Step 1 determination matches what I wrote in the demand section
- [ ] Total medical specials in the letter match the actual provider charges

## Output

**⚠️ CRITICAL: File Format Rules**
- **NEVER** write `.docx` or `.pdf` files directly — these are binary formats and will be corrupt
- **ALWAYS** save as `.md` (markdown) first
- The user will approve and export to PDF/DOCX via the Drafts tab in the UI

### Step 6: Save Files

#### 6a. Create drafts folder if it doesn't exist

```bash
mkdir -p ".pi_tool/drafts"
```

#### 6b. Save Demand Letter (Markdown format)

Use the Write tool to save to: `.pi_tool/drafts/demand_letter.md`

**DO NOT save as `.docx` — the Write tool cannot create valid Word documents.**

#### 6c. Update Drafts Manifest

Use the Write tool to update `.pi_tool/drafts/manifest.json` with this entry:

**Manifest Schema:**
```json
{
  "demand_letter": {
    "name": "Demand Letter",
    "type": "demand",
    "createdAt": "ISO timestamp",
    "targetPath": "3P/3P Demand.pdf",
    "exhibits": [
      {
        "path": "relative path to file",
        "date": "YYYY-MM-DD (for chronological sorting)",
        "description": "Provider name or document type"
      }
    ]
  }
}
```

If the manifest already exists, read it first and merge the new entry.

**Include in exhibits (in this order of precedence):**
1. Police report (Investigation folder)
2. Scene/vehicle photos (Investigation folder)
3. Medical records & bills for each provider referenced (Records & Bills folder)
4. Client injury photos

Sort exhibits chronologically by date within each category.

#### 6d. Verify files were created

```bash
ls -la ".pi_tool/drafts/demand_letter.md" ".pi_tool/drafts/manifest.json"
```

If either file is missing, stop and report the error.

### Step 7: Notify User

Tell the user: "The demand letter draft is ready for review. Open the **Drafts** tab in the right panel to preview and approve it. Once approved, it will be exported to `3P/3P Demand.pdf`."
