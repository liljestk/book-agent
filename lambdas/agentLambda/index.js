exports.handler = async (event) => {
    let body;
    try {
      body = JSON.parse(event.body || JSON.stringify(event)); // Support both direct and API Gateway payloads.
    } catch (err) {
      return { statusCode: 400, body: "Invalid JSON" };
    }
    
    const inputData = body.data || "";
    const modified = `${inputData}\n\n-- Processed by Agent`;
  
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: modified })
    };
  };
  