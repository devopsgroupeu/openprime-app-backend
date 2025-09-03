// src/controllers/aiController.js
const { streamChat } = require("../services/aiService");

// Controller function to handle AI chat requests
async function chat(req, res, next) {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages payload" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Helper function to send a chunk of data to the client
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      await streamChat({ messages, topic: req.body.topic}, (chunk, meta) => {
        if (chunk) send({ chunk });
        if (meta?.done) send({ done: true });
      });
    } catch (err) {
      console.error("AI streaming error:", err);
      // Fallback message in case the AI model cannot be reached
      send({
        chunk: "⚠️ Sorry, Aura AI couldn't connect to the model. Please try again later."
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
