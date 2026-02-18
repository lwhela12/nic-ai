// Quick test script for synthesis API call only
// Run with: ANTHROPIC_API_KEY=sk-ant-... bun run test-synthesis.ts

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import { join } from "path";

const caseFolder = process.argv[2] || "/Users/lucaswhelan/claude-pi/test-cases/lozoya-in-progress";

async function testSynthesis() {
  console.log(`Testing synthesis for: ${caseFolder}`);

  const indexPath = join(caseFolder, '.ai_tool/document_index.json');
  const hypergraphPath = join(caseFolder, '.ai_tool/hypergraph_analysis.json');

  const [documentIndexContent, hypergraphContent] = await Promise.all([
    readFile(indexPath, 'utf-8'),
    readFile(hypergraphPath, 'utf-8')
  ]);

  console.log(`Read index (${documentIndexContent.length} chars) and hypergraph (${hypergraphContent.length} chars)`);

  const anthropic = new Anthropic();

  const SYNTHESIS_SCHEMA = {
    type: "object" as const,
    properties: {
      needs_review: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            field: { type: "string" as const },
            conflicting_values: { type: "array" as const, items: { type: "string" as const } },
            sources: { type: "array" as const, items: { type: "string" as const } },
            reason: { type: "string" as const }
          },
          required: ["field", "conflicting_values", "sources", "reason"] as const
        }
      },
      errata: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            field: { type: "string" as const },
            decision: { type: "string" as const },
            evidence: { type: "string" as const },
            confidence: { type: "string" as const, enum: ["high", "medium", "low"] }
          },
          required: ["field", "decision", "evidence", "confidence"] as const
        }
      },
      case_analysis: { type: "string" as const },
      liability_assessment: { type: "string" as const, enum: ["clear", "moderate", "contested"] },
      injury_tier: { type: "string" as const, enum: ["tier_1_soft_tissue", "tier_2_structural", "tier_3_surgical"] },
      estimated_value_range: { type: "string" as const },
      policy_limits_demand_appropriate: { type: "boolean" as const },
      summary: {
        type: "object" as const,
        properties: {
          client: { type: "string" as const },
          dol: { type: "string" as const },
          dob: { type: "string" as const },
          providers: { type: "array" as const, items: { type: "string" as const } },
          total_charges: { type: "number" as const },
          policy_limits: { type: "object" as const, additionalProperties: true },
          contact: { type: "object" as const, additionalProperties: true },
          health_insurance: { type: "object" as const, additionalProperties: true },
          claim_numbers: { type: "object" as const, additionalProperties: { type: "string" as const } },
          case_summary: { type: "string" as const }
        },
        required: ["client", "dol", "providers", "total_charges"] as const
      },
      case_name: { type: "string" as const },
      case_phase: { type: "string" as const, enum: ["Intake", "Investigation", "Treatment", "Demand", "Negotiation", "Settlement", "Complete"] }
    },
    required: [
      "needs_review", "errata", "case_analysis", "liability_assessment", "injury_tier",
      "estimated_value_range", "policy_limits_demand_appropriate", "summary", "case_name", "case_phase"
    ] as const
  };

  const systemPrompt = `You are a case analyst for a Personal Injury law firm. Analyze the case data and return a synthesis using the case_synthesis tool. Focus on:
- needs_review: Any UNCERTAIN conflicts or significant discrepancies
- errata: Document your decisions with evidence
- case_analysis: Substantive analysis (liability, injury tier, value range, gaps)
- summary: Consolidated case info with providers as string array`;

  console.log(`Making API call...`);
  const startTime = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16000,
      system: systemPrompt,
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
        input_schema: SYNTHESIS_SCHEMA
      }],
      tool_choice: { type: "tool", name: "case_synthesis" }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nAPI call completed in ${elapsed}s`);
    console.log(`Usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

    const toolBlock = response.content.find(block => block.type === 'tool_use');
    if (toolBlock && toolBlock.type === 'tool_use') {
      const synthesis = toolBlock.input as Record<string, any>;
      console.log(`\nSynthesis result:`);
      console.log(`- needs_review: ${synthesis.needs_review?.length || 0} items`);
      console.log(`- errata: ${synthesis.errata?.length || 0} items`);
      console.log(`- case_analysis: ${synthesis.case_analysis?.slice(0, 200)}...`);
      console.log(`- liability: ${synthesis.liability_assessment}`);
      console.log(`- injury_tier: ${synthesis.injury_tier}`);
      console.log(`- value_range: ${synthesis.estimated_value_range}`);
      console.log(`- case_phase: ${synthesis.case_phase}`);
      console.log(`\nFull synthesis saved to synthesis-output.json`);
      await Bun.write('synthesis-output.json', JSON.stringify(synthesis, null, 2));

      // Merge into document_index.json
      const existingIndex = JSON.parse(documentIndexContent);
      const merged = {
        ...existingIndex,
        needs_review: synthesis.needs_review || [],
        errata: synthesis.errata || [],
        case_analysis: synthesis.case_analysis || '',
        liability_assessment: synthesis.liability_assessment || null,
        injury_tier: synthesis.injury_tier || null,
        estimated_value_range: synthesis.estimated_value_range || null,
        policy_limits_demand_appropriate: synthesis.policy_limits_demand_appropriate ?? null,
        case_name: synthesis.case_name || existingIndex.case_name,
        case_phase: synthesis.case_phase || existingIndex.case_phase,
        summary: {
          ...existingIndex.summary,
          ...synthesis.summary,
          providers: Array.isArray(synthesis.summary?.providers)
            ? synthesis.summary.providers.map((p: any) => typeof p === 'string' ? p : p.name || String(p))
            : existingIndex.summary?.providers || [],
        }
      };

      await Bun.write(indexPath, JSON.stringify(merged, null, 2));
      console.log(`Updated ${indexPath}`);
    } else {
      console.log('No tool_use block found in response');
      console.log('Response:', JSON.stringify(response.content, null, 2));
    }
  } catch (err) {
    console.error('API Error:', err);
  }
}

testSynthesis();
