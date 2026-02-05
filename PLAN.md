# Extraction & Modularity Refactoring Plan

## Progress Summary

### Completed Work

#### Phase 1: Fix Extraction ✅ DONE
- Removed Path 2b (direct API with base64 PDF)
- All non-pre-extracted files now route to Agent SDK fallback
- Simplified to two paths:
  - **Path 1**: pdftotext succeeds → Direct Haiku API with structured tool_use
  - **Path 2**: Everything else → Agent SDK with Read/Bash tools

#### Phase 2: Practice Areas Module Structure ✅ DONE

Created new modular structure:
```
server/practice-areas/
├── index.ts                           # Registry and loader
├── types.ts                           # PracticeAreaConfig interface
├── personal-injury/
│   ├── index.ts                       # Module exports
│   ├── config.ts                      # PI_DOC_TYPES, PI_PHASES
│   ├── extraction.md                  # PI extraction prompt
│   └── extraction-with-tools.md       # PI agent fallback prompt
└── workers-comp/
    ├── index.ts                       # Module exports
    ├── config.ts                      # WC_DOC_TYPES, WC_PHASES
    ├── extraction.md                  # WC extraction prompt
    └── extraction-with-tools.md       # WC agent fallback prompt
```

#### Changes Made

1. **firm.ts**:
   - Updated `getFileExtractionSystemPrompt()` to load from registry
   - Updated `getFileExtractionSystemPromptWithTools()` to load from registry
   - Both functions have fallback to hardcoded prompts during migration
   - Removed Path 2b code (direct PDF API calls)
   - Import `practiceAreaRegistry` from practice-areas module

2. **index-schema.ts**:
   - Now imports `SHARED_DOC_TYPES` from `practice-areas/types`
   - Now imports `PI_DOC_TYPES`, `PI_PHASES` from `practice-areas/personal-injury/config`
   - Now imports `WC_DOC_TYPES`, `WC_PHASES` from `practice-areas/workers-comp/config`
   - Re-exports for backward compatibility
   - Removed duplicate definitions

3. **New practice-areas module**:
   - `types.ts`: `PracticeAreaConfig` and `PracticeAreaRegistry` interfaces
   - `index.ts`: Registry implementation with lazy loading of prompts from markdown
   - Practice area configs in their respective directories
   - Extraction prompts moved to markdown files

---

## Remaining Work

### Sprint 3: Further Separation (Optional)
- [ ] Move PI-specific Zod schemas to `practice-areas/personal-injury/schema.ts`
- [ ] Move WC-specific Zod schemas to `practice-areas/workers-comp/schema.ts`
- [ ] Update synthesis prompts to load from markdown files
- [ ] Consider generating `FILE_EXTRACTION_TOOL_SCHEMA` per practice area

### Sprint 4: Testing & Validation
- [ ] Test PI extraction with new module structure
- [ ] Test WC extraction with new module structure
- [ ] Verify index normalization works correctly
- [ ] Test on Windows to confirm extraction works

---

## Architecture Decisions Made

1. **Prompts are markdown files**: Easier for developers and eventually users to edit
2. **Static registry**: Practice areas are explicitly imported, code changes required for new areas
3. **Shared types in base**: SHARED_DOC_TYPES defined in `practice-areas/types.ts`
4. **Backward compatibility**: Re-exports from index-schema.ts preserve existing imports

---

## File Changes Summary

| File | Change |
|------|--------|
| `server/routes/firm.ts` | Removed Path 2b, updated prompt loaders |
| `server/lib/index-schema.ts` | Now imports from practice-areas |
| `server/practice-areas/types.ts` | NEW - interfaces and shared types |
| `server/practice-areas/index.ts` | NEW - registry implementation |
| `server/practice-areas/personal-injury/*` | NEW - PI config and prompts |
| `server/practice-areas/workers-comp/*` | NEW - WC config and prompts |

---

## Key Principles Implemented

1. **PI and WC are now separate**: Each has its own directory with config and prompts
2. **Prompts are editable**: Markdown files can be modified without rebuilding
3. **Core code is generic**: firm.ts and index-schema.ts import law-specific config
4. **Backward compatibility**: Existing imports still work via re-exports
