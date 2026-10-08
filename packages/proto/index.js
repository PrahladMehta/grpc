import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const here = path.dirname(fileURLToPath(import.meta.url));

// Loads a .proto file from this package and returns its gRPC package object.
//   loadProto("user") -> { UserService, ... }   (proto package "user")
//   loadProto("llm")  -> { LlmService, ... }    (proto package "llm")
export function loadProto(name) {
  const definition = protoLoader.loadSync(path.join(here, `${name}.proto`), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(definition)[name];
}
