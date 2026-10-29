// src/services/aiService.js
const {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
const {
  bedrockRequestsTotal,
  bedrockRequestDurationSeconds,
  bedrockThrottlesTotal,
} = require("../utils/metrics");

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const MODEL_ID = process.env.BEDROCK_INFERENCE_PROFILE_ARN;

// Create every outcome series at zero, so the first call after a restart is
// visible to increase()/rate() rather than starting a brand-new series.
for (const operation of ["ConverseStream", "Converse"]) {
  bedrockThrottlesTotal.inc({ operation }, 0);
  for (const outcome of ["success", "throttled", "error"]) {
    bedrockRequestsTotal.inc({ operation, outcome }, 0);
  }
}

// Time one logical Bedrock call (all throttling retries included, since that
// is the latency the user waits through) and record its outcome.
async function observeBedrockCall(operation, call) {
  const endTimer = bedrockRequestDurationSeconds.startTimer();
  let outcome = "error";
  try {
    const result = await call();
    outcome = "success";
    return result;
  } catch (err) {
    if (err.name === "ThrottlingException") {
      outcome = "throttled";
      // A throttle can also arrive mid-stream, after sendWithRetry returned;
      // count it here unless sendWithRetry already did.
      if (!err.throttleCounted) bedrockThrottlesTotal.inc({ operation });
    }
    throw err;
  } finally {
    bedrockRequestsTotal.inc({ operation, outcome });
    endTimer({ operation, outcome });
  }
}

// Retry wrapper with exponential backoff. Once `signal` aborts (the client
// went away) the in-flight call is cancelled and no further attempt is made.
async function sendWithRetry(operation, cmd, signal, maxRetries = 5) {
  let delay = 500;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.send(cmd, { abortSignal: signal });
    } catch (err) {
      if (err.name === "ThrottlingException") {
        bedrockThrottlesTotal.inc({ operation });
        err.throttleCounted = true;
      }
      if (err.name === "ThrottlingException" && attempt < maxRetries) {
        console.warn(`Throttled by Bedrock. Retry #${attempt + 1} in ${delay}ms`);
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
        signal?.throwIfAborted();
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries reached due to throttling.");
}

// Run one chat turn. `system` and `messages` are already in Bedrock's format,
// built and sanitised by buildChatRequest (src/services/aiChatRequest.js).
async function streamChat({ system, messages }, onChunk, { signal } = {}) {
  try {
    const cmd = new ConverseStreamCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: { maxTokens: 400 },
    });

    // Timed through the end of the stream: a stream that breaks midway is a
    // failed call, and the time to read it out is part of the latency.
    const buffer = await observeBedrockCall("ConverseStream", async () => {
      const res = await sendWithRetry("ConverseStream", cmd, signal);

      let text = "";

      for await (const event of res.stream) {
        signal?.throwIfAborted();
        if (event.contentBlockDelta?.delta?.text) {
          text += event.contentBlockDelta.delta.text;
        }
      }

      return text;
    });

    onChunk(buffer, { done: true });
  } catch (err) {
    // Nobody is waiting for the answer: a second, non-streaming call would only
    // be billed.
    if (signal?.aborted) throw err;
    console.error("Streaming failed, fallback to non-streaming:", err.message);
    const cmd = new ConverseCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: { maxTokens: 400 },
    });

    const res = await observeBedrockCall("Converse", () => sendWithRetry("Converse", cmd, signal));
    const text = res?.output?.message?.content?.map((c) => c.text).join("") || "";
    onChunk(text, { done: true });
  }
}

module.exports = { streamChat };
