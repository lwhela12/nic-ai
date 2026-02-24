import { describe, expect, it } from "bun:test";
import { detectSensitiveBoxes } from "../lib/evidence-packet";

function makeWord(
  text: string,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  attributeOrder: Array<"xMin" | "yMin" | "xMax" | "yMax"> = ["xMin", "yMin", "xMax", "yMax"]
): string {
  const attrPairs: Record<"xMin" | "yMin" | "xMax" | "yMax", number> = {
    xMin: bounds.xMin,
    yMin: bounds.yMin,
    xMax: bounds.xMax,
    yMax: bounds.yMax,
  };
  const attrs = attributeOrder.map((name) => `${name}="${attrPairs[name]}"`).join(" ");
  return `<word ${attrs}>${text}</word>`;
}

function makePage(words: string[]): string {
  return `<page>${words.join("")}</page>`;
}

describe("PII detector", () => {
  it("detects SSN when digits are split across adjacent tokens with SSN context", () => {
    const bbox = makePage([
      makeWord("Employee", { xMin: 10, yMin: 10, xMax: 50, yMax: 20 }),
      makeWord("SSN", { xMin: 52, yMin: 10, xMax: 70, yMax: 20 }),
      makeWord("123", { xMin: 72, yMin: 10, xMax: 88, yMax: 20 }),
      makeWord("45", { xMin: 90, yMin: 10, xMax: 102, yMax: 20 }),
      makeWord("6789", { xMin: 104, yMin: 10, xMax: 130, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("ssn");
    expect(findings[0]?.preview).toBe("***-**-6789");
  });

  it("detects OCR-noisy SSN with placeholders when SSN context is present", () => {
    const bbox = makePage([
      makeWord("Soc.", { xMin: 10, yMin: 10, xMax: 32, yMax: 20 }),
      makeWord("Sec", { xMin: 34, yMin: 10, xMax: 50, yMax: 20 }),
      makeWord("#", { xMin: 52, yMin: 10, xMax: 56, yMax: 20 }),
      makeWord("530-8?", { xMin: 58, yMin: 10, xMax: 88, yMax: 20 }),
      makeWord("-3?07", { xMin: 90, yMin: 10, xMax: 118, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("ssn");
    expect(findings[0]?.preview).toBe("***-**-3*07");
  });

  it("detects SSN when OCR uses Unicode minus characters", () => {
    const bbox = makePage([
      makeWord("123−45−6789", { xMin: 10, yMin: 10, xMax: 88, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("ssn");
    expect(findings[0]?.preview).toBe("***-**-6789");
  });

  it("detects DOB date with spaced D.O.B context tokens", () => {
    const bbox = makePage([
      makeWord("D.", { xMin: 10, yMin: 10, xMax: 20, yMax: 20 }),
      makeWord("O.", { xMin: 22, yMin: 10, xMax: 32, yMax: 20 }),
      makeWord("B.", { xMin: 34, yMin: 10, xMax: 44, yMax: 20 }),
      makeWord("01/02/1980", { xMin: 46, yMin: 10, xMax: 96, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("dob");
    expect(findings[0]?.preview).toBe("**/**/****");
  });

  it("detects DOB when label and date share one token", () => {
    const bbox = makePage([
      makeWord("DOB:03-14-1978", { xMin: 10, yMin: 10, xMax: 90, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("dob");
  });

  it("does not flag bare nine-digit numbers without SSN context", () => {
    const bbox = makePage([
      makeWord("Claim", { xMin: 10, yMin: 10, xMax: 35, yMax: 20 }),
      makeWord("Number", { xMin: 37, yMin: 10, xMax: 68, yMax: 20 }),
      makeWord("123456789", { xMin: 70, yMin: 10, xMax: 120, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(0);
  });

  it("does not flag OCR-noisy nine-char numbers without SSN context", () => {
    const bbox = makePage([
      makeWord("Bill", { xMin: 10, yMin: 10, xMax: 30, yMax: 20 }),
      makeWord("ID", { xMin: 32, yMin: 10, xMax: 40, yMax: 20 }),
      makeWord("530-8?-3?07", { xMin: 42, yMin: 10, xMax: 102, yMax: 20 }),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(0);
  });

  it("parses word coordinates even when bbox attributes appear in different order", () => {
    const bbox = makePage([
      makeWord(
        "123-45-6789",
        { xMin: 10, yMin: 10, xMax: 80, yMax: 20 },
        ["yMin", "xMax", "xMin", "yMax"]
      ),
    ]);

    const findings = detectSensitiveBoxes(bbox, "records/example.pdf");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("ssn");
  });
});
