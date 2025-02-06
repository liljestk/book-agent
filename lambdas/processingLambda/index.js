const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { Client } = require('@opensearch-project/opensearch');

const s3Client = new S3Client();
const opensearchClient = new Client({
  node: process.env.OPENSEARCH_ENDPOINT // e.g. "https://your-opensearch-endpoint"
  // Add authentication configuration as needed
});

const streamToString = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });

// Dummy vectorization function – replace with your actual embedding logic.
function vectorizeText(text) {
  // Example: convert each character code modulo 100 into a number.
  return Array.from(text).map(ch => ch.charCodeAt(0) % 100);
}

exports.handler = async (event) => {
  const records = Array.isArray(event.Records) ? event.Records : [];
  if (!records.length) {
    console.error("No records found in event");
    return { statusCode: 400, body: "No records found" };
  }

  // Use your provided names as defaults.
  const bucket = process.env.BUCKET_NAME || "s3datastorebucket";
  const indexName = process.env.OPENSEARCH_INDEX || "bedrock-knowledge-base-default-index";

  for (const record of records) {
    try {
      const key = decodeURIComponent(record.s3.object.key);

      // Retrieve S3 object
      const s3Res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const fileContent = await streamToString(s3Res.Body);

      // Vectorize the file content
      const vector = vectorizeText(fileContent);

      // Index the document into OpenSearch
      await opensearchClient.index({
        index: indexName,
        body: {
          id: key,
          vector,       // the computed vector
          content: fileContent  // optionally store the original text
        }
      });

      console.log(`Processed and indexed ${key}`);
    } catch (error) {
      console.error(`Error processing record: ${error}`);
    }
  }
  return { statusCode: 200 };
};