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
  "folders": {
    "Intake": [
      {
        "file": "filename.pdf",
        "title": "what this document is",
        "date": "document date if found",
        "key_info": "what's important - amounts, parties, dates, etc.",
        "issues": "any problems noticed (optional)"
      }
    ],
    "1P": [],
    "3P": [],
    "Records & Bills": [],
    "Balance REQT & RECD": []
  },
  "summary": {
    "client": "name",
    "dol": "date of loss",
    "providers": ["list"],
    "total_charges": "dollar amount",
    "policy_limits": "1P and 3P limits"
  }
}
```
