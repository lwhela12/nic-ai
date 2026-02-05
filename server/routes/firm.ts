import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

// SDK CLI options helper - handles both direct and npx modes
import { getSDKCliOptions } from "../lib/sdk-cli-options";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { readFileSync, existsSync } from "fs";
import { join, relative, dirname } from "path";
import { homedir } from "os";
import { getFirmSession, saveFirmSession } from "../sessions";
import { PHASE_RULES, getPhaseRules } from "../shared/phase-rules";
import { loadPracticeGuide, loadSectionsByIds, clearKnowledgeCache } from "./knowledge";
import { extractTextFromFile } from "../lib/extract";
import { generateCaseSummary } from "../lib/case-summary";
import { mergeToIndex, diffIndexes, type HypergraphResult, type IndexDiff } from "../lib/merge-index";
import { directFirmChat } from "../lib/firm-chat";
import {
  normalizeIndex,
  validateIndex,
  FILE_EXTRACTION_TOOL_SCHEMA,
  type DocumentIndex,
} from "../lib/index-schema";
import { practiceAreaRegistry, PRACTICE_AREAS } from "../practice-areas";

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
        dol: { type: "string" as const, description: "Date of loss (MM/DD/YYYY or YYYY-MM-DD)" },
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
        doi: { type: "string" as const, description: "Date of injury (MM/DD/YYYY or YYYY-MM-DD)" },
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
  }
): Promise<CaseSummary> {
  const indexPath = join(casePath, ".pi_tool", "document_index.json");
  // Accept both short code ("WC") and full name ("Workers' Compensation")
  const isWC = options?.practiceArea === PRACTICE_AREAS.WC || options?.practiceArea === "WC";

  const caseSummary: CaseSummary = {
    path: casePath,
    name: caseName,
    indexed: false,
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

    // Practice area - use firm-level setting, fallback to index
    caseSummary.practiceArea = options?.practiceArea || index.practice_area || index.practiceArea;

    // WC-specific fields (based on firm-level practice area setting)
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

    // Check if needs reindex (files modified after index)
    caseSummary.needsReindex = await checkNeedsReindex(casePath, indexStats.mtimeMs);

  } catch {
    // No index found - case exists but not indexed
    caseSummary.indexed = false;
  }

  return caseSummary;
}

// Discover subcases and build their summaries
async function discoverAndBuildSubcases(
  parentPath: string,
  parentName: string,
  practiceArea?: string
): Promise<CaseSummary[]> {
  const subcasePaths = await discoverSubcases(parentPath);
  const subcases: CaseSummary[] = [];

  for (const subcasePath of subcasePaths) {
    const subcaseName = subcasePath.split('/').pop() || subcasePath;
    const summary = await buildCaseSummary(subcasePath, subcaseName, {
      subcaseInfo: { parentPath, parentName },
      practiceArea,
    });
    subcases.push(summary);
  }

  return subcases;
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
  const practiceArea = c.req.query("practiceArea"); // Firm-level setting from UI

  if (!root) {
    return c.json({ error: "root query param required" }, 400);
  }

  // Accept both short code ("WC") and full name ("Workers' Compensation")
  const isWC = practiceArea === PRACTICE_AREAS.WC || practiceArea === "WC";

  try {
    const entries = await readdir(root, { withFileTypes: true });
    const cases: CaseSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".pi_tool") continue;
      // Skip dot-prefixed folders at root level (they shouldn't be cases)
      if (entry.name.startsWith('.')) continue;

      const casePath = join(root, entry.name);

      // For WC practice area, check for DOI subfolders
      if (isWC) {
        const doiDetection = await detectDOISubfolders(casePath);

        if (doiDetection.isContainer) {
          // This is a client container with DOI subfolders
          // Add container as a grouping header (not a case)
          const containerSummary = buildContainerSummary(
            casePath,
            entry.name,
            doiDetection.doiCases
          );
          cases.push(containerSummary);

          // Add each DOI subfolder as a separate case
          for (const doiCase of doiDetection.doiCases) {
            const doiSummary = await buildDOICaseSummary(
              doiCase,
              casePath,
              entry.name,
              doiDetection.doiCases,
              practiceArea
            );
            cases.push(doiSummary);
          }

          // Skip regular subcase discovery for containers
          continue;
        }
      }

      // Regular case (non-container) - existing logic
      const caseSummary = await buildCaseSummary(casePath, entry.name, { practiceArea });
      cases.push(caseSummary);

      // Discover and add subcases (linked family members)
      const subcases = await discoverAndBuildSubcases(casePath, entry.name, practiceArea);
      cases.push(...subcases);
    }

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
2. Date of loss (accident date) in MM/DD/YYYY format
3. Insurance details - USE THE STRUCTURED FIELDS:
   - For client's own policy (1P): use insurance_1p with carrier, policy_number, claim_number, bodily_injury, medical_payments, um_uim
   - For at-fault party's policy (3P): use insurance_3p with carrier, policy_number, claim_number, bodily_injury, insured_name
4. Medical provider name and charges (as numbers, not strings)
5. Health insurance carrier, group_no, member_no
6. Settlement/demand amounts as numbers

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
2. Date of injury (DOI) in MM/DD/YYYY format
3. Employer information:
   - Employer name, address
   - Job title at time of injury
   - Date of hire
4. WC Carrier/TPA information:
   - Carrier name, claim number, adjuster name/contact
5. Injury details:
   - Body parts injured
   - Mechanism of injury
   - ICD-10 diagnosis codes if present
6. Wage information:
   - Average Monthly Wage (AMW)
   - Compensation rate (typically 2/3 of AMW)
7. Disability status (IMPORTANT - always determine disability_type when work status is mentioned):
   - TTD (Temporary Total Disability): Patient is completely off work, cannot work at all
   - TPD (Temporary Partial Disability): Patient on modified/light duty, working with restrictions
   - PPD (Permanent Partial Disability): Patient has reached MMI with permanent impairment rating
   - PTD (Permanent Total Disability): Patient permanently unable to work

   INFERENCE RULES for disability_type:
   - "Off work", "no work", "cannot work" → TTD
   - "Modified duty", "light duty", "work restrictions", "limited duty" → TPD
   - "MMI reached" + impairment rating → PPD
   - Always extract disability_type if work status or benefits are mentioned
8. Medical treatment:
   - Treating physician name (ATP)
   - Treatment dates and types
   - Work restrictions
9. Hearing information:
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
    // Include any specific data points found
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- For PDFs: use pdftotext "filename" - 2>/dev/null | head -200
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
  "extracted_data": {
    // Include any specific data points found
  }
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no explanation
- For PDFs: use pdftotext "filename" - 2>/dev/null | head -200
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
  - doi: Date of injury (MM/DD/YYYY)
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

async function extractFile(
  caseFolder: string,
  filePath: string, // relative path like "Intake/Intake.pdf"
  fileIndex: number,
  totalFiles: number,
  practiceArea?: string,
  onProgress?: (event: { type: string; [key: string]: any }) => void,
  sdkCliOpts?: ReturnType<typeof getSDKCliOptions>,
  cachedSystemPrompt?: string
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

    // PRE-EXTRACT: Try to extract text server-side before calling agent
    let extractedText = '';
    let usePreExtracted = false;
    const extractStartTime = Date.now();
    try {
      extractedText = await extractTextFromFile(fullPath);
      const extractElapsed = ((Date.now() - extractStartTime) / 1000).toFixed(1);
      console.log(`[${fileIndex + 1}/${totalFiles}] Extracted ${extractedText.length} chars in ${extractElapsed}s`);

      // Only use pre-extracted text if we got meaningful content
      usePreExtracted = extractedText.length > 50 &&
        !extractedText.startsWith('[Could not') &&
        !extractedText.startsWith('[Binary file');
    } catch (extractErr) {
      console.warn(`[${fileIndex + 1}/${totalFiles}] Text extraction failed, falling back to agent:`, extractErr);
    }

    // Truncate if too long to avoid token limits
    const MAX_CHARS = 15000;
    if (usePreExtracted && extractedText.length > MAX_CHARS) {
      extractedText = extractedText.slice(0, MAX_CHARS) + '\n\n[... truncated ...]';
      console.log(`[${fileIndex + 1}/${totalFiles}] Truncated to ${MAX_CHARS} chars`);
    }

    // Track extraction method for logging (updated below if large file uses agent)
    let extractionMethod = usePreExtracted ? 'pre-extracted' : 'pdf-direct';

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

    // ========================================================================
    // PATH 1: Pre-extracted text → Direct API with structured tool_use
    // ========================================================================
    if (usePreExtracted) {
      try {
        const response = await getClient().messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: getFileExtractionSystemPrompt(practiceArea),
          messages: [{
            role: "user",
            content: `Extract information from this document.

FILENAME: ${filename}
FOLDER: ${folder}

DOCUMENT TEXT:
${extractedText}

Use the extract_document tool to return your findings.`
          }],
          tools: [FILE_EXTRACTION_TOOL_SCHEMA],
          tool_choice: { type: "tool", name: "extract_document" }
        });

        // Capture usage
        usage.inputTokensNew = response.usage.input_tokens || 0;
        usage.inputTokensCacheWrite = (response.usage as any).cache_creation_input_tokens || 0;
        usage.inputTokensCacheRead = (response.usage as any).cache_read_input_tokens || 0;
        usage.inputTokens = usage.inputTokensNew + usage.inputTokensCacheWrite + usage.inputTokensCacheRead;
        usage.outputTokens = response.usage.output_tokens || 0;
        usage.apiCalls = 1;

        // Extract tool use result
        const toolBlock = response.content.find(block => block.type === 'tool_use');
        if (toolBlock && toolBlock.type === 'tool_use') {
          const extracted = toolBlock.input as {
            type: string;
            key_info: string;
            extracted_data: Record<string, unknown>;
          };

          result = {
            filename,
            folder,
            type: extracted.type || 'other',
            key_info: extracted.key_info || '',
            extracted_data: extracted.extracted_data,
          };
        }
      } catch (apiErr) {
        console.error(`[${fileIndex + 1}/${totalFiles}] Direct API error for ${filename}:`, apiErr);
        result.key_info = `Extraction failed: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`;
        result.error = apiErr instanceof Error ? apiErr.message : String(apiErr);
      }

      result.usage = usage;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${fileIndex + 1}/${totalFiles}] ✓ Done: ${filename} (${elapsed}s) - ${result.type} [structured-extraction]`);
      onProgress?.({
        type: "file_done",
        fileIndex,
        totalFiles,
        filename,
        folder,
        docType: result.type,
        extractionMethod: 'structured',
        elapsed: parseFloat(elapsed)
      });
      return result;
    }

    // ========================================================================
    // PATH 2: Agent SDK fallback for all non-pre-extracted files
    // Uses Haiku agent with Read/Bash tools to examine the file
    // ========================================================================
    console.log(`[${fileIndex + 1}/${totalFiles}] [agent-fallback] ${filename}`);
    extractionMethod = 'agent-fallback';

    // Use cached SDK options or create them (should be cached at call site)
    const effectiveSdkCliOpts = sdkCliOpts ?? getSDKCliOptions();
    const effectiveSystemPrompt = cachedSystemPrompt ?? getFileExtractionSystemPromptWithTools(practiceArea);
    const agentPrompt = `Extract information from this file: ${fullPath}

Use the Read tool to read the file. Then return the JSON extraction with these fields:
- type: document type
- key_info: 2-3 sentence summary
- extracted_data: object with any data found

Return ONLY valid JSON, no markdown.`;

    const AGENT_TIMEOUT_MS = 60000; // 60 seconds

    try {
      // Wrap agent query in a promise with timeout to prevent hanging
      const agentPromise = (async () => {
        for await (const msg of query({
          prompt: agentPrompt,
          options: {
            cwd: caseFolder,
            systemPrompt: effectiveSystemPrompt,
            model: "haiku" as const,
            allowedTools: ["Bash", "Read"],
            permissionMode: "acceptEdits" as const,
            maxTurns: 5,
            persistSession: false,
            ...effectiveSdkCliOpts,
          },
        })) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                try {
                  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result = {
                      filename: parsed.filename || filename,
                      folder,
                      type: parsed.type || 'other',
                      key_info: parsed.key_info || '',
                      extracted_data: parsed.extracted_data,
                    };
                  }
                } catch {
                  result.key_info = block.text.slice(0, 500);
                }
              }
            }
          }

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
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent timeout after ${AGENT_TIMEOUT_MS / 1000}s`)), AGENT_TIMEOUT_MS)
      );

      await Promise.race([agentPromise, timeoutPromise]);
    } catch (agentErr) {
      console.error(`[${fileIndex + 1}/${totalFiles}] Agent fallback error for ${filename}:`, agentErr);
      result.key_info = `Extraction failed: ${agentErr instanceof Error ? agentErr.message : String(agentErr)}`;
      result.error = agentErr instanceof Error ? agentErr.message : String(agentErr);
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
  const indexDir = join(caseFolder, '.pi_tool');
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
async function listCaseFiles(caseFolder: string): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dir: string, base: string = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip .pi_tool entirely
      if (entry.name === '.pi_tool') continue;
      // For directories, skip dot-prefixed ones (they're separate subcase folders)
      if (entry.isDirectory() && entry.name.startsWith('.')) continue;
      // For files, skip hidden files
      if (!entry.isDirectory() && entry.name.startsWith('.')) continue;

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
      if (entry.name === '.pi_tool') continue;

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
  const piToolDir = join(containerPath, '.pi_tool');
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
      if (entry.name === '.pi_tool') continue;
      if (!entry.name.startsWith('.')) continue;

      // Check if subfolder has any files (not empty)
      const subPath = join(casePath, entry.name);
      try {
        const subEntries = await readdir(subPath, { withFileTypes: true });
        const hasFiles = subEntries.some(e => !e.isDirectory() || e.name !== '.pi_tool');
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
  }
): Promise<{ success: boolean; error?: string; diff?: IndexDiff }> {
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

    // Step 2: Extract files in batches with GC pauses
    const BATCH_SIZE = 15;
    console.log(`\n========== EXTRACTING ${files.length} FILES (batches of ${BATCH_SIZE} with GC) ==========`);
    onProgress({ type: "status", caseName, message: `Extracting ${files.length} files (${BATCH_SIZE} at a time)...` });

    // Batch-based extraction with forced GC between batches to prevent memory accumulation
    const extractions: FileExtraction[] = [];
    let completedCount = 0;

    async function processInBatches<T>(
      items: T[],
      batchSize: number,
      processor: (item: T, index: number) => Promise<FileExtraction>
    ): Promise<FileExtraction[]> {
      const results: FileExtraction[] = [];
      const totalBatches = Math.ceil(items.length / batchSize);

      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const start = batchNum * batchSize;
        const end = Math.min(start + batchSize, items.length);
        const batch = items.slice(start, end);

        // Process batch concurrently
        const batchResults = await Promise.all(
          batch.map(async (item, batchIndex) => {
            const globalIndex = start + batchIndex;
            try {
              return await processor(item, globalIndex);
            } catch (err) {
              const filename = typeof item === 'string' ? (item as string).split('/').pop() || String(item) : String(item);
              const folder = typeof item === 'string' ? (item as string).split('/')[0] || 'root' : 'root';
              console.error(`[${globalIndex + 1}/${items.length}] Unhandled error for ${filename}:`, err);
              return {
                filename,
                folder,
                type: 'other' as const,
                key_info: 'Failed to extract',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          })
        );

        results.push(...batchResults);
        completedCount += batch.length;
        console.log(`--- Progress: ${completedCount}/${items.length} files complete (batch ${batchNum + 1}/${totalBatches}) ---`);

        // Force garbage collection every 5 batches (75 files at batch size 15) to prevent memory accumulation
        // without causing excessive pauses
        if ((batchNum + 1) % 5 === 0 && typeof Bun !== 'undefined' && Bun.gc) {
          Bun.gc(true);
          console.log(`[gc] Forced garbage collection after ${completedCount} files`);
        }
      }

      return results;
    }

    // Pre-compute SDK options and system prompt once for all files (eliminates per-file overhead)
    const sdkCliOpts = getSDKCliOptions();
    const cachedSystemPrompt = getFileExtractionSystemPromptWithTools(options?.practiceArea);

    const extractionResults = await processInBatches(
      files,
      BATCH_SIZE,
      (filePath, index) => extractFile(
        caseFolder,
        filePath,
        index,
        files.length,
        options?.practiceArea,
        (event) => { onProgress({ ...event, caseName }); },
        sdkCliOpts,
        cachedSystemPrompt
      )
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

    const initialIndex: Record<string, any> = {
      indexed_at: new Date().toISOString(),
      case_name: caseName,
      case_phase: isIncremental && existingIndex?.case_phase ? existingIndex.case_phase : 'Unknown',
      summary: baseSummary,
      folders,
      failed_files: failedFiles,
      issues_found: [],
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

    // Build initial index object for case summary (needs folders structure)
    const initialIndexForSummary = { folders };

    // Run both Haiku calls in parallel
    const [hypergraphResult, caseSummaryResult] = await Promise.all([
      generateHypergraph(caseFolder, { folders }, options?.practiceArea),
      generateCaseSummary(initialIndexForSummary, options?.firmRoot)
    ]);

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

    // Add case summary usage to Haiku totals
    totalUsage.haiku.inputTokens += caseSummaryResult.usage.inputTokens;
    totalUsage.haiku.outputTokens += caseSummaryResult.usage.outputTokens;
    totalUsage.haiku.apiCalls += 1;

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

    // Write final normalized index
    await writeFile(indexPath, JSON.stringify(normalizedIndex, null, 2));
    console.log(`[Index] Wrote normalized document_index.json`);
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

    // Report usage to subscription server (fire-and-forget)
    const totalTokensUsed = usageReport.totalInputTokens + usageReport.totalOutputTokens;
    if (totalTokensUsed > 0) {
      reportUsage(totalTokensUsed, "indexing").catch(() => {});
    }

    // If this is a subcase, update parent's index to include it in related_cases
    if (options?.parentCase) {
      try {
        const parentIndexPath = join(options.parentCase.path, '.pi_tool', 'document_index.json');
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
}

// Track containers that need to be indexed first
interface ContainerToIndex {
  path: string;
  name: string;
  doiCases: Array<{ path: string; name: string; dateOfInjury: string }>;
  sharedFolders: string[];
}

app.post("/batch-index", async (c) => {
  const { root, cases: casesToIndex, practiceArea } = await c.req.json();

  if (!root) {
    return c.json({ error: "root is required" }, 400);
  }

  // Accept both short code ("WC") and full name ("Workers' Compensation")
  const isWC = practiceArea === PRACTICE_AREAS.WC || practiceArea === "WC";

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
              const doiIndexPath = join(doiCase.path, ".pi_tool", "document_index.json");
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
          const subcaseIndexPath = join(subcasePath, ".pi_tool", "document_index.json");
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
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".pi_tool") continue;
        if (entry.name.startsWith('.')) continue; // Skip dot-prefixed at root

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
              const doiIndexPath = join(doiCase.path, ".pi_tool", "document_index.json");
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
        const indexPath = join(casePath, ".pi_tool", "document_index.json");
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
          const subcaseIndexPath = join(subcasePath, ".pi_tool", "document_index.json");
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
    }
  });
});

// Helper to check if case needs reindexing
async function checkNeedsReindex(casePath: string, indexedAt: number): Promise<boolean> {
  async function checkDir(dir: string): Promise<boolean> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".pi_tool") continue;
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
      systemPrompt: getHypergraphPrompt(practiceArea),
      model: "haiku",
      allowedTools: [],
      permissionMode: "acceptEdits",
      maxTurns: 4,
      persistSession: false, // Prevent race condition when running concurrent extractions
      ...getSDKCliOptions(),
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
    if (!entry.isDirectory() || entry.name === ".pi_tool") continue;

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
    caseCount: entries.filter(e => e.isDirectory() && e.name !== ".pi_tool").length,
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
  const { root, message, history = [] } = await c.req.json();

  if (!root || !message) {
    return c.json({ error: "root and message required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of directFirmChat(root, message, history)) {
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

const FIRM_DIR = ".pi_tool";

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

  try {
    const indexPath = join(casePath, ".pi_tool", "document_index.json");

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

  try {
    const indexPath = join(casePath, ".pi_tool", "document_index.json");

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
