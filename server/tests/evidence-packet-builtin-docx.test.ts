import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import PizZip from "pizzip";

const tempDirs: string[] = [];

function paragraphText(paragraphXml: string): string {
  return [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function expectNoSpacerParagraphBefore(docXml: string, headingNeedle: string): void {
  const paragraphs = docXml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
  const idx = paragraphs.findIndex((paragraph) => paragraph.includes(headingNeedle));
  expect(idx).toBeGreaterThan(0);
  const previous = paragraphs[idx - 1] || "";
  const normalized = paragraphText(previous);
  const withoutOmit = normalized.replace(/\{\{\s*omit\s*\}\}/gi, "").trim();
  expect(withoutOmit.length).toBeGreaterThan(0);
  expect(/^[\/\\|._-]+$/.test(withoutOmit)).toBe(false);
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("ensureBuiltInPacketDocxTemplate", () => {
  it("materializes HO/AO masters and is idempotent unless forced", async () => {
    const { ensureBuiltInPacketDocxTemplate } = await import(
      `../lib/evidence-packet.ts?builtin-docx=${Date.now()}`
    );

    const firmRoot = await makeTempDir("claude-pi-firm-");
    const hoRelativePath = await ensureBuiltInPacketDocxTemplate(firmRoot, "ho-standard");
    const aoRelativePath = await ensureBuiltInPacketDocxTemplate(firmRoot, "ao-standard");

    expect(hoRelativePath).toBe("source/__builtin-ho-standard.docx");
    expect(aoRelativePath).toBe("source/__builtin-ao-standard.docx");

    const hoFullPath = join(
      firmRoot,
      ".ai_tool",
      "templates",
      "source",
      "__builtin-ho-standard.docx"
    );
    const aoFullPath = join(
      firmRoot,
      ".ai_tool",
      "templates",
      "source",
      "__builtin-ao-standard.docx"
    );
    const versionsPath = join(
      firmRoot,
      ".ai_tool",
      "templates",
      "source",
      "__builtin-docx-versions.json"
    );

    const hoBytes = await readFile(hoFullPath);
    const aoBytes = await readFile(aoFullPath);
    expect(hoBytes.length).toBeGreaterThan(256);
    expect(aoBytes.length).toBeGreaterThan(256);
    expect(hoBytes[0]).toBe("P".charCodeAt(0)); // ZIP/DOCX signature
    expect(hoBytes[1]).toBe("K".charCodeAt(0));
    expect(aoBytes[0]).toBe("P".charCodeAt(0));
    expect(aoBytes[1]).toBe("K".charCodeAt(0));
    const hoZip = new PizZip(hoBytes);
    const hoHeader = hoZip.file("word/header1.xml")?.asText() || "";
    expect(hoHeader).toContain("<w:drawing>");
    expect(hoHeader).toContain("<w:txbxContent>");
    expect(hoHeader).toContain("<w:t>1</w:t>");
    expect(hoHeader).toContain("<w:t>28</w:t>");
    const hoDoc = hoZip.file("word/document.xml")?.asText() || "";
    expect(hoDoc).toContain("{{hoCaptionLine1}}");
    expect(hoDoc).toContain("{{hoCaptionLine4}}");
    expect(hoDoc).toContain("{{affirmationTitle}}");
    expect(hoDoc).toContain("{{signatureFirmBlock}}");
    expect(hoDoc).toContain("{{certIntro}}");
    expect(hoDoc).toContain("{{serviceRecipientsText}}");
    const hoCounselPos = hoDoc.indexOf("{{counselPreamble}}");
    const hoIndexPos = hoDoc.indexOf("{{documentIndexText}}");
    const hoAffirmationPos = hoDoc.indexOf("{{affirmationTitle}}");
    expect(hoCounselPos).toBeGreaterThan(-1);
    expect(hoIndexPos).toBeGreaterThan(hoCounselPos);
    expect(hoAffirmationPos).toBeGreaterThan(hoIndexPos);
    const hoIndexParagraph = hoDoc.split("</w:p>").find((p) => p.includes("{{documentIndexText}}")) || "";
    expect(hoIndexParagraph).toContain('w:tab w:val="right"');
    expect(hoIndexParagraph).toContain('w:leader="dot"');
    expectNoSpacerParagraphBefore(hoDoc, "{{documentIndexText}}");
    expect(hoDoc).toMatch(/<w:p[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?\{\{affirmationTitle\}\}[\s\S]*?<\/w:p>/);
    expect(hoDoc).toMatch(/<w:p[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?CERTIFICATE OF MAILING[\s\S]*?<\/w:p>/);
    expectNoSpacerParagraphBefore(hoDoc, "{{affirmationTitle}}");
    expectNoSpacerParagraphBefore(hoDoc, "CERTIFICATE OF MAILING");
    expect(hoDoc).not.toContain(">ISSUE<");
    expect(hoDoc).not.toContain(">WITNESSES<");
    expect(hoDoc).not.toContain(">DURATION<");

    const aoZip = new PizZip(aoBytes);
    const aoHeader = aoZip.file("word/header1.xml")?.asText() || "";
    expect(aoHeader).toContain("<w:drawing>");
    expect(aoHeader).toContain("<w:txbxContent>");
    expect(aoHeader).toContain("<w:t>1</w:t>");
    expect(aoHeader).toContain("<w:t>28</w:t>");
    const aoDoc = aoZip.file("word/document.xml")?.asText() || "";
    const aoIndexParagraph = aoDoc.split("</w:p>").find((p) => p.includes("{{documentIndexText}}")) || "";
    expect(aoIndexParagraph).toContain('w:tab w:val="right"');
    expect(aoIndexParagraph).toContain('w:leader="dot"');
    expect(aoDoc).toMatch(/<w:p[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?\{\{documentIndexText\}\}[\s\S]*?<\/w:p>/);
    expectNoSpacerParagraphBefore(aoDoc, "{{documentIndexText}}");
    expect(aoDoc).toContain("{{signatureFirmBlock}}");
    expect(aoDoc).toMatch(/<w:p[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?\{\{affirmationTitle\}\}[\s\S]*?<\/w:p>/);
    expect(aoDoc).toMatch(/<w:p[\s\S]*?<w:pageBreakBefore\/>[\s\S]*?CERTIFICATE OF MAILING[\s\S]*?<\/w:p>/);
    expectNoSpacerParagraphBefore(aoDoc, "{{affirmationTitle}}");
    expectNoSpacerParagraphBefore(aoDoc, "CERTIFICATE OF MAILING");

    const versionMap = JSON.parse(await readFile(versionsPath, "utf-8"));
    expect(typeof versionMap["ho-standard"]).toBe("number");
    expect(typeof versionMap["ao-standard"]).toBe("number");

    await writeFile(hoFullPath, "CUSTOM-HO", "utf-8");
    await ensureBuiltInPacketDocxTemplate(firmRoot, "ho-standard");
    expect(await readFile(hoFullPath, "utf-8")).toBe("CUSTOM-HO");

    await ensureBuiltInPacketDocxTemplate(firmRoot, "ho-standard", { force: true });
    const forcedBytes = await readFile(hoFullPath);
    expect(forcedBytes.length).toBeGreaterThan(256);
    expect(forcedBytes[0]).toBe("P".charCodeAt(0));
    expect(forcedBytes[1]).toBe("K".charCodeAt(0));
  });
});
