import crypto from "node:crypto";
import grpc from "@grpc/grpc-js";
import { loadProto } from "@upa/proto";
import { createAgent, tool } from "langchain";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as z from "zod";
import { getUser } from "./userClient.js";

const PORT = process.env.LLM_SERVICE_PORT || "50052";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const { INTERNAL_TOKEN } = process.env;

if (!INTERNAL_TOKEN) {
  console.error("INTERNAL_TOKEN must be set in llm-service/.env (same value as user-service).");
  process.exit(1);
}

const llmProto = loadProto("llm");

// The tool takes no ID argument: it always reads the authenticated user's own data
// (passed via config), so a prompt can't make the model fetch someone else's account.
const getMyAccount = tool(
  async (_input, config) => {
    try {
      return JSON.stringify(await getUser(config.configurable.userId));
    } catch (err) {
      return `Error: ${err.details || err.message}`;
    }
  },
  {
    name: "get_my_account",
    description:
      "Fetch the current user's profile (name, email, age, city, plan) and their orders (item, amount, status, date).",
    schema: z.object({}),
  },
);

// Built on first use: ChatGoogleGenerativeAI throws without GOOGLE_API_KEY / GEMINI_API_KEY.
let agent;
function getAgent() {
  agent ??= createAgent({
    // Few retries: when Gemini is overloaded (503) or rate-limited (429), fail in seconds
    // with a clear error instead of backing off silently for minutes.
    model: new ChatGoogleGenerativeAI({ model: GEMINI_MODEL, temperature: 0, maxRetries: 2 }),
    tools: [getMyAccount],
    systemPrompt:
      "You are an assistant for a signed-in user. Answer questions about their account and orders. " +
      "Look the data up with get_my_account rather than guessing. You only have access to this user's data; " +
      "if they ask about other users, say you can't share that. If the data doesn't contain the answer, say so. " +
      "Order amounts are in Indian rupees, exactly as stored (4599 means ₹4,599). " +
      "Keep answers short and direct.",
  });
  return agent;
}

function isInternal(call) {
  const given = Buffer.from(String(call.metadata.get("x-internal-token")[0] ?? ""));
  const expected = Buffer.from(INTERNAL_TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const handlers = {
  // Server streaming: write each text chunk to the caller as the model produces it.
  async Ask(call) {
    if (!isInternal(call)) {
      return call.emit("error", { code: grpc.status.PERMISSION_DENIED, details: "Internal endpoint" });
    }
    const { user_id, question } = call.request;
    const abort = new AbortController();
    call.on("cancelled", () => abort.abort());

    try {
      const stream = await getAgent().stream(
        { messages: [{ role: "user", content: question }] },
        {
          streamMode: "messages",
          configurable: { userId: user_id },
          recursionLimit: 10,
          signal: abort.signal,
        },
      );
      // "messages" mode yields [messageChunk, metadata]; only forward the model's text,
      // not tool results.
      for await (const [chunk] of stream) {
        if (chunk.type !== "ai") continue;
        const text = chunk.text;
        if (text) call.write({ text });
      }
      call.end();
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(err);
      // Gemini overloaded (503) or rate-limited (429): tell the caller to retry, without the raw upstream dump.
      if (/\[(429|503)[ \]]/.test(err.message)) {
        return call.emit("error", {
          code: grpc.status.UNAVAILABLE,
          details: "The AI model is busy right now. Please try again in a minute.",
        });
      }
      call.emit("error", { code: grpc.status.INTERNAL, details: "The AI model failed to answer." });
    }
  },
};

const server = new grpc.Server();
server.addService(llmProto.LlmService.service, handlers);
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error("Failed to start llm-service:", err.message);
    process.exit(1);
  }
  console.log(`llm-service (gRPC) listening on port ${port}`);
});
