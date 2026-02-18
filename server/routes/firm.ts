import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

// SDK CLI options helper - handles both direct and npx modes
import { getSDKCliOptions } from "../lib/sdk-cli-options";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, relative, dirname } from "path";
import { migratePiTool } from "../lib/migrate-pi-tool";
import {
  detectYearBasedMode,
  loadClientRegistry,
  scanAndBuildRegistry,
  ensureRegistryFresh,
  refreshRegistry,
  resolveFirmRoot,
  getClientSlug,
  getSourceFolders,
  resolveYearFilePath,
  yearFromFolder,
  type ClientRegistry,
} from "../lib/year-mode";
import { homedir } from "os";
import { getFirmSession, saveFirmSession } from "../sessions";
import { PHASE_RULES, getPhaseRules } from "../shared/phase-rules";
import { loadPracticeGuide, loadSectionsByIds, clearKnowledgeCache } from "./knowledge";
import { extractTextFromFile } from "../lib/extract";
import { generateCaseSummary } from "../lib/case-summary";
import { mergeToIndex, diffIndexes, type HypergraphResult, type IndexDiff } from "../lib/merge-index";
import { 
  extractWithGptOss,
  extractWithVision,
  generateHypergraphWithGptOss,
  generateHypergraphConflictReviewWithGptOss,
} from "../lib/groq-extract";
import { directFirmChat, type FirmChatScope } from "../lib/firm-chat";
import { writeIndexDerivedFiles } from "../lib/meta-index";
import {
  normalizeIndex,
  validateIndex,
  FILE_EXTRACTION_TOOL_SCHEMA,
  type DocumentIndex,
} from "../lib/index-schema";
import { practiceAreaRegistry, PRACTICE_AREAS } from "../practice-areas";
import { normalizePracticeArea, resolveFirmPracticeArea } from "../lib/practice-area";
import { requireCaseAccess, requireFirmAccess } from "../lib/team-access";
import { formatDateYYYYMMDD, parseFlexibleDate } from "../lib/date-format";
import { buildDocumentId } from "../lib/document-id";

// ============================================================================
// Usage Reporting
// ============================================================================

const DEV_MODE = process.env.DEV_MODE === "true" || process.env.NODE_ENV !== "production";
const SUBSCRIPTION_SERVER = process.env.CLAUDE_PI_SERVER || "https://claude-pi-five.vercel.app";
const CONFIG_DIR = process.env.CLAUDE_PI_CONFIG_DIR || join(homedir(), ".claude-pi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface AuthConfig {
  authToken?: string;
}

function loadAuthConfig(): AuthConfig | null {
  if (process.env.CLAUDE_PI_CONFIG) {
    try {
      return JSON.parse(process.env.CLAUDE_PI_CONFIG);
    } catch {
      // Fall through
    }
  }
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Report token usage to the subscription server.
 * This is fire-and-forget - errors are logged but don't affect the main request.
 */
async function reportUsage(tokensUsed: number, requestType: string): Promise<void> {
  if (DEV_MODE) return;
  const config = loadAuthConfig();
  if (!config?.authToken) return;

  try {
    await fetch(`${SUBSCRIPTION_SERVER}/v1/usage/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify({ tokensUsed, requestType }),
    });
  } catch (err) {
    console.warn("[usage] Failed to report usage:", err);
  }
}

// Lazy client creation - API key is set by auth middleware before requests
// Web shim (imported in server/index.ts) handles runtime selection
// Client is reset periodically to prevent connection pool exhaustion
let _anthropic: Anthropic | null = null;
let _requestCount = 0;
const CLIENT_RESET_THRESHOLD = 50;

function getClient(): Anthropic {
  if (!_anthropic || _requestCount >= CLIENT_RESET_THRESHOLD) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: globalThis.fetch.bind(globalThis),
    });
    if (_requestCount >= CLIENT_RESET_THRESHOLD) {
      console.log('[api] Anthropic client reset (connection pool refresh)');
    }
    _requestCount = 0;
  }
  _requestCount++;
  return _anthropic;
}

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

// JSON Schema for structured synthesis output (used with direct API call)
// PI-specific schema
const SYNTHESIS_SCHEMA_PI = {
  type: "object" as const,
  properties: {
    needs_review: {
      type: "array" as const,
      description: "Fields requiring human review due to conflicts or uncertainty",
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const, description: "Field name or path (e.g., 'charges:Provider Name')" },
          conflicting_values: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "The different values found"
          },
          sources: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Source documents for each value"
          },
          reason: { type: "string" as const, description: "Why this requires human review" }
        },
        required: ["field", "conflicting_values", "sources", "reason"] as const
      }
    },
    errata: {
      type: "array" as const,
      description: "Documentation of decisions made during synthesis",
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const, description: "Field that was resolved" },
          decision: { type: "string" as const, description: "Value chosen" },
          evidence: { type: "string" as const, description: "What the extractions showed" },
          confidence: { type: "string" as const, enum: ["high", "medium", "low"] }
        },
        required: ["field", "decision", "evidence", "confidence"] as const
      }
    },
    case_analysis: {
      type: "string" as const,
      description: "Substantive case analysis: liability assessment, injury tier, value estimate, treatment patterns, next steps"
    },
    liability_assessment: {
      type: "string" as const,
      enum: ["clear", "moderate", "contested"],
      description: "Overall liability strength"
    },
    injury_tier: {
      type: "string" as const,
      enum: ["tier_1_soft_tissue", "tier_2_structural", "tier_3_surgical"],
      description: "Injury severity tier based on treatment and findings"
    },
    estimated_value_range: {
      type: "string" as const,
      description: "Value range in format '$X - $Y' based on specials and multiplier"
    },
    policy_limits_demand_appropriate: {
      type: "boolean" as const,
      description: "Whether a policy limits demand is appropriate"
    },
    summary: {
      type: "object" as const,
      description: "Case summary fields",
      properties: {
        client: { type: "string" as const, description: "Client's full name" },
        dol: { type: "string" as const, description: "Date of loss (MM-DD-YYYY preferred, or YYYY-MM-DD)" },
        dob: { type: "string" as const, description: "Client's date of birth" },
        providers: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "List of medical provider names"
        },
        total_charges: { type: "number" as const, description: "Total medical charges in dollars" },
        policy_limits: {
          type: "object" as const,
          description: "Policy limits by party (1P, 3P)",
          additionalProperties: true
        },
        contact: {
          type: "object" as const,
          properties: {
            phone: { type: "string" as const },
            email: { type: "string" as const },
            address: {
              type: "object" as const,
              properties: {
                street: { type: "string" as const },
                city: { type: "string" as const },
                state: { type: "string" as const },
                zip: { type: "string" as const }
              }
            }
          }
        },
        health_insurance: {
          type: "object" as const,
          properties: {
            carrier: { type: "string" as const },
            group_no: { type: "string" as const },
            member_no: { type: "string" as const }
          }
        },
        claim_numbers: {
          type: "object" as const,
          description: "Claim numbers keyed by party (e.g., '1P_AAA', '3P_Progressive')",
          additionalProperties: { type: "string" as const }
        },
        case_summary: { type: "string" as const, description: "Brief narrative summary of the case" }
      },
      required: ["client", "dol", "providers", "total_charges"] as const
    },
    case_name: {
      type: "string" as const,
      description: "Case name (typically 'LASTNAME, Firstname')"
    },
    case_phase: {
      type: "string" as const,
      enum: ["Intake", "Investigation", "Treatment", "Demand", "Negotiation", "Settlement", "Complete"],
      description: "Current phase of the case"
    }
  },
  required: [
    "needs_review",
    "errata",
    "case_analysis",
    "liability_assessment",
    "injury_tier",
    "estimated_value_range",
    "policy_limits_demand_appropriate",
    "summary",
    "case_name",
    "case_phase"
  ] as const
};

// WC-specific schema for synthesis
const SYNTHESIS_SCHEMA_WC = {
  type: "object" as const,
  properties: {
    // Shared fields (same structure as PI)
    needs_review: {
      type: "array" as const,
      description: "Fields requiring human review due to conflicts or uncertainty",
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const, description: "Field name or path (e.g., 'charges:Provider Name')" },
          conflicting_values: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "The different values found"
          },
          sources: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Source documents for each value"
          },
          reason: { type: "string" as const, description: "Why this requires human review" }
        },
        required: ["field", "conflicting_values", "sources", "reason"] as const
      }
    },
    errata: {
      type: "array" as const,
      description: "Documentation of decisions made during synthesis",
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const, description: "Field that was resolved" },
          decision: { type: "string" as const, description: "Value chosen" },
          evidence: { type: "string" as const, description: "What the extractions showed" },
          confidence: { type: "string" as const, enum: ["high", "medium", "low"] }
        },
        required: ["field", "decision", "evidence", "confidence"] as const
      }
    },
    case_analysis: {
      type: "string" as const,
      description: "Substantive WC case analysis: compensability assessment, injury classification, benefits calculation, treatment status, next steps"
    },
    // WC-specific assessment fields
    compensability: {
      type: "string" as const,
      enum: ["clearly_compensable", "likely_compensable", "disputed", "denied"],
      description: "Compensability status of the claim based on AOE/COE analysis"
    },
    claim_type: {
      type: "string" as const,
      enum: ["specific_injury", "occupational_disease", "cumulative_trauma"],
      description: "Type of workers' compensation claim"
    },
    estimated_ttd_weeks: {
      type: "number" as const,
      description: "Estimated weeks of Temporary Total Disability benefits"
    },
    estimated_ppd_rating: {
      type: "number" as const,
      description: "Estimated Permanent Partial Disability rating percentage"
    },
    third_party_potential: {
      type: "boolean" as const,
      description: "Whether there is potential for a third-party liability claim"
    },
    open_hearings: {
      type: "array" as const,
      description: "Open hearing matters with case numbers and hearing level",
      items: {
        type: "object" as const,
        properties: {
          case_number: { type: "string" as const, description: "Hearing/docket case number (e.g., D-16-12345)" },
          hearing_level: {
            type: "string" as const,
            enum: ["H.O.", "A.O."],
            description: "H.O. (Hearing Officer, default) or A.O. (Appeals Officer, if any A.O. documents exist)"
          },
          next_date: { type: "string" as const, description: "Next hearing date if known" },
          issue: { type: "string" as const, description: "Issue(s) in dispute" }
        },
        required: ["case_number", "hearing_level"] as const
      }
    },
    // WC summary structure
    summary: {
      type: "object" as const,
      description: "Case summary fields for Workers' Compensation",
      properties: {
        client: { type: "string" as const, description: "Client's full name" },
        doi: { type: "string" as const, description: "Date of injury (MM-DD-YYYY preferred, or YYYY-MM-DD)" },
        dob: { type: "string" as const, description: "Client's date of birth" },
        providers: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "List of medical provider names"
        },
        total_charges: { type: "number" as const, description: "Total medical charges in dollars" },
        contact: {
          type: "object" as const,
          properties: {
            phone: { type: "string" as const },
            email: { type: "string" as const },
            address: {
              type: "object" as const,
              properties: {
                street: { type: "string" as const },
                city: { type: "string" as const },
                state: { type: "string" as const },
                zip: { type: "string" as const }
              }
            }
          }
        },
        health_insurance: {
          type: "object" as const,
          properties: {
            carrier: { type: "string" as const },
            group_no: { type: "string" as const },
            member_no: { type: "string" as const }
          }
        },
        case_summary: { type: "string" as const, description: "Brief narrative summary of the case" },
        // WC-specific summary fields
        employer: {
          type: "object" as const,
          description: "Employer information",
          properties: {
            name: { type: "string" as const, description: "Employer company name" },
            address: {
              type: "object" as const,
              properties: {
                street: { type: "string" as const },
                city: { type: "string" as const },
                state: { type: "string" as const },
                zip: { type: "string" as const }
              }
            },
            phone: { type: "string" as const }
          },
          required: ["name"] as const
        },
        wc_carrier: {
          type: "object" as const,
          description: "Workers' compensation insurance carrier information",
          properties: {
            name: { type: "string" as const, description: "Insurance carrier name" },
            claim_number: { type: "string" as const, description: "WC claim number" },
            adjuster_name: { type: "string" as const },
            adjuster_phone: { type: "string" as const },
            tpa_name: { type: "string" as const, description: "Third Party Administrator name if applicable" }
          }
        },
        disability_status: {
          type: "object" as const,
          description: "Current disability status and benefits information",
          properties: {
            type: {
              type: "string" as const,
              enum: ["TTD", "TPD", "PPD", "PTD"],
              description: "Type of disability (Temporary Total, Temporary Partial, Permanent Partial, Permanent Total)"
            },
            amw: { type: "number" as const, description: "Average Monthly Wage in dollars" },
            compensation_rate: { type: "number" as const, description: "Weekly compensation rate in dollars" },
            mmi_date: { type: "string" as const, description: "Maximum Medical Improvement date" },
            ppd_rating: { type: "number" as const, description: "Permanent Partial Disability rating percentage" }
          }
        },
        job_title: { type: "string" as const, description: "Client's job title at time of injury" },
        injury_description: { type: "string" as const, description: "Description of the work injury" },
        body_parts: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "List of affected body parts"
        }
      },
      required: ["client", "doi", "providers", "total_charges", "employer"] as const
    },
    case_name: {
      type: "string" as const,
      description: "Case name (typically 'LASTNAME, Firstname')"
    },
    case_phase: {
      type: "string" as const,
      enum: ["Intake", "Investigation", "Treatment", "MMI Evaluation", "Benefits Resolution", "Settlement/Hearing", "Closed"],
      description: "Current phase of the Workers' Compensation case"
    }
  },
  required: [
    "needs_review",
    "errata",
    "case_analysis",
    "compensability",
    "summary",
    "case_name",
    "case_phase"
  ] as const
};

/**
 * Get the appropriate synthesis schema based on practice area.
 */
function getSynthesisSchema(practiceArea?: string) {
  if (practiceArea === PRACTICE_AREAS.WC) {
    return SYNTHESIS_SCHEMA_WC;
  }
  return SYNTHESIS_SCHEMA_PI;
}

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
  // Linked case fields
  isSubcase?: boolean;
  parentPath?: string;
  parentName?: string;
  practiceArea?: string;
  // WC-specific fields
  employer?: string;
  ttdStatus?: string;
  amw?: number;
  compensationRate?: number;
  openHearings?: Array<{ case_number: string; hearing_level: string; next_date?: string; issue?: string }>;
  // Team assignments
  assignments?: Array<{ userId: string; assignedAt: string; assignedBy: string }>;
  // DOI container fields (for WC multi-injury clients)
  isContainer?: boolean;          // True for client containers (not a case itself)
  containerPath?: string;         // Path to container (for DOI cases)
  containerName?: string;         // Container display name
  siblingCases?: Array<{ path: string; name: string; dateOfInjury: string }>;
  injuryDate?: string;            // Parsed from DOI folder name (YYYY-MM-DD)
  fileCount?: number;             // Total document files in case folder
  latestYear?: number;            // Most recent year folder containing this client
}

// Helper to parse amount values (handles both number and string formats like "$24,419.90")
function parseAmount(val: any): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

// Helper to build a CaseSummary from a case folder path
async function buildCaseSummary(
  casePath: string,
  caseName: string,
  options?: {
    subcaseInfo?: { parentPath: string; parentName: string };
    practiceArea?: string;
    yearRegistry?: { firmRoot: string; registry: ClientRegistry; slug: string };
  }
): Promise<CaseSummary> {
  const indexPath = join(casePath, ".ai_tool", "document_index.json");
  const configuredPracticeArea = normalizePracticeArea(options?.practiceArea);

  const caseSummary: CaseSummary = {
    path: casePath,
    name: caseName,
    indexed: false,
    practiceArea: configuredPracticeArea,
    isSubcase: !!options?.subcaseInfo,
    parentPath: options?.subcaseInfo?.parentPath,
    parentName: options?.subcaseInfo?.parentName,
  };

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);
    const indexStats = await stat(indexPath);

    caseSummary.indexed = true;
    caseSummary.indexedAt = indexStats.mtime.toISOString();

    // Extract from index - handle various formats
    caseSummary.clientName = index.summary?.client || index.client_name || index.summary?.client_name || index.case_name?.split(" v.")[0] || caseName;
    caseSummary.casePhase = index.case_phase || index.summary?.case_phase || "Unknown";
    // Check incident_date (canonical field), dol (PI legacy), and date_of_loss variants
    caseSummary.dateOfLoss = index.summary?.incident_date || index.summary?.dol || index.date_of_loss || index.summary?.date_of_loss || index.dol;
    caseSummary.policyLimits = index.policy_limits || index.summary?.policy_limits || index["3p_policy_limits"];

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
      const dolDate = parseFlexibleDate(caseSummary.dateOfLoss);
      if (dolDate) {
        const solDate = new Date(dolDate);
        solDate.setFullYear(solDate.getFullYear() + 2);
        caseSummary.statuteOfLimitations = formatDateYYYYMMDD(solDate);
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

    // Practice area - prefer folder setting, fallback to existing case index metadata
    const indexPracticeArea = normalizePracticeArea(index.practice_area || index.practiceArea);
    caseSummary.practiceArea = configuredPracticeArea || indexPracticeArea;

    const isWC = caseSummary.practiceArea === PRACTICE_AREAS.WC;

    // WC-specific fields
    if (isWC) {
      // Employer
      caseSummary.employer = index.summary?.employer?.name || index.summary?.employer;

      // TTD Status
      caseSummary.ttdStatus = index.summary?.disability_status?.type || index.ttd_status;

      // AMW and compensation rate (accept both amw and legacy aww)
      caseSummary.amw = parseAmount(index.summary?.disability_status?.amw)
        || parseAmount(index.summary?.disability_status?.aww)
        || parseAmount(index.amw);
      caseSummary.compensationRate = parseAmount(index.summary?.disability_status?.compensation_rate) || parseAmount(index.compensation_rate);

      // Open hearings (normalize legacy type→hearing_level)
      if (Array.isArray(index.open_hearings)) {
        caseSummary.openHearings = index.open_hearings.map((h: any) => ({
          case_number: h.case_number,
          hearing_level: h.hearing_level || (h.type === "A.O." ? "A.O." : "H.O."),
          next_date: h.next_date,
          issue: h.issue,
        }));
      }
    }

    // Team assignments
    if (Array.isArray(index.assignments)) {
      caseSummary.assignments = index.assignments;
    }

    // Check if needs reindex — skip for year-based dashboard loads (expensive)
    if (!options?.yearRegistry) {
      caseSummary.needsReindex = await checkNeedsReindex(casePath, indexStats.mtimeMs);
    }

  } catch {
    // No index found - case exists but not indexed
    caseSummary.indexed = false;
  }

  // File count — use registry if available, otherwise walk
  try {
    if (options?.yearRegistry) {
      const entry = options.yearRegistry.registry.clients[options.yearRegistry.slug];
      caseSummary.fileCount = entry?.fileCount ?? 0;
    } else {
      let count = 0;
      async function countFiles(dir: string) {
        let entries: Awaited<ReturnType<typeof readdir>>;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name === '.ai_tool' || e.name.startsWith('.')) continue;
          if (e.isDirectory()) await countFiles(join(dir, e.name));
          else count++;
        }
      }
      await countFiles(casePath);
      caseSummary.fileCount = count;
    }
  } catch { /* ignore */ }

  return caseSummary;
}

// Discover subcases and build their summaries
async function discoverAndBuildSubcases(
  parentPath: string,
  parentName: string,
  practiceArea?: string
): Promise<CaseSummary[]> {
  const subcasePaths = await discoverSubcases(parentPath);

  return Promise.all(
    subcasePaths.map(subcasePath => {
      const subcaseName = subcasePath.split('/').pop() || subcasePath;
      return buildCaseSummary(subcasePath, subcaseName, {
        subcaseInfo: { parentPath, parentName },
        practiceArea,
      });
    })
  );
}

/**
 * Build a container summary for a client folder with DOI subfolders.
 * Containers are not cases themselves - they're grouping headers.
 */
function buildContainerSummary(
  containerPath: string,
  containerName: string,
  doiCases: Array<{ path: string; name: string; dateOfInjury: string }>
): CaseSummary {
  return {
    path: containerPath,
    name: containerName,
    clientName: containerName,
    indexed: false, // Containers are never "indexed" as cases
    isContainer: true,
    siblingCases: doiCases,
  };
}

/**
 * Build a DOI case summary with container and sibling information.
 */
async function buildDOICaseSummary(
  doiCase: { path: string; name: string; dateOfInjury: string },
  containerPath: string,
  containerName: string,
  allSiblings: Array<{ path: string; name: string; dateOfInjury: string }>,
  practiceArea?: string
): Promise<CaseSummary> {
  const summary = await buildCaseSummary(doiCase.path, doiCase.name, { practiceArea });

  // Add DOI-specific fields
  summary.containerPath = containerPath;
  summary.containerName = containerName;
  summary.injuryDate = doiCase.dateOfInjury;

  // Add sibling cases (excluding self)
  summary.siblingCases = allSiblings.filter(s => s.path !== doiCase.path);

  // Override client name to be clearer (include injury date context)
  if (!summary.clientName || summary.clientName === doiCase.name) {
    summary.clientName = containerName;
  }

  return summary;
}

// Get all cases in a firm's root folder
app.get("/cases", async (c) => {
  const root = c.req.query("root");
  const requestedPracticeArea = c.req.query("practiceArea"); // Backward compatibility

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  // Migrate .pi_tool → .ai_tool at firm root if needed
  await migratePiTool(root);

  const configuredPracticeArea = await resolveFirmPracticeArea(root);
  const practiceArea =
    configuredPracticeArea ||
    normalizePracticeArea(requestedPracticeArea) ||
    PRACTICE_AREAS.PI;
  const isWC = practiceArea === PRACTICE_AREAS.WC;

  try {
    // Check for year-based folder structure (2024/, 2025/, etc.)
    const yearMode = await detectYearBasedMode(root);
    if (yearMode) {
      let registry = await loadClientRegistry(root);
      if (!registry) {
        registry = await scanAndBuildRegistry(root);
      } else {
        // Lightweight check: pick up new clients in current year + any new year folders
        registry = await ensureRegistryFresh(root, registry);
      }

      // Build CaseSummary[] from virtual case folders — pass registry to avoid per-client I/O
      const cases = await Promise.all(
        Object.values(registry.clients).map(async (client) => {
          const virtualPath = join(root, ".ai_tool", "clients", client.slug);
          const summary = await buildCaseSummary(virtualPath, client.name, {
            practiceArea,
            yearRegistry: { firmRoot: root, registry, slug: client.slug },
          });
          // Compute latest year from source folders
          const years = client.sourceFolders
            .map((sf) => yearFromFolder(sf.split("/")[0]))
            .filter((y): y is number => y !== null);
          summary.latestYear = years.length > 0 ? Math.max(...years) : undefined;
          return summary;
        })
      );

      // Sort: indexed first, then alphabetically
      cases.sort((a, b) => {
        if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const indexedCount = cases.filter((c) => c.indexed).length;

      return c.json({
        root,
        practiceArea,
        yearBasedMode: true,
        cases,
        summary: {
          total: cases.length,
          indexed: indexedCount,
          needsAttention: 0,
        },
      });
    }

    const entries = await readdir(root, { withFileTypes: true });

    // Process all case directories in parallel for speed
    const casePromises = entries
      .filter(entry => entry.isDirectory() && entry.name !== ".ai_tool" && entry.name !== ".ai_tool")
      .map(async (entry) => {
        const casePath = join(root, entry.name);
        const results: CaseSummary[] = [];

        // For WC practice area, check for DOI subfolders
        if (isWC) {
          const doiDetection = await detectDOISubfolders(casePath);

          if (doiDetection.isContainer) {
            const containerSummary = buildContainerSummary(
              casePath,
              entry.name,
              doiDetection.doiCases
            );
            results.push(containerSummary);

            // Process DOI subfolder summaries in parallel
            const doiSummaries = await Promise.all(
              doiDetection.doiCases.map(doiCase =>
                buildDOICaseSummary(doiCase, casePath, entry.name, doiDetection.doiCases, practiceArea)
              )
            );
            results.push(...doiSummaries);
            return results;
          }
        }

        // Regular case (non-container)
        const [caseSummary, subcases] = await Promise.all([
          buildCaseSummary(casePath, entry.name, { practiceArea }),
          discoverAndBuildSubcases(casePath, entry.name, practiceArea),
        ]);
        results.push(caseSummary, ...subcases);
        return results;
      });

    const caseArrays = await Promise.all(casePromises);
    const cases = caseArrays.flat();

    // Sort cases with special handling for containers and DOI cases
    // Containers and their DOI cases should stay together
    const topLevelCases = cases.filter(c => !c.isSubcase && !c.containerPath);
    topLevelCases.sort((a, b) => {
      // Containers and indexed cases before unindexed regular cases
      if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
      if (!a.isContainer && !b.isContainer) {
        if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
      }
      // Then by SOL urgency (for non-containers)
      if (!a.isContainer && !b.isContainer) {
        if (a.solDaysRemaining !== undefined && b.solDaysRemaining !== undefined) {
          return a.solDaysRemaining - b.solDaysRemaining;
        }
        if (a.solDaysRemaining !== undefined) return -1;
        if (b.solDaysRemaining !== undefined) return 1;
      }
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });

    // Rebuild final list with proper grouping
    const sortedCases: CaseSummary[] = [];
    for (const parent of topLevelCases) {
      sortedCases.push(parent);

      if (parent.isContainer) {
        // Add DOI cases for this container (sorted by injury date, most recent first)
        const doiCases = cases.filter(c => c.containerPath === parent.path);
        doiCases.sort((a, b) => (b.injuryDate || '').localeCompare(a.injuryDate || ''));
        sortedCases.push(...doiCases);
      } else {
        // Add subcases for this parent (regular linked cases)
        const subcases = cases.filter(c => c.isSubcase && c.parentPath === parent.path);
        subcases.sort((a, b) => a.name.localeCompare(b.name));
        sortedCases.push(...subcases);
      }
    }

    // Count indexed cases (DOI cases count, containers don't)
    const indexedCount = sortedCases.filter(c => c.indexed && !c.isContainer).length;

    // For WC, count open hearings instead of SOL urgency
    const needsAttentionCount = isWC
      ? sortedCases.filter(c => c.openHearings && c.openHearings.length > 0).length
      : sortedCases.filter(c => c.solDaysRemaining !== undefined && c.solDaysRemaining <= 90).length;

    return c.json({
      root,
      practiceArea,
      cases: sortedCases,
      summary: {
        total: sortedCases.filter(c => !c.isContainer).length, // Don't count containers
        indexed: indexedCount,
        needsAttention: needsAttentionCount,
      }
    });
  } catch (error) {
    console.error("Firm cases error:", error);
    return c.json({ error: "Could not read firm directory" }, 500);
  }
});

// Scan for new clients in year-based folder structures
app.post("/scan-clients", async (c) => {
  const { root } = await c.req.json();

  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  try {
    const result = await refreshRegistry(root);
    return c.json(result);
  } catch (error) {
    console.error("Scan clients error:", error);
    return c.json({ error: "Could not scan for clients" }, 500);
  }
});

// ============================================================================
// FILE EXTRACTION SYSTEM - One agent per file, server-side orchestration
// ============================================================================

// =============================================================================
// PRACTICE-AREA-AWARE EXTRACTION PROMPTS
// =============================================================================

// Personal Injury extraction prompt
const PI_EXTRACTION_PROMPT = `You are a document extraction agent for a Personal Injury law firm in Nevada.

YOUR TASK: Analyze the provided document text and extract key information using the extract_document tool.

DOCUMENT TYPES (use for the "type" field):
- intake_form: Client intake, accident details, contact info
- lor: Letter of Representation to insurance companies
- declaration: Insurance policy declarations page (coverage limits) - EXTRACT FULL COVERAGE DETAILS
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

EXTRACTION PRIORITIES:
1. Client name, DOB, contact info (phone, email, address with street/city/state/zip)
2. Date of loss (accident date) in MM-DD-YYYY format
3. Document date (the date of this specific document, not treatment/incident dates):
   - Extract into extracted_data.document_date
   - If multiple dates appear, choose the document's issued/signed/authored date
   - Add extracted_data.document_date_confidence (high|medium|low|unknown)
   - Add extracted_data.document_date_reason with a brief explanation
4. Handwriting detection:
   - Set has_handwritten_data to true only if substantive extracted values appear handwritten (exclude signature/initial-only markings)
   - Set handwritten_fields to non-signature extracted field names that appear handwritten (for example: ["client_name", "document_date"])
   - Use an empty array [] when no handwritten values are present
5. Insurance details - USE THE STRUCTURED FIELDS:
   - For client's own policy (1P): use insurance_1p with carrier, policy_number, claim_number, bodily_injury, medical_payments, um_uim
   - For at-fault party's policy (3P): use insurance_3p with carrier, policy_number, claim_number, bodily_injury, insured_name
6. Medical provider name and charges (as numbers, not strings)
7. Health insurance carrier, group_no, member_no
8. Settlement/demand amounts as numbers

CRITICAL FOR DECLARATION PAGES:
- Identify if this is the client's policy (1P) or adverse party's policy (3P) based on folder name or document content
- Extract carrier name, ALL coverage limits (BI, Med Pay, UM/UIM, PD)
- Format limits as "$X/$Y" (per person/per accident)

Always call the extract_document tool with your findings.`;

// Workers' Compensation extraction prompt
const WC_EXTRACTION_PROMPT = `You are a document extraction agent for a Workers' Compensation law firm in Nevada.

YOUR TASK: Analyze the provided document text and extract key information using the extract_document tool.

DOCUMENT TYPES (use for the "type" field):
- c4_claim: C-4 Employee's Claim for Compensation form
- c3_employer_report: C-3 Employer's Report of Industrial Injury
- c5_carrier_acceptance: C-5 Insurer's Acceptance/Denial of Claim
- medical_record: Treatment records from ATP (Authorized Treating Physician)
- medical_bill: Bills from medical providers
- work_status_report: Work restrictions, light duty documentation
- ime_report: Independent Medical Examination report
- mmi_determination: Maximum Medical Improvement determination
- ppd_rating: Permanent Partial Disability rating report
- ttd_check: Temporary Total Disability benefit check/stub
- correspondence: Letters with adjuster, insurer, or DIR
- authorization: Medical treatment authorizations
- identification: Driver's license, ID, SSN documents
- d9_hearing: D-9 Request for Hearing form
- hearing_notice: Notice of hearing from DIR
- hearing_decision: Administrative Officer or Hearing Officer decision
- settlement: Stipulation, settlement agreement
- wage_records: Pay stubs, W-2s, wage verification
- job_description: Job duties, physical requirements
- other: Anything that doesn't fit above

EXTRACTION PRIORITIES:
1. Claimant name, DOB, SSN (last 4), contact info
2. Date of injury (DOI) in MM-DD-YYYY format
3. Document date (the date of this specific document, not DOI/treatment dates):
   - Extract into extracted_data.document_date
   - If multiple dates appear, choose the document's issued/signed/authored date
   - Add extracted_data.document_date_confidence (high|medium|low|unknown)
   - Add extracted_data.document_date_reason with a brief explanation
4. Handwriting detection:
   - Set has_handwritten_data to true only if substantive extracted values appear handwritten (exclude signature/initial-only markings)
   - Set handwritten_fields to non-signature extracted field names that appear handwritten (for example: ["claimant_name", "doi"])
   - Use an empty array [] when no handwritten values are present
5. Employer information:
   - Employer name, address
   - Job title at time of injury
   - Date of hire
6. WC Carrier/TPA information:
   - Carrier name, claim number, adjuster name/contact
7. Injury details:
   - Body parts injured
   - Mechanism of injury
   - ICD-10 diagnosis codes if present
8. Wage information:
   - Average Monthly Wage (AMW)
   - Compensation rate (typically 2/3 of AMW)
9. Disability status (IMPORTANT - always determine disability_type when work status is mentioned):
   - TTD (Temporary Total Disability): Patient is completely off work, cannot work at all
   - TPD (Temporary Partial Disability): Patient on modified/light duty, working with restrictions
   - PPD (Permanent Partial Disability): Patient has reached MMI with permanent impairment rating
   - PTD (Permanent Total Disability): Patient permanently unable to work

   INFERENCE RULES for disability_type:
   - "Off work", "no work", "cannot work" → TTD
   - "Modified duty", "light duty", "work restrictions", "limited duty" → TPD
   - "MMI reached" + impairment rating → PPD
   - Always extract disability_type if work status or benefits are mentioned
10. Medical treatment:
   - Treating physician name (ATP)
   - Treatment dates and types
   - Work restrictions
11. Hearing information:
   - Case/docket number
   - Hearing dates
   - Issues in dispute

Always call the extract_document tool with your findings.`;

// Function to get the appropriate extraction prompt
// Loads from practice-areas module (markdown files) with fallback to hardcoded prompts
function getFileExtractionSystemPrompt(practiceArea?: string): string {
  const config = practiceArea === PRACTICE_AREAS.WC
    ? practiceAreaRegistry.get("WC")
    : practiceAreaRegistry.getDefault();

  // Use loaded prompt from markdown file if available, otherwise fall back to hardcoded
  if (config?.extractionPrompt) {
    return config.extractionPrompt;
  }

  // Fallback to hardcoded prompts during migration
  if (practiceArea === PRACTICE_AREAS.WC) return WC_EXTRACTION_PROMPT;
  return PI_EXTRACTION_PROMPT;
}

// PI fallback extraction prompt (agent reads file with tools)
const PI_EXTRACTION_PROMPT_WITH_TOOLS = `You are a document extraction agent for a Personal Injury law firm in Nevada.

YOUR TASK: Read ONE document and extract key information.

DOCUMENT TYPES:
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
- Use MM-DD-YYYY as the default output format for DOB, DOL, and document dates
- Document date (this document's own issued/signed/authored date, not incident/treatment dates)
- If multiple dates appear, include:
  * extracted_data.document_date (best document date)
  * extracted_data.document_date_confidence: high|medium|low|unknown
  * extracted_data.document_date_reason: short explanation
- Handwriting detection:
  * has_handwritten_data: true when substantive extracted values appear handwritten (exclude signature/initial-only markings), else false
  * handwritten_fields: array of non-signature extracted field names that appear handwritten (use [] when none)
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
  "has_handwritten_data": false,
  "handwritten_fields": [],
  "extracted_data": {
    // Include any specific data points found
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- For PDFs: prefer the Read tool directly (cross-platform). If needed, run: pdftotext "filename" -
- For all other files: use the Read tool directly
- If a file cannot be read or parsed, return the JSON with key_info explaining the issue`;

// WC fallback extraction prompt (agent reads file with tools)
const WC_EXTRACTION_PROMPT_WITH_TOOLS = `You are a document extraction agent for a Workers' Compensation law firm in Nevada.

YOUR TASK: Read ONE document and extract key information.

DOCUMENT TYPES:
- c4_claim: C-4 Employee's Claim for Compensation
- c3_employer_report: C-3 Employer's Report of Industrial Injury
- c5_carrier_acceptance: C-5 Insurer's Acceptance/Denial
- medical_record: Treatment records from ATP
- medical_bill: Bills from medical providers
- work_status_report: Work restrictions, light duty docs
- ime_report: Independent Medical Examination
- mmi_determination: Maximum Medical Improvement determination
- ppd_rating: Permanent Partial Disability rating
- ttd_check: TTD benefit check/stub
- correspondence: Letters with adjuster, insurer, DIR
- authorization: Medical treatment authorizations
- identification: Driver's license, ID, SSN documents
- d9_hearing: D-9 Request for Hearing
- hearing_notice: Notice of hearing from DIR
- hearing_decision: AO or HO decision
- settlement: Stipulation, settlement agreement
- wage_records: Pay stubs, W-2s, wage verification
- job_description: Job duties, physical requirements
- other: Anything that doesn't fit above

EXTRACTION FOCUS:
- Claimant name, DOB, SSN (last 4), contact info
- Date of injury (DOI)
- Use MM-DD-YYYY as the default output format for DOB, DOI, and document dates
- Document date (this document's own issued/signed/authored date, not DOI/treatment dates)
- If multiple dates appear, include:
  * extracted_data.document_date (best document date)
  * extracted_data.document_date_confidence: high|medium|low|unknown
  * extracted_data.document_date_reason: short explanation
- Handwriting detection:
  * has_handwritten_data: true when substantive extracted values appear handwritten (exclude signature/initial-only markings), else false
  * handwritten_fields: array of non-signature extracted field names that appear handwritten (use [] when none)
- Employer name, job title
- WC Carrier name, claim number, adjuster
- Body parts injured, diagnosis codes
- Average Monthly Wage (AMW), compensation rate
- disability_type (IMPORTANT - always determine when work status mentioned):
  * TTD = off work completely, cannot work
  * TPD = modified/light duty, working with restrictions
  * PPD = MMI reached with permanent impairment rating
  * PTD = permanently unable to work
- MMI date, PPD rating if present
- Treating physician (ATP), work restrictions
- Hearing case numbers and dates

DISABILITY TYPE INFERENCE:
- "Off work", "no work", "cannot work" → disability_type: "TTD"
- "Modified duty", "light duty", "work restrictions" → disability_type: "TPD"
- "MMI reached" + rating percentage → disability_type: "PPD"

OUTPUT FORMAT - Return ONLY valid JSON:
{
  "filename": "<exact filename>",
  "folder": "<folder name>",
  "type": "<document_type from list above>",
  "key_info": "<2-3 sentence summary of most important information>",
  "has_handwritten_data": false,
  "handwritten_fields": [],
  "extracted_data": {
    // Include any specific data points found
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- For PDFs: prefer the Read tool directly (cross-platform). If needed, run: pdftotext "filename" -
- For all other files: use the Read tool directly
- If a file cannot be read or parsed, return the JSON with key_info explaining the issue`;

// Function to get the appropriate fallback extraction prompt
// Loads from practice-areas module (markdown files) with fallback to hardcoded prompts
function getFileExtractionSystemPromptWithTools(practiceArea?: string): string {
  const config = practiceArea === PRACTICE_AREAS.WC
    ? practiceAreaRegistry.get("WC")
    : practiceAreaRegistry.getDefault();

  // Use loaded prompt from markdown file if available, otherwise fall back to hardcoded
  if (config?.extractionPromptWithTools) {
    return config.extractionPromptWithTools;
  }

  // Fallback to hardcoded prompts during migration
  if (practiceArea === PRACTICE_AREAS.WC) return WC_EXTRACTION_PROMPT_WITH_TOOLS;
  return PI_EXTRACTION_PROMPT_WITH_TOOLS;
}

// Build synthesis system prompt for JSON output (used with direct API call)
async function buildSynthesisSystemPrompt(firmRoot?: string, practiceArea?: string): Promise<string> {
  const practiceKnowledge = await loadSectionsByIds(firmRoot, SYNTHESIS_SECTION_IDS);
  const indexSchema = await loadIndexSchema();
  const phaseRules = getPhaseRules(practiceArea);
  const isWC = practiceArea === PRACTICE_AREAS.WC;

  if (isWC) {
    return `You are a case analyst and summarizer for a Workers' Compensation law firm in Nevada.

You will receive:
1. document_index.json - Data extracted from all case documents
2. hypergraph_analysis.json - Cross-document analysis showing consensus values and conflicts

YOUR JOB: Analyze the case substantively and return a JSON synthesis. Do NOT make any tool calls.

## PRACTICE KNOWLEDGE

${practiceKnowledge}

## CANONICAL INDEX SCHEMA

${indexSchema}

## ANALYSIS WORKFLOW:

1. **Case Analysis** — Using the practice knowledge above, assess:
   - **Compensability**: Is the claim accepted, denied, or disputed?
   - **Injury severity**: Body parts affected, surgical vs conservative treatment
   - **Disability status**: TTD ongoing, TPD, or MMI reached? PPD rating if applicable
   - **Benefits status**: Are TTD payments current? Any disputes or suspensions?
   - **Document quality gaps**: What critical documents are missing?

2. Use hypergraph consensus values where available

3. Generate a case summary consolidating:
   - Contact info into summary.contact
   - Employer info into summary.employer (name, address, job_title)
   - WC carrier info into summary.wc_carrier (carrier, claim_number, adjuster)
   - Disability status into summary.disability_status (type, amw, compensation_rate, mmi_date, ppd_rating)

4. Document ALL judgment calls in "errata"

5. Put CRITICAL unresolved conflicts in "needs_review"

## CRITICAL: HANDLING HYPERGRAPH CONFLICTS

**MANDATORY needs_review items** - If the hypergraph shows ANY of these, you MUST add to needs_review:
1. Any field where consensus is "UNCERTAIN" - these REQUIRE human decision
2. Any AMW or compensation rate conflicts
3. Any date_of_injury conflicts
4. Any PPD rating conflicts

**You are NOT authorized to resolve UNCERTAIN values.** When hypergraph says consensus: "UNCERTAIN", you MUST:
1. Add it to needs_review with both values and their sources
2. NOT pick one value to use in the summary
3. Use "NEEDS REVIEW" or leave empty in summary fields

## ERRATA - Document ALL decisions

Every field you fill in should have an errata entry:
{
  "field": "<what field>",
  "decision": "<value you used>",
  "evidence": "<what the extractions showed>",
  "confidence": "high|medium|low"
}

## PHASE RULES:
${Object.entries(phaseRules).map(([phase, desc]) => `- ${phase}: ${desc}`).join('\n')}

## OUTPUT FORMAT

Return a JSON object with these fields:
- needs_review: Array of conflicts requiring human review
- errata: Array of documented decisions
- case_analysis: String with substantive analysis (compensability, injury severity, disability status, benefits status, gaps, next steps)
- compensability_status: "accepted" | "denied" | "disputed"
- disability_type: "ttd" | "tpd" | "ppd" | "ptd"
- summary: Object with:
  - client: Claimant name
  - doi: Date of injury (MM-DD-YYYY)
  - dob: Date of birth
  - providers: Array of provider names (strings)
  - total_charges: Total medical charges
  - employer: { name, address, job_title }
  - wc_carrier: { carrier, claim_number, adjuster }
  - disability_status: { type, amw, compensation_rate, mmi_date, ppd_rating }
  - contact: { phone, email, address }
  - case_summary: Brief narrative summary
- case_name: e.g. "LASTNAME, Firstname"
- case_phase: One of Intake, Investigation, Treatment, MMI Evaluation, Benefits Resolution, Settlement/Hearing, Closed
- open_hearings: Array of { case_number, hearing_level ("H.O." or "A.O."), next_date, issue }. Use "A.O." if any Appeals Officer documents/decisions exist, otherwise default to "H.O."

**IMPORTANT**: You MUST include needs_review and errata arrays. Empty arrays only if truly zero conflicts.`;
  }

  // Personal Injury synthesis prompt (default)
  return `You are a case analyst and summarizer for a Personal Injury law firm in Nevada.

You will receive:
1. document_index.json - Data extracted by Haiku from all case documents
2. hypergraph_analysis.json - Cross-document analysis showing consensus values and conflicts

YOUR JOB: Analyze the case substantively and return a JSON synthesis. Do NOT make any tool calls.

## PRACTICE KNOWLEDGE

${practiceKnowledge}

## CANONICAL INDEX SCHEMA

**CRITICAL SCHEMA REQUIREMENTS:**
- \`summary.providers\` MUST be an array of strings: \`["Provider A", "Provider B"]\` — NOT objects
- \`summary.policy_limits\` MUST use keys \`1P\` and \`3P\` — NOT "first_party"/"third_party"
- \`summary.claim_numbers\` MUST use keys like \`1P_CarrierName\` and \`3P_CarrierName\` — NOT "first_party_carrier"

${indexSchema}

## ANALYSIS WORKFLOW:

1. **Case Analysis** — Using the practice knowledge above, assess:
   - **Liability strength**: clear / moderate / contested (with reasoning)
   - **Injury tier**: Tier 1 (soft tissue) / Tier 2 (structural) / Tier 3 (surgical) based on treatment and findings
   - **Estimated value range**: Apply the multiplier for the injury tier against total specials
   - **Policy limits demand appropriate?**: Yes/No based on Section IV triggers
   - **Document quality gaps**: What critical documents are missing?

2. Use hypergraph consensus values where available

3. Generate a case summary consolidating:
   - Contact info into summary.contact
   - Health insurance into summary.health_insurance
   - Claim numbers into summary.claim_numbers (use 1P_CarrierName, 3P_CarrierName format)

4. Document ALL judgment calls in "errata"

5. Put CRITICAL unresolved conflicts in "needs_review"

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

## ERRATA - Document ALL decisions

Every field you fill in should have an errata entry:
{
  "field": "<what field>",
  "decision": "<value you used>",
  "evidence": "<what the extractions showed>",
  "confidence": "high|medium|low"
}

## PHASE RULES:
${Object.entries(phaseRules).map(([phase, desc]) => `- ${phase}: ${desc}`).join('\n')}

## OUTPUT FORMAT

Return a JSON object with these fields:
- needs_review: Array of conflicts requiring human review
- errata: Array of documented decisions
- case_analysis: String with substantive analysis (liability, injury tier, value, gaps, next steps)
- liability_assessment: "clear" | "moderate" | "contested"
- injury_tier: "tier_1_soft_tissue" | "tier_2_structural" | "tier_3_surgical"
- estimated_value_range: e.g. "$37,500 - $62,500"
- policy_limits_demand_appropriate: true | false
- summary: Object with client, dol, dob, providers (array of strings), total_charges, policy_limits, contact, health_insurance, claim_numbers, case_summary
- case_name: e.g. "LASTNAME, Firstname"
- case_phase: One of Intake, Investigation, Treatment, Demand, Negotiation, Settlement, Complete

**IMPORTANT**: You MUST include needs_review and errata arrays. Empty arrays only if truly zero conflicts.`;
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
  has_handwritten_data?: boolean;
  handwritten_fields?: string[];
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

function normalizeDateToIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = parseFlexibleDate(trimmed);
  if (!parsed) return null;
  return formatDateYYYYMMDD(parsed);
}

function inferDateFromFilename(filename: string): string | null {
  const ymd = filename.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10);
    const day = parseInt(ymd[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  const mdy = filename.match(/(\d{1,2})[-_](\d{1,2})[-_](20\d{2})/);
  if (mdy) {
    const month = parseInt(mdy[1], 10);
    const day = parseInt(mdy[2], 10);
    const year = parseInt(mdy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  return null;
}

function isSignatureOnlyHandwrittenField(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  return (
    /\bsignature\b/.test(normalized) ||
    /\bsigned by\b/.test(normalized) ||
    /\bsigned\b/.test(normalized) ||
    /\bsigner\b/.test(normalized) ||
    /\binitials?\b/.test(normalized) ||
    normalized === "sign"
  );
}

function normalizeHandwrittenFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const field = item.trim();
    if (!field) continue;
    if (isSignatureOnlyHandwrittenField(field)) continue;
    const key = field.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(field);
  }

  return normalized;
}

function resolveHandwritingMetadata(extraction: FileExtraction): {
  hasHandwrittenData: boolean;
  handwrittenFields: string[];
  issue?: string;
} {
  const handwrittenFields = normalizeHandwrittenFields(
    extraction.handwritten_fields
  );
  const hasHandwrittenData = handwrittenFields.length > 0;

  if (!hasHandwrittenData) {
    return {
      hasHandwrittenData: false,
      handwrittenFields: [],
    };
  }

  const issue =
    handwrittenFields.length > 0
      ? `Contains handwritten extracted values in fields: ${handwrittenFields.join(", ")}.`
      : "Contains handwritten extracted values. Review extracted data.";

  return {
    hasHandwrittenData: true,
    handwrittenFields,
    issue,
  };
}

function resolveDocumentDate(extraction: FileExtraction): {
  date?: string;
  issue?: string;
} {
  const extractedData = extraction.extracted_data;
  const explicitDate = normalizeDateToIso(extractedData?.document_date);
  const confidenceRaw = typeof extractedData?.document_date_confidence === "string"
    ? extractedData.document_date_confidence.trim().toLowerCase()
    : "";
  const reason = typeof extractedData?.document_date_reason === "string"
    ? extractedData.document_date_reason.trim()
    : "";

  if (explicitDate) {
    if (confidenceRaw === "low" || confidenceRaw === "unknown") {
      const reasonSuffix = reason ? ` Reason: ${reason}` : "";
      return {
        date: explicitDate,
        issue: `Document date extracted with ${confidenceRaw} confidence.${reasonSuffix}`,
      };
    }
    return { date: explicitDate };
  }

  const inferredFromName = inferDateFromFilename(extraction.filename);
  if (inferredFromName) {
    return {
      date: inferredFromName,
      issue:
        "Document date not explicitly extracted from document text; inferred from filename. Verify manually.",
    };
  }

  return {
    issue:
      "Document date extraction failed: no reliable document date was identified. Review this file.",
  };
}

// ============================================================================
// Pre-classification: determine text vs vision extraction for each file
// ============================================================================

interface ClassifiedFile {
  filePath: string;       // relative path like "Intake/Intake.pdf"
  filename: string;
  folder: string;
  fullPath: string;
  useText: boolean;       // true = text extraction (GPT-OSS), false = vision (Scout/Maverick)
  isPdf: boolean;
  extractedText: string;  // pre-extracted text (only meaningful when useText=true)
  fileSizeMB: number;
}

async function classifyFile(
  caseFolder: string,
  filePath: string,
  yearModeInfo?: { firmRoot: string; registry: ClientRegistry; slug: string },
): Promise<ClassifiedFile> {
  const filename = filePath.split('/').pop() || filePath;
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const rawFolder = dirname(filePath).replace(/\\/g, '/');
  const folder = rawFolder === '.' ? '.' : rawFolder;

  // Year-based mode: resolve through source folders
  let fullPath: string;
  if (yearModeInfo) {
    const { firmRoot, registry, slug } = yearModeInfo;
    fullPath = resolveYearFilePath(firmRoot, registry, slug, filePath);
  } else {
    fullPath = join(caseFolder, filePath);
  }

  let fileSizeMB = 0;
  try {
    const fileStats = await stat(fullPath);
    fileSizeMB = fileStats.size / (1024 * 1024);
  } catch {
    // File not found — will be caught during extraction
    return {
      filePath,
      filename,
      folder,
      fullPath,
      useText: false,
      isPdf,
      extractedText: '',
      fileSizeMB: 0
    };
  }

  // Try to extract text server-side
  let extractedText = '';
  let useText = false;
  try {
    extractedText = await extractTextFromFile(fullPath);
    useText = extractedText.length > 50 &&
      !extractedText.startsWith('[Could not') &&
      !extractedText.startsWith('[Binary file');
  } catch {
    // Text extraction failed — will use vision
  }

  // Truncate if too long to avoid token limits
  const MAX_CHARS = 15000;
  if (useText && extractedText.length > MAX_CHARS) {
    extractedText = extractedText.slice(0, MAX_CHARS) + '\n\n[... truncated ...]';
  }

  return { filePath, filename, folder, fullPath, useText, isPdf, extractedText, fileSizeMB };
}

// ============================================================================
// Text extraction: GPT-OSS 120B (Path 1)
// ============================================================================

async function extractFileText(
  classified: ClassifiedFile,
  fileIndex: number,
  totalFiles: number,
  practiceArea?: string,
  onProgress?: (event: { type: string; [key: string]: any }) => void,
): Promise<FileExtraction> {
  const { filename, folder, fullPath, extractedText } = classified;
  const startTime = Date.now();

  onProgress?.({ type: "file_start", fileIndex, totalFiles, filename, folder });

  let result: FileExtraction = {
    filename,
    folder,
    type: 'other',
    key_info: '',
    has_handwritten_data: false,
    handwritten_fields: [],
  };
  const usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'groq'
  };

  try {
    const groqResult = await extractWithGptOss(
      extractedText,
      filename,
      folder,
      getFileExtractionSystemPrompt(practiceArea)
    );

    const handwrittenFields = normalizeHandwrittenFields(groqResult.result.handwritten_fields);
    const hasHandwrittenData = handwrittenFields.length > 0;

    result = {
      filename,
      folder,
      type: groqResult.result.type || 'other',
      key_info: groqResult.result.key_info || '',
      has_handwritten_data: hasHandwrittenData,
      handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
      extracted_data: groqResult.result.extracted_data,
    };

    usage.inputTokens = groqResult.usage.inputTokens;
    usage.inputTokensNew = groqResult.usage.inputTokens;
    usage.outputTokens = groqResult.usage.outputTokens;
    usage.apiCalls = 1;
  } catch (apiErr) {
    console.error(`[${fileIndex + 1}/${totalFiles}] GPT-OSS error for ${filename}:`, apiErr);
    result.key_info = `Extraction failed: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`;
    result.error = apiErr instanceof Error ? apiErr.message : String(apiErr);
  }

  result.usage = usage;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${fileIndex + 1}/${totalFiles}] ✓ Done: ${filename} (${elapsed}s) - ${result.type} [groq-gpt-oss]`);
  onProgress?.({
    type: "file_done",
    fileIndex,
    totalFiles,
    filename,
    folder,
    docType: result.type,
    extractionMethod: 'groq-gpt-oss',
    elapsed: parseFloat(elapsed)
  });
  return result;
}

// ============================================================================
// Vision extraction: Scout → Maverick fallback (Path 2)
// ============================================================================

async function extractFileVision(
  classified: ClassifiedFile,
  fileIndex: number,
  totalFiles: number,
  practiceArea?: string,
  onProgress?: (event: { type: string; [key: string]: any }) => void,
): Promise<FileExtraction> {
  const { filename, folder, fullPath, isPdf } = classified;
  const startTime = Date.now();

  onProgress?.({ type: "file_start", fileIndex, totalFiles, filename, folder });

  const usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'groq'
  };

  let result: FileExtraction = {
    filename,
    folder,
    type: 'other',
    key_info: 'Skipped: vision supports PDF files only',
    has_handwritten_data: false,
    handwritten_fields: [],
    error: 'SKIPPED_NON_PDF',
  };

  // Pre-flight: check file exists
  try {
    await stat(fullPath);
  } catch {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[${fileIndex + 1}/${totalFiles}] ✗ File not found: ${filename} (${elapsed}s)`);
    return {
      filename,
      folder,
      type: 'other',
      key_info: 'File not found or inaccessible',
      has_handwritten_data: false,
      handwritten_fields: [],
      error: `File not found: ${fullPath}`,
      usage,
    };
  }

  console.log(`[${fileIndex + 1}/${totalFiles}] [groq-vision] ${filename}`);

  if (!isPdf) {
    console.log(`[Vision] Skipping ${filename}: not a PDF`);
    result.usage = usage;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${fileIndex + 1}/${totalFiles}] ✓ Done: ${filename} (${elapsed}s) - ${result.type} [groq-vision]`);
    onProgress?.({
      type: "file_done",
      fileIndex,
      totalFiles,
      filename,
      folder,
      docType: result.type,
      extractionMethod: 'groq-vision',
      elapsed: parseFloat(elapsed),
      skipped: true,
    });
    return result;
  }

  try {
    const groqResult = await extractWithVision(
      fullPath,
      filename,
      folder,
      classified.fileSizeMB,
      getFileExtractionSystemPrompt(practiceArea)
    );

    const handwrittenFields = normalizeHandwrittenFields(groqResult.result.handwritten_fields);
    const hasHandwrittenData = handwrittenFields.length > 0;

    result = {
      filename,
      folder,
      type: groqResult.result.type || 'other',
      key_info: groqResult.result.key_info || '',
      has_handwritten_data: hasHandwrittenData,
      handwritten_fields: hasHandwrittenData ? handwrittenFields : [],
      extracted_data: groqResult.result.extracted_data,
    };

    usage.inputTokens = groqResult.usage.inputTokens;
    usage.inputTokensNew = groqResult.usage.inputTokens;
    usage.outputTokens = groqResult.usage.outputTokens;
    usage.apiCalls = 1;
  } catch (visionErr) {
    console.error(`[${fileIndex + 1}/${totalFiles}] Vision error for ${filename}:`, visionErr);
    result.key_info = `Extraction failed: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}`;
    result.error = visionErr instanceof Error ? visionErr.message : String(visionErr);
  }

  result.usage = usage;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${fileIndex + 1}/${totalFiles}] ✓ Done: ${filename} (${elapsed}s) - ${result.type} [groq-vision]`);
  onProgress?.({
    type: "file_done",
    fileIndex,
    totalFiles,
    filename,
    folder,
    docType: result.type,
    extractionMethod: 'groq-vision',
    elapsed: parseFloat(elapsed)
  });
  return result;
}

// Sonnet synthesizes case summary from extracted data using single-turn structured output
async function synthesizeCaseSummary(
  caseFolder: string,
  conflictCount: number,
  firmRoot?: string,
  practiceArea?: string
): Promise<UsageStats> {
  console.log(`\n========== SONNET SYNTHESIS (Single-Turn) ==========`);
  console.log(`[Sonnet] Case folder: ${caseFolder}`);
  console.log(`[Sonnet] Conflicts detected: ${conflictCount}`);

  const startTime = Date.now();
  const indexDir = join(caseFolder, '.ai_tool');
  const indexPath = join(indexDir, 'document_index.json');
  const hypergraphPath = join(indexDir, 'hypergraph_analysis.json');

  let usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'sonnet'
  };

  try {
    // Step 1: Pre-read both JSON files server-side
    const [documentIndexContent, hypergraphContent] = await Promise.all([
      readFile(indexPath, 'utf-8'),
      readFile(hypergraphPath, 'utf-8')
    ]);

    console.log(`[Sonnet] Read index (${documentIndexContent.length} chars) and hypergraph (${hypergraphContent.length} chars)`);

    // Step 2: Build system prompt
    const synthesisSystemPrompt = await buildSynthesisSystemPrompt(firmRoot, practiceArea);

    // Step 3: Make single API call with tool use for structured output
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16000,
      system: synthesisSystemPrompt,
      messages: [{
        role: "user",
        content: `<hypergraph_analysis>
${hypergraphContent}
</hypergraph_analysis>

<document_index>
${documentIndexContent}
</document_index>

Analyze the case and use the case_synthesis tool to return your synthesis.`
      }],
      tools: [{
        name: "case_synthesis",
        description: "Output the synthesized case analysis with all required fields",
        input_schema: getSynthesisSchema(practiceArea)
      }],
      tool_choice: { type: "tool", name: "case_synthesis" }
    });

    // Step 4: Extract usage stats
    usage.inputTokensNew = response.usage.input_tokens || 0;
    usage.inputTokensCacheWrite = (response.usage as any).cache_creation_input_tokens || 0;
    usage.inputTokensCacheRead = (response.usage as any).cache_read_input_tokens || 0;
    usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
    usage.outputTokens = response.usage.output_tokens || 0;
    usage.apiCalls = 1;

    // Step 5: Parse the tool use output
    const toolBlock = response.content.find(block => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('No tool use response from synthesis API');
    }

    const synthesis = toolBlock.input as Record<string, any>;
    console.log(`[Sonnet] Parsed synthesis with ${synthesis.needs_review?.length || 0} review items, ${synthesis.errata?.length || 0} errata entries`);

    // Step 6: Merge synthesis into existing index and write back
    const existingIndex = JSON.parse(documentIndexContent);
    const isWC = practiceArea === PRACTICE_AREAS.WC;

    // Build merged index with practice-area-aware field extraction
    const merged: Record<string, any> = {
      ...existingIndex,
      // Common fields
      needs_review: synthesis.needs_review || [],
      errata: synthesis.errata || [],
      case_analysis: synthesis.case_analysis || '',
      case_name: synthesis.case_name || existingIndex.case_name,
      case_phase: synthesis.case_phase || existingIndex.case_phase,
      // Deep merge summary, preserving folders structure
      summary: {
        ...existingIndex.summary,
        ...synthesis.summary,
        // Ensure providers is an array of strings (flatten if needed)
        providers: Array.isArray(synthesis.summary?.providers)
          ? synthesis.summary.providers.map((p: any) => typeof p === 'string' ? p : p.name || String(p))
          : existingIndex.summary?.providers || [],
      }
    };

    // Practice-area-specific assessment fields
    if (isWC) {
      // WC fields
      merged.compensability = synthesis.compensability || null;
      merged.claim_type = synthesis.claim_type || null;
      merged.estimated_ttd_weeks = synthesis.estimated_ttd_weeks ?? null;
      merged.estimated_ppd_rating = synthesis.estimated_ppd_rating ?? null;
      merged.third_party_potential = synthesis.third_party_potential ?? null;
      // Ensure WC summary sub-objects are properly merged
      if (synthesis.summary?.employer) {
        merged.summary.employer = synthesis.summary.employer;
      }
      if (synthesis.summary?.wc_carrier) {
        merged.summary.wc_carrier = synthesis.summary.wc_carrier;
      }
      if (synthesis.summary?.disability_status) {
        merged.summary.disability_status = synthesis.summary.disability_status;
      }
      if (synthesis.summary?.job_title) {
        merged.summary.job_title = synthesis.summary.job_title;
      }
      if (synthesis.summary?.injury_description) {
        merged.summary.injury_description = synthesis.summary.injury_description;
      }
      if (synthesis.summary?.body_parts) {
        merged.summary.body_parts = synthesis.summary.body_parts;
      }
      // Use doi for WC incident date
      if (synthesis.summary?.doi) {
        merged.summary.incident_date = synthesis.summary.doi;
      }
      // Open hearings from synthesis
      if (Array.isArray(synthesis.open_hearings) && synthesis.open_hearings.length > 0) {
        merged.open_hearings = synthesis.open_hearings;
      }
    } else {
      // PI fields
      merged.liability_assessment = synthesis.liability_assessment || null;
      merged.injury_tier = synthesis.injury_tier || null;
      merged.estimated_value_range = synthesis.estimated_value_range || null;
      merged.policy_limits_demand_appropriate = synthesis.policy_limits_demand_appropriate ?? null;
      // Use dol for PI incident date
      if (synthesis.summary?.dol) {
        merged.summary.incident_date = synthesis.summary.dol;
      }
    }

    await writeFile(indexPath, JSON.stringify(merged, null, 2));
    await writeIndexDerivedFiles(caseFolder, merged);
    console.log(`[Sonnet] Wrote merged index to ${indexPath}`);

  } catch (err) {
    console.error(`[Sonnet] Synthesis error:`, err);
    // Re-throw so caller can handle
    throw err;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Sonnet] Done in ${elapsed}s. Usage: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`);
  console.log(`==========================================\n`);

  return usage;
}

// List all indexable files in a case folder
async function listCaseFiles(
  caseFolder: string,
  options?: { sourceFolders?: { firmRoot: string; folders: string[] } }
): Promise<string[]> {
  // Year-based mode: walk each source folder with year prefix
  if (options?.sourceFolders) {
    const { firmRoot, folders } = options.sourceFolders;
    const allFiles: string[] = [];
    for (const relFolder of folders) {
      const absFolder = join(firmRoot, relFolder);
      const yearPrefix = relFolder.split("/")[0];
      const files: string[] = [];

      async function walkSourceDir(dir: string, base: string = '') {
        let entries: Awaited<ReturnType<typeof readdir>>;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          if (entry.name === '.ai_tool' || entry.name.startsWith('.')) continue;
          const fullPath = join(dir, entry.name);
          const relativePath = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walkSourceDir(fullPath, relativePath);
          } else {
            files.push(`${yearPrefix}/${relativePath}`);
          }
        }
      }

      await walkSourceDir(absFolder);
      allFiles.push(...files);
    }
    return allFiles;
  }

  // Standard mode
  const files: string[] = [];

  async function walkDir(dir: string, base: string = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip .ai_tool entirely
      if (entry.name === '.ai_tool') continue;

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

// =============================================================================
// DOI CONTAINER DETECTION (for WC multi-injury clients)
// =============================================================================

/**
 * DOI folder pattern: DOI_YYYY-MM-DD (e.g., DOI_2024-01-15)
 */
const DOI_FOLDER_PATTERN = /^DOI_(\d{4}-\d{2}-\d{2})$/;

/**
 * Parse a DOI folder name to extract the date of injury.
 * Returns the date string (YYYY-MM-DD) or null if not a valid DOI folder.
 */
function parseDOIFolderName(name: string): { date: string } | null {
  const match = name.match(DOI_FOLDER_PATTERN);
  if (match) {
    return { date: match[1] };
  }
  return null;
}

interface DOIDetectionResult {
  isContainer: boolean;
  doiCases: Array<{ path: string; name: string; dateOfInjury: string }>;
  sharedFolders: string[];
}

/**
 * Detect if a folder contains DOI subfolders (making it a client container).
 * Returns:
 * - isContainer: true if any DOI_* folders found
 * - doiCases: array of { path, name, dateOfInjury } for each DOI folder
 * - sharedFolders: non-DOI folders (for container indexing)
 */
async function detectDOISubfolders(folderPath: string): Promise<DOIDetectionResult> {
  const result: DOIDetectionResult = {
    isContainer: false,
    doiCases: [],
    sharedFolders: [],
  };

  try {
    const entries = await readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.ai_tool') continue;

      const parsed = parseDOIFolderName(entry.name);
      if (parsed) {
        // This is a DOI folder
        result.doiCases.push({
          path: join(folderPath, entry.name),
          name: entry.name,
          dateOfInjury: parsed.date,
        });
      } else if (!entry.name.startsWith('.')) {
        // Non-DOI, non-hidden folder (shared client info like "General Contact Info")
        result.sharedFolders.push(entry.name);
      }
    }

    result.isContainer = result.doiCases.length > 0;

    // Sort DOI cases by date (most recent first)
    result.doiCases.sort((a, b) => b.dateOfInjury.localeCompare(a.dateOfInjury));

  } catch {
    // Can't read folder
  }

  return result;
}

interface ContainerInfo {
  clientName: string;
  practiceArea?: string;
  contact?: {
    phone?: string;
    email?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
  };
  sharedFolders: string[];
  doiCases: Array<{ path: string; dateOfInjury: string; indexed?: boolean }>;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Index a container's shared folders (non-DOI folders like "General Contact Info").
 * Extracts shared client contact info and writes to container_info.json.
 */
async function indexContainer(
  containerPath: string,
  sharedFolders: string[],
  doiCases: Array<{ path: string; name: string; dateOfInjury: string }>,
  practiceArea?: string,
  onProgress?: (event: { type: string; [key: string]: any }) => void
): Promise<{ success: boolean; containerInfo?: ContainerInfo; error?: string }> {
  const containerName = containerPath.split('/').pop() || containerPath;
  const piToolDir = join(containerPath, '.ai_tool');
  const containerInfoPath = join(piToolDir, 'container_info.json');

  onProgress?.({ type: "status", message: `Indexing container: ${containerName}` });

  try {
    await mkdir(piToolDir, { recursive: true });

    // Try to load existing container info
    let existingInfo: ContainerInfo | null = null;
    try {
      const existing = await readFile(containerInfoPath, 'utf-8');
      existingInfo = JSON.parse(existing);
    } catch {
      // No existing container info
    }

    // Build container info from shared folders (extract contact data)
    // For now, we just record the structure; full extraction could be added later
    const containerInfo: ContainerInfo = {
      clientName: containerName,
      practiceArea: practiceArea === PRACTICE_AREAS.WC || practiceArea === "WC"
        ? PRACTICE_AREAS.WC
        : undefined,
      contact: existingInfo?.contact, // Preserve existing contact if we have it
      sharedFolders,
      doiCases: doiCases.map(dc => ({
        path: dc.path,
        dateOfInjury: dc.dateOfInjury,
        indexed: false, // Will be updated when DOI cases are indexed
      })),
      createdAt: existingInfo?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Write container info
    await writeFile(containerInfoPath, JSON.stringify(containerInfo, null, 2));
    onProgress?.({ type: "status", message: `Container info written: ${containerName}` });

    return { success: true, containerInfo };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress?.({ type: "error", message: `Failed to index container: ${error}` });
    return { success: false, error };
  }
}

// Discover dot-prefixed subfolders that represent linked cases (e.g., .ClientB Spouse)
async function discoverSubcases(casePath: string): Promise<string[]> {
  const subcases: string[] = [];
  try {
    const entries = await readdir(casePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.ai_tool' || entry.name === '.ai_tool') continue;
      if (!entry.name.startsWith('.')) continue;

      // Check if subfolder has any files (not empty)
      const subPath = join(casePath, entry.name);
      try {
        const subEntries = await readdir(subPath, { withFileTypes: true });
        const hasFiles = subEntries.some(e => !e.isDirectory() || e.name !== '.ai_tool');
        if (hasFiles) {
          subcases.push(subPath);
        }
      } catch {
        // Can't read subfolder, skip it
      }
    }
  } catch {
    // Can't read parent folder
  }
  return subcases;
}

// Semaphore to limit concurrent vision extractions (heavy subprocess memory)
const VISION_CONCURRENCY = 4;
let _activeVision = 0;
const _visionQueue: Array<() => void> = [];

function acquireVisionSlot(): Promise<void> {
  if (_activeVision < VISION_CONCURRENCY) {
    _activeVision++;
    console.log(`[vision-sem] Acquired slot (${_activeVision}/${VISION_CONCURRENCY} active, ${_visionQueue.length} queued)`);
    return Promise.resolve();
  }
  console.log(`[vision-sem] Queuing — all ${VISION_CONCURRENCY} slots busy (${_visionQueue.length + 1} will be queued)`);
  return new Promise(resolve => _visionQueue.push(() => {
    _activeVision++;
    console.log(`[vision-sem] Dequeued into slot (${_activeVision}/${VISION_CONCURRENCY} active, ${_visionQueue.length} queued)`);
    resolve();
  }));
}

function releaseVisionSlot(): void {
  _activeVision--;
  console.log(`[vision-sem] Released slot (${_activeVision}/${VISION_CONCURRENCY} active, ${_visionQueue.length} queued)`);
  if (_visionQueue.length > 0) {
    _visionQueue.shift()!();
  }
}

// Index a single case using file-by-file extraction
async function indexCase(
  caseFolder: string,
  onProgress: (event: { type: string; [key: string]: any }) => void,
  options?: {
    incrementalFiles?: string[];
    firmRoot?: string;
    parentCase?: { path: string; name: string };
    practiceArea?: string;
    // DOI container info (for WC multi-injury clients)
    containerInfo?: {
      path: string;
      clientName: string;
      injuryDate: string;
      siblingCases?: Array<{ path: string; name: string; dateOfInjury: string }>;
    };
    // Year-based mode: source folders to scan instead of caseFolder
    sourceFolders?: { firmRoot: string; folders: string[] };
  }
): Promise<{ success: boolean; error?: string; diff?: IndexDiff }> {
  const caseName = caseFolder.split('/').pop() || caseFolder;
  const isIncremental = options?.incrementalFiles && options.incrementalFiles.length > 0;
  const indexDir = join(caseFolder, '.ai_tool');
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

  // Aggregate usage tracking
  const totalUsage = {
    groq: {
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
      files = await listCaseFiles(caseFolder, {
        sourceFolders: options?.sourceFolders,
      });
      onProgress({ type: "files_found", caseName, count: files.length, files });
    }

    if (files.length === 0) {
      onProgress({ type: "case_done", caseName, success: false, error: "No files found" });
      return { success: false, error: "No files found in case folder" };
    }

    // Step 2: Process files in a steady stream (max concurrent workers)
    // Accumulators are declared here so workers can build results incrementally,
    // allowing each extraction to be GC'd immediately after processing.
    const CONCURRENCY_LIMIT = 6;
    const totalFiles = files.length;
    let completedCount = 0;
    let successCount = 0;
    let failCount = 0;
    let nextFileIndex = 0;

    // Incremental folder building — populated inside workers, no extractions[] array needed
    const folders: Record<string, { files: Array<{
      doc_id?: string;
      filename: string;
      type: string;
      key_info: string;
      date?: string;
      issues?: string;
      has_handwritten_data: boolean;
      handwritten_fields: string[];
      extracted_data?: Record<string, any>;
    }> }> =
      isIncremental && existingIndex?.folders ? normalizeFolders(existingIndex.folders) : {};
    const runIssues: string[] = [];
    const failedFiles: Array<{ filename: string; folder: string; error: string | undefined; failed_at: string }> = [];

    const indexStartTime = Date.now();
    console.log(`\n========== PROCESSING ${files.length} FILES (max concurrent: ${CONCURRENCY_LIMIT}) =========`);
    onProgress({ type: "status", caseName, message: `Processing ${files.length} files (steady stream, max ${CONCURRENCY_LIMIT} concurrent)...` });

    // Build year-mode info for file path resolution if applicable
    let yearModeInfo: { firmRoot: string; registry: ClientRegistry; slug: string } | undefined;
    if (options?.sourceFolders) {
      const slug = getClientSlug(caseFolder);
      const firmRoot = resolveFirmRoot(caseFolder);
      const registry = await loadClientRegistry(firmRoot);
      if (slug && registry?.clients[slug]) {
        yearModeInfo = { firmRoot, registry, slug };
      }
    }

    const processWorker = async () => {
      while (nextFileIndex < totalFiles) {
        const fileIndex = nextFileIndex++;
        const filePath = files[fileIndex];

        let extraction: FileExtraction | null = null;
        let isVision = false;
        try {
          let classified: ClassifiedFile | null = await classifyFile(caseFolder, filePath, yearModeInfo);
          isVision = !classified.useText;
          extraction = classified.useText
            ? await extractFileText(
                classified,
                fileIndex,
                totalFiles,
                options?.practiceArea,
                (event) => { onProgress({ ...event, caseName }); }
              )
            : await (async () => {
                await acquireVisionSlot();
                try {
                  return await extractFileVision(
                    classified!,
                    fileIndex,
                    totalFiles,
                    options?.practiceArea,
                    (event) => { onProgress({ ...event, caseName }); }
                  );
                } finally {
                  releaseVisionSlot();
                }
              })();
          classified = null; // Release classified (including extractedText) immediately
        } catch (err) {
          const fallbackFolder = dirname(filePath).replace(/\\/g, '/');
          const fallbackFilename = filePath.split('/').pop() || filePath;
          console.error(`[${fileIndex + 1}/${totalFiles}] Unhandled error for ${fallbackFilename}:`, err);
          extraction = {
            filename: fallbackFilename,
            folder: fallbackFolder || "root",
            type: 'other' as const,
            key_info: "Failed to extract",
            has_handwritten_data: false,
            handwritten_fields: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }

        // Aggregate usage incrementally
        if (extraction!.usage) {
          totalUsage.groq.inputTokens += extraction!.usage.inputTokens;
          totalUsage.groq.inputTokensNew += extraction!.usage.inputTokensNew || 0;
          totalUsage.groq.inputTokensCacheWrite += extraction!.usage.inputTokensCacheWrite || 0;
          totalUsage.groq.inputTokensCacheRead += extraction!.usage.inputTokensCacheRead || 0;
          totalUsage.groq.outputTokens += extraction!.usage.outputTokens;
          totalUsage.groq.apiCalls += extraction!.usage.apiCalls;
        }

        // Build folder entry incrementally
        if (!folders[extraction!.folder]) {
          folders[extraction!.folder] = { files: [] };
        }
        if (isIncremental) {
          folders[extraction!.folder].files = folders[extraction!.folder].files.filter(
            (f: any) => f.filename !== extraction!.filename
          );
        }

        const fileEntry: {
          doc_id?: string;
          filename: string;
          type: string;
          key_info: string;
          date?: string;
          issues?: string;
          has_handwritten_data: boolean;
          handwritten_fields: string[];
          extracted_data?: Record<string, any>;
        } = {
          doc_id: buildDocumentId(extraction!.folder, extraction!.filename),
          filename: extraction!.filename,
          type: extraction!.type,
          key_info: extraction!.key_info,
          has_handwritten_data: false,
          handwritten_fields: [],
          extracted_data: extraction!.extracted_data,
        };

        const dateResolution = resolveDocumentDate(extraction!);
        const handwritingResolution = resolveHandwritingMetadata(extraction!);
        if (dateResolution.date) {
          fileEntry.date = dateResolution.date;
        }
        fileEntry.has_handwritten_data = handwritingResolution.hasHandwrittenData;
        fileEntry.handwritten_fields = handwritingResolution.handwrittenFields;
        if (dateResolution.issue) {
          fileEntry.issues = dateResolution.issue;
          runIssues.push(`[Document Date] ${extraction!.folder}/${extraction!.filename}: ${dateResolution.issue}`);
        }
        if (handwritingResolution.issue) {
          fileEntry.issues = fileEntry.issues
            ? `${fileEntry.issues} ${handwritingResolution.issue}`
            : handwritingResolution.issue;
          runIssues.push(`[Handwriting] ${extraction!.folder}/${extraction!.filename}: ${handwritingResolution.issue}`);
        }
        if (extraction!.error) {
          const extractionIssue = `Extraction failed: ${extraction!.error}`;
          fileEntry.issues = fileEntry.issues
            ? `${fileEntry.issues} ${extractionIssue}`
            : extractionIssue;
          runIssues.push(`[Extraction] ${extraction!.folder}/${extraction!.filename}: ${extraction!.error}`);
          failedFiles.push({
            filename: extraction!.filename,
            folder: extraction!.folder,
            error: extraction!.error,
            failed_at: new Date().toISOString(),
          });
          failCount++;
        } else {
          successCount++;
        }

        folders[extraction!.folder].files.push(fileEntry);

        // Release extraction — its data has been transferred to folders/accumulators
        extraction = null;

        completedCount += 1;

        // Log memory every 5 files to track leak pattern
        if (completedCount % 5 === 0) {
          const mem = process.memoryUsage();
          const elapsed = ((Date.now() - indexStartTime) / 1000).toFixed(0);
          console.log(`[mem] ${completedCount}/${totalFiles} @ ${elapsed}s | RSS: ${(mem.rss / 1024 / 1024).toFixed(0)}MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB | External: ${(mem.external / 1024 / 1024).toFixed(0)}MB | ArrayBuf: ${((mem.arrayBuffers || 0) / 1024 / 1024).toFixed(0)}MB`);
        }

        console.log(`--- Progress: ${completedCount}/${totalFiles} files complete ---`);

        // Force garbage collection every 5 files (same cadence as before)
        if (completedCount % 5 === 0 && typeof Bun !== 'undefined' && Bun.gc) {
          Bun.gc(true);
          console.log(`[gc] Forced garbage collection after ${completedCount} files`);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, totalFiles) },
      () => processWorker()
    );

    await Promise.all(workers);

    onProgress({
      type: "extractions_complete",
      caseName,
      successful: successCount,
      failed: failCount
    });

    // Step 3: Build preliminary index for hypergraph analysis
    // Folders were built incrementally during extraction above.

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

    const existingIssues = Array.isArray(existingIndex?.issues_found)
      ? existingIndex.issues_found.filter((issue: unknown): issue is string => typeof issue === "string")
      : [];
    const issuesFound = Array.from(new Set([...existingIssues, ...runIssues]));

    const initialIndex: Record<string, any> = {
      indexed_at: new Date().toISOString(),
      case_name: caseName,
      case_phase: isIncremental && existingIndex?.case_phase ? existingIndex.case_phase : 'Unknown',
      summary: baseSummary,
      folders,
      failed_files: failedFiles,
      issues_found: issuesFound,
      reconciled_values: existingIndex?.reconciled_values ?? {},
      needs_review: existingIndex?.needs_review ?? [],
      errata: existingIndex?.errata ?? [],
      case_analysis: existingIndex?.case_analysis ?? "",
      case_notes: existingIndex?.case_notes ?? [],
      chat_archives: existingIndex?.chat_archives ?? [],
      liability_assessment: existingIndex?.liability_assessment ?? null,
      injury_tier: existingIndex?.injury_tier ?? null,
      estimated_value_range: existingIndex?.estimated_value_range ?? null,
      policy_limits_demand_appropriate: existingIndex?.policy_limits_demand_appropriate ?? null,
    };

    // Add practice area if specified (omit for PI to maintain backward compat)
    // Accept both short code ("WC") and full name ("Workers' Compensation")
    if (options?.practiceArea === PRACTICE_AREAS.WC || options?.practiceArea === "WC") {
      initialIndex.practice_area = PRACTICE_AREAS.WC;
    }

    // Add linked case fields if this is a subcase
    if (options?.parentCase) {
      initialIndex.parent_case = options.parentCase;
      initialIndex.is_subcase = true;
    }

    // Add DOI container fields if this is a DOI case (WC multi-injury client)
    if (options?.containerInfo) {
      initialIndex.container = {
        path: options.containerInfo.path,
        clientName: options.containerInfo.clientName,
      };
      initialIndex.is_doi_case = true;
      initialIndex.injury_date = options.containerInfo.injuryDate;

      // Add DOI siblings as related cases
      if (options.containerInfo.siblingCases && options.containerInfo.siblingCases.length > 0) {
        initialIndex.related_cases = options.containerInfo.siblingCases.map(sibling => ({
          path: sibling.path,
          name: sibling.name,
          type: "doi_sibling" as const,
          dateOfInjury: sibling.dateOfInjury,
        }));
      }
    }

    await writeFile(indexPath, JSON.stringify(initialIndex, null, 2));
    console.log(`[Index] Wrote initial document_index.json`);

    // Step 5: Run hypergraph and case summary generation IN PARALLEL
    onProgress({ type: "status", caseName, message: "Analyzing documents and generating summary..." });

    // Build summary context object (include practice and linked-claim context)
    const initialIndexForSummary = {
      folders,
      case_name: initialIndex.case_name,
      practice_area: initialIndex.practice_area,
      is_doi_case: initialIndex.is_doi_case,
      injury_date: initialIndex.injury_date,
      related_cases: initialIndex.related_cases,
    };

    // Run both Groq calls in parallel
    const [hypergraphResult, caseSummaryResult] = await Promise.all([
      generateHypergraph(caseFolder, { folders }, options?.practiceArea),
      generateCaseSummary(initialIndexForSummary, {
        firmRoot: options?.firmRoot,
        practiceArea: options?.practiceArea,
      })
    ]);

    // Save hypergraph to file
    const hypergraphPath = join(indexDir, 'hypergraph_analysis.json');
    await writeFile(hypergraphPath, JSON.stringify(hypergraphResult, null, 2));
    console.log(`[Hypergraph] Wrote hypergraph_analysis.json`);

    // Add hypergraph usage to Groq totals
    if (hypergraphResult.usage) {
      totalUsage.groq.inputTokens += hypergraphResult.usage.inputTokens;
      totalUsage.groq.inputTokensNew += hypergraphResult.usage.inputTokensNew || 0;
      totalUsage.groq.inputTokensCacheWrite += hypergraphResult.usage.inputTokensCacheWrite || 0;
      totalUsage.groq.inputTokensCacheRead += hypergraphResult.usage.inputTokensCacheRead || 0;
      totalUsage.groq.outputTokens += hypergraphResult.usage.outputTokens;
      totalUsage.groq.apiCalls += hypergraphResult.usage.apiCalls;
    }

    // Add case summary usage to Groq totals
    totalUsage.groq.inputTokens += caseSummaryResult.usage.inputTokens;
    totalUsage.groq.outputTokens += caseSummaryResult.usage.outputTokens;
    totalUsage.groq.apiCalls += 1;

    onProgress({
      type: "hypergraph_complete",
      caseName,
      conflictsFound: hypergraphResult.conflicts.length,
      confidence: hypergraphResult.summary.confidence_score
    });

    // Step 6: Programmatic merge - combine hypergraph + case summary into final index
    onProgress({ type: "status", caseName, message: "Merging results..." });

    const mergedIndex = mergeToIndex(
      hypergraphResult as HypergraphResult,
      caseSummaryResult,
      {
        ...initialIndex,
        folders, // Preserve folders from extraction
      }
    );

    // Normalize to canonical schema before writing (pass practiceArea for WC-specific normalization)
    const normalizedIndex = normalizeIndex(mergedIndex, options?.practiceArea);

    // Validate and log any issues (non-blocking)
    const validation = validateIndex(normalizedIndex);
    if (!validation.valid) {
      console.warn(`[Schema] Validation issues in ${caseName}:`, validation.issues.slice(0, 5));
    }

    // Compute diff between old and new index
    const indexDiff = diffIndexes(previousIndex, normalizedIndex);

    // Write final normalized index + all derived files
    await writeFile(indexPath, JSON.stringify(normalizedIndex, null, 2));
    await writeIndexDerivedFiles(caseFolder, normalizedIndex);
    console.log(`[Index] Wrote normalized document_index.json + meta_index.json + per-folder indexes`);
    console.log(`[Diff] ${indexDiff.summary}`);

    // ========== SONNET SYNTHESIS (COMMENTED OUT - replaced by parallel Haiku + programmatic merge) ==========
    // // Step 6: Sonnet reconciles and writes case summary (skip for simple incremental updates)
    // // Critical fields that require full re-synthesis if they have conflicts
    // const CRITICAL_CONFLICT_FIELDS = ['date_of_loss', 'total_medical', 'policy_limits', 'client_name'];
    //
    // const hasCriticalConflicts = hypergraphResult.conflicts.some(c =>
    //   CRITICAL_CONFLICT_FIELDS.some(field => c.field.toLowerCase().includes(field.toLowerCase()))
    // );
    //
    // const isSimpleIncremental = isIncremental &&
    //   files.length <= 3 &&
    //   !hasCriticalConflicts;
    //
    // let summaryUsage: UsageStats;
    //
    // if (isSimpleIncremental) {
    //   // Skip full synthesis for simple incremental updates
    //   console.log(`[Sonnet] Skipping synthesis - simple incremental update (${files.length} files, no critical conflicts)`);
    //   onProgress({ type: "status", caseName, message: `Quick update (${files.length} file(s), no re-synthesis needed)` });
    //   summaryUsage = {
    //     inputTokens: 0,
    //     inputTokensNew: 0,
    //     inputTokensCacheWrite: 0,
    //     inputTokensCacheRead: 0,
    //     outputTokens: 0,
    //     apiCalls: 0,
    //     model: 'sonnet'
    //   };
    // } else {
    //   onProgress({ type: "status", caseName, message: "Reconciling conflicts and generating case summary..." });
    //   summaryUsage = await synthesizeCaseSummary(caseFolder, hypergraphResult.conflicts.length, options?.firmRoot);
    // }
    //
    // // Add summary usage with cache breakdown
    // totalUsage.sonnet.inputTokens += summaryUsage.inputTokens;
    // totalUsage.sonnet.inputTokensNew += summaryUsage.inputTokensNew || 0;
    // totalUsage.sonnet.inputTokensCacheWrite += summaryUsage.inputTokensCacheWrite || 0;
    // totalUsage.sonnet.inputTokensCacheRead += summaryUsage.inputTokensCacheRead || 0;
    // totalUsage.sonnet.outputTokens += summaryUsage.outputTokens;
    // totalUsage.sonnet.apiCalls += summaryUsage.apiCalls;
    // ========== END SONNET SYNTHESIS ==========

    // Report usage stats
    const usageReport = {
      groq: totalUsage.groq,
      totalInputTokens: totalUsage.groq.inputTokens,
      totalOutputTokens: totalUsage.groq.outputTokens,
      totalApiCalls: totalUsage.groq.apiCalls,
    };

    onProgress({
      type: "usage_stats",
      caseName,
      usage: usageReport,
    });

    // Pretty print usage to console
    console.log(`\n========== USAGE STATS: ${caseName} ==========`);
    console.log(`Groq:   ${usageReport.groq.apiCalls} calls, ${usageReport.groq.inputTokens.toLocaleString()} in / ${usageReport.groq.outputTokens.toLocaleString()} out`);
    console.log(`---------------------------------------------`);
    console.log(`TOTAL:  ${usageReport.totalApiCalls} API calls`);
    console.log(`        ${usageReport.totalInputTokens.toLocaleString()} input tokens`);
    console.log(`        ${usageReport.totalOutputTokens.toLocaleString()} output tokens`);
    console.log(`=============================================\n`);

    // Report usage to subscription server (fire-and-forget)
    const totalTokensUsed = usageReport.totalInputTokens + usageReport.totalOutputTokens;
    if (totalTokensUsed > 0) {
      reportUsage(totalTokensUsed, "indexing").catch(() => {});
    }

    // If this is a subcase, update parent's index to include it in related_cases
    if (options?.parentCase) {
      try {
        const parentIndexPath = join(options.parentCase.path, '.ai_tool', 'document_index.json');
        const parentContent = await readFile(parentIndexPath, 'utf-8');
        const parentIndex = JSON.parse(parentContent);

        // Initialize or update related_cases array
        const relatedCases = parentIndex.related_cases || [];
        const existingIdx = relatedCases.findIndex((rc: any) => rc.path === caseFolder);

        const relatedEntry = {
          path: caseFolder,
          name: caseName,
          type: "subcase" as const,
        };

        if (existingIdx >= 0) {
          relatedCases[existingIdx] = relatedEntry;
        } else {
          relatedCases.push(relatedEntry);
        }

        parentIndex.related_cases = relatedCases;
        await writeFile(parentIndexPath, JSON.stringify(parentIndex, null, 2));
        await writeIndexDerivedFiles(options.parentCase.path, parentIndex);
        console.log(`[Index] Updated parent index with related_cases`);
      } catch (parentErr) {
        // Parent index may not exist yet - that's ok
        console.warn(`[Index] Could not update parent index:`, parentErr);
      }
    }

    onProgress({ type: "case_done", caseName, success: true, diff: indexDiff });
    return { success: true, diff: indexDiff };

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (previousIndexContent !== null) {
      try {
        await writeFile(indexPath, previousIndexContent);
        try {
          const restored = JSON.parse(previousIndexContent);
          await writeIndexDerivedFiles(caseFolder, restored);
        } catch {
          // best effort only
        }
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
// Structure to track cases with their parent info for batch indexing
interface BatchIndexTarget {
  path: string;
  name: string;
  parentCase?: { path: string; name: string };
  // DOI container info (for WC multi-injury clients)
  containerInfo?: {
    path: string;
    clientName: string;
    injuryDate: string;
    siblingCases?: Array<{ path: string; name: string; dateOfInjury: string }>;
  };
  // Year-based mode: source folders for this client
  sourceFolders?: { firmRoot: string; folders: string[] };
}

// Track containers that need to be indexed first
interface ContainerToIndex {
  path: string;
  name: string;
  doiCases: Array<{ path: string; name: string; dateOfInjury: string }>;
  sharedFolders: string[];
}

app.post("/batch-index", async (c) => {
  const { root, cases: casesToIndex, practiceArea: requestedPracticeArea } = await c.req.json();

  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  const configuredPracticeArea = await resolveFirmPracticeArea(root);
  const practiceArea =
    configuredPracticeArea ||
    normalizePracticeArea(requestedPracticeArea) ||
    PRACTICE_AREAS.PI;
  const isWC = practiceArea === PRACTICE_AREAS.WC;

  // Build list of cases to index (including subcases and DOI cases)
  let targetCases: BatchIndexTarget[] = [];
  let containersToIndex: ContainerToIndex[] = [];

  if (casesToIndex && casesToIndex.length > 0) {
    // Specific cases provided - check type of each
    for (const casePath of casesToIndex) {
      const caseName = casePath.split('/').pop() || casePath;
      const parentPath = dirname(casePath);
      const parentName = parentPath.split('/').pop() || '';

      // Check if this is a DOI case (folder name matches DOI_YYYY-MM-DD)
      const doiParsed = parseDOIFolderName(caseName);
      if (doiParsed && parentPath !== root) {
        // This is a DOI case - need to also check siblings
        const parentDoiDetection = await detectDOISubfolders(parentPath);
        if (parentDoiDetection.isContainer) {
          // Find sibling DOI cases (excluding self)
          const siblings = parentDoiDetection.doiCases.filter(d => d.path !== casePath);

          // Add container if not already tracked
          if (!containersToIndex.find(c => c.path === parentPath)) {
            containersToIndex.push({
              path: parentPath,
              name: parentName,
              doiCases: parentDoiDetection.doiCases,
              sharedFolders: parentDoiDetection.sharedFolders,
            });
          }

          targetCases.push({
            path: casePath,
            name: caseName,
            containerInfo: {
              path: parentPath,
              clientName: parentName,
              injuryDate: doiParsed.date,
              siblingCases: siblings,
            },
          });
        }
      } else if (caseName.startsWith('.') && parentPath !== root) {
        // It's a subcase (dot-prefixed)
        targetCases.push({
          path: casePath,
          name: caseName,
          parentCase: { path: parentPath, name: parentName },
        });
      } else {
        // Regular case or container - check for DOI subfolders if WC
        if (isWC) {
          const doiDetection = await detectDOISubfolders(casePath);
          if (doiDetection.isContainer) {
            // This is a container - queue container and all its DOI cases
            containersToIndex.push({
              path: casePath,
              name: caseName,
              doiCases: doiDetection.doiCases,
              sharedFolders: doiDetection.sharedFolders,
            });

            for (const doiCase of doiDetection.doiCases) {
              const doiIndexPath = join(doiCase.path, ".ai_tool", "document_index.json");
              try {
                await stat(doiIndexPath);
                // DOI case already indexed, skip
              } catch {
                // Not indexed, add to list
                const siblings = doiDetection.doiCases.filter(d => d.path !== doiCase.path);
                targetCases.push({
                  path: doiCase.path,
                  name: doiCase.name,
                  containerInfo: {
                    path: casePath,
                    clientName: caseName,
                    injuryDate: doiCase.dateOfInjury,
                    siblingCases: siblings,
                  },
                });
              }
            }
            continue; // Skip regular subcase discovery for containers
          }
        }

        // Regular case
        targetCases.push({ path: casePath, name: caseName });

        // Also discover and add any unindexed subcases
        const subcasePaths = await discoverSubcases(casePath);
        for (const subcasePath of subcasePaths) {
          const subcaseName = subcasePath.split('/').pop() || subcasePath;
          const subcaseIndexPath = join(subcasePath, ".ai_tool", "document_index.json");
          try {
            await stat(subcaseIndexPath);
            // Subcase already indexed, skip
          } catch {
            // No index, add to list
            targetCases.push({
              path: subcasePath,
              name: subcaseName,
              parentCase: { path: casePath, name: caseName },
            });
          }
        }
      }
    }
  } else {
    // No specific cases provided - find all unindexed ones (including subcases and DOI cases)

    // Year-based mode: iterate registry clients instead of directory entries
    const batchYearMode = await detectYearBasedMode(root);
    if (batchYearMode) {
      let registry = await loadClientRegistry(root);
      if (!registry) {
        registry = await scanAndBuildRegistry(root);
      }
      for (const client of Object.values(registry.clients)) {
        const virtualPath = join(root, ".ai_tool", "clients", client.slug);
        const indexPath = join(virtualPath, ".ai_tool", "document_index.json");
        try {
          await stat(indexPath);
          // Already indexed, skip
        } catch {
          targetCases.push({
            path: virtualPath,
            name: client.name,
            sourceFolders: { firmRoot: root, folders: client.sourceFolders },
          });
        }
      }
    } else {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".ai_tool" || entry.name === ".ai_tool") continue;

        const casePath = join(root, entry.name);

        // For WC, check for DOI subfolders first
        if (isWC) {
          const doiDetection = await detectDOISubfolders(casePath);
          if (doiDetection.isContainer) {
            // This is a container - queue container and all its unindexed DOI cases
            containersToIndex.push({
              path: casePath,
              name: entry.name,
              doiCases: doiDetection.doiCases,
              sharedFolders: doiDetection.sharedFolders,
            });

            for (const doiCase of doiDetection.doiCases) {
              const doiIndexPath = join(doiCase.path, ".ai_tool", "document_index.json");
              try {
                await stat(doiIndexPath);
                // DOI case already indexed, skip
              } catch {
                // Not indexed, add to list
                const siblings = doiDetection.doiCases.filter(d => d.path !== doiCase.path);
                targetCases.push({
                  path: doiCase.path,
                  name: doiCase.name,
                  containerInfo: {
                    path: casePath,
                    clientName: entry.name,
                    injuryDate: doiCase.dateOfInjury,
                    siblingCases: siblings,
                  },
                });
              }
            }
            continue; // Skip regular case handling for containers
          }
        }

        // Regular case
        const indexPath = join(casePath, ".ai_tool", "document_index.json");
        try {
          await stat(indexPath);
          // Parent index exists, but check subcases
        } catch {
          // No parent index, add to list
          targetCases.push({ path: casePath, name: entry.name });
        }

        // Discover and add any unindexed subcases
        const subcasePaths = await discoverSubcases(casePath);
        for (const subcasePath of subcasePaths) {
          const subcaseName = subcasePath.split('/').pop() || subcasePath;
          const subcaseIndexPath = join(subcasePath, ".ai_tool", "document_index.json");
          try {
            await stat(subcaseIndexPath);
            // Subcase already indexed, skip
          } catch {
            // No index, add to list
            targetCases.push({
              path: subcasePath,
              name: subcaseName,
              parentCase: { path: casePath, name: entry.name },
            });
          }
        }
      }
    } catch (error) {
      return c.json({ error: "Could not read firm directory" }, 500);
    }
    } // close non-year-mode else
  }

  if (targetCases.length === 0) {
    return c.json({ message: "All cases are already indexed", indexed: 0 });
  }

  return streamSSE(c, async (stream) => {
    // Heartbeat keeps SSE alive during long Groq API calls
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) });
      } catch { /* stream closed */ }
    }, 30_000);

    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "start",
          totalCases: targetCases.length,
          containersToIndex: containersToIndex.length,
          cases: targetCases.map(t => ({
            path: t.path,
            name: t.name,
            isSubcase: !!t.parentCase,
            isDOICase: !!t.containerInfo,
          }))
        })
      });

      // Step 1: Index containers first (if any)
      for (const container of containersToIndex) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            message: `Indexing container: ${container.name}`,
          })
        });

        await indexContainer(
          container.path,
          container.sharedFolders,
          container.doiCases,
          practiceArea,
          async (event) => {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        );
      }

      // Step 2: Index all DOI cases and regular cases in parallel
      const results = await Promise.all(
        targetCases.map(target =>
          indexCase(target.path, async (event) => {
            // Stream progress events to client
            await stream.writeSSE({
              data: JSON.stringify(event)
            });
          }, {
            firmRoot: root,
            parentCase: target.parentCase,
            practiceArea,
            containerInfo: target.containerInfo,
            sourceFolders: target.sourceFolders,
          })
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
    } finally {
      clearInterval(heartbeat);
    }
  });
});

// Cache recent reindex checks to avoid rescanning large case trees on quick dashboard revisits.
const REINDEX_CHECK_TTL_MS = 15000;
const REINDEX_CHECK_CACHE_MAX = 512;
const reindexCheckCache = new Map<string, { value: boolean; checkedAt: number }>();

function pruneReindexCheckCache(now: number) {
  if (reindexCheckCache.size <= REINDEX_CHECK_CACHE_MAX) return;
  for (const [key, cached] of reindexCheckCache) {
    if (now - cached.checkedAt > REINDEX_CHECK_TTL_MS) {
      reindexCheckCache.delete(key);
    }
  }
}

// Helper to check if case needs reindexing
async function checkNeedsReindex(casePath: string, indexedAt: number): Promise<boolean> {
  const now = Date.now();
  const cacheKey = `${casePath}::${indexedAt}`;
  const cached = reindexCheckCache.get(cacheKey);
  if (cached && now - cached.checkedAt <= REINDEX_CHECK_TTL_MS) {
    return cached.value;
  }

  pruneReindexCheckCache(now);

  async function checkDir(dir: string): Promise<boolean> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const results = await Promise.all(
        entries
          .filter(entry => entry.name !== ".ai_tool")
          .map(async (entry) => {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              return checkDir(fullPath);
            }
            const stats = await stat(fullPath);
            return stats.mtimeMs > indexedAt;
          })
      );
      return results.some(r => r);
    } catch {
      return false;
    }
  }
  // Year-based: check actual source folders instead of the virtual path
  const slug = getClientSlug(casePath);
  let needsReindex = false;
  if (slug) {
    const firmRoot = resolveFirmRoot(casePath);
    const registry = await loadClientRegistry(firmRoot);
    if (registry?.clients[slug]) {
      for (const rel of registry.clients[slug].sourceFolders) {
        if (await checkDir(join(firmRoot, rel))) {
          needsReindex = true;
          break;
        }
      }
    }
  } else {
    needsReindex = await checkDir(casePath);
  }
  reindexCheckCache.set(cacheKey, { value: needsReindex, checkedAt: now });
  return needsReindex;
}

// ============================================================================
// HYPERGRAPH GENERATION - Cross-document consistency analysis
// ============================================================================

// ── Programmatic hypergraph augmentation ────────────────────────────────────
//
// The LLM analyzes chunked document indexes to build value→source mappings,
// but frequently misses values when the index is large. This function scans
// ALL extracted_data across every document and augments the LLM's hypergraph
// with ground-truth source counts so consensus is accurate.

/** Map of hypergraph field name → extracted_data keys that feed into it */
const HYPERGRAPH_FIELD_ALIASES: Record<string, string[]> = {
  // Common to PI and WC
  claimant_name: ["claimant_name", "client_name", "patient_name"],
  date_of_birth: ["date_of_birth", "dob"],
  client_phone: ["client_phone", "phone", "claimant_phone"],
  client_email: ["client_email", "email", "claimant_email"],
  client_address: ["client_address", "address", "claimant_address"],
  // PI-specific
  date_of_loss: ["date_of_loss", "dol"],
  claim_number_1p: ["claim_number_1p", "claimant_1p", "claim_1p"],
  claim_number_3p: ["claim_number_3p", "claimant_3p", "claim_3p"],
  policy_limits_1p: ["policy_limits_1p", "policy_limit_1p", "policy_limits_1", "policy1p"],
  policy_limits_3p: ["policy_limits_3p", "policy_limit_3p", "policy_limits_3", "policy3p", "insurance_3p_limits"],
  adjuster_name_1p: ["adjuster_name_1p", "first_party_adjuster_name", "1p_adjuster_name"],
  adjuster_phone_1p: ["adjuster_phone_1p", "first_party_adjuster_phone", "1p_adjuster_phone"],
  adjuster_email_1p: ["adjuster_email_1p", "first_party_adjuster_email", "1p_adjuster_email"],
  adjuster_name_3p: ["adjuster_name_3p", "third_party_adjuster_name", "3p_adjuster_name", "adjuster_name"],
  adjuster_phone_3p: ["adjuster_phone_3p", "third_party_adjuster_phone", "3p_adjuster_phone", "adjuster_phone"],
  adjuster_email_3p: ["adjuster_email_3p", "third_party_adjuster_email", "3p_adjuster_email", "adjuster_email"],
  health_insurance: ["health_insurance"],
  total_medical: ["total_medical", "total_medical_charges", "total_charges", "total_medical_cost"],
  insurance_claim_numbers: ["insurance_claim_numbers"],
  policy_limits: ["policy_limits"],
  provider_balances: ["provider_balances", "provider_balance"],
  // WC-specific
  date_of_injury: ["date_of_injury", "doi"],
  employer_name: ["employer_name", "employer"],
  employer_address: ["employer_address"],
  employer_phone: ["employer_phone"],
  job_title: ["job_title", "job_title_at_time_of_injury"],
  wc_carrier: ["wc_carrier", "wc_insurance_carrier", "carrier_name"],
  wc_claim_number: ["wc_claim_number", "claim_number", "claim"],
  tpa_name: ["tpa_name", "third_party_administrator"],
  tpa: ["tpa"],
  adjuster_name: ["adjuster_name"],
  adjuster_phone: ["adjuster_phone"],
  adjuster_email: ["adjuster_email"],
  disability_type: ["disability_type"],
  amw: ["amw", "average_monthly_wage", "aww"],
  compensation_rate: ["compensation_rate", "weekly_compensation_rate"],
  body_parts_injured: ["body_parts_injured", "body_parts"],
  injury_description: ["injury_description", "mechanism_of_injury", "incident_description"],
  providers: ["providers", "treating_physicians", "treating_providers"],
  mmi_date: ["mmi_date"],
  ppd_rating: ["ppd_rating"],
};

/** Build a reverse lookup: extracted_data key → hypergraph field name */
function buildAliasReverseMap(): Map<string, string> {
  const reverseMap = new Map<string, string>();
  for (const [hgField, aliases] of Object.entries(HYPERGRAPH_FIELD_ALIASES)) {
    for (const alias of aliases) {
      // First alias mapping wins (most specific)
      if (!reverseMap.has(alias)) {
        reverseMap.set(alias, hgField);
      }
    }
  }
  return reverseMap;
}

/** Normalize a value for grouping: lowercase, collapse whitespace, trim */
function normalizeDateForGrouping(value: string): string | null {
  const compact = value.replace(/\s+/g, " ").trim();

  const slashDate = compact.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashDate) {
    const [, m, d, yRaw] = slashDate;
    const yNum = yRaw.length === 2 ? Number(yRaw) + 2000 : Number(yRaw);
    const mm = m.padStart(2, "0");
    const dd = d.padStart(2, "0");
    return `${yNum.toString().padStart(4, "0")}-${mm}-${dd}`;
  }

  const alphaDate = compact.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (alphaDate) {
    const [, monthText, day, yearRaw] = alphaDate;
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
    const idx = months.indexOf(monthText.slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const yNum = yearRaw.length === 2 ? Number(yearRaw) + 2000 : Number(yearRaw);
      return `${yNum.toString()}-${String(idx + 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    }
  }

  return null;
}

function normalizeMoneyForGrouping(value: string): string | null {
  const compact = value.replace(/,/g, "").trim();
  const moneyMatch = compact.match(/^\$?\s*(\d+(?:\.\d{1,2})?)$/);
  if (!moneyMatch) return null;
  const amount = Number(moneyMatch[1]);
  if (Number.isNaN(amount)) return null;
  return `$${amount.toFixed(2)}`;
}

function normalizeForGrouping(value: string): string {
  const compact = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!compact) return "";

  return (
    normalizeDateForGrouping(compact)
    || normalizeMoneyForGrouping(compact)
    || compact
  );
}

function normalizeScalarValue(rawValue: unknown): string[] {
  if (typeof rawValue === "number") return [String(rawValue)];
  if (typeof rawValue === "boolean") return [rawValue ? "true" : "false"];
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((entry) => normalizeScalarValue(entry));
  }
  return [];
}

function addFieldValue(
  fieldValues: Map<string, Map<string, { canonical: string; canonicalCount: Map<string, number>; sources: Set<string> }>>,
  field: string,
  rawValue: unknown,
  filename: string
): void {
  for (const scalar of normalizeScalarValue(rawValue)) {
    const normalized = normalizeForGrouping(scalar);
    if (!normalized) continue;

    if (!fieldValues.has(field)) {
      fieldValues.set(field, new Map());
    }
    const values = fieldValues.get(field)!;
    const entry = values.get(normalized) || {
      canonical: scalar,
      canonicalCount: new Map<string, number>(),
      sources: new Set<string>([filename]),
    };
    const count = entry.canonicalCount.get(scalar) || 0;
    entry.canonicalCount.set(scalar, count + 1);
    entry.sources.add(filename);

    let bestCasing = entry.canonical;
    let bestCount = 0;
    for (const [form, formCount] of entry.canonicalCount) {
      if (formCount > bestCount) {
        bestCount = formCount;
        bestCasing = form;
      }
    }
    entry.canonical = bestCasing;
    values.set(normalized, entry);
  }
}

function addInsuranceFields(
  side: "1p" | "3p",
  insuranceValue: Record<string, any>,
  filename: string,
  fieldValues: Map<string, Map<string, { canonical: string; canonicalCount: Map<string, number>; sources: Set<string> }>>,
): void {
  if (!insuranceValue || typeof insuranceValue !== "object") return;

  const claimNumber = insuranceValue.claim_number || insuranceValue.policy_number || insuranceValue.claimNo;
  if (claimNumber) {
    addFieldValue(fieldValues, `claim_number_${side}`, claimNumber, filename);
  }

  const carrier = insuranceValue.carrier || insuranceValue.insurer || insuranceValue.insured_name;
  if (carrier) {
    addFieldValue(fieldValues, side === "1p" ? "wc_carrier" : "wc_carrier", carrier, filename);
  }

  const adjusterName = insuranceValue.adjuster_name || insuranceValue.adjuster;
  if (adjusterName) {
    addFieldValue(fieldValues, side === "1p" ? "adjuster_name_1p" : "adjuster_name_3p", adjusterName, filename);
  }

  const adjusterPhone = insuranceValue.adjuster_phone || insuranceValue.adjuster_phone_number;
  if (adjusterPhone) {
    addFieldValue(fieldValues, side === "1p" ? "adjuster_phone_1p" : "adjuster_phone_3p", adjusterPhone, filename);
  }

  const adjusterEmail = insuranceValue.adjuster_email || insuranceValue.adjuster_email_address;
  if (adjusterEmail) {
    addFieldValue(fieldValues, side === "1p" ? "adjuster_email_1p" : "adjuster_email_3p", adjusterEmail, filename);
  }

  if (carrier || insuranceValue.bodily_injury || insuranceValue.medical_payments || insuranceValue.um_uim || insuranceValue.property_damage) {
    const policyPayload: Record<string, string> = {};
    if (carrier) policyPayload.carrier = String(carrier).trim();
    if (insuranceValue.bodily_injury) policyPayload.bodily_injury = String(insuranceValue.bodily_injury).trim();
    if (insuranceValue.medical_payments) policyPayload.medical_payments = String(insuranceValue.medical_payments).trim();
    if (insuranceValue.um_uim) policyPayload.um_uim = String(insuranceValue.um_uim).trim();
    if (insuranceValue.property_damage) policyPayload.property_damage = String(insuranceValue.property_damage).trim();
    if (insuranceValue.policy_number) policyPayload.policy_number = String(insuranceValue.policy_number).trim();
    addFieldValue(fieldValues, side === "1p" ? "policy_limits_1p" : "policy_limits_3p", JSON.stringify(policyPayload), filename);
  }
}

function buildDeterministicHypergraph(documentIndex: Record<string, any>): HypergraphResult {
  const aliasMap = buildAliasReverseMap();
  const fieldValues = new Map<string, Map<string, { canonical: string; canonicalCount: Map<string, number>; sources: Set<string> }>>();
  const addField = (field: string, value: unknown, source: string) => addFieldValue(fieldValues, field, value, source);

  const rawFolders = documentIndex.folders || {};
  for (const [_folderName, folderData] of Object.entries(rawFolders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files;
    if (!Array.isArray(files)) continue;

    for (const file of files) {
      const filename = file?.filename || "unknown";
      const extracted = file?.extracted_data;
      if (!extracted || typeof extracted !== "object") continue;

      for (const [key, rawValue] of Object.entries(extracted as Record<string, any>)) {
        const hgField = aliasMap.get(key);

        if (hgField) {
          addField(hgField, rawValue, filename);
        }

        if (typeof key === "string" && (key.startsWith("charges:") || key.startsWith("provider_charges:"))) {
          addField(key, rawValue, filename);
          continue;
        }

        if (key === "insurance_1p") {
          addInsuranceFields("1p", rawValue as Record<string, any>, filename, fieldValues);
          continue;
        }
        if (key === "insurance_3p") {
          addInsuranceFields("3p", rawValue as Record<string, any>, filename, fieldValues);
          continue;
        }

        if (key === "charges" || key === "provider_charges") {
          if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
            for (const [provider, chargeValue] of Object.entries(rawValue)) {
              if (provider) {
                addField(`charges:${provider}`, chargeValue, filename);
              }
            }
          }
          continue;
        }

        if (key === "health_insurance" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
          addField("health_insurance", JSON.stringify(rawValue), filename);
          continue;
        }

        if (key === "provider_balances" && rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
          for (const [provider, balanceValue] of Object.entries(rawValue)) {
            addField(`provider_balances:${provider}`, balanceValue, filename);
          }
          continue;
        }
      }
    }
  }

  const hypergraph: HypergraphResult["hypergraph"] = {};
  const conflicts: HypergraphResult["conflicts"] = [];

  for (const [field, valueMap] of fieldValues) {
    const orderedValues = Array.from(valueMap.values()).map((entry) => ({
      value: entry.canonical,
      sources: Array.from(entry.sources),
      count: entry.sources.size,
    }));
    orderedValues.sort((a, b) => b.count - a.count);

    const totalMentions = orderedValues.reduce((sum, item) => sum + item.count, 0);
    const topCount = orderedValues[0]?.count || 0;
    const secondCount = orderedValues[1]?.count || 0;
    const consensusValue = orderedValues.length > 1 && topCount === secondCount
      ? "UNCERTAIN"
      : (orderedValues[0]?.value || "");
    const confidence = totalMentions > 0 && consensusValue !== "UNCERTAIN"
      ? topCount / totalMentions
      : 0;

    hypergraph[field] = {
      values: orderedValues,
      consensus: consensusValue,
      confidence,
      has_conflict: orderedValues.length > 1,
    };

    if (orderedValues.length > 1) {
      const consensusSources = consensusValue === "UNCERTAIN" ? [] : (orderedValues[0]?.sources || []);
      for (let i = 0; i < orderedValues.length; i++) {
        if (i > 0 || consensusValue === "UNCERTAIN") {
          const candidate = orderedValues[i];
          conflicts.push({
            field,
            consensus_value: consensusValue,
            consensus_sources: [...consensusSources],
            outlier_value: candidate.value,
            outlier_sources: [...candidate.sources],
          });
        }
      }
    }
  }

  return {
    hypergraph,
    conflicts: conflicts.filter((item, idx, arr) => {
      const key = `${item.field}|${item.consensus_value}|${item.outlier_value}`;
      return arr.findIndex((other) => `${other.field}|${other.consensus_value}|${other.outlier_value}` === key) === idx;
    }),
    summary: {
      total_fields_analyzed: Object.keys(hypergraph).length,
      fields_with_conflicts: Object.keys(hypergraph).filter((field) => hypergraph[field]?.has_conflict).length,
      confidence_score: Object.keys(hypergraph).length > 0
        ? Object.values(hypergraph).reduce((sum, node) => sum + (node.confidence || 0), 0) / Object.keys(hypergraph).length
        : 0,
    },
  };
}

function buildHypergraphReviewPayload(hypergraph: HypergraphResult["hypergraph"]) {
  return {
    reviewTargets: Object.entries(hypergraph)
      .filter(([, node]) => node.has_conflict || node.consensus === "UNCERTAIN")
      .map(([field, node]) => ({
        field,
        consensus: node.consensus,
        confidence: node.confidence,
        values: node.values,
      })),
  };
}

function annotateConflictReasons(
  conflictMap: Map<string, HypergraphResult["conflicts"][number]>,
  annotations: Array<{ field: string; likely_reason: string }>
): void {
  const byField = new Map<string, string>();
  for (const item of annotations) {
    const field = (item.field || "").trim();
    if (!field || !item.likely_reason) continue;
    byField.set(field, String(item.likely_reason).trim());
  }

  for (const conflict of conflictMap.values()) {
    const reason = byField.get(conflict.field);
    if (reason) {
      conflict.likely_reason = reason;
    }
  }
}

// Backward-compat helper: preserve old post-LMM augmentation path if needed.
// Keep existing augmentation helper for fallback-only scenarios and debugging.
function deprecatedAugmentHypergraphFromExtractedData(
  hypergraph: Record<string, {
    values: Array<{ value: string; sources: string[]; count: number }>;
    consensus: string;
    confidence: number;
    has_conflict: boolean;
  }>,
  conflictMap: Map<string, any>,
  documentIndex: Record<string, any>
): void {
  augmentHypergraphFromExtractedData(hypergraph, conflictMap, documentIndex);
}

/**
 * Scan all extracted_data in the document index and augment the hypergraph
 * with accurate source counts. Then recompute consensus for each field.
 */
function augmentHypergraphFromExtractedData(
  hypergraph: Record<string, {
    values: Array<{ value: string; sources: string[]; count: number }>;
    consensus: string;
    confidence: number;
    has_conflict: boolean;
  }>,
  conflictMap: Map<string, any>,
  documentIndex: Record<string, any>
): void {
  const aliasMap = buildAliasReverseMap();

  // Collect: hgField → normalizedValue → { canonical: string (most common casing), sources: Set<filename> }
  const fieldValues = new Map<string, Map<string, { canonical: string; canonicalCount: Map<string, number>; sources: Set<string> }>>();

  const rawFolders = documentIndex.folders || {};
  for (const [_folderName, folderData] of Object.entries(rawFolders) as [string, any][]) {
    const files = Array.isArray(folderData) ? folderData : folderData?.files;
    if (!Array.isArray(files)) continue;

    for (const file of files) {
      const filename = file?.filename;
      if (!filename || !file?.extracted_data) continue;

      const ed = file.extracted_data as Record<string, unknown>;
      for (const [key, rawValue] of Object.entries(ed)) {
        const hgField = aliasMap.get(key);
        if (!hgField) continue;

        // Only process string/number values
        const strValue = typeof rawValue === "string" ? rawValue.trim()
          : typeof rawValue === "number" ? String(rawValue)
          : null;
        if (!strValue) continue;

        const normalized = normalizeForGrouping(strValue);
        if (!normalized) continue;

        if (!fieldValues.has(hgField)) {
          fieldValues.set(hgField, new Map());
        }
        const valMap = fieldValues.get(hgField)!;

        if (!valMap.has(normalized)) {
          valMap.set(normalized, { canonical: strValue, canonicalCount: new Map([[strValue, 1]]), sources: new Set([filename]) });
        } else {
          const entry = valMap.get(normalized)!;
          entry.sources.add(filename);
          // Track most common exact casing
          entry.canonicalCount.set(strValue, (entry.canonicalCount.get(strValue) || 0) + 1);
          // Update canonical to most frequent casing
          let bestCount = 0;
          for (const [form, count] of entry.canonicalCount) {
            if (count > bestCount) {
              bestCount = count;
              entry.canonical = form;
            }
          }
        }
      }
    }
  }

  // Augment each hypergraph field with programmatic data
  for (const [hgField, valueMap] of fieldValues) {
    if (!hypergraph[hgField]) {
      hypergraph[hgField] = { values: [], consensus: "", confidence: 0, has_conflict: false };
    }
    const node = hypergraph[hgField];

    // Build a normalized lookup for existing LLM values
    const existingByNorm = new Map<string, number>(); // normalized → index in node.values
    for (let i = 0; i < node.values.length; i++) {
      existingByNorm.set(normalizeForGrouping(node.values[i].value), i);
    }

    // Merge programmatic values into the node
    for (const [normalized, entry] of valueMap) {
      const existingIdx = existingByNorm.get(normalized);
      if (existingIdx !== undefined) {
        // LLM already has this value — add any missing sources
        const existing = node.values[existingIdx];
        const sourceSet = new Set(existing.sources);
        for (const src of entry.sources) sourceSet.add(src);
        existing.sources = Array.from(sourceSet);
        existing.count = existing.sources.length;
      } else {
        // LLM missed this value entirely — add it
        node.values.push({
          value: entry.canonical,
          sources: Array.from(entry.sources),
          count: entry.sources.size,
        });
      }
    }

    // Recompute consensus: sort by count desc, pick winner
    node.values.sort((a, b) => b.count - a.count);
    const totalMentions = node.values.reduce((sum, v) => sum + v.count, 0);
    const topCount = node.values[0]?.count || 0;
    const secondCount = node.values[1]?.count || 0;

    // If tied at top, mark UNCERTAIN
    if (node.values.length > 1 && topCount === secondCount) {
      node.consensus = "UNCERTAIN";
      node.confidence = 0;
    } else {
      node.consensus = node.values[0]?.value || "";
      node.confidence = totalMentions > 0 ? topCount / totalMentions : 0;
    }
    node.has_conflict = node.values.length > 1;
  }

  // Rebuild conflicts from augmented hypergraph
  conflictMap.clear();
  for (const [field, node] of Object.entries(hypergraph)) {
    if (!node.has_conflict || node.values.length < 2) continue;

    const consensusValue = node.consensus;
    const consensusSources = node.consensus !== "UNCERTAIN" ? node.values[0]?.sources || [] : [];

    for (let i = (consensusValue === "UNCERTAIN" ? 0 : 1); i < node.values.length; i++) {
      const outlier = node.values[i];
      const key = `${field}|${consensusValue}|${outlier.value}`;
      if (!conflictMap.has(key)) {
        conflictMap.set(key, {
          field,
          consensus_value: consensusValue,
          consensus_sources: [...consensusSources],
          outlier_value: outlier.value,
          outlier_sources: [...outlier.sources],
        });
      }
    }
  }

  // Log augmentation results
  let augmentedFields = 0;
  for (const [field, node] of Object.entries(hypergraph)) {
    if (fieldValues.has(field)) augmentedFields++;
  }
  console.log(`[Hypergraph] Programmatic augmentation: ${augmentedFields} fields cross-checked against extracted_data`);
}

// System prompt for hypergraph generation (Haiku) - Personal Injury
const hypergraphSystemPromptPI = `You are a data consistency analyzer for a Personal Injury law firm.

YOUR TASK: Read a document index JSON and build a hypergraph that groups related data points across documents to identify inconsistencies.

HYPERGRAPH STRUCTURE:
- Each "hyperedge" groups all mentions of a semantic field (e.g., all dates of loss, all DOBs, all charges for a provider)
- Nodes within a hyperedge should have the same value if extracted correctly
- Inconsistencies = nodes in same hyperedge with different values

FIELDS TO TRACK:
1. date_of_loss / dol - The accident date (critical - appears in many docs)
2. date_of_birth / dob - Client DOB
3. client_name - Client's full name
4. client_phone / phone - Client phone number (primarily in intake forms)
5. client_email / email - Client email address (primarily in intake forms)
6. client_address / address - Client mailing address (primarily in intake forms)
7. claim_number_1p - First party claim number (from insurance_1p.claim_number)
8. claim_number_3p - Third party claim number (from insurance_3p.claim_number)
9. policy_limits_1p - Client's own policy limits. Look for insurance_1p object with:
   - carrier, bodily_injury, medical_payments, um_uim, property_damage
   - Output as JSON object: {"carrier": "X", "bodily_injury": "Y", ...}
10. policy_limits_3p - At-fault party's policy limits. Look for insurance_3p object with:
    - carrier, bodily_injury, property_damage, insured_name
    - Output as JSON object: {"carrier": "X", "bodily_injury": "Y", ...}
11. charges - Medical charges by provider. Use field name format "charges:Provider Name" (e.g., "charges:Spinal Rehab Center")
12. provider_balances - Outstanding balances by provider
13. total_medical - Total medical specials
14. health_insurance - Look for health_insurance object with carrier, group_no, member_no
    - Output as JSON object: {"carrier": "X", "group_no": "Y", "member_no": "Z"}
15. adjuster_name_3p - Third party (at-fault carrier) adjuster name. Look in insurance_3p.adjuster_name
16. adjuster_phone_3p - Third party adjuster phone. Look in insurance_3p.adjuster_phone
17. adjuster_email_3p - Third party adjuster email. Look in insurance_3p.adjuster_email
18. adjuster_name_1p - First party (client's carrier) adjuster name. Look in insurance_1p.adjuster_name
19. adjuster_phone_1p - First party adjuster phone. Look in insurance_1p.adjuster_phone
20. adjuster_email_1p - First party adjuster email. Look in insurance_1p.adjuster_email
    - NOTE: If adjuster_name/phone/email appear at top level (not inside insurance_1p/3p), treat them as 3P adjuster info

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

// System prompt for hypergraph generation (Haiku) - Workers' Compensation
const hypergraphSystemPromptWC = `You are a data consistency analyzer for a Workers' Compensation law firm.

YOUR TASK: Read a document index JSON and build a hypergraph that groups related data points across documents to identify inconsistencies.

HYPERGRAPH STRUCTURE:
- Each "hyperedge" groups all mentions of a semantic field (e.g., all dates of injury, all DOBs, all AMW values)
- Nodes within a hyperedge should have the same value if extracted correctly
- Inconsistencies = nodes in same hyperedge with different values

FIELDS TO TRACK:
1. date_of_injury / doi - The work injury date (critical - appears in many docs)
2. date_of_birth / dob - Client DOB
3. client_name / claimant_name - Client's full name
4. client_phone / phone - Client phone number
5. client_email / email - Client email address
6. client_address / address - Client mailing address
7. employer_name / employer - Employer company name (critical for WC)
8. employer_address - Employer address
9. employer_phone - Employer phone
10. job_title - Client's job title/position
11. wc_carrier / wc_insurance_carrier - Workers' comp insurance carrier name
12. wc_claim_number / claim_number - WC claim number
13. tpa_name / third_party_administrator - Third Party Administrator (e.g., CCMSI)
14. adjuster_name - Claims adjuster name
15. adjuster_phone - Claims adjuster phone
16. amw / average_monthly_wage - Average Monthly Wage (critical for benefits calculation)
17. compensation_rate / weekly_compensation_rate - Weekly benefit rate
18. disability_type - TTD/TPD/PPD/PTD status
19. injury_description - Description of injury mechanism
20. body_parts / body_parts_injured - Affected body parts
21. providers - Treating physicians/facilities
22. mmi_date - Maximum Medical Improvement date
23. ppd_rating - Permanent Partial Disability rating percentage

ANALYSIS RULES:
1. Normalize values for comparison:
   - Dates: treat "6/25/2023", "06/25/2023", "6/25/23" as equivalent
   - Money: treat "$6,558", "6558", "6,558.00" as equivalent
   - Names: ignore minor variations (case, spacing)
   - Employer: "Caesars Palace" = "CAESARS PALACE" = "Caesar's Palace"
2. Count how many documents support each value
3. Majority value = consensus (higher confidence)
4. Flag outliers with their source documents

HANDLING UNCERTAINTY:
- If document counts are EQUAL (e.g., 1:1 or 2:2), do NOT declare a consensus. Set consensus to "UNCERTAIN" and confidence to 0.
- Do NOT guess which document is "more authoritative" or "more recent" - that's not your job.
- AMW and compensation_rate conflicts are CRITICAL - always flag them.

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
      "likely_reason": "<optional explanation>"
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
- AMW and compensation_rate are CRITICAL for WC - always extract if present
- If a field appears in only one document, confidence is lower but no conflict`;

// Helper to get the right hypergraph prompt based on practice area
function getHypergraphPrompt(practiceArea?: string): string {
  if (practiceArea === PRACTICE_AREAS.WC) {
    return hypergraphSystemPromptWC;
  }
  return hypergraphSystemPromptPI;
}

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
  documentIndex: Record<string, any>,
  practiceArea?: string
): Promise<HypergraphResult> {
  console.log(`\n========== GENERATING HYPERGRAPH (${practiceArea || 'PI'}) ==========`);

  const usage: UsageStats = {
    inputTokens: 0,
    inputTokensNew: 0,
    inputTokensCacheWrite: 0,
    inputTokensCacheRead: 0,
    outputTokens: 0,
    apiCalls: 0,
    model: 'groq'
  };

  const deterministic = buildDeterministicHypergraph(documentIndex);
  const fields = Object.keys(deterministic.hypergraph);
  const mergedHypergraph = deterministic.hypergraph;

  const conflictMap = new Map<string, HypergraphResult["conflicts"][number]>();
  for (const conflict of deterministic.conflicts) {
    const key = `${conflict.field}|${conflict.consensus_value}|${conflict.outlier_value}`;
    if (!conflictMap.has(key)) {
      conflictMap.set(key, { ...conflict });
    }
  }

  const reviewTargets = buildHypergraphReviewPayload(mergedHypergraph);
  if (reviewTargets.reviewTargets.length > 0) {
    try {
      const payloadJson = JSON.stringify(reviewTargets, null, 2);
      const llmReview = await generateHypergraphConflictReviewWithGptOss(payloadJson);
      usage.inputTokensNew += llmReview.usage.inputTokens;
      usage.outputTokens += llmReview.usage.outputTokens;
      usage.apiCalls += 1;
      annotateConflictReasons(conflictMap, llmReview.result.annotations);
      console.log(`[Hypergraph] Reviewed ${reviewTargets.reviewTargets.length} uncertain/conflict candidates with LLM`);
    } catch (error) {
      console.warn("[Hypergraph] Conflict review call failed; proceeding without generated reasons", error);
    }
  }

  usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;

  // Optional fallback path for diagnostics
  if (process.env.HYPERGRAPH_USE_LLm_AUGMENT === "true") {
    deprecatedAugmentHypergraphFromExtractedData(mergedHypergraph, conflictMap, documentIndex);
  }

  const fieldsWithConflicts = fields.filter((field) => mergedHypergraph[field].has_conflict).length;
  const avgConfidence = fields.length > 0
    ? fields.reduce((sum, field) => sum + (mergedHypergraph[field].confidence || 0), 0) / fields.length
    : 0;

  const result: HypergraphResult = {
    hypergraph: mergedHypergraph,
    conflicts: Array.from(conflictMap.values()),
    summary: {
      total_fields_analyzed: fields.length,
      fields_with_conflicts: fieldsWithConflicts,
      confidence_score: avgConfidence,
    },
    usage,
  };

  console.log(`Hypergraph generated (Groq GPT-OSS):`);
  console.log(`  Fields analyzed: ${result.summary.total_fields_analyzed}`);
  console.log(`  Conflicts found: ${result.summary.fields_with_conflicts}`);
  console.log(`  Confidence: ${(result.summary.confidence_score * 100).toFixed(0)}%`);
  console.log(`  Usage: ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out`);
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
  const indexPath = join(caseFolder, ".ai_tool", "document_index.json");

  try {
    const indexContent = await readFile(indexPath, "utf-8");
    const documentIndex = JSON.parse(indexContent);

    // Detect practice area from existing index
    const practiceArea = documentIndex.practice_area;

    const hypergraph = await generateHypergraph(caseFolder, documentIndex, practiceArea);

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

interface ScopeAssignment {
  userId: string;
}

interface ScopeResolutionInput {
  role: string;
  permissions: {
    canManageTeam: boolean;
    canViewAllCases: boolean;
  };
}

function normalizeScopeAssignments(input: unknown): ScopeAssignment[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (assignment): assignment is ScopeAssignment =>
      !!assignment &&
      typeof assignment === "object" &&
      typeof (assignment as any).userId === "string"
  );
}

function isVisibleInScope(
  assignments: ScopeAssignment[],
  scope: FirmChatScope,
  actorUserId: string
): boolean {
  if (scope.mode === "firm") return true;
  if (scope.mode === "mine") {
    return assignments.some((assignment) => assignment.userId === actorUserId);
  }
  return assignments.some((assignment) => assignment.userId === scope.memberId);
}

function defaultScopeForRole(role: string): FirmChatScope {
  if (role === "case_manager") {
    return { mode: "mine" };
  }
  return { mode: "firm" };
}

function resolveFirmChatScope(
  rawScope: unknown,
  context: ScopeResolutionInput,
  teamMemberIds: Set<string>
): { ok: true; scope: FirmChatScope } | { ok: false; error: string } {
  const fallback = defaultScopeForRole(context.role);

  if (!rawScope || typeof rawScope !== "object") {
    return { ok: true, scope: fallback };
  }

  const scopeInput = rawScope as { mode?: string; memberId?: string };
  const mode = scopeInput.mode;

  if (mode === "mine") {
    return { ok: true, scope: { mode: "mine" } };
  }

  if (mode === "member") {
    if (!context.permissions.canManageTeam) {
      return { ok: false, error: "insufficient_permissions" };
    }
    if (!scopeInput.memberId || !teamMemberIds.has(scopeInput.memberId)) {
      return { ok: false, error: "invalid_member_scope" };
    }
    return { ok: true, scope: { mode: "member", memberId: scopeInput.memberId } };
  }

  if (mode === "firm") {
    if (!context.permissions.canViewAllCases) {
      return { ok: true, scope: { mode: "mine" } };
    }
    return { ok: true, scope: { mode: "firm" } };
  }

  return { ok: true, scope: fallback };
}

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
    assignedTo: string[];
  }>;
  aggregates: {
    totalSpecials: number;
    casesByPhase: Record<string, number>;
    solUrgent: number; // cases with SOL < 90 days
  };
}

// Build aggregated firm context from case summaries
async function buildFirmContext(
  root: string,
  scope: FirmChatScope,
  actorUserId: string,
  memberById: Map<string, { id: string; email: string; name?: string }>
): Promise<FirmContext> {
  const entries = await readdir(root, { withFileTypes: true });
  const caseSummaries: FirmContext['caseSummaries'] = [];
  const casesByPhase: Record<string, number> = {};
  let totalSpecials = 0;
  let solUrgent = 0;
  let indexedCount = 0;
  let visibleCaseCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".ai_tool") continue;

    const casePath = join(root, entry.name);
    const indexPath = join(casePath, ".ai_tool", "document_index.json");

    try {
      const indexContent = await readFile(indexPath, "utf-8");
      const index = JSON.parse(indexContent);
      const assignments = normalizeScopeAssignments(index.assignments);
      if (!isVisibleInScope(assignments, scope, actorUserId)) {
        continue;
      }
      visibleCaseCount++;
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
        const dolDate = parseFlexibleDate(dateOfLoss);
        if (dolDate) {
          const solDate = new Date(dolDate);
          solDate.setFullYear(solDate.getFullYear() + 2);
          statuteOfLimitations = formatDateYYYYMMDD(solDate);
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

      // Extract policy limits - handle both flat keys and nested structure
      let policyLimits: string | undefined;
      const limits = index.policy_limits || index.summary?.policy_limits;
      if (typeof limits === 'string') {
        policyLimits = limits;
      } else if (typeof limits === 'object' && limits !== null) {
        // Try flat keys first (3P_bi), then nested structure (3P.bodily_injury)
        const biValue = limits['3P_bi'] || limits['3p_bi'] || limits['bi'] || limits['bodily_injury']
          || limits['3P']?.bodily_injury || limits['3p']?.bodily_injury;
        if (typeof biValue === 'string') policyLimits = biValue;
      }

      // Track phase counts
      casesByPhase[casePhase] = (casesByPhase[casePhase] || 0) + 1;
      totalSpecials += specials;
      const assignedTo = assignments.map((assignment) => {
        const member = memberById.get(assignment.userId);
        if (!member) return assignment.userId;
        return member.name ? `${member.name} (${member.email})` : member.email;
      });

      caseSummaries.push({
        name: entry.name,
        clientName,
        casePhase,
        dateOfLoss,
        totalSpecials: specials,
        solDaysRemaining,
        providers,
        policyLimits,
        assignedTo,
      });
    } catch {
      // Case not indexed
      if (scope.mode === "firm") {
        visibleCaseCount++;
      }
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
    caseCount: visibleCaseCount,
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
  const { root, message, sessionId: providedSessionId, scope: rawScope } = await c.req.json();

  if (!root || !message) {
    return c.json({ error: "root and message required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  const activeMembers = access.team.members.filter((member) => member.status === "active");
  const scopedMemberIds = new Set(
    activeMembers
      .filter((member) => member.role === "case_manager" || member.role === "case_manager_assistant")
      .map((member) => member.id)
  );
  const scopeResult = resolveFirmChatScope(rawScope, access.context, scopedMemberIds);
  if (!scopeResult.ok) {
    return c.json({ error: scopeResult.error }, 403);
  }
  const scope = scopeResult.scope;
  const memberById = new Map(
    activeMembers.map((member) => [member.id, { id: member.id, email: member.email, name: member.name }])
  );

  const systemPrompt = await loadFirmSystemPrompt();
  const sessionId = providedSessionId || (await getFirmSession(root));

  // Build firm context
  const firmContext = await buildFirmContext(root, scope, access.context.userId, memberById);
  const scopeLabel = scope.mode === "firm"
    ? "firm"
    : scope.mode === "mine"
      ? "my cases"
      : `${memberById.get(scope.memberId)?.name || memberById.get(scope.memberId)?.email || "selected team member"}'s cases`;

  // Format context for the prompt
  const contextString = `
FIRM PORTFOLIO CONTEXT:
- Active Scope: ${scopeLabel}
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
  Policy: ${c.policyLimits || 'Unknown'} | Providers: ${c.providers.length > 0 ? c.providers.join(', ') : 'None listed'} | Assigned: ${c.assignedTo.length > 0 ? c.assignedTo.join(', ') : 'Unassigned'}
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
          ...getSDKCliOptions(),
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

// Direct firm chat - lightweight Haiku-based chat with tools
app.post("/direct-chat", async (c) => {
  const { root, message, history = [], scope: rawScope } = await c.req.json();

  if (!root || !message) {
    return c.json({ error: "root and message required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
  }

  const activeMembers = access.team.members.filter((member) => member.status === "active");
  const scopedMemberIds = new Set(
    activeMembers
      .filter((member) => member.role === "case_manager" || member.role === "case_manager_assistant")
      .map((member) => member.id)
  );
  const scopeResult = resolveFirmChatScope(rawScope, access.context, scopedMemberIds);
  if (!scopeResult.ok) {
    return c.json({ error: scopeResult.error }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of directFirmChat(root, message, history, {
        scope: scopeResult.scope,
        actorUserId: access.context.userId,
        teamMembers: activeMembers.map((member) => ({
          id: member.id,
          email: member.email,
          name: member.name,
        })),
      })) {
        // Report usage when done
        if (event.type === "done" && event.usage) {
          const totalTokens = (event.usage.inputTokens || 0) + (event.usage.outputTokens || 0);
          if (totalTokens > 0) {
            reportUsage(totalTokens, "firm_chat").catch(() => {});
          }
        }
        await stream.writeSSE({
          data: JSON.stringify(event)
        });
      }
    } catch (error) {
      console.error("Direct firm chat error:", error);
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
  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
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

const FIRM_DIR = ".ai_tool";

// Get firm todos
app.get("/todos", async (c) => {
  const root = c.req.query("root");

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
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

  const access = await requireFirmAccess(c, root);
  if (!access.ok) {
    return access.response;
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

// =============================================================================
// CASE ASSIGNMENT ENDPOINTS
// =============================================================================

// Assign users to a case
app.put("/case/assign", async (c) => {
  const { casePath, userIds, assignedBy } = await c.req.json();

  if (!casePath || !userIds || !assignedBy) {
    return c.json({ error: "casePath, userIds, and assignedBy are required" }, 400);
  }

  if (!Array.isArray(userIds)) {
    return c.json({ error: "userIds must be an array" }, 400);
  }

  const access = await requireCaseAccess(c, casePath);
  if (!access.ok) {
    return access.response;
  }
  if (!access.context.permissions.canAssignCases) {
    return c.json({ error: "insufficient_permissions" }, 403);
  }

  try {
    const indexPath = join(casePath, ".ai_tool", "document_index.json");

    if (!existsSync(indexPath)) {
      return c.json({ error: "Case index not found" }, 404);
    }

    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Initialize or update assignments
    const existingAssignments = index.assignments || [];
    const existingUserIds = new Set(existingAssignments.map((a: { userId: string }) => a.userId));

    // Add new assignments (don't duplicate)
    const now = new Date().toISOString();
    for (const userId of userIds) {
      if (!existingUserIds.has(userId)) {
        existingAssignments.push({
          userId,
          assignedAt: now,
          assignedBy: assignedBy.toLowerCase(),
        });
      }
    }

    index.assignments = existingAssignments;

    // Normalize and save
    const normalized = normalizeIndex(index);
    await writeFile(indexPath, JSON.stringify(normalized, null, 2));
    await writeIndexDerivedFiles(casePath, normalized);

    return c.json({ success: true, assignments: normalized.assignments });
  } catch (error) {
    console.error("Assign case error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Remove assignment from a case
app.delete("/case/unassign", async (c) => {
  const casePath = c.req.query("casePath");
  const userId = c.req.query("userId");

  if (!casePath || !userId) {
    return c.json({ error: "casePath and userId query params are required" }, 400);
  }

  const access = await requireCaseAccess(c, casePath);
  if (!access.ok) {
    return access.response;
  }
  if (!access.context.permissions.canAssignCases) {
    return c.json({ error: "insufficient_permissions" }, 403);
  }

  try {
    const indexPath = join(casePath, ".ai_tool", "document_index.json");

    if (!existsSync(indexPath)) {
      return c.json({ error: "Case index not found" }, 404);
    }

    const indexContent = await readFile(indexPath, "utf-8");
    const index = JSON.parse(indexContent);

    // Remove the assignment
    const existingAssignments = index.assignments || [];
    index.assignments = existingAssignments.filter((a: { userId: string }) => a.userId !== userId);

    // Normalize and save
    const normalized = normalizeIndex(index);
    await writeFile(indexPath, JSON.stringify(normalized, null, 2));
    await writeIndexDerivedFiles(casePath, normalized);

    return c.json({ success: true, assignments: normalized.assignments });
  } catch (error) {
    console.error("Unassign case error:", error);
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

// Export indexCase for use by other routes (e.g., claude.ts /init endpoint)
export { indexCase, generateHypergraph };
export default app;
