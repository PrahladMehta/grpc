import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import bcrypt from "bcryptjs";
import { pool, createUser, findUserRowByEmail, getUserWithOrders, toUser } from "./db.js";
import { signToken, requireUser, requireInternal, internalMetadata } from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.USER_SERVICE_PORT || "50051";
const LLM_SERVICE_ADDR = process.env.LLM_SERVICE_ADDR || "localhost:50052";

const loadProto = (file) =>
  grpc.loadPackageDefinition(
    protoLoader.loadSync(path.join(here, "..", "proto", file), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    }),
  );
const { user: userProto } = loadProto("user.proto");
const { llm: llmProto } = loadProto("llm.proto");

const llmClient = new llmProto.LlmService(LLM_SERVICE_ADDR, grpc.credentials.createInsecure());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Wraps a unary handler so thrown/rejected gRPC-style errors become proper status responses.
const unary = (fn) => async (call, callback) => {
  try {
    callback(null, await fn(call));
  } catch (err) {
    if (err.code === undefined) console.error(err);
    callback({ code: err.code ?? grpc.status.INTERNAL, details: err.details ?? "Internal error" });
  }
};

const handlers = {
  Register: unary(async (call) => {
    const { name, email, password, age, city } = call.request;
    if (!name?.trim()) throw { code: grpc.status.INVALID_ARGUMENT, details: "name is required" };
    if (!EMAIL_RE.test(email ?? "")) throw { code: grpc.status.INVALID_ARGUMENT, details: "valid email is required" };
    if ((password ?? "").length < 8) {
      throw { code: grpc.status.INVALID_ARGUMENT, details: "password must be at least 8 characters" };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const user = await createUser({ name: name.trim(), email: email.toLowerCase(), passwordHash, age, city });
      return { token: signToken(user), user };
    } catch (err) {
      if (err.code === "23505") throw { code: grpc.status.ALREADY_EXISTS, details: "Email already registered" };
      throw err;
    }
  }),

  Login: unary(async (call) => {
    const { email, password } = call.request;
    const row = await findUserRowByEmail((email ?? "").toLowerCase());
    // Same message for unknown email and wrong password, so emails can't be probed.
    if (!row || !(await bcrypt.compare(password ?? "", row.password_hash))) {
      throw { code: grpc.status.UNAUTHENTICATED, details: "Invalid email or password" };
    }
    const user = toUser(row);
    return { token: signToken(user), user };
  }),

  GetProfile: unary(async (call) => {
    const userId = requireUser(call);
    const user = await getUserWithOrders(userId);
    if (!user) throw { code: grpc.status.NOT_FOUND, details: "User no longer exists" };
    return user;
  }),

  // Internal: llm-service fetches the authenticated user's data through this.
  GetUser: unary(async (call) => {
    requireInternal(call);
    const user = await getUserWithOrders(call.request.id);
    if (!user) throw { code: grpc.status.NOT_FOUND, details: `User ${call.request.id} not found` };
    return user;
  }),

  // Server streaming: authenticate, then relay llm-service's stream chunk by chunk.
  Ask(call) {
    let userId;
    try {
      userId = requireUser(call);
    } catch (err) {
      return call.emit("error", err);
    }
    const question = (call.request.question ?? "").trim();
    if (!question) {
      return call.emit("error", { code: grpc.status.INVALID_ARGUMENT, details: "question is required" });
    }

    const upstream = llmClient.Ask({ user_id: userId, question }, internalMetadata());
    upstream.on("data", (chunk) => call.write(chunk));
    upstream.on("end", () => call.end());
    upstream.on("error", (err) => {
      if (err.code === grpc.status.CANCELLED && call.cancelled) return;
      // No connection at all -> llm-service is down; otherwise pass its status through.
      const down = err.code === grpc.status.UNAVAILABLE && /No connection established|ECONNREFUSED/.test(err.details);
      call.emit("error", {
        code: err.code ?? grpc.status.INTERNAL,
        details: down ? "LLM service is unavailable" : err.details,
      });
    });
    // Client hung up: stop the LLM work too.
    call.on("cancelled", () => upstream.cancel());
  },
};

await pool.query("SELECT 1"); // fail fast if the database is unreachable

const server = new grpc.Server();
server.addService(userProto.UserService.service, handlers);
server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error("Failed to start user-service:", err.message);
    process.exit(1);
  }
  console.log(`user-service (gRPC) listening on port ${port}`);
});
