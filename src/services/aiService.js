// src/services/aiService.js
const { systemInstructionText } = require("../utils/aiModelInstructions");
const { BedrockRuntimeClient, ConverseStreamCommand, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const MODEL_ID = process.env.BEDROCK_INFERENCE_PROFILE_ARN;

// Convert frontend messages to Bedrock format with system instructions + topic
function toBedrockMessages(messages, topic) {
  const topicContext = topic
    ? `\n\nContext for this conversation: Focus only on **${topic}**.
      Answer with best practices, common issues, security, and cost optimization for ${topic}.`
    : "";

  const systemInstruction = {
    role: "user",
    content: [{ text: `${systemInstructionText}${topicContext}` }]
  };

  const userAndAssistantMsgs = messages.map(m => ({
    role: m.type === "user" ? "user" : "assistant",
    content: [{ text: m.content || m.message }]
  }));

  return [systemInstruction, ...userAndAssistantMsgs];
}

// Retry wrapper with exponential backoff
async function sendWithRetry(cmd, maxRetries = 5) {
  let delay = 500; 
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.send(cmd);
    } catch (err) {
      if (err.name === 'ThrottlingException') {
        console.warn(`Throttled by Bedrock. Retry #${attempt + 1} in ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; 
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries reached due to throttling.');
}

// Main function to handle chat with optional topic
async function streamChat({ messages, topic }, onChunk) {
  const bedrockMessages = toBedrockMessages(messages, topic);

  try {
    const cmd = new ConverseStreamCommand({
      modelId: MODEL_ID,
      messages: bedrockMessages,
      inferenceConfig: { maxTokens: 400, temperature: 0.2, topP: 0.9 }
    });

    const res = await sendWithRetry(cmd);

    let buffer = "";

    for await (const event of res.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        const text = event.contentBlockDelta.delta.text;
        buffer += text;
      }
    }

  onChunk(buffer, { done: true });

  } catch (err) {
    console.error("Streaming failed, fallback to non-streaming:", err.message);
    const cmd = new ConverseCommand({
      modelId: MODEL_ID,
      messages: bedrockMessages,
      inferenceConfig: { maxTokens: 400, temperature: 0.2, topP: 0.9 }
    });

    const res = await sendWithRetry(cmd);
    const text = res?.output?.message?.content?.map(c => c.text).join("") || "";
    onChunk(text, { done: true });
  }
}

module.exports = { streamChat };
