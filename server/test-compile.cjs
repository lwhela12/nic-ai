const fs = require('fs');
const docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');

const content = fs.readFileSync('/Users/lucaswhelan/jason-ai/tmp_test_docx2/test.docx', 'binary');
const zip = new PizZip(content);

try {
  const doc = new docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
} catch (error) {
  if (error.properties && error.properties.errors) {
    error.properties.errors.forEach(function(err) {
      console.log("Error:", err.message);
      console.log("Context:", err.properties.context);
      console.log("Offset:", err.properties.offset);
      const xml = zip.files['word/document.xml'].asText();
      console.log("Surrounding XML:", xml.substring(err.properties.offset - 30, err.properties.offset + 30));
      console.log("---");
    });
  } else {
    console.log(error);
  }
}
