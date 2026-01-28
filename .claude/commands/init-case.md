---
allowed-tools: Read, Write, Glob, Grep, Bash(*), Task
description: Initialize a case by indexing all documents
---

Index all documents in this case folder. For each document, extract the title, date, and what's important about it.

Save the result to `.pi_tool/document_index.json`

Use sub-agents for each folder to manage context efficiently.

## Output Schema

```json
{
  "case_name": "string",
  "indexed_at": "ISO date",
  "case_phase": "Intake|Investigation|Treatment|Demand|Negotiation|Settlement|Complete",
  "folders": {
    "Intake": {
      "files": [
        {
          "filename": "filename.pdf",
          "type": "intake_form|lor|declaration|medical_record|medical_bill|correspondence|authorization|identification|police_report|demand|settlement|lien|balance_request|balance_confirmation|property_damage|other",
          "key_info": "2-3 sentence summary of most important information",
          "extracted_data": {
            "client_name": "...",
            "dob": "MM/DD/YYYY",
            "dol": "MM/DD/YYYY",
            "charges": 1234.56,
            "provider": "..."
          }
        }
      ]
    },
    "1P": { "files": [] },
    "3P": { "files": [] },
    "Records & Bills": { "files": [] },
    "Balance REQT & RECD": { "files": [] }
  },
  "summary": {
    "client": "name",
    "dol": "date of loss",
    "providers": ["list"],
    "total_charges": 0,
    "policy_limits": {
      "1P": { "carrier": "...", "bodily_injury": "...", "medical_payments": "..." },
      "3P": { "carrier": "...", "bodily_injury": "..." }
    }
  },
  "issues_found": [],
  "needs_review": [],
  "errata": []
}
```
