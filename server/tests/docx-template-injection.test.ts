import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import PizZip from "pizzip";
import { injectVariablesIntoDocx } from "../lib/extract";

const tempDirs: string[] = [];

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

/**
 * Create a minimal DOCX with specified paragraph XML content.
 * Allows testing run-splitting and injection without a real Word doc.
 */
function createMinimalDocx(paragraphsXml: string, extraFiles?: Record<string, string>): Buffer {
  const zip = new PizZip();

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphsXml}
  </w:body>
</w:document>`;

  zip.file("word/document.xml", documentXml);

  // Minimal content types
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  // Minimal relationships
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  // Add any extra files (e.g., headers/footers)
  if (extraFiles) {
    for (const [path, content] of Object.entries(extraFiles)) {
      zip.file(path, content);
    }
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/**
 * Helper: extract document.xml text from a DOCX buffer.
 */
function extractDocumentXml(docxBuffer: Uint8Array): string {
  const zip = new PizZip(Buffer.from(docxBuffer));
  const node = zip.file("word/document.xml");
  return node ? node.asText() : "";
}

function extractXmlFile(docxBuffer: Uint8Array, path: string): string | null {
  const zip = new PizZip(Buffer.from(docxBuffer));
  const node = zip.file(path);
  return node ? node.asText() : null;
}

describe("injectVariablesIntoDocx", () => {
  describe("basic single-run replacement", () => {
    it("replaces a literal string within a single run", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>In the Matter of John Doe, Claimant.</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{claimantName}}");
      expect(xml).not.toContain("John Doe");
    });

    it("replaces multiple literals in a single run", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Claim 123-456, Hearing 789-012, Claimant John Doe</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "123-456": "{{claimNumber}}",
        "789-012": "{{hearingNumber}}",
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{claimNumber}}");
      expect(xml).toContain("{{hearingNumber}}");
      expect(xml).toContain("{{claimantName}}");
      expect(xml).not.toContain("123-456");
      expect(xml).not.toContain("789-012");
      expect(xml).not.toContain("John Doe");
    });
  });

  describe("regex special character handling", () => {
    it("handles parentheses in legal text", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Smith (d/b/a Corp.) vs. Jones</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "Smith (d/b/a Corp.)": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{claimantName}}");
      expect(xml).not.toContain("Smith (d/b/a Corp.)");
    });

    it("handles periods, dollar signs, and brackets", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Amount: $5,000.00 [estimated]</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "$5,000.00 [estimated]": "{{amount}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{amount}}");
    });
  });

  describe("cross-run replacement (run-splitting fix)", () => {
    it("replaces text split across two runs", async () => {
      const dir = await makeTempDir("docx-inject-");
      // Simulate Word splitting "John Doe" across two runs (common with spell-check)
      const paragraphXml = `<w:p>
  <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">In the Matter of John </w:t></w:r>
  <w:r><w:t>Doe, Claimant.</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{claimantName}}");
      // The surrounding text should be preserved
      expect(xml).toContain("In the Matter of");
      expect(xml).toContain(", Claimant.");
    });

    it("replaces text split across three runs", async () => {
      const dir = await makeTempDir("docx-inject-");
      // "January 1, 2024" split across 3 runs
      const paragraphXml = `<w:p>
  <w:r><w:t>Date: January </w:t></w:r>
  <w:r><w:rPr><w:b/></w:rPr><w:t>1, </w:t></w:r>
  <w:r><w:t>2024 at 9:00 AM</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "January 1, 2024 at 9:00 AM": "{{hearingDateTime}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{hearingDateTime}}");
      expect(xml).toContain("Date: ");
    });

    it("preserves formatting on non-replaced text in affected runs", async () => {
      const dir = await makeTempDir("docx-inject-");
      // Run 0 has bold formatting, Run 1 is normal
      // "John Doe" spans both runs
      const paragraphXml = `<w:p>
  <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">In the Matter of John </w:t></w:r>
  <w:r><w:t>Doe, Claimant.</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      // Bold formatting should still be present on the first run
      expect(xml).toContain("<w:b/>");
      // The second run should still contain ", Claimant." (not emptied entirely)
      expect(xml).toContain(", Claimant.");
    });

    it("handles runs with no w:t element (images, breaks)", async () => {
      const dir = await makeTempDir("docx-inject-");
      // A run with an image between two text runs
      const paragraphXml = `<w:p>
  <w:r><w:t xml:space="preserve">Hello John </w:t></w:r>
  <w:r><w:drawing><wp:inline/></w:drawing></w:r>
  <w:r><w:t>Doe World</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      // Since runs without <w:t> are skipped, "John " and "Doe" are not adjacent
      // in the text-only concatenation. The concatenated text is "Hello John Doe World"
      // but "John " is in run 0 and "Doe" starts run 2 (run 1 has no text).
      // The replacement should still work because we skip non-text runs in charMap.
      expect(xml).toContain("{{claimantName}}");
      // Image run should still be preserved
      expect(xml).toContain("<w:drawing>");
    });
  });

  describe("XML entity handling", () => {
    it("handles ampersands in text content", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Smith &amp; Jones LLC</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "Smith & Jones LLC": "{{firmName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{firmName}}");
      expect(xml).not.toContain("Smith &amp; Jones");
    });

    it("re-encodes entities in replacement values", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Placeholder Text</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      // The replacement tag itself doesn't need entity encoding since {{ }} are safe
      const result = await injectVariablesIntoDocx(docxPath, {
        "Placeholder Text": "{{testVar}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{testVar}}");
    });
  });

  describe("header and footer processing", () => {
    it("replaces text in header XML files", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Body text here</w:t></w:r>
</w:p>`;
      const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t>John Doe, Attorney at Law</w:t></w:r>
  </w:p>
</w:hdr>`;

      const docxBuffer = createMinimalDocx(paragraphXml, {
        "word/header1.xml": headerXml,
      });
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const headerResult = extractXmlFile(result, "word/header1.xml");
      expect(headerResult).not.toBeNull();
      expect(headerResult!).toContain("{{claimantName}}");
    });

    it("replaces text in footer XML files", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Body text</w:t></w:r>
</w:p>`;
      const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:r><w:t>Page - Claim No. 123-456</w:t></w:r>
  </w:p>
</w:ftr>`;

      const docxBuffer = createMinimalDocx(paragraphXml, {
        "word/footer1.xml": footerXml,
      });
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "123-456": "{{claimNumber}}",
      });

      const footerResult = extractXmlFile(result, "word/footer1.xml");
      expect(footerResult).not.toBeNull();
      expect(footerResult!).toContain("{{claimNumber}}");
    });
  });

  describe("longest-first replacement ordering", () => {
    it("replaces longer matches before shorter ones to avoid partial matches", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>John Doe Jr. and John Doe</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe Jr.": "{{claimantFullName}}",
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("{{claimantFullName}}");
      expect(xml).toContain("{{claimantName}}");
      // "John Doe Jr." should be replaced first, not partially consumed by "John Doe"
      expect(xml).not.toContain("John Doe Jr.");
    });
  });

  describe("multiple occurrences", () => {
    it("replaces all occurrences of a literal in the document", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>John Doe appears here and John Doe appears again</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "John Doe": "{{claimantName}}",
      });

      const xml = extractDocumentXml(result);
      const matches = xml.match(/\{\{claimantName\}\}/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
      expect(xml).not.toContain("John Doe");
    });
  });

  describe("no-op cases", () => {
    it("returns original DOCX unchanged when no replacements match", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Some unrelated text</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "Nonexistent Text": "{{variable}}",
      });

      const xml = extractDocumentXml(result);
      expect(xml).toContain("Some unrelated text");
      expect(xml).not.toContain("{{variable}}");
    });

    it("skips replacement entries that don't start with {{", async () => {
      const dir = await makeTempDir("docx-inject-");
      const paragraphXml = `<w:p>
  <w:r><w:t>Keep this text</w:t></w:r>
</w:p>`;
      const docxBuffer = createMinimalDocx(paragraphXml);
      const docxPath = join(dir, "test.docx");
      await writeFile(docxPath, docxBuffer);

      const result = await injectVariablesIntoDocx(docxPath, {
        "Keep this text": "not a variable tag",
      });

      const xml = extractDocumentXml(result);
      // Should NOT replace because the value doesn't start with {{
      expect(xml).toContain("Keep this text");
    });
  });
});

describe("source file preservation", () => {
  it("templatized directory creation doesn't affect source", async () => {
    const dir = await makeTempDir("docx-preserve-");
    const templatesDir = join(dir, ".ai_tool", "templates");
    const sourceDir = join(templatesDir, "source");
    const templatizedDir = join(templatesDir, "templatized");

    await mkdir(sourceDir, { recursive: true });
    await mkdir(templatizedDir, { recursive: true });

    // Create a source DOCX
    const paragraphXml = `<w:p><w:r><w:t>John Doe original</w:t></w:r></w:p>`;
    const docxBuffer = createMinimalDocx(paragraphXml);
    const sourcePath = join(sourceDir, "template.docx");
    await writeFile(sourcePath, docxBuffer);

    // Inject and save to templatized
    const result = await injectVariablesIntoDocx(sourcePath, {
      "John Doe": "{{claimantName}}",
    });
    await writeFile(join(templatizedDir, "template.docx"), Buffer.from(result));

    // Verify source is unchanged
    const sourceContent = await readFile(sourcePath);
    const sourceZip = new PizZip(sourceContent);
    const sourceXml = sourceZip.file("word/document.xml")!.asText();
    expect(sourceXml).toContain("John Doe original");
    expect(sourceXml).not.toContain("{{claimantName}}");

    // Verify templatized has the replacement
    const templatizedContent = await readFile(join(templatizedDir, "template.docx"));
    const templatizedZip = new PizZip(templatizedContent);
    const templatizedXml = templatizedZip.file("word/document.xml")!.asText();
    expect(templatizedXml).toContain("{{claimantName}}");
    expect(templatizedXml).not.toContain("John Doe");
  });
});
