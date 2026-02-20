---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Generate a demand letter from case documents
---

# Draft Demand Letter

## CRITICAL OUTPUT REQUIREMENTS

**You MUST save files to EXACTLY these paths (no variations):**

1. **Demand Letter:** `.ai_tool/drafts/demand_letter.md`
   - NOT `3P_Demand_Letter.md` or `demand-letter.md` or anything else
   - EXACTLY `demand_letter.md`

2. **Manifest:** `.ai_tool/drafts/manifest.json`
   - MUST contain a `"demand_letter"` key with exhibits array

**If you save to any other filename or location, bundling will fail.**

## Path Requirements

**All file paths must be absolute and within the case folder.**
- Get your WORKING_DIRECTORY from the prompt context
- Construct paths as: `{WORKING_DIRECTORY}/.ai_tool/drafts/{filename}.md`
- The system will reject writes outside the case folder

Generate a professional demand letter for the appropriate insurance company.

## Step 1: Determine Demand Category and Type (DO THIS FIRST)

Read `.ai_tool/document_index.json` and determine:

### A. Which insurance carrier to demand from?

1. **3P (Third-Party) Demand** - Demand against the at-fault party's liability insurer
   - Use when: Liability is clear and 3P policy limits are known
   - Check: `summary.policy_limits.3P.bodily_injury`

2. **1P UM (Uninsured Motorist) Demand** - Demand against client's own UM coverage
   - Use when: At-fault driver has NO insurance
   - Check: `summary.policy_limits.1P.um` or `summary.policy_limits.1P.uninsured_motorist`

3. **1P UIM (Underinsured Motorist) Demand** - Demand against client's own UIM coverage
   - Use when: 3P limits are exhausted/insufficient AND client has UIM coverage
   - Check: `summary.policy_limits.1P.uim` or `summary.policy_limits.1P.underinsured_motorist`

### B. Policy Limits vs. Specific Amount?

Extract these values:
- **Total Medical Specials** = `summary.total_charges`
- **Applicable Per-Person BI Limit** = first number from the relevant policy limits

**DECISION:**
- IF Total Specials > 40% of Per-Person Limit → **POLICY LIMITS DEMAND**
- IF Total Specials × 2.5 > Per-Person Limit → **POLICY LIMITS DEMAND**
- ELSE → **SPECIFIC AMOUNT DEMAND**

**State your determination:** "This is a [3P/1P UM/1P UIM] [POLICY LIMITS/SPECIFIC AMOUNT] demand because [reason]."

**You CANNOT demand more than the applicable policy limits.**

## Step 1b: Use the Firm Template (CRITICAL - READ CAREFULLY)

**Firm templates are pre-loaded in your system prompt.** Look for a template matching your demand type:

| Demand Type | Look for template containing |
|-------------|------------------------------|
| 3P Policy Limits | "3rd Party Standard Demand Letter" |
| 3P Specific Amount | Use 3P template, modify demand language |
| 1P UM | "1st Party UM Demand" |
| 1P UIM | "1st Party UIM Demand" |

### UNDERSTANDING TEMPLATE STRUCTURE

Each template file contains ANALYSIS sections and TEMPLATE CONTENT. You should:

- **IGNORE sections 1-3** (Template Overview, Structure Analysis, Placeholders) - these are documentation
- **USE ONLY section 4 "TEMPLATE CONTENT"** - this is the actual letter to copy
- **IGNORE section 5** (Usage Notes) - this is documentation

The actual letter template is SHORT (usually 60-80 lines). It looks like:

```
{{DATE}}
Sent via Insurer
{{INSURER_NAME}}
Re:
- My Client: {{CLAIMANT}}
...
## Damages
[table]
...
## DEMAND
[boilerplate]
...
Sincerely,
```

### TEMPLATE USAGE RULES (MANDATORY - STRICT COMPLIANCE REQUIRED)

1. **Find "## 4. TEMPLATE CONTENT"** in the template - this is where the actual letter starts
2. **Copy ONLY that section** - from after "TEMPLATE CONTENT" to before "## 5. USAGE NOTES"
3. **Replace placeholders with actual values** - `{{CLAIMANT_FULL_NAME}}` → "Brenda Boerdam-Madrid"
4. **Fill the damages table** with actual provider data from the index
5. **OUTPUT LENGTH: 60-90 lines MAXIMUM** - if your output exceeds 100 lines, you are NOT following the template

### WHAT TO NEVER ADD (even if it seems helpful)

❌ **NO "LIABILITY" section** - the template doesn't have one, so don't add one
❌ **NO "INJURIES AND MEDICAL TREATMENT" section** - just the damages table
❌ **NO detailed medical narratives** - no describing procedures, diagnoses, or treatment
❌ **NO ICD codes** - just provider names, dates, and amounts
❌ **NO "VALUATION" section** - the template doesn't calculate multipliers
❌ **NO "NON-ECONOMIC DAMAGES" section** - the template just says "pain and suffering"
❌ **NO AFFIDAVIT section at the end** - the template ends at "Enclosures"

### WHAT YOU SHOULD OUTPUT

A letter that is essentially a find-and-replace on the template:
- Same structure as template section 4
- Same boilerplate paragraphs copied verbatim
- Same length (~70 lines)
- Placeholders replaced with actual case data

### Only if NO matching template exists in your context:
- Use Template A or B below as a fallback (these are more verbose than typical firm templates)

## Step 2: Verify Prerequisites

Confirm these exist in the index or case folder:
- Intake form (client info, accident narrative)
- **For 3P demands:** 3P insurance dec page (adverse party's policy limits, claim number)
- **For 1P UM/UIM demands:** 1P insurance dec page (client's own policy limits)
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
    Date of Loss:   [MM-DD-YYYY]
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

[FIRM NAME]


[Attorney Name, Esq.]

[Initials]/tl
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
    Date of Loss:   [MM-DD-YYYY]
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

[FIRM NAME]


[Attorney Name, Esq.]

[Initials]/tl
Enclosures: supporting documents
```

## Pain & Suffering Calculation (Template B only)

Use the multiplier guidelines from `agent/practice-guide.md` Section IV (Valuation Framework) to determine the appropriate pain and suffering multiplier based on injury tier. Round to a clean number for the demand.

## Step 5: Verify Before Saving

**REQUIRED CHECKS:**
- [ ] **LINE COUNT: Is the letter under 100 lines?** If over 100 lines, you added sections that aren't in the template. DELETE them and try again.
- [ ] **NO EXTRA SECTIONS:** Does the letter have only the sections from the template? (No "Liability", no "Injuries", no "Valuation", no "Affidavit")
- [ ] If this is a policy limits demand, the demand section says "POLICY LIMITS" (NOT a dollar amount)
- [ ] If this is a specific amount demand, the amount is LESS than the 3P per-person BI limit
- [ ] My Step 1 determination matches what I wrote in the demand section
- [ ] Total medical specials in the letter match the actual provider charges

**⚠️ STOP AND FIX if your output exceeds 100 lines.** The firm template is concise. A 300+ line letter means you ignored the template.

## Output

**⚠️ CRITICAL: File Format Rules**
- **NEVER** write `.docx` or `.pdf` files directly — these are binary formats and will be corrupt
- **ALWAYS** save as `.md` (markdown) first
- The user will approve and export to PDF/DOCX via the Drafts tab in the UI

### Step 6: Save Files

#### 6a. Create drafts folder if it doesn't exist

```bash
mkdir -p "{WORKING_DIRECTORY}/.ai_tool/drafts"
```

#### 6b. Save Demand Letter (Markdown format)

Use the Write tool to save to: `{WORKING_DIRECTORY}/.ai_tool/drafts/demand_letter.md`

**DO NOT save as `.docx` — the Write tool cannot create valid Word documents.**

#### 6c. Update Drafts Manifest

Use the Write tool to update `{WORKING_DIRECTORY}/.ai_tool/drafts/manifest.json` with this entry:

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
ls -la "{WORKING_DIRECTORY}/.ai_tool/drafts/demand_letter.md" "{WORKING_DIRECTORY}/.ai_tool/drafts/manifest.json"
```

If either file is missing, stop and report the error.

### Step 7: Notify User

Tell the user: "The demand letter draft is ready for review. Open the **Drafts** tab in the right panel to preview and approve it. Once approved, it will be exported to `3P/3P Demand.pdf`."
