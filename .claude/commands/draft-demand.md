---
allowed-tools: Read, Write, Glob, Grep, Bash
description: Generate a demand letter from case documents
---

# Draft Demand Letter

Generate a professional demand letter for the third-party insurance company.

## Prerequisites

Before drafting, verify these exist:
- Intake form (client info, accident narrative)
- 3P insurance dec page (policy limits, claim number)
- Medical records and bills from all providers
- Photos of vehicle damage (optional but helpful)

**CRITICAL - Verify 3P Policy Limits:**
1. Read `.pi_tool/document_index.json` and check for `summary.policy_limits.3P`
2. If `policy_limits.3P.bodily_injury` is missing or empty:
   - **STOP** - Do not proceed with demand letter
   - Flag error: "Cannot draft demand: Missing 3P policy limits. Need adverse party's dec page."
   - Ask user to provide the 3P insurer's declaration page
3. Extract the **per-person** limit from the bodily_injury field (e.g., "$50,000/$100,000" → $50,000)

If critical documents are missing, list them and ask before proceeding.

## Information to Extract

1. **Header Information**
   - Date
   - Insurance company name and address
   - Claim number
   - Client name
   - Insured (defendant) name
   - Date of loss

2. **Medical Expenses Table**
   - Provider name
   - Dates of treatment (start - end)
   - Total charges
   - Sum all providers for Total Medical Specials

3. **Accident Narrative**
   - How the accident happened
   - Liability factors (rear-end, citation, etc.)

4. **Injury Summary**
   - Diagnoses from medical records
   - Treatment received
   - Current status / prognosis

5. **Demand Amount** (MUST use 3P policy limits)
   - Get 3P per-person BI limit from `policy_limits.3P.bodily_injury` (first number in "X/Y" format)
   - Calculate demand using injury multipliers (see Pain & Suffering section below)
   - **Compare to 3P limits:**
     - If specials > 40% of 3P per-person limit → Demand **full 3P policy limits**
     - If calculated demand > 3P per-person limit → **Cap at 3P policy limits**
     - Otherwise, use calculated demand amount
   - **NEVER demand more than the 3P policy limits** - the adverse insurer cannot pay more than their policy allows

## Demand Letter Format

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

[If demanding policy limits:]
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
for [POLICY LIMITS / $X,XXX.XX].

[If policy limits demand:]
Therefore, a demand is hereby made for POLICY LIMITS. Please contact me by
the demand deadline date of this letter with an evaluation of this claim.

Sincerely,

MUSLUSKY LAW


Adam L. Muslusky, Esq.

ALM/tl
Enclosures: supporting documents
```

## Output

Save two files:

### 1. Demand Letter
`3P/3P Demand - DRAFT.md` - The demand letter (DRAFT - attorney must review before sending)

### 2. Demand Manifest
`.pi_tool/demand_manifest.json` - Documents referenced for bundling

**Manifest Schema:**
```json
{
  "created_at": "ISO timestamp",
  "demand_letter_path": "3P/3P Demand - DRAFT.md",
  "exhibits": [
    {
      "path": "relative path to file",
      "date": "YYYY-MM-DD (for chronological sorting)",
      "description": "Provider name or document type"
    }
  ]
}
```

**Include in exhibits (in this order of precedence):**
1. Police report (Investigation folder)
2. Scene/vehicle photos (Investigation folder)
3. Medical records & bills for each provider referenced (Records & Bills folder)
4. Client injury photos

Sort exhibits chronologically by date within each category.

## Pain & Suffering Calculation

Use these guidelines:
- Soft tissue only: 1.5-2.5x specials
- Injections received: 2-3x specials
- Disc injury on imaging: 2.5-4x specials
- Surgery: 3-5x specials

Round to a clean number for the demand.
