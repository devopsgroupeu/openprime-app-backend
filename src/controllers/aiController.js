// src/controllers/aiController.js
const { streamChat } = require("../services/aiService");
const { buildChatRequest } = require("../services/aiChatRequest");

// Controller function to handle AI chat requests
async function chat(req, res, next) {
  try {
    let chatRequest;
    try {
      chatRequest = await buildChatRequest(req.body);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    // A dropped connection (tab closed, page left) cancels the Bedrock call,
    // its retries and its fallback: an answer nobody reads is still billed.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Helper function to send a chunk of data to the client
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      await streamChat(
        chatRequest,
        (chunk, meta) => {
          if (chunk) send({ chunk });
          if (meta?.done) send({ done: true });
        },
        { signal: abort.signal },
      );
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error("AI streaming error:", err);
      // Fallback message in case the AI model cannot be reached
      send({
        chunk: "⚠️ Sorry, Aura AI couldn't connect to the model. Please try again later.",
      });
      send({ done: true });
    }

    res.end();
  } catch (err) {
    console.error("AI controller error:", err);
    next(err);
  }
}

module.exports = { chat };
