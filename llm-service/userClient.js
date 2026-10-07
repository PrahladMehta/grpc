import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(here, "..", "proto", "user.proto");
const USER_SERVICE_ADDR = process.env.USER_SERVICE_ADDR || "localhost:50051";

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const { user: userProto } = grpc.loadPackageDefinition(packageDefinition);

const client = new userProto.UserService(USER_SERVICE_ADDR, grpc.credentials.createInsecure());

// GetUser is an internal endpoint: authenticate this service with the shared token.
function internalMetadata() {
  const md = new grpc.Metadata();
  md.set("x-internal-token", process.env.INTERNAL_TOKEN);
  return md;
}

export function getUser(id) {
  return new Promise((resolve, reject) => {
    client.GetUser({ id }, internalMetadata(), (err, res) => (err ? reject(err) : resolve(res)));
  });
}
