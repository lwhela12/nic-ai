import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { getFirmSession, saveFirmSession } from "../sessions";
import { PHASE_RULES } from "../shared/phase-rules";
import { loadPracticeGuide, loadSectionsByIds, clearKnowledgeCache } from "./knowledge";

const app = new Hono();

// Practice guide loading now handled by knowledge.ts

// Load INDEX_SCHEMA.md for injection into synthesis prompt
let indexSchemaCache: string | null = null;

async function loadIndexSchema(): Promise<string> {
  if (indexSchemaCache) return indexSchemaCache;
  const schemaPath = join(import.meta.dir, "../../INDEX_SCHEMA.md");
  try {
    indexSchemaCache = await readFile(schemaPath, "utf-8");
  } catch {
    console.warn("[Schema] Could not load INDEX_SCHEMA.md, using fallback");
    indexSchemaCache = "";
  }
  return indexSchemaCache;
}

// Sections relevant for case synthesis (by manifest section ID)
const SYNTHESIS_SECTION_IDS = [
  "liability-evaluation",
  "injury-severity",
  "valuation-framework",
  "subrogation-liens",
  "document-quality",
  // Workers' comp equivalents
  "claim-evaluation",
  "injury-classification",
  "benefits-calculation",
  "third-party-claims",
];

interface CaseSummary {
  path: string;
  name: string;
  indexed: boolean;
  indexedAt?: string;
  clientName?: string;
  casePhase?: string;
  dateOfLoss?: string;
  totalSpecials?: number;
  policyLimits?: string | Record<string, unknown>;
  statuteOfLimitations?: string;
  solDaysRemaining?: number;
  needsReindex?: boolean;
  providers?: string[];
}

// Get all cases in a firm's root folder
app.get("/cases", async (c) => {
  const root = c.req.query("root");

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }

  try {
    const entries = await readdir(root, { withFileTypes: true });
    const cases: CaseSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const casePath = join(root, entry.name);
      const indexPath = join(casePath, ".pi_tool", "document_index.json");

      const caseSummary: CaseSummary = {
        path: casePath,
        name: entry.name,
        indexed: false,
      };

      try {
        const indexContent = await readFile(indexPath, "utf-8");
        const index = JSON.parse(indexContent);
        const indexStats = await stat(indexPath);

        caseSummary.indexed = true;
        caseSummary.indexedAt = indexStats.mtime.toISOString();

        // Extract from index - handle various formats
        caseSummary.clientName = index.summary?.client || index.client_name || index.summary?.client_name || index.case_name?.split(" v.")[0] || entry.name;
        caseSummary.casePhase = index.case_phase || index.summary?.case_phase || "Unknown";
        caseSummary.dateOfLoss = index.summary?.dol || index.date_of_loss || index.summary?.date_of_loss || index.dol;
        caseSummary.policyLimits = index.policy_limits || index.summary?.policy_limits || index["3p_policy_limits"];

        // Calculate total specials from various possible locations
        // Handle both number and string formats (e.g., "$24,419.90")
        const parseAmount = (val: any): number | undefined => {
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const cleaned = val.replace(/[$,]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? undefined : num;
          }
          return undefined;
        };

        caseSummary.totalSpecials = parseAmount(index.total_specials)
          ?? parseAmount(index.summary?.total_specials)
          ?? parseAmount(index.summary?.total_charges)
          ?? parseAmount(index.total_medical_charges)
          ?? parseAmount(index.total_charges)
          ?? parseAmount(index.financials?.total_charges);

        // Statute of limitations - use explicit value or calculate from DOL + 2 years (Nevada PI)
        caseSummary.statuteOfLimitations = index.statute_of_limitations || index.summary?.statute_of_limitations;

        // If no explicit SOL, calculate from DOL (Nevada PI = 2 years)
        if (!caseSummary.statuteOfLimitations && caseSummary.dateOfLoss) {
          try {
            // Parse DOL - handle various formats like "01/04/2024" or "2024-03-21"
            const dolStr = caseSummary.dateOfLoss;
            let dolDate: Date;
            if (dolStr.includes('/')) {
              // MM/DD/YYYY format
              const [month, day, year] = dolStr.split('/');
              dolDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            } else {
              // ISO format
              dolDate = new Date(dolStr);
            }

            if (!isNaN(dolDate.getTime())) {
              // Add 2 years for Nevada PI statute
              const solDate = new Date(dolDate);
              solDate.setFullYear(solDate.getFullYear() + 2);
              caseSummary.statuteOfLimitations = solDate.toISOString().split('T')[0];
            }
          } catch {
            // Could not parse DOL
          }
        }

        if (caseSummary.statuteOfLimitations) {
          const solDate = new Date(caseSummary.statuteOfLimitations);
          const now = new Date();
          const diffMs = solDate.getTime() - now.getTime();
          caseSummary.solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }

        // Providers list
        if (index.providers) {
          caseSummary.providers = Array.isArray(index.providers)
            ? index.providers.map((p: any) => typeof p === 'string' ? p : p.name)
            : Object.keys(index.providers);
        } else if (index.summary?.providers) {
          caseSummary.providers = index.summary.providers;
        }

        // Check if needs reindex (files modified after index)
        caseSummary.needsReindex = await checkNeedsReindex(casePath, indexStats.mtimeMs);

      } catch {
        // No index found - case exists but not indexed
        caseSummary.indexed = false;
      }

      cases.push(caseSummary);
    }

    // Sort by SOL (most urgent first), then by name
    cases.sort((a, b) => {
      // Indexed cases first
      if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
      // Then by SOL urgency
      if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
        return a.solDaysRemaining - b.solDaysRemaining;
      }
      if (a.solDaysRemaining !== undefined) return -1;
      if (b.solDaysRemaining !== undefined) return 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });

    return c.json({
      root,
      cases,
      summary: {
        total: cases.length,
        indexed: cases.filter(c => c.indexed).length,
        needsAttention: cases.filter(c => c.solDaysRemaining !== undefined && c.solDaysRemaining <= 90).length,
      }
    });
  } catch (error) {
    console.error("Firm cases error:", error);
    return c.json({ error: "Could not read firm directory" }, 500);
  }
});

// ============================================================================
// FILE EXTRACTION SYSTEM - One agent per file, server-side orchestration
// ============================================================================

// System prompt for file extraction agents (Haiku)
const fileExtractionSystemPrompt = `You are a document extraction agent for a Personal Injury law firm in Nevada (Muslusky Law).

YOUR TASK: Read ONE document and extract key information.

DOCUMENT TYPES YOU MAY ENCOUNTER:
- intake_form: Client intake, accident details, contact info
- lor: Letter of Representation to insurance companies
- declaration: Insurance policy declarations page (coverage limits)
- medical_record: Medical treatment records, doctor notes
- medical_bill: Bills from medical providers (charges, dates)
- correspondence: Letters, emails with adjusters
- authorization: HIPAA forms, signed authorizations
- identification: Driver's license, ID documents
- police_report: Accident/police reports
- demand: Demand letter to insurance
- settlement: Settlement memos, releases
- lien: Medical liens from providers
- balance_request: Balance confirmation requests
- balance_confirmation: Confirmed balances from providers
- property_damage: Vehicle repair estimates, rental receipts
- other: Anything that doesn't fit above

EXTRACTION FOCUS:
- Client name, DOB, contact info (phone, email, address)
- Date of loss (accident date)
- Insurance policy numbers and limits
- Medical provider names
- Treatment dates and charges (dollar amounts)
- Claim numbers
- Health insurance details (carrier, group number, member ID)
- Any issues or gaps noted in the document

OUTPUT FORMAT - Return ONLY valid JSON:
{
  "filename": "<exact filename>",
  "folder": "<folder name>",
  "type": "<document_type from list above>",
  "key_info": "<2-3 sentence summary of most important information>",
  "extracted_data": {
    // Include any specific data points found, such as:
    // "client_name": "...",
    // "dob": "MM/DD/YYYY",
    // "dol": "MM/DD/YYYY",
    // "phone": "702-555-1234",
    // "email": "client@email.com",
    // "address": { "street": "123 Main St", "city": "Las Vegas", "state": "NV", "zip": "89101" },
    // "charges": 1234.56,
    // "provider": "...",
    // "policy_limits": "...",
    // "health_insurance_carrier": "...",
    // "health_insurance_group": "...",
    // "health_insurance_member": "...",
    // etc.
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- If the file cannot be read or is empty, still return the JSON with key_info explaining the issue
- For PDFs: use pdftotext "filename" - 2>/dev/null | head -200
- For all other files: use the Read tool directly
- If a file cannot be read or parsed, return the JSON with key_info explaining the issue`;

// Build synthesis system prompt with practice guide sections injected
async function buildSynthesisSystemPrompt(firmRoot?: string): Promise<string> {
  const practiceKnowledge = await loadSectionsByIds(firmRoot, SYNTHESIS_SECTION_IDS);
  const indexSchema = await loadIndexSchema();

  return `You are a case analyst and summarizer for a Personal Injury law firm in Nevada.

You have two JSON files in .pi_tool/:
1. document_index.json - Data extracted by Haiku from all case documents
2. hypergraph_analysis.json - Cross-document analysis showing consensus values and conflicts

YOUR JOB: Analyze the case substantively and synthesize a case summary. Do NOT read any source PDFs.

## PRACTICE KNOWLEDGE

${practiceKnowledge}

## CANONICAL INDEX SCHEMA — MUST FOLLOW EXACTLY

The following schema defines the EXACT structure for document_index.json. You MUST adhere to this schema precisely.

**CRITICAL SCHEMA REQUIREMENTS:**
- \`summary.providers\` MUST be an array of strings: \`["Provider A", "Provider B"]\` — NOT objects
- \`summary.policy_limits\` MUST use keys \`1P\` and \`3P\` — NOT "first_party"/"third_party"
- \`summary.claim_numbers\` MUST use keys like \`1P_CarrierName\` and \`3P_CarrierName\` — NOT "first_party_carrier"
- \`case_notes\` is an array for user notes — write your analysis to \`case_analysis\` (string field) instead

${indexSchema}

## WORKFLOW:
1. Read both JSON files
2. **Case Analysis** — Using the practice knowledge above, assess:
   - **Liability strength**: clear / moderate / contested (with reasoning)
   - **Injury tier**: Tier 1 (soft tissue) / Tier 2 (structural) / Tier 3 (surgical) based on treatment and findings
   - **Estimated value range**: Apply the multiplier for the injury tier against total specials
   - **Policy limits demand appropriate?**: Yes/No based on Section IV triggers
   - **Document quality gaps**: What critical documents are missing per the completeness checklist?
   Write your analysis into the case_analysis field (a string, NOT case_notes which is an array).
3. Use the hypergraph consensus values where available
4. Generate a case summary from the extracted data
5. Consolidate contact information into summary.contact object:
   - phone: Client's phone number
   - email: Client's email address
   - address: { street, city, state, zip }
6. Consolidate health insurance into summary.health_insurance object:
   - carrier, group_no, member_no
7. Consolidate claim numbers into summary.claim_numbers object
8. Document ALL judgment calls in "errata"
9. Put CRITICAL unresolved conflicts in "needs_review" (user must decide)
10. Edit document_index.json with your synthesis

## CRITICAL: HANDLING HYPERGRAPH CONFLICTS

**MANDATORY needs_review items** - If the hypergraph shows ANY of these, you MUST add to needs_review:
1. Any field where consensus is "UNCERTAIN" - these REQUIRE human decision
2. Any charges/balances with conflicting values (even if one looks "newer")
3. Any date_of_loss conflicts (affects statute of limitations)
4. Any policy_limits conflicts

**You are NOT authorized to resolve UNCERTAIN values.** When hypergraph says consensus: "UNCERTAIN", you MUST:
1. Add it to needs_review with both values and their sources
2. NOT pick one value to use in the summary
3. Use "NEEDS REVIEW" or leave empty in summary fields

Example: If hypergraph shows:
\`\`\`
"charges:Spinal Rehab": {
  "consensus": "UNCERTAIN",
  "values": [{"value": "6558", "sources": ["MRB.pdf"]}, {"value": "10558", "sources": ["BC.pdf"]}]
}
\`\`\`

You MUST add to needs_review:
\`\`\`
{
  "field": "charges:Spinal Rehab",
  "conflicting_values": ["$6,558", "$10,558"],
  "sources": ["MRB Spinal Rehab Center.PDF", "BC Spinal Rehab Center.pdf"],
  "reason": "$4,000 discrepancy in provider charges requires human verification"
}
\`\`\`

## ERRATA - Document ALL decisions

Every field you fill in should have an errata entry explaining where it came from:

{
  "field": "<what field>",
  "decision": "<value you used>",
  "evidence": "<what the extractions showed>",
  "confidence": "high|medium|low"
}

## CASE ANALYSIS FIELDS

Write these fields in document_index.json:
- **case_analysis**: Your substantive analysis — liability assessment, injury tier determination, value estimate, treatment pattern observations, priority next steps. This should be analytical, not just a data summary. (This is a string field, NOT the case_notes array.)
- **liability_assessment**: "clear" | "moderate" | "contested"
- **injury_tier**: "tier_1_soft_tissue" | "tier_2_structural" | "tier_3_surgical"
- **estimated_value_range**: e.g. "$37,500 - $62,500" (specials x low multiplier to specials x high multiplier)
- **policy_limits_demand_appropriate**: true | false

## PHASE RULES:
${Object.entries(PHASE_RULES).map(([phase, desc]) => `- ${phase}: ${desc}`).join('\n')}

## CRITICAL EDITING RULES:
- The document_index.json already has placeholder fields (needs_review, errata, case_analysis, etc.)
- Use Edit tool to REPLACE existing values, NOT add new keys
- Find the existing "needs_review": [] and replace it with your array
- Find the existing "errata": [] and replace it with your array
- NEVER add duplicate keys - this breaks JSON parsing
- Each Edit should target a specific existing field to replace its value

## PRIORITY: Edit needs_review and errata FIRST

**Your first Edit calls MUST be for needs_review and errata.** These are the most important fields.
Do not spend many turns reading files or running Bash commands. Read the hypergraph once, then immediately start making Edit calls.

Edit order:
1. needs_review (with all UNCERTAIN fields)
2. errata (with all your decisions)
3. case_analysis, liability_assessment, injury_tier, estimated_value_range, policy_limits_demand_appropriate
4. summary fields
5. case_name, case_phase

**IMPORTANT**: You MUST write needs_review and errata arrays. Empty arrays are only acceptable if there are truly zero conflicts (which is rare).`;
}

// Usage tracking with cache breakdown
interface UsageStats {
  inputTokens: number;        // Total input (sum of all three below)
  inputTokensNew: number;     // Regular price tokens
  inputTokensCacheWrite: number;  // Cache creation (25% premium)
  inputTokensCacheRead: number;   // Cache hits (90% discount)
  outputTokens: number;
  apiCalls: number;
  model: string;
}

// Extract info from a single file
interface FileExtraction {
  filename: string;
  folder: string;
  type: string;
  key_info: string;
  extracted_data?: Record<string, any>;
  error?: string;
  usage?: UsageStats;
}

function normalizeFolders(input: any): Record<string, { files: any[] }> {
  const normalized: Record<string, { files: any[] }> = {};
  if (!input || typeof input !== "object") return normalized;

  for (const [folderName, folderData] of Object.entries(input)) {
    if (Array.isArray(folderData)) {
      normalized[folderName] = { files: [...folderData] };
      continue;
    }

    if (folderData && typeof folderData === "object") {
      const files = (folderData as any).files;
      if (Array.isArray(files)) {
        normalized[folderName] = { files: [...files] };
        continue;
      }
      const documents = (folderData as any).documents;
      if (Array.isArray(documents)) {
        normalized[folderName] = { files: [...documents] };
        continue;
      }
    }

    normalized[folderName] = { files: [] };
  }

  return normalized;
}

/**
 * Tiered PDF text extraction:
 * 1. pdftotext (fastest) - extracts embedded text layer
 * 2. tesseract OCR (medium) - for scanned documents
 * 3. null (fallback to Claude Read tool) - for complex layouts, handwriting
 */
async function extractPdfText(
  filePath: string
): Promise<{ text: string | null; method: 'pdftotext' | 'tesseract' | 'claude-read' }> {
  const MIN_TEXT_LENGTH = 100; // Minimum chars to consider extraction successful

  // Tier 1: pdftotext (works on native PDFs and pre-OCR'd scans)
  try {
    const pdfProc = Bun.spawn(['pdftotext', filePath, '-'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const pdfText = await new Response(pdfProc.stdout).text();
    await pdfProc.exited;

    if (pdfText.trim().length > MIN_TEXT_LENGTH) {
      console.log(`  → pdftotext succeeded (${pdfText.length} chars)`);
      return { text: pdfText.slice(0, 50000), method: 'pdftotext' };
    }
  } catch (err) {
    console.log(`  → pdftotext failed: ${err}`);
  }

  // Tier 2: tesseract OCR (for scanned documents)
  try {
    // Convert PDF to images and OCR them
    const tempDir = `/tmp/ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await Bun.spawn(['mkdir', '-p', tempDir]).exited;

    // Convert PDF pages to PNG images (300 DPI for good OCR quality)
    const convertProc = Bun.spawn(['pdftoppm', '-png', '-r', '300', filePath, `${tempDir}/page`], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await convertProc.exited;

    // OCR all page images
    const ocrProc = Bun.spawn(['sh', '-c', `tesseract ${tempDir}/page-*.png stdout 2>/dev/null`], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const ocrText = await new Response(ocrProc.stdout).text();
    await ocrProc.exited;

    // Cleanup temp files
    await Bun.spawn(['rm', '-rf', tempDir]).exited;

    if (ocrText.trim().length > MIN_TEXT_LENGTH / 2) {
      console.log(`  → tesseract OCR succeeded (${ocrText.length} chars)`);
      return { text: ocrText.slice(0, 50000), method: 'tesseract' };
    }
  } catch (err) {
    console.log(`  → tesseract OCR failed: ${err}`);
  }

  // Tier 3: Fall back to Claude Read tool
  console.log(`  → Falling back to Claude Read tool`);
  return { text: null, method: 'claude-read' };
}

async function extractFile(
  caseFolder: string,
  filePath: string, // relative path like "Intake/Intake.pdf"
  fileIndex: number,
  totalFiles: number,
  onProgress?: (event: { type: string; [key: string]: any }) => void
): Promise<FileExtraction> {
  const filename = filePath.split('/').pop() || filePath;
  const rawFolder = dirname(filePath).replace(/\\/g, '/');
  const folder = rawFolder === '.' ? '.' : rawFolder;
  const fullPath = join(caseFolder, filePath);
  const startTime = Date.now();

  // Track messages for debugging failures
  const messageLog: Array<{ type: string; subtype?: string; detail?: string }> = [];

  try {
    // Pre-flight checks
    let fileStats;
    try {
      fileStats = await stat(fullPath);
    } catch (statErr) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[${fileIndex + 1}/${totalFiles}] ✗ File not found: ${filename} (${elapsed}s)`);
      return {
        filename,
        folder,
        type: 'other',
        key_info: 'File not found or inaccessible',
        error: `File not found: ${fullPath}`,
      };
    }

    // Warn about very large files (>10MB)
    const fileSizeMB = fileStats.size / (1024 * 1024);
    if (fileSizeMB > 10) {
      console.warn(`[${fileIndex + 1}/${totalFiles}] ⚠ Large file: ${filename} (${fileSizeMB.toFixed(1)}MB)`);
    }

    console.log(`[${fileIndex + 1}/${totalFiles}] Starting: ${filename} (${fileSizeMB.toFixed(2)}MB)`);
    onProgress?.({ type: "file_start", fileIndex, totalFiles, filename, folder });

    let result: FileExtraction = { filename, folder, type: 'other', key_info: '' };
    let usage: UsageStats = {
      inputTokens: 0,
      inputTokensNew: 0,
      inputTokensCacheWrite: 0,
      inputTokensCacheRead: 0,
      outputTokens: 0,
      apiCalls: 0,
      model: 'haiku'
    };

    // Determine extraction strategy based on file type
    const isPdf = fullPath.toLowerCase().endsWith('.pdf');
    let preExtractedText: string | null = null;
    let extractionMethod: 'pdftotext' | 'tesseract' | 'claude-read' | 'direct' = 'direct';

    if (isPdf) {
      const pdfResult = await extractPdfText(fullPath);
      preExtractedText = pdfResult.text;
      extractionMethod = pdfResult.method;
    }

    // Build prompt and options based on extraction strategy
    const prompt = preExtractedText
      ? `Extract information from this file: ${filename} (extracted via ${extractionMethod})

Document content:
---
${preExtractedText}
---

Return the JSON extraction based on the content above.`
      : isPdf
        ? `Extract information from this file: ${fullPath}

Use the Read tool to read the file (it may contain scanned images or complex layouts).

Then return the JSON extraction.`
        : `Extract information from this file: ${fullPath}

Use the Read tool to read the file.

Then return the JSON extraction.`;

    const options = preExtractedText
      ? {
          // Fast path: text already extracted, no tools needed
          cwd: caseFolder,
          systemPrompt: fileExtractionSystemPrompt,
          model: "haiku" as const,
          allowedTools: [] as string[],
          permissionMode: "acceptEdits" as const,
          maxTurns: 1,
        }
      : {
          // Fallback: let agent use Read tool
          cwd: caseFolder,
          systemPrompt: fileExtractionSystemPrompt,
          model: "haiku" as const,
          allowedTools: ["Read"],
          permissionMode: "acceptEdits" as const,
          maxTurns: 3,
        };

    for await (const msg of query({
      prompt,
      options,
    })) {
      // Log all message types for debugging
      const msgAny = msg as any;
      messageLog.push({
        type: msg.type,
        subtype: msgAny.subtype,
        detail: msgAny.error || msgAny.message || msgAny.reason || undefined
      });

      // Log errors and system messages that might indicate issues
      if (msg.type === "error" || (msg.type === "system" && msgAny.subtype === "error")) {
        console.error(`[${fileIndex + 1}/${totalFiles}] SDK Error for ${filename}:`, JSON.stringify(msg, null, 2));
      }

      // Log result with error subtype
      if (msg.type === "result" && msgAny.subtype === "error") {
        console.error(`[${fileIndex + 1}/${totalFiles}] Result error for ${filename}:`, msgAny.error || msgAny.message || JSON.stringify(msg));
      }

      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            // Try to parse JSON from the response
            try {
              const jsonMatch = block.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                result = {
                  filename: parsed.filename || filename,
                  folder: folder,  // Always use our calculated folder from file path, not agent's
                  type: parsed.type || 'other',
                  key_info: parsed.key_info || '',
                  extracted_data: parsed.extracted_data,
                };
              }
            } catch {
              // If JSON parsing fails, use the text as key_info
              result.key_info = block.text.slice(0, 500);
            }
          }
        }
      }

      // Capture final result usage with cache breakdown
      if (msg.type === "result" && (msg as any).usage) {
        const finalUsage = (msg as any).usage;
        usage.inputTokensNew = finalUsage.input_tokens || 0;
        usage.inputTokensCacheWrite = finalUsage.cache_creation_input_tokens || 0;
        usage.inputTokensCacheRead = finalUsage.cache_read_input_tokens || 0;
        usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
        usage.outputTokens = finalUsage.output_tokens || 0;
        usage.apiCalls = 1;
      }
    }

    result.usage = usage;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${fileIndex + 1}/${totalFiles}] ✓ Done: ${filename} (${elapsed}s) - ${result.type} [${extractionMethod}]`);
    onProgress?.({
      type: "file_done",
      fileIndex,
      totalFiles,
      filename,
      folder,
      docType: result.type,
      extractionMethod,
      elapsed: parseFloat(elapsed)
    });
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Extract detailed error info
    const errAny = err as any;
    const errorDetails = {
      message: err instanceof Error ? err.message : String(err),
      code: errAny?.code,
      exitCode: errAny?.exitCode,
      stderr: errAny?.stderr,
      stdout: errAny?.stdout,
      cause: errAny?.cause,
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    };

    // Log detailed failure info
    console.error(`[${fileIndex + 1}/${totalFiles}] ✗ FAILED: ${filename} (${elapsed}s)`);
    console.error(`  File path: ${fullPath}`);
    console.error(`  Error: ${errorDetails.message}`);
    if (errorDetails.code) console.error(`  Code: ${errorDetails.code}`);
    if (errorDetails.exitCode) console.error(`  Exit code: ${errorDetails.exitCode}`);
    if (errorDetails.stderr) console.error(`  Stderr: ${errorDetails.stderr}`);
    if (errorDetails.cause) console.error(`  Cause: ${JSON.stringify(errorDetails.cause)}`);
    if (messageLog.length > 0) {
      console.error(`  Message log (${messageLog.length} messages):`);
      messageLog.slice(-5).forEach((m, i) => {
        console.error(`    [${i}] ${m.type}${m.subtype ? ':' + m.subtype : ''} ${m.detail || ''}`);
      });
    }

    onProgress?.({
      type: "file_error",
      fileIndex,
      totalFiles,
      filename,
      error: errorDetails.message,
      errorDetails
    });
    return {
      filename,
      folder,
      type: 'other',
      key_info: 'Failed to extract',
      error: errorDetails.message,
    };
  }
}

// Sonnet synthesizes case summary from extracted data (NO PDF reading)
async function synthesizeCaseSummary(
  caseFolder: string,
  conflictCount: number,
  firmRoot?: string
): Promise<UsageStats> {
  console.log(`\n========== SONNET SYNTHESIS ==========`);
  console.log(`[Sonnet] Case folder: ${caseFolder}`);
  console.log(`[Sonnet] Conflicts detected: ${conflictCount}`);

  let usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'sonnet'
  };

  const synthesisSystemPrompt = await buildSynthesisSystemPrompt(firmRoot);

  for await (const msg of query({
    prompt: `Analyze and synthesize a case summary from the extracted data.

## PRIORITY ORDER - Edit these fields in THIS order:

1. **FIRST** - Read .pi_tool/hypergraph_analysis.json
2. **SECOND** - Edit needs_review array with ALL UNCERTAIN or conflicting fields (charges, balances with different values)
3. **THIRD** - Edit errata array documenting your decisions
4. **FOURTH** - Edit case_analysis with your substantive case analysis (liability, injury tier, value range, gaps)
5. **FIFTH** - Edit liability_assessment, injury_tier, estimated_value_range, policy_limits_demand_appropriate
6. **THEN** - Edit summary fields (client, dol, dob, providers, total_charges, policy_limits)
7. **LAST** - Edit case_name, case_phase

## CRITICAL RULES:
- Any hypergraph field with "consensus": "UNCERTAIN" MUST go in needs_review
- Any field with has_conflict: true where values differ significantly (>$100 for money) MUST go in needs_review
- Do NOT spend many turns reading - focus on making the Edit calls

## EFFICIENT WORKFLOW:
1. Read hypergraph_analysis.json (one Read call)
2. Immediately make Edit calls for needs_review and errata
3. Read document_index.json summary section if needed
4. Make Edit calls for summary fields

Do NOT read any PDFs. Minimize Read/Bash calls. Prioritize Edit calls.`,
    options: {
      cwd: caseFolder,
      systemPrompt: synthesisSystemPrompt,
      model: "sonnet",
      allowedTools: ["Read", "Edit"],
      permissionMode: "acceptEdits",
      maxTurns: 25,
    },
  })) {
    console.log(`[Sonnet] Message type: ${msg.type}`);

    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.length > 0) {
          console.log(`[Sonnet] Text: ${block.text.slice(0, 500)}${block.text.length > 500 ? '...' : ''}`);
        } else if (block.type === "tool_use") {
          console.log(`[Sonnet] Tool: ${block.name}`);
        }
      }
    }

    // Capture final result usage
    if (msg.type === "result" && (msg as any).usage) {
      const finalUsage = (msg as any).usage;
      usage.inputTokensNew = finalUsage.input_tokens || 0;
      usage.inputTokensCacheWrite = finalUsage.cache_creation_input_tokens || 0;
      usage.inputTokensCacheRead = finalUsage.cache_read_input_tokens || 0;
      usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
      usage.outputTokens = finalUsage.output_tokens || 0;
      usage.apiCalls = 1;
    }
  }

  console.log(`[Sonnet] Done. Usage: ${usage.inputTokens} in / ${usage.outputTokens} out`);
  console.log(`==========================================\n`);

  return usage;
}

// List all indexable files in a case folder
async function listCaseFiles(caseFolder: string): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dir: string, base: string = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      const relativePath = base ? `${base}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walkDir(fullPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  await walkDir(caseFolder);
  return files;
}

// Index a single case using file-by-file extraction
async function indexCase(
  caseFolder: string,
  onProgress: (event: { type: string; [key: string]: any }) => void,
  options?: { incrementalFiles?: string[]; firmRoot?: string }
): Promise<{ success: boolean; error?: string }> {
  const caseName = caseFolder.split('/').pop() || caseFolder;
  const isIncremental = options?.incrementalFiles && options.incrementalFiles.length > 0;
  const indexDir = join(caseFolder, '.pi_tool');
  const indexPath = join(indexDir, 'document_index.json');

  let previousIndexContent: string | null = null;
  let previousIndex: any = null;
  try {
    previousIndexContent = await readFile(indexPath, 'utf-8');
    try {
      previousIndex = JSON.parse(previousIndexContent);
    } catch {
      previousIndex = null;
    }
  } catch {
    // No previous index
  }

  // Aggregate usage tracking with cache breakdown
  const totalUsage = {
    haiku: {
      inputTokens: 0,
      inputTokensNew: 0,
      inputTokensCacheWrite: 0,
      inputTokensCacheRead: 0,
      outputTokens: 0,
      apiCalls: 0
    },
    sonnet: {
      inputTokens: 0,
      inputTokensNew: 0,
      inputTokensCacheWrite: 0,
      inputTokensCacheRead: 0,
      outputTokens: 0,
      apiCalls: 0
    },
  };

  try {
    onProgress({ type: "case_start", caseName, caseFolder, incremental: isIncremental });

    // Load existing index if incremental (use preloaded index when available)
    let existingIndex: any = previousIndex;
    if (isIncremental) {
      if (existingIndex) {
        console.log(`[Incremental] Loaded existing index with ${Object.keys(existingIndex.folders || {}).length} folders`);
      } else {
        console.log(`[Incremental] No existing index found, falling back to full index`);
      }
    }

    // Step 1: List files (all files for full index, or just specified files for incremental)
    let files: string[];
    if (isIncremental && options?.incrementalFiles) {
      files = options.incrementalFiles;
      onProgress({ type: "status", caseName, message: `Incremental update: ${files.length} file(s)...` });
      onProgress({ type: "files_found", caseName, count: files.length, files, incremental: true });
    } else {
      onProgress({ type: "status", caseName, message: "Listing files..." });
      files = await listCaseFiles(caseFolder);
      onProgress({ type: "files_found", caseName, count: files.length, files });
    }

    if (files.length === 0) {
      onProgress({ type: "case_done", caseName, success: false, error: "No files found" });
      return { success: false, error: "No files found in case folder" };
    }

    // Step 2: Extract files with concurrency limit
    const CONCURRENCY_LIMIT = 15;
    console.log(`\n========== EXTRACTING ${files.length} FILES (max ${CONCURRENCY_LIMIT} concurrent) ==========`);
    onProgress({ type: "status", caseName, message: `Extracting ${files.length} files (${CONCURRENCY_LIMIT} at a time)...` });

    // Concurrency-limited extraction
    const extractions: FileExtraction[] = [];
    let completedCount = 0;

    async function processWithLimit<T>(
      items: T[],
      limit: number,
      processor: (item: T, index: number) => Promise<FileExtraction>
    ): Promise<FileExtraction[]> {
      const results: FileExtraction[] = new Array(items.length);
      let currentIndex = 0;

      async function worker() {
        while (currentIndex < items.length) {
          const index = currentIndex++;
          try {
            results[index] = await processor(items[index], index);
          } catch (err) {
            // Ensure a single file failure never kills the whole batch
            const item = items[index];
            const filename = typeof item === 'string' ? (item as string).split('/').pop() || String(item) : String(item);
            const folder = typeof item === 'string' ? (item as string).split('/')[0] || 'root' : 'root';
            console.error(`[${index + 1}/${items.length}] Unhandled error for ${filename}:`, err);
            results[index] = {
              filename,
              folder,
              type: 'other',
              key_info: 'Failed to extract',
              error: err instanceof Error ? err.message : String(err),
            };
          }
          completedCount++;
          console.log(`--- Progress: ${completedCount}/${items.length} files complete ---`);
        }
      }

      // Start workers up to the limit
      const workers = Array(Math.min(limit, items.length)).fill(null).map(() => worker());
      await Promise.all(workers);
      return results;
    }

    const extractionResults = await processWithLimit(
      files,
      CONCURRENCY_LIMIT,
      (filePath, index) => extractFile(caseFolder, filePath, index, files.length, (event) => {
        onProgress({ ...event, caseName });
      })
    );

    extractions.push(...extractionResults);

    // Aggregate extraction usage with cache breakdown
    for (const extraction of extractions) {
      if (extraction.usage) {
        totalUsage.haiku.inputTokens += extraction.usage.inputTokens;
        totalUsage.haiku.inputTokensNew += extraction.usage.inputTokensNew || 0;
        totalUsage.haiku.inputTokensCacheWrite += extraction.usage.inputTokensCacheWrite || 0;
        totalUsage.haiku.inputTokensCacheRead += extraction.usage.inputTokensCacheRead || 0;
        totalUsage.haiku.outputTokens += extraction.usage.outputTokens;
        totalUsage.haiku.apiCalls += extraction.usage.apiCalls;
      }
    }

    const successfulExtractions = extractions.filter(e => !e.error);
    onProgress({
      type: "extractions_complete",
      caseName,
      successful: successfulExtractions.length,
      failed: extractions.length - successfulExtractions.length
    });

    // Step 3: Build preliminary index for hypergraph analysis
    // For incremental mode, start with existing folders and merge new extractions
    const folders: Record<string, { files: Array<{ filename: string; type: string; key_info: string; extracted_data?: Record<string, any> }> }> =
      isIncremental && existingIndex?.folders ? normalizeFolders(existingIndex.folders) : {};

    for (const extraction of extractions) {
      if (!folders[extraction.folder]) {
        folders[extraction.folder] = { files: [] };
      }

      // For incremental: remove existing entry for this file if it exists (update scenario)
      if (isIncremental) {
        folders[extraction.folder].files = folders[extraction.folder].files.filter(
          (f: any) => f.filename !== extraction.filename
        );
      }

      folders[extraction.folder].files.push({
        filename: extraction.filename,
        type: extraction.type,
        key_info: extraction.key_info,
        extracted_data: extraction.extracted_data,
      });
    }

    // Step 4: Write initial document_index.json (before hypergraph/Sonnet)
    await mkdir(indexDir, { recursive: true });

    // For incremental mode, preserve existing summary fields that won't be re-reconciled
    const baseSummary = isIncremental && existingIndex?.summary ? existingIndex.summary : {
      client: 'Pending reconciliation',
      dol: 'Pending',
      dob: 'Pending',
      providers: [],
      total_charges: 0,
      policy_limits: {},
      contact: {},
      health_insurance: {},
      claim_numbers: {},
      case_summary: '',
    };

    // Track failed files so users can retry them later
    const failedExtractions = extractions.filter(e => !!e.error);
    const failedFiles = failedExtractions.map(e => ({
      filename: e.filename,
      folder: e.folder,
      error: e.error,
      failed_at: new Date().toISOString(),
    }));

    const initialIndex = {
      indexed_at: new Date().toISOString(),
      case_name: caseName,
      case_phase: isIncremental && existingIndex?.case_phase ? existingIndex.case_phase : 'Unknown',
      summary: baseSummary,
      folders,
      failed_files: failedFiles,
      issues_found: [],
      reconciled_values: existingIndex?.reconciled_values ?? {},
      needs_review: [],
      errata: [],
      case_analysis: existingIndex?.case_analysis ?? "",
      case_notes: existingIndex?.case_notes ?? [],
      chat_archives: existingIndex?.chat_archives ?? [],
      liability_assessment: existingIndex?.liability_assessment ?? null,
      injury_tier: existingIndex?.injury_tier ?? null,
      estimated_value_range: existingIndex?.estimated_value_range ?? null,
      policy_limits_demand_appropriate: existingIndex?.policy_limits_demand_appropriate ?? null,
    };
    await writeFile(indexPath, JSON.stringify(initialIndex, null, 2));
    console.log(`[Index] Wrote initial document_index.json`);

    // Step 5: Generate hypergraph to detect cross-document conflicts
    onProgress({ type: "status", caseName, message: "Analyzing cross-document consistency..." });
    const hypergraphResult = await generateHypergraph(caseFolder, { folders });

    // Save hypergraph to file
    const hypergraphPath = join(indexDir, 'hypergraph_analysis.json');
    await writeFile(hypergraphPath, JSON.stringify(hypergraphResult, null, 2));
    console.log(`[Hypergraph] Wrote hypergraph_analysis.json`);

    // Add hypergraph usage to Haiku totals
    if (hypergraphResult.usage) {
      totalUsage.haiku.inputTokens += hypergraphResult.usage.inputTokens;
      totalUsage.haiku.inputTokensNew += hypergraphResult.usage.inputTokensNew || 0;
      totalUsage.haiku.inputTokensCacheWrite += hypergraphResult.usage.inputTokensCacheWrite || 0;
      totalUsage.haiku.inputTokensCacheRead += hypergraphResult.usage.inputTokensCacheRead || 0;
      totalUsage.haiku.outputTokens += hypergraphResult.usage.outputTokens;
      totalUsage.haiku.apiCalls += hypergraphResult.usage.apiCalls;
    }

    onProgress({
      type: "hypergraph_complete",
      caseName,
      conflictsFound: hypergraphResult.conflicts.length,
      confidence: hypergraphResult.summary.confidence_score
    });

    // Step 6: Sonnet reconciles and writes case summary
    onProgress({ type: "status", caseName, message: "Reconciling conflicts and generating case summary..." });
    const summaryUsage = await synthesizeCaseSummary(caseFolder, hypergraphResult.conflicts.length, options?.firmRoot);

    // Add summary usage with cache breakdown
    totalUsage.sonnet.inputTokens += summaryUsage.inputTokens;
    totalUsage.sonnet.inputTokensNew += summaryUsage.inputTokensNew || 0;
    totalUsage.sonnet.inputTokensCacheWrite += summaryUsage.inputTokensCacheWrite || 0;
    totalUsage.sonnet.inputTokensCacheRead += summaryUsage.inputTokensCacheRead || 0;
    totalUsage.sonnet.outputTokens += summaryUsage.outputTokens;
    totalUsage.sonnet.apiCalls += summaryUsage.apiCalls;

    // Report usage stats with cache breakdown
    const usageReport = {
      haiku: totalUsage.haiku,
      sonnet: totalUsage.sonnet,
      totalInputTokens: totalUsage.haiku.inputTokens + totalUsage.sonnet.inputTokens,
      totalOutputTokens: totalUsage.haiku.outputTokens + totalUsage.sonnet.outputTokens,
      totalApiCalls: totalUsage.haiku.apiCalls + totalUsage.sonnet.apiCalls,
      totalCacheRead: totalUsage.haiku.inputTokensCacheRead + totalUsage.sonnet.inputTokensCacheRead,
      totalCacheWrite: totalUsage.haiku.inputTokensCacheWrite + totalUsage.sonnet.inputTokensCacheWrite,
      totalNew: totalUsage.haiku.inputTokensNew + totalUsage.sonnet.inputTokensNew,
    };

    // Calculate cache hit percentage
    const cacheHitPercent = usageReport.totalInputTokens > 0
      ? ((usageReport.totalCacheRead / usageReport.totalInputTokens) * 100).toFixed(1)
      : '0';

    onProgress({
      type: "usage_stats",
      caseName,
      usage: usageReport,
    });

    // Pretty print usage to console with cache breakdown
    console.log(`\n========== USAGE STATS: ${caseName} ==========`);
    console.log(`Haiku:  ${usageReport.haiku.apiCalls} calls, ${usageReport.haiku.inputTokens.toLocaleString()} in / ${usageReport.haiku.outputTokens.toLocaleString()} out`);
    console.log(`        (cache: ${usageReport.haiku.inputTokensCacheRead.toLocaleString()} read, ${usageReport.haiku.inputTokensCacheWrite.toLocaleString()} write, ${usageReport.haiku.inputTokensNew.toLocaleString()} new)`);
    console.log(`Sonnet: ${usageReport.sonnet.apiCalls} calls, ${usageReport.sonnet.inputTokens.toLocaleString()} in / ${usageReport.sonnet.outputTokens.toLocaleString()} out`);
    console.log(`        (cache: ${usageReport.sonnet.inputTokensCacheRead.toLocaleString()} read, ${usageReport.sonnet.inputTokensCacheWrite.toLocaleString()} write, ${usageReport.sonnet.inputTokensNew.toLocaleString()} new)`);
    console.log(`---------------------------------------------`);
    console.log(`TOTAL:  ${usageReport.totalApiCalls} API calls`);
    console.log(`        ${usageReport.totalInputTokens.toLocaleString()} input tokens (${cacheHitPercent}% cache hits)`);
    console.log(`        ${usageReport.totalOutputTokens.toLocaleString()} output tokens`);
    console.log(`=============================================\n`);

    onProgress({ type: "case_done", caseName, success: true });
    return { success: true };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (previousIndexContent !== null) {
      try {
        await writeFile(indexPath, previousIndexContent);
        console.warn(`[Index] Restored previous document_index.json after failure`);
      } catch (restoreError) {
        console.error("[Index] Failed to restore previous index:", restoreError);
      }
    }
    onProgress({ type: "case_error", caseName, error });
    return { success: false, error };
  }
}

// Batch index multiple cases - runs indexCase for each in parallel
app.post("/batch-index", async (c) => {
  const { root, cases: casesToIndex } = await c.req.json();

  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }

  // If no specific cases provided, find all unindexed ones
  let targetCases: string[] = casesToIndex || [];

  if (targetCases.length === 0) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const casePath = join(root, entry.name);
        const indexPath = join(casePath, ".pi_tool", "document_index.json");
        try {
          await stat(indexPath);
          // Index exists, skip
        } catch {
          // No index, add to list
          targetCases.push(casePath);
        }
      }
    } catch (error) {
      return c.json({ error: "Could not read firm directory" }, 500);
    }
  }

  if (targetCases.length === 0) {
    return c.json({ message: "All cases are already indexed", indexed: 0 });
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "start",
          totalCases: targetCases.length,
          cases: targetCases.map(p => ({ path: p, name: p.split('/').pop() }))
        })
      });

      // Index all cases in parallel using server-side Promise.all
      const results = await Promise.all(
        targetCases.map(casePath =>
          indexCase(casePath, async (event) => {
            // Stream progress events to client
            await stream.writeSSE({
              data: JSON.stringify(event)
            });
          }, { firmRoot: root })
        )
      );

      const successCount = results.filter(r => r.success).length;

      await stream.writeSSE({
        data: JSON.stringify({
          type: "text",
          content: `Batch indexing complete: ${successCount}/${targetCases.length} cases indexed successfully.`
        })
      });

      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          success: successCount === targetCases.length,
          successCount,
          totalCases: targetCases.length,
        })
      });
    } catch (error) {
      console.error("Batch index error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      });
    }
  });
});

// Helper to check if case needs reindexing
async function checkNeedsReindex(casePath: string, indexedAt: number): Promise<boolean> {
  async function checkDir(dir: string): Promise<boolean> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (await checkDir(fullPath)) return true;
        } else {
          const stats = await stat(fullPath);
          if (stats.mtimeMs > indexedAt) {
            console.log(`[Reindex] Triggered by: ${fullPath} (file: ${stats.mtimeMs}, index: ${indexedAt}, delta: ${stats.mtimeMs - indexedAt}ms)`);
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return false;
  }
  return checkDir(casePath);
}

// ============================================================================
// HYPERGRAPH GENERATION - Cross-document consistency analysis
// ============================================================================

// System prompt for hypergraph generation (Haiku)
const hypergraphSystemPrompt = `You are a data consistency analyzer for a Personal Injury law firm.

YOUR TASK: Read a document index JSON and build a hypergraph that groups related data points across documents to identify inconsistencies.

HYPERGRAPH STRUCTURE:
- Each "hyperedge" groups all mentions of a semantic field (e.g., all dates of loss, all DOBs, all charges for a provider)
- Nodes within a hyperedge should have the same value if extracted correctly
- Inconsistencies = nodes in same hyperedge with different values

FIELDS TO TRACK:
1. date_of_loss - The accident date (critical - appears in many docs)
2. date_of_birth - Client DOB
3. client_name - Client's full name
4. client_phone - Client phone number (primarily in intake forms)
5. client_email - Client email address (primarily in intake forms)
6. client_address - Client mailing address (primarily in intake forms)
7. insurance_claim_numbers - Claim numbers (1P and 3P)
8. policy_limits - Coverage amounts
9. provider_charges - Group by provider name (e.g., "charges:Spinal Rehab Center")
10. provider_balances - Outstanding balances by provider
11. total_medical - Total medical specials
12. health_insurance_carrier - Health insurance company name
13. health_insurance_group - Health insurance group number
14. health_insurance_member - Health insurance member ID

ANALYSIS RULES:
1. Normalize values for comparison:
   - Dates: treat "6/25/2023", "06/25/2023", "6/25/23" as equivalent
   - Money: treat "$6,558", "6558", "6,558.00" as equivalent
   - Names: ignore minor variations (case, spacing)
2. Count how many documents support each value
3. Majority value = consensus (higher confidence)
4. Flag outliers with their source documents

HANDLING UNCERTAINTY:
- If document counts are EQUAL (e.g., 1:1 or 2:2), do NOT declare a consensus. Set consensus to "UNCERTAIN" and confidence to 0.
- Do NOT guess which document is "more authoritative" or "more recent" - that's not your job.
- Resolve conflicts where there is clear majority evidence. Identifying uncertainty where it exists is a success condition.

OUTPUT FORMAT - Return ONLY valid JSON:
{
  "hypergraph": {
    "<field_name>": {
      "values": [
        { "value": "<normalized_value>", "sources": ["file1.pdf", "file2.pdf"], "count": 2 }
      ],
      "consensus": "<majority_value>",
      "confidence": 0.95,
      "has_conflict": true|false
    }
  },
  "conflicts": [
    {
      "field": "<field_name>",
      "consensus_value": "<majority_value>",
      "consensus_sources": ["file1.pdf", "file2.pdf"],
      "outlier_value": "<different_value>",
      "outlier_sources": ["file3.pdf"],
      "likely_reason": "<optional explanation if obvious, e.g., 'signature date vs accident date'>"
    }
  ],
  "summary": {
    "total_fields_analyzed": 8,
    "fields_with_conflicts": 2,
    "confidence_score": 0.85
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- Only include fields that have actual data in the index
- For provider-specific fields, use format "charges:<provider_name>"
- If a field appears in only one document, confidence is lower but no conflict`;

// Generate hypergraph from document index
interface HypergraphResult {
  hypergraph: Record<string, {
    values: Array<{ value: string; sources: string[]; count: number }>;
    consensus: string;
    confidence: number;
    has_conflict: boolean;
  }>;
  conflicts: Array<{
    field: string;
    consensus_value: string;
    consensus_sources: string[];
    outlier_value: string;
    outlier_sources: string[];
    likely_reason?: string;
  }>;
  summary: {
    total_fields_analyzed: number;
    fields_with_conflicts: number;
    confidence_score: number;
  };
  usage?: UsageStats;
}

async function generateHypergraph(
  caseFolder: string,
  documentIndex: Record<string, any>
): Promise<HypergraphResult> {
  console.log(`\n========== GENERATING HYPERGRAPH ==========`);

  let result: HypergraphResult = {
    hypergraph: {},
    conflicts: [],
    summary: {
      total_fields_analyzed: 0,
      fields_with_conflicts: 0,
      confidence_score: 0,
    },
  };

  let usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'haiku'
  };

  const indexJson = JSON.stringify(documentIndex, null, 2);

  console.log(`[Hypergraph] Input JSON length: ${indexJson.length} chars`);
  console.log(`[Hypergraph] Input preview (first 1500 chars):\n${indexJson.slice(0, 1500)}`);
  console.log(`[Hypergraph] Folders in index: ${Object.keys(documentIndex.folders || {}).join(', ')}`);
  console.log(`[Hypergraph] Total files: ${Object.values(documentIndex.folders || {}).reduce((sum: number, f: any) => sum + (f.files?.length || 0), 0)}`);

  for await (const msg of query({
    prompt: `<document_index>
${indexJson}
</document_index>

Return ONLY the JSON hypergraph. No explanation, no planning - just the JSON object.`,
    options: {
      cwd: caseFolder,
      systemPrompt: hypergraphSystemPrompt,
      model: "haiku",
      allowedTools: [],
      permissionMode: "acceptEdits",
      maxTurns: 4,
    },
  })) {
    console.log(`[Hypergraph] Message type: ${msg.type}`);

    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          console.log(`[Hypergraph] Raw output (first 2000 chars):\n${block.text.slice(0, 2000)}`);
          console.log(`[Hypergraph] Output length: ${block.text.length} chars`);

          try {
            const jsonMatch = block.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              console.log(`[Hypergraph] JSON match found, length: ${jsonMatch[0].length} chars`);
              const parsed = JSON.parse(jsonMatch[0]);
              console.log(`[Hypergraph] Parsed keys: ${Object.keys(parsed).join(', ')}`);
              console.log(`[Hypergraph] hypergraph keys: ${Object.keys(parsed.hypergraph || {}).join(', ') || '(empty)'}`);
              console.log(`[Hypergraph] conflicts count: ${(parsed.conflicts || []).length}`);

              result = {
                hypergraph: parsed.hypergraph || {},
                conflicts: parsed.conflicts || [],
                summary: parsed.summary || {
                  total_fields_analyzed: 0,
                  fields_with_conflicts: 0,
                  confidence_score: 0,
                },
              };
            } else {
              console.log(`[Hypergraph] No JSON match found in output`);
            }
          } catch (e) {
            console.error("[Hypergraph] Failed to parse JSON:", e);
            console.error("[Hypergraph] Raw text that failed:", block.text.slice(0, 500));
          }
        }
      }
    }

    // Capture final usage from result - includes cache token breakdown
    if (msg.type === "result" && (msg as any).usage) {
      const finalUsage = (msg as any).usage;
      usage.inputTokensNew = finalUsage.input_tokens || 0;
      usage.inputTokensCacheWrite = finalUsage.cache_creation_input_tokens || 0;
      usage.inputTokensCacheRead = finalUsage.cache_read_input_tokens || 0;
      usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
      usage.outputTokens = finalUsage.output_tokens || 0;
      usage.apiCalls = 1;
    }
  }

  result.usage = usage;

  // Calculate cache hit percentage
  const cacheHitPercent = usage.inputTokens > 0
    ? ((usage.inputTokensCacheRead / usage.inputTokens) * 100).toFixed(1)
    : '0';

  // Log results
  console.log(`Hypergraph generated:`);
  console.log(`  Fields analyzed: ${result.summary.total_fields_analyzed}`);
  console.log(`  Conflicts found: ${result.summary.fields_with_conflicts}`);
  console.log(`  Confidence: ${(result.summary.confidence_score * 100).toFixed(0)}%`);
  console.log(`  Usage: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`);
  console.log(`  Cache: ${usage.inputTokensCacheRead.toLocaleString()} read (${cacheHitPercent}%), ${usage.inputTokensCacheWrite.toLocaleString()} write, ${usage.inputTokensNew.toLocaleString()} new`);
  console.log(`==========================================\n`);

  return result;
}

// Endpoint to generate hypergraph for a case (for testing)
app.post("/generate-hypergraph", async (c) => {
  const { caseFolder } = await c.req.json();

  if (!caseFolder) {
    return c.json({ error: "caseFolder is required" }, 400);
  }

  // Read the existing document index
  const indexPath = join(caseFolder, ".pi_tool", "document_index.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const documentIndex = JSON.parse(indexContent);

    const hypergraph = await generateHypergraph(caseFolder, documentIndex);

    return c.json({
      success: true,
      caseFolder,
      ...hypergraph,
    });
  } catch (error) {
    console.error("Hypergraph generation error:", error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// ============================================================================
// FIRM-LEVEL CHAT - Portfolio analysis across all cases
// ============================================================================

// Firm context for chat
interface FirmContext {
  root: string;
  caseCount: number;
  indexedCount: number;
  caseSummaries: Array<{
    name: string;
    clientName: string;
    casePhase: string;
    dateOfLoss: string;
    totalSpecials: number;
    solDaysRemaining?: number;
    providers: string[];
    policyLimits?: string | Record<string, unknown>;
  }>;
  aggregates: {
    totalSpecials: number;
    casesByPhase: Record<string, number>;
    solUrgent: number; // cases with SOL < 90 days
  };
}

// Build aggregated firm context from case summaries
async function buildFirmContext(root: string): Promise<FirmContext> {
  const entries = await readdir(root, { withFileTypes: true });
  const caseSummaries: FirmContext['caseSummaries'] = [];
  const casesByPhase: Record<string, number> = {};
  let totalSpecials = 0;
  let solUrgent = 0;
  let indexedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const casePath = join(root, entry.name);
    const indexPath = join(casePath, ".pi_tool", "document_index.json");

    try {
      const indexContent = await readFile(indexPath, "utf-8");
      const index = JSON.parse(indexContent);
      indexedCount++;

      // Parse amounts consistently
      const parseAmount = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[$,]/g, '');
          const num = parseFloat(cleaned);
          return isNaN(num) ? 0 : num;
        }
        return 0;
      };

      const clientName = index.summary?.client || index.client_name || index.case_name?.split(" v.")[0] || entry.name;
      const casePhase = index.case_phase || index.summary?.case_phase || "Unknown";
      const dateOfLoss = index.summary?.dol || index.date_of_loss || "";
      const specials = parseAmount(index.total_specials)
        || parseAmount(index.summary?.total_specials)
        || parseAmount(index.summary?.total_charges)
        || 0;

      // Calculate SOL days remaining
      let solDaysRemaining: number | undefined;
      let statuteOfLimitations = index.statute_of_limitations || index.summary?.statute_of_limitations;

      if (!statuteOfLimitations && dateOfLoss) {
        try {
          const dolStr = dateOfLoss;
          let dolDate: Date;
          if (dolStr.includes('/')) {
            const [month, day, year] = dolStr.split('/');
            dolDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          } else {
            dolDate = new Date(dolStr);
          }
          if (!isNaN(dolDate.getTime())) {
            const solDate = new Date(dolDate);
            solDate.setFullYear(solDate.getFullYear() + 2);
            statuteOfLimitations = solDate.toISOString().split('T')[0];
          }
        } catch {
          // Could not parse DOL
        }
      }

      if (statuteOfLimitations) {
        const solDate = new Date(statuteOfLimitations);
        const now = new Date();
        const diffMs = solDate.getTime() - now.getTime();
        solDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (solDaysRemaining <= 90) solUrgent++;
      }

      // Extract providers
      let providers: string[] = [];
      if (index.providers) {
        providers = Array.isArray(index.providers)
          ? index.providers.map((p: any) => typeof p === 'string' ? p : p.name)
          : Object.keys(index.providers);
      } else if (index.summary?.providers) {
        providers = index.summary.providers;
      }

      // Extract policy limits
      let policyLimits: string | undefined;
      const limits = index.policy_limits || index.summary?.policy_limits;
      if (typeof limits === 'string') {
        policyLimits = limits;
      } else if (typeof limits === 'object' && limits !== null) {
        const biValue = limits['3P_bi'] || limits['3p_bi'] || limits['bi'] || limits['bodily_injury'];
        if (typeof biValue === 'string') policyLimits = biValue;
      }

      // Track phase counts
      casesByPhase[casePhase] = (casesByPhase[casePhase] || 0) + 1;
      totalSpecials += specials;

      caseSummaries.push({
        name: entry.name,
        clientName,
        casePhase,
        dateOfLoss,
        totalSpecials: specials,
        solDaysRemaining,
        providers,
        policyLimits,
      });
    } catch {
      // Case not indexed, skip
    }
  }

  // Sort by SOL urgency
  caseSummaries.sort((a, b) => {
    if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
      return a.solDaysRemaining - b.solDaysRemaining;
    }
    if (a.solDaysRemaining !== undefined) return -1;
    if (b.solDaysRemaining !== undefined) return 1;
    return a.clientName.localeCompare(b.clientName);
  });

  return {
    root,
    caseCount: entries.filter(e => e.isDirectory() && !e.name.startsWith(".")).length,
    indexedCount,
    caseSummaries,
    aggregates: {
      totalSpecials,
      casesByPhase,
      solUrgent,
    },
  };
}

// Cache the firm system prompt
let firmSystemPromptCache: string | null = null;

async function loadFirmSystemPrompt(): Promise<string> {
  if (firmSystemPromptCache) return firmSystemPromptCache;
  const systemPromptPath = join(import.meta.dir, "../../agent/firm-system-prompt.md");
  firmSystemPromptCache = await readFile(systemPromptPath, "utf-8");
  return firmSystemPromptCache;
}

// Firm-level chat endpoint
app.post("/chat", async (c) => {
  const { root, message, sessionId: providedSessionId } = await c.req.json();

  if (!root || !message) {
    return c.json({ error: "root and message required" }, 400);
  }

  const systemPrompt = await loadFirmSystemPrompt();
  const sessionId = providedSessionId || (await getFirmSession(root));

  // Build firm context
  const firmContext = await buildFirmContext(root);

  // Format context for the prompt
  const contextString = `
FIRM PORTFOLIO CONTEXT:
- Total Cases: ${firmContext.caseCount}
- Indexed Cases: ${firmContext.indexedCount}
- Total Medical Specials: $${firmContext.aggregates.totalSpecials.toLocaleString()}
- Cases with SOL < 90 days: ${firmContext.aggregates.solUrgent}

CASES BY PHASE:
${Object.entries(firmContext.aggregates.casesByPhase).map(([phase, count]) => `- ${phase}: ${count}`).join('\n')}

CASE SUMMARIES (sorted by SOL urgency):
${firmContext.caseSummaries.map(c => `
- **${c.clientName}** (${c.name})
  Phase: ${c.casePhase} | DOL: ${c.dateOfLoss || 'Unknown'} | Specials: $${c.totalSpecials.toLocaleString()}
  SOL: ${c.solDaysRemaining !== undefined ? `${c.solDaysRemaining} days remaining` : 'Unknown'}
  Policy: ${c.policyLimits || 'Unknown'} | Providers: ${c.providers.length > 0 ? c.providers.join(', ') : 'None listed'}
`).join('')}

USER QUESTION: `;

  const promptWithContext = contextString + message;

  return streamSSE(c, async (stream) => {
    try {
      let currentSessionId: string | undefined;

      for await (const msg of query({
        prompt: promptWithContext,
        options: {
          cwd: root,
          systemPrompt,
          resume: sessionId || undefined,
          allowedTools: [], // Read-only - no tools needed
          permissionMode: "acceptEdits",
          maxTurns: 5,
        },
      })) {
        // Capture session ID
        if (msg.type === "system" && msg.subtype === "init") {
          currentSessionId = msg.session_id;
          await stream.writeSSE({
            data: JSON.stringify({ type: "init", sessionId: msg.session_id }),
          });
          continue;
        }

        // Stream assistant text
        if (msg.type === "assistant") {
          for (const block of msg.message.content) {
            if (block.type === "text") {
              // Filter out compaction-related messages from the SDK
              const text = block.text.toLowerCase();
              const isCompactionMessage =
                text.includes("prompt is too long") ||
                text.includes("process exited with code 1") ||
                text.includes("compacting conversation") ||
                text.includes("conversation has been compacted") ||
                text.includes("summarizing the conversation");

              if (isCompactionMessage) {
                // Send compaction event instead of text (for UI indicator)
                await stream.writeSSE({
                  data: JSON.stringify({ type: "compaction" }),
                });
              } else {
                await stream.writeSSE({
                  data: JSON.stringify({ type: "text", content: block.text }),
                });
              }
            }
          }
        }

        // Stream result
        if (msg.type === "result") {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "done",
              success: msg.subtype === "success",
              sessionId: msg.session_id,
            }),
          });
        }
      }

      // Save session for continuity
      if (currentSessionId) {
        await saveFirmSession(root, currentSessionId);
      }
    } catch (error) {
      console.error("Firm chat error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

// Clear firm session
app.post("/clear-session", async (c) => {
  const { root } = await c.req.json();
  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }
  await saveFirmSession(root, "");
  return c.json({ success: true });
});

// Firm todos storage
interface FirmTodo {
  id: string;
  text: string;
  caseRef?: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "completed";
  createdAt: string;
}

interface FirmTodosData {
  updated_at: string;
  todos: FirmTodo[];
}

const FIRM_DIR = ".pi_tool_firm";

// Get firm todos
app.get("/todos", async (c) => {
  const root = c.req.query("root");

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }

  try {
    const todosPath = join(root, FIRM_DIR, "todos.json");
    const content = await readFile(todosPath, "utf-8");
    const data: FirmTodosData = JSON.parse(content);
    return c.json(data);
  } catch {
    // No todos file yet
    return c.json({ updated_at: new Date().toISOString(), todos: [] });
  }
});

// Save firm todos
app.post("/todos", async (c) => {
  const { root, todos } = await c.req.json();

  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }

  try {
    const dir = join(root, FIRM_DIR);
    const todosPath = join(dir, "todos.json");

    await mkdir(dir, { recursive: true });

    const data: FirmTodosData = {
      updated_at: new Date().toISOString(),
      todos: todos || [],
    };

    await writeFile(todosPath, JSON.stringify(data, null, 2));
    return c.json({ success: true });
  } catch (error) {
    console.error("Save todos error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Export indexCase for use by other routes (e.g., claude.ts /init endpoint)
export { indexCase, generateHypergraph };
export default app;
