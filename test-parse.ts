import { readFile } from "fs/promises";
import { analyzeTemplateWithAI } from "./server/lib/extract.js";

async function test() {
  const text = await readFile("/Users/lucaswhelan/Downloads/Case Sample for Lucas WC copy/.ai_tool/templates/source/AO_STMT_and_Doc_Evidence_-2691432-GK.docx");
  // wait we need to use the actual extract logic...
}
