// src/services/aiService.js
const { BedrockRuntimeClient, ConverseStreamCommand, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

// Initialize Bedrock client with AWS region (default to us-east-1 if not set)
const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const MODEL_ID = process.env.BEDROCK_INFERENCE_PROFILE_ARN;

// Helper function to convert frontend messages to the format Bedrock expects
function toBedrockMessages(messages) {
  // Put style instruction as a pseudo-user message
  const systemInstruction = {
    role: "user",
    content: [{ text: "You are a helpful AI assistant. Keep responses concise (1–2 sentences). Use simple language unless asked for detail." }]
  };

  const userAndAssistantMsgs = messages.map(m => ({
    role: m.type === "user" ? "user" : "assistant",
    content: [{ text: m.message }]
  }));

  return [systemInstruction, ...userAndAssistantMsgs];
}


// Main function to handle chat
async function streamChat({ messages }, onChunk) {
  const bedrockMessages = toBedrockMessages(messages);

  try {
    const cmd = new ConverseStreamCommand({
      modelId: MODEL_ID,
      messages: bedrockMessages,
      inferenceConfig: { 
        maxTokens: 200,  // maximum tokens to generate
        temperature: 0.2, // randomness in output (low = more deterministic)
        topP: 0.9         // nucleus sampling parameter
    }
    });

    const res = await client.send(cmd);

    for await (const event of res.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        onChunk(event.contentBlockDelta.delta.text);
      }
    }
  } catch (err) {
    // Fallback: if streaming fails, use normal non-streaming API
    const cmd = new ConverseCommand({
      modelId: MODEL_ID,
      messages: bedrockMessages,
      inferenceConfig: { maxTokens: 200, temperature: 0.2, topP: 0.9 }
    });
    const res = await client.send(cmd);
    // Extract full text from response
    const text = res?.output?.message?.content?.map(c => c.text).join("") || "";
    // Send the full response via callback and indicate done
    onChunk(text, { done: true });
  }
}

module.exports = { streamChat };
