# PI Case Assistant Agent

This directory contains the configuration and instructions for the Personal Injury case assistant agent.

## Files

- `system-prompt.md` - The agent's system prompt containing:
  - Nevada PI law knowledge
  - Document indexing instructions
  - Case folder structure expectations
  - Valuation guidelines
  - Provider information

## How the Agent Works

### Single Agent Architecture

The app uses a single agent with comprehensive PI law knowledge (in `system-prompt.md`). This agent can:

1. **Parse Documents** - Read PDFs using `pdftotext`, extract key information
2. **Index Cases** - Create structured JSON indexes of case contents
3. **Answer Questions** - Use the index + document access to answer attorney questions
4. **Generate Work Product** - Draft demand letters, case memos, settlement calculations

### Parallel Processing with Subagents

For efficiency, the agent can spawn subagents using the `Task` tool:

```
Main Agent
├── Task: "Process Intake folder" ──► Subagent reads Intake/*.pdf
├── Task: "Process 1P folder"     ──► Subagent reads 1P/*.pdf
├── Task: "Process 3P folder"     ──► Subagent reads 3P/*.pdf
└── (launched in parallel)
```

### Batch Processing

For indexing multiple cases, an orchestrator pattern is used:

```
Orchestrator Agent
├── Task: "Index Case A" ──► Case Agent A ──► spawns folder subagents
├── Task: "Index Case B" ──► Case Agent B ──► spawns folder subagents
├── Task: "Index Case C" ──► Case Agent C ──► spawns folder subagents
└── (all cases processed in parallel)
```

## Modifying Agent Behavior

### To change PI law knowledge:
Edit `system-prompt.md` sections:
- Nevada Personal Injury Law Basics
- Valuation Guidelines
- Common Las Vegas Medical Providers

### To change indexing behavior:
Edit `system-prompt.md` sections:
- Using the Document Index
- Full Indexing (New Case)
- Incremental Indexing (Updates)
- Batch Indexing (Multiple Cases)

### To change document handling:
Edit `system-prompt.md` sections:
- PDF Handling
- Error Handling
- Context Management

## Index Schema

The agent creates `.ai_tool/document_index.json` with this structure:

```json
{
  "indexed_at": "2024-01-19T12:00:00Z",
  "files_indexed": ["Intake/Intake.pdf", "1P/Dec.pdf", ...],
  "case_name": "Client v. Defendant",
  "case_phase": "Demand",
  "statute_of_limitations": "2026-03-21",
  "summary": {
    "client": "Client Name",
    "dol": "2024-03-21",
    "providers": ["Provider A", "Provider B"],
    "total_charges": "$24,419.90",
    "policy_limits": {
      "1P_medpay": "$1,000",
      "3P_bi": "$50,000/$100,000"
    }
  },
  "folders": {
    "Intake": [
      {"file": "Intake.pdf", "title": "...", "key_info": "..."}
    ],
    "1P": [...],
    "3P": [...],
    "Records & Bills": [...]
  },
  "issues_found": ["Missing police report", ...]
}
```

## Tools Available to the Agent

The agent has access to these tools (configured in `server/routes/claude.ts`):

| Tool | Purpose |
|------|---------|
| `Read` | Read files (PDFs, images, text) |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `Bash` | Run commands (primarily `pdftotext`) |
| `Write` | Create/overwrite files |
| `Edit` | Modify existing files |
| `Task` | Spawn parallel subagents |
