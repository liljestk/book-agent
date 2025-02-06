const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "eu-central-1"
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: ''
    };
  }

  try {
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    const { query } = parsedBody;
    if (!query) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ response: "No query provided" })
      };
    }

    // Build payload for Bedrock Agent using the incoming query.
    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: query
        }]
      }]
    };

    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: "application/json",
      body: JSON.stringify(payload)
    });

    const bedrockResponse = await bedrockClient.send(command);
    const decodedBody = new TextDecoder().decode(bedrockResponse.body);
    const parsedResponse = JSON.parse(decodedBody);
    const enrichedResponse = parsedResponse?.content?.[0]?.text || "(No response)";

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ response: enrichedResponse }),
    };

  } catch (error) {
    console.error("Error processing request:", error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        message: "Internal server error",
        error: error.message
      })
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "POST,OPTIONS,GET"
  };
}
