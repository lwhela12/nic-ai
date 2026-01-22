---
allowed-tools: Read, Write
description: Generate a case memo from the document index
---

Read `.pi_tool/document_index.json` and generate a comprehensive case memo.

Save to `.pi_tool/case_memo.md`

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
