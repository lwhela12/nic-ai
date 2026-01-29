import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { readFile } from "fs/promises";

/**
 * Extract text content from a PDF file.
 * Returns the extracted text as a string.
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  const dataBuffer = await readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

/**
 * Extract text content from a DOCX file.
 * Returns the extracted text as markdown-formatted string.
 */
export async function extractTextFromDocx(filePath: string): Promise<string> {
  const dataBuffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  return result.value;
}

/**
 * Extract text from a file based on its extension.
 * Supports PDF and DOCX formats.
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop();

  switch (ext) {
    case "pdf":
      return extractTextFromPdf(filePath);
    case "docx":
      return extractTextFromDocx(filePath);
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}
