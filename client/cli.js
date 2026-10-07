// Command-line client for user-service.
//   node cli.js register <name> <email> <password> [age] [city]
//   node cli.js login <email> <password>
//   node cli.js me
//   node cli.js ask "<question>"
// The JWT from register/login is saved to .token and sent on later calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(here, ".token");
const USER_SERVICE_ADDR = process.env.USER_SERVICE_ADDR || "localhost:50051";

const { user: userProto } = grpc.loadPackageDefinition(
  protoLoader.loadSync(path.join(here, "..", "proto", "user.proto"), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }),
);
const client = new userProto.UserService(USER_SERVICE_ADDR, grpc.credentials.createInsecure());

function authMetadata() {
  if (!fs.existsSync(TOKEN_FILE)) fail("Not logged in. Run: node cli.js login <email> <password>");
  const md = new grpc.Metadata();
  md.set("authorization", `Bearer ${fs.readFileSync(TOKEN_FILE, "utf8").trim()}`);
  return md;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function grpcError(err) {
  fail(`Error (${grpc.status[err.code] ?? err.code}): ${err.details || err.message}`);
}

function saveSession(err, res) {
  if (err) return grpcError(err);
  fs.writeFileSync(TOKEN_FILE, res.token);
  console.log(`Logged in as ${res.user.name} <${res.user.email}> (id ${res.user.id}). Token saved.`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "register": {
    const [name, email, password, age, city] = args;
    if (!password) fail("Usage: node cli.js register <name> <email> <password> [age] [city]");
    client.Register({ name, email, password, age: Number(age) || 0, city: city ?? "" }, saveSession);
    break;
  }

  case "login": {
    const [email, password] = args;
    if (!password) fail("Usage: node cli.js login <email> <password>");
    client.Login({ email, password }, saveSession);
    break;
  }

  case "me":
    client.GetProfile({}, authMetadata(), (err, user) => {
      if (err) return grpcError(err);
      console.log(JSON.stringify(user, null, 2));
    });
    break;

  case "ask": {
    const question = args.join(" ");
    if (!question) fail('Usage: node cli.js ask "<question>"');
    // Server streaming: print each chunk the moment it arrives.
    const stream = client.Ask({ question }, authMetadata());
    stream.on("data", (chunk) => process.stdout.write(chunk.text));
    stream.on("end", () => process.stdout.write("\n"));
    stream.on("error", (err) => {
      process.stdout.write("\n");
      grpcError(err);
    });
    break;
  }

  default:
    fail(
      "Commands:\n" +
        "  register <name> <email> <password> [age] [city]\n" +
        "  login <email> <password>\n" +
        "  me\n" +
        '  ask "<question>"',
    );
}
