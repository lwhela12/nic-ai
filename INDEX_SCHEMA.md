# Document Index Schema

This is the canonical schema for `.pi_tool/document_index.json`. All indexing agents must produce this exact structure.

## Root Structure

```json
{
  "indexed_at": "2024-01-19T12:00:00Z",
  "case_phase": "Treatment",
  "summary": {
    "client": "John Smith",
    "dol": "2024-01-15",
    "providers": ["Provider A", "Provider B"],
    "total_charges": 12500.00,
    "policy_limits": {
      "1P": {
        "carrier": "State Farm",
        "bodily_injury": "$250,000/$500,000",
        "medical_payments": "$25,000",
        "um_uim": "$250,000/$500,000"
      },
      "3P": {
        "carrier": "National General",
        "bodily_injury": "$50,000/$100,000"
      }
    }
  },
  "folders": {
    "Intake": {
      "files": [
        {
          "filename": "Intake.pdf",
          "type": "intake_form",
          "key_info": "Client intake with accident details",
          "has_handwritten_data": true,
          "handwritten_fields": ["client_name", "document_date"]
        }
      ]
    },
    "1P": {
      "files": [...]
    }
  },
  "issues_found": ["Missing police report", "Incomplete medical records"],
  "case_analysis": "LIABILITY: Clear - rear-end collision with police report. INJURY TIER: Tier 2 (structural) - MRI shows disc bulge, received injections. VALUE RANGE: $45,000 - $75,000 based on 3-5x multiplier on $15k specials. GAPS: Missing wage loss documentation.",
  "case_notes": [
    {
      "id": "note-1705933200000",
      "content": "Progressive claim number: CLM-2024-78234",
      "field_updated": "summary.claim_numbers.3P_Progressive",
      "previous_value": null,
      "source": "chat",
      "createdAt": "2024-01-22T15:00:00Z"
    }
  ],
  "chat_archives": [
    {
      "id": "archive-1705933200000",
      "date": "2024-01-22",
      "summary": "Discussed medical records and identified missing documents",
      "messageCount": 12,
      "file": "chat_archives/2024-01-22_session.json"
    }
  ]
}
```

## Field Definitions

### Root Fields
- `indexed_at` (string): ISO 8601 timestamp when index was created
- `case_phase` (string): One of: `Intake`, `Investigation`, `Treatment`, `Demand`, `Negotiation`, `Settlement`, `Complete`
- `summary` (object): Quick reference for case overview
- `folders` (object): Documents organized by folder
- `issues_found` (array): List of problems or gaps identified
- `case_analysis` (string): AI-generated substantive analysis — liability assessment, injury tier, value estimate, treatment patterns, next steps
- `case_notes` (array): User-provided information and audit trail (NOT for AI analysis — use case_analysis)
- `chat_archives` (array): Archived conversation summaries

### Summary Fields
- `client` (string): Client's full name
- `dol` (string): Date of loss in MM-DD-YYYY or YYYY-MM-DD format
- `dob` (string): Client's date of birth in MM-DD-YYYY or YYYY-MM-DD format
- `providers` (array): List of medical provider names
- `total_charges` (number): Total medical charges in dollars
- `policy_limits` (object): Policy limits organized by party:
  - `1P` (object): Client's own auto insurance (for Med-Pay claims, UM/UIM claims)
    - `carrier` (string): Insurance carrier name (e.g., "State Farm")
    - `bodily_injury` (string): BI limits in "per-person/per-accident" format (e.g., "$250,000/$500,000")
    - `medical_payments` (string): Med-Pay coverage limit (e.g., "$25,000")
    - `um_uim` (string): Uninsured/Underinsured motorist limits (e.g., "$250,000/$500,000")
  - `3P` (object): At-fault party's insurance (for liability demand letters)
    - `carrier` (string): Insurance carrier name (e.g., "National General")
    - `bodily_injury` (string): BI limits - **USE THIS FOR 3P DEMAND LETTERS** (e.g., "$50,000/$100,000")
- `contact` (object): Client contact information
  - `phone` (string): Phone number (e.g., "702-555-1234")
  - `email` (string): Email address
  - `address` (object): Mailing address
    - `street` (string): Street address
    - `city` (string): City
    - `state` (string): State abbreviation (e.g., "NV")
    - `zip` (string): ZIP code
- `health_insurance` (object): Health insurance details
  - `carrier` (string): Insurance carrier name
  - `group_no` (string): Group number
  - `member_no` (string): Member ID number
- `claim_numbers` (object): Insurance claim numbers keyed by party (e.g., "1P_AAA", "3P_Progressive")

### Folder Structure
Each folder is an object with:
- `files` (array): List of file objects - **MUST use "files", not "documents"**

### File Object
- `filename` (string): Name of the file (e.g., "Intake.pdf")
- `type` (string): Document type (e.g., "intake_form", "lor", "demand", "medical_record", "hearing_decision")
- `key_info` (string): Brief summary of important information extracted
- `date` (string, optional): Document date (the document's own date, normalized to `YYYY-MM-DD` when available)
- `issues` (string, optional): Extraction warning for this file (for example, date extraction uncertainty/failure)
- `has_handwritten_data` (boolean): `true` when substantive extracted values appear handwritten (exclude signature/initial-only markings); otherwise `false`
- `handwritten_fields` (array): Names of non-signature extracted fields that appear handwritten (for example `["client_name", "document_date"]`; empty array when none)
- `user_reviewed` (boolean, optional): `true` when a user manually reviewed and saved updates for this file
- `reviewed_at` (string, optional): ISO timestamp of when the file was marked reviewed
- `review_notes` (string, optional): Brief note describing what the user reviewed/changed

### Case Note Object
- `id` (string): Unique identifier (e.g., "note-1705933200000")
- `content` (string): Description of what was added or changed
- `field_updated` (string, optional): Path to the field that was updated (e.g., "summary.claim_numbers.3P")
- `previous_value` (any, optional): Previous value before the change (for audit trail)
- `source` (string): How the note was created - "chat" or "manual"
- `createdAt` (string): ISO 8601 timestamp

### Chat Archive Object
- `id` (string): Unique identifier (e.g., "archive-1705933200000")
- `date` (string): Date of the conversation (YYYY-MM-DD)
- `summary` (string): AI-generated summary of what was discussed
- `messageCount` (number): Number of messages in the archived conversation
- `file` (string): Relative path to the archive file (e.g., "chat_archives/2024-01-22_session.json")

## Agent Hierarchy

```
Firm Level (batch-index)
└── Case Orchestrator (one per case, default model)
    └── Folder Agent (one per folder, model: "haiku")
        └── Reads documents, extracts info, returns structured data

Case Level (init)
└── Folder Agent (one per folder, model: "haiku")
    └── Reads documents, extracts info, returns structured data
```

## Practice Areas

The index schema supports two practice areas:

### Personal Injury (PI) - Default
- `practice_area`: `undefined` or `"Personal Injury"`
- Assessment fields: `liability_assessment`, `injury_tier`, `estimated_value_range`, `policy_limits_demand_appropriate`
- Summary fields: `policy_limits`, `claim_numbers`, `dol` (date of loss)
- Case phases: `Intake`, `Investigation`, `Treatment`, `Demand`, `Negotiation`, `Settlement`, `Complete`

### Workers' Compensation (WC)
- `practice_area`: `"Workers' Compensation"`
- Assessment fields: `compensability`, `claim_type`, `estimated_ttd_weeks`, `estimated_ppd_rating`, `third_party_potential`
- Summary fields:
  - `employer` (object): `name`, `address`, `phone`, `contact_name`
  - `wc_carrier` (object): `name`, `claim_number`, `adjuster_name`, `adjuster_phone`, `tpa_name`
  - `disability_status` (object): `type` (TTD/TPD/PPD/PTD), `amw`, `compensation_rate`, `mmi_date`, `ppd_rating`
  - `job_title`, `injury_description`, `body_parts`
  - `doi` (date of injury) → normalized to `incident_date`
- Case phases: `Intake`, `Investigation`, `Treatment`, `MMI Evaluation`, `Benefits Resolution`, `Settlement/Hearing`, `Closed`

### WC Assessment Field Definitions
- `compensability` (string): One of `clearly_compensable`, `likely_compensable`, `disputed`, `denied`
- `claim_type` (string): One of `specific_injury`, `occupational_disease`, `cumulative_trauma`
- `estimated_ttd_weeks` (number): Estimated weeks of Temporary Total Disability benefits
- `estimated_ppd_rating` (number): Estimated Permanent Partial Disability rating percentage
- `third_party_potential` (boolean): Whether there is potential for a third-party liability claim

### WC Summary Sub-objects

#### employer
- `name` (string, required): Employer company name
- `address` (object): Street, city, state, zip
- `phone` (string): Employer phone number
- `contact_name` (string): Contact person at employer

#### wc_carrier
- `name` (string, required): Workers' comp insurance carrier name
- `claim_number` (string): WC claim number
- `adjuster_name` (string): Adjuster's name
- `adjuster_phone` (string): Adjuster's phone
- `tpa_name` (string): Third Party Administrator name if applicable

#### disability_status
- `type` (string): One of `TTD` (Temporary Total), `TPD` (Temporary Partial), `PPD` (Permanent Partial), `PTD` (Permanent Total)
- `amw` (number): Average Monthly Wage in dollars
- `compensation_rate` (number): Weekly compensation rate in dollars
- `mmi_date` (string): Maximum Medical Improvement date
- `ppd_rating` (number): Permanent Partial Disability rating percentage

## Phase Detection

### Personal Injury Phases
After indexing, phase is determined by checking:
1. **Complete**: Release signed in Settlement folder
2. **Settlement**: Settlement memo exists
3. **Negotiation**: Settlement correspondence exists
4. **Demand**: Demand file in 3P folder
5. **Treatment**: Medical records in Records & Bills
6. **Investigation**: LOR files present
7. **Intake**: Default if intake exists

### Workers' Compensation Phases
1. **Closed**: Case resolved, all benefits paid or denied
2. **Settlement/Hearing**: Active settlement negotiations or hearing scheduled
3. **Benefits Resolution**: Dispute over benefits, waiting on determinations
4. **MMI Evaluation**: At or near Maximum Medical Improvement, awaiting rating
5. **Treatment**: Active medical treatment ongoing
6. **Investigation**: Compensability investigation underway
7. **Intake**: Default initial phase
