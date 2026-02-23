const fs = require("fs");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { execFileSync } = require("child_process");

async function run() {
    const masterPath = "/Users/lucaswhelan/Downloads/Case Sample for Lucas WC copy/.ai_tool/templates/source/AO_STMT_and_Doc_Evidence_-2691432-GK.docx";
    const masterBytes = fs.readFileSync(masterPath);

    // 1. Fulfill DOCX using docxtemplater
    const zip = new PizZip(masterBytes);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
    });

    const docxData = {
        claimantName: "TEST CLAIMANT",
        claimNumber: "TEST-123",
        hearingNumber: "TEST-456",
        hearingDateTime: "Jan 1, 2025",
        employerName: "TEST EMPLOYER",
        appealNumber: "TEST-789",
        priorHearingNumber: "TEST-000",
        employer: "TEST EMPLOYER",
    };

    doc.render(docxData);
    const fulfilledBuffer = doc.getZip().generate({
        type: "nodebuffer",
        compression: "DEFLATE",
    });

    const outDocx = "test_fulfilled.docx";
    fs.writeFileSync(outDocx, fulfilledBuffer);

    // 2. Convert to PDF using LibreOffice
    console.log("Converting to PDF with LibreOffice...");
    execFileSync("/Applications/LibreOffice.app/Contents/MacOS/soffice", ["--headless", "--convert-to", "pdf", outDocx]);

    console.log("Done! Checking text layout...");
    const bboxHtml = execFileSync("pdftotext", ["test_fulfilled.pdf", "-"]).toString();
    console.log(bboxHtml.substring(0, 1000));
}

run().catch(console.error);
