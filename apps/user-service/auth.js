import grpc from "@grpc/grpc-js";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const { JWT_SECRET, INTERNAL_TOKEN } = process.env;
if (!JWT_SECRET || !INTERNAL_TOKEN) {
  console.error("JWT_SECRET and INTERNAL_TOKEN must be set in user-service/.env (see .env.example).");
  process.exit(1);
}

const TOKEN_TTL = "1h";

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Reads "authorization: Bearer <jwt>" from gRPC metadata. Returns the user ID or throws a gRPC error.
export function requireUser(call) {
  const header = String(call.metadata.get("authorization")[0] ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    throw { code: grpc.status.UNAUTHENTICATED, details: "Missing bearer token" };
  }
  try {
    return jwt.verify(token, JWT_SECRET).sub;
  } catch {
    throw { code: grpc.status.UNAUTHENTICATED, details: "Invalid or expired token" };
  }
}

// For service-to-service calls (llm-service -> user-service).
export function requireInternal(call) {
  const given = Buffer.from(String(call.metadata.get("x-internal-token")[0] ?? ""));
  const expected = Buffer.from(INTERNAL_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw { code: grpc.status.PERMISSION_DENIED, details: "Internal endpoint" };
  }
}

export function internalMetadata() {
  const md = new grpc.Metadata();
  md.set("x-internal-token", INTERNAL_TOKEN);
  return md;
}
