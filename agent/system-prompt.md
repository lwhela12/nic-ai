<!-- REFERENCE ONLY: Not loaded by any code path. See router-prompt.md for chat agent, firm.ts for indexing. -->

# Personal Injury Case Reference — Redirected

PI practice knowledge (liability evaluation, injury assessment, valuation, Nevada law, etc.) has moved to **`agent/practice-guide.md`**.

Schema documentation and folder structure conventions remain below for developer reference.

## Canonical Index Schema

The definitive schema for `.ai_tool/document_index.json`. Produced by `firm.ts` indexing pipeline.

```json
{
  "indexed_at": "2024-01-19T12:00:00Z",
  "case_name": "Client v. Adverse",
  "case_phase": "Treatment",
  "summary": {
    "client": "John Smith",
    "dol": "2024-01-15",
    "dob": "1985-06-27",
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
    },
    "contact": {
      "phone": "702-555-1234",
      "email": "client@email.com",
      "address": { "street": "123 Main St", "city": "Las Vegas", "state": "NV", "zip": "89101" }
    },
    "health_insurance": {
      "carrier": "Blue Cross",
      "group_no": "GRP-12345",
      "member_no": "MEM-67890"
    },
    "claim_numbers": {
      "1P_StateFarm": "CLM-001",
      "3P_NationalGeneral": "CLM-002"
    },
    "case_summary": "Brief narrative of case status"
  },
  "folders": {
    "Intake": {
      "files": [
        {
          "filename": "Intake.pdf",
          "type": "intake_form",
          "key_info": "Client intake with accident details and contact information.",
          "extracted_data": {
            "client_name": "John Smith",
            "dob": "06/27/1985",
            "dol": "01/15/2024",
            "phone": "702-555-1234"
          }
        }
      ]
    }
  },
  "issues_found": ["Missing police report"],
  "reconciled_values": {},
  "needs_review": [],
  "errata": [],
  "case_notes": "",
  "liability_assessment": null,
  "injury_tier": null,
  "estimated_value_range": null,
  "policy_limits_demand_appropriate": null
}
```

**Key constraints:**
- Each folder value is an object with a `files` array (NOT a bare array)
- Each file object has: `filename`, `type`, `key_info`, optionally `extracted_data`
- `case_phase` is one of: Intake, Investigation, Treatment, Demand, Negotiation, Settlement, Complete

## Document Type Taxonomy

| Type | Description |
|------|-------------|
| `intake_form` | Client intake, accident details, contact info |
| `lor` | Letter of Representation to insurance companies |
| `declaration` | Insurance policy declarations page (coverage limits) |
| `medical_record` | Medical treatment records, doctor notes |
| `medical_bill` | Bills from medical providers (charges, dates) |
| `correspondence` | Letters, emails with adjusters |
| `authorization` | HIPAA forms, signed authorizations |
| `identification` | Driver's license, ID documents |
| `police_report` | Accident/police reports |
| `demand` | Demand letter to insurance |
| `settlement` | Settlement memos, releases |
| `lien` | Medical liens from providers |
| `balance_request` | Balance confirmation requests |
| `balance_confirmation` | Confirmed balances from providers |
| `property_damage` | Vehicle repair estimates, rental receipts |
| `other` | Anything that doesn't fit above |

## Case Phase Definitions

Phase detection logic lives in `server/shared/phase-rules.ts`. Phases in order:

| Phase | Indicator |
|-------|-----------|
| **Intake** | Has intake docs but no LOR files sent |
| **Investigation** | LORs sent, gathering insurance/police info |
| **Treatment** | Medical records accumulating, no demand yet |
| **Demand** | Demand letter exists in 3P folder |
| **Negotiation** | Settlement correspondence exists, no settlement memo |
| **Settlement** | Settlement memo exists |
| **Complete** | Release signed, case complete |

Detection checks folders in reverse order (Complete first) to find the most advanced phase.

## Expected Folder Structure

```
Case_Folder/
├── Intake/           <- Client onboarding (intake, ID, retainer, HIPAAs)
├── 1P/              <- First Party insurance (LOR, MedPay, dec page)
├── 3P/              <- Third Party insurance (LOR, dec page, demand, correspondence)
├── Property Damage/ <- Photos, estimates, total loss docs
├── Records & Bills/ <- Medical records and bills (MRB files)
├── MRB REQT/        <- Medical records requests sent
├── Balance REQT & RECD/ <- Balance confirmations
├── Med Liens/       <- Signed provider liens
├── Reductions/      <- Negotiated lien reductions
└── Settlement/      <- Settlement memo, release, disbursements
```
