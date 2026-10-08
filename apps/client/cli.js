// Client for user-service.
//
// Interactive mode (stays open):
//   node cli.js
//
// One-shot commands:
//   node cli.js register <name> <email> <password> [age] [city]
//   node cli.js login <email> <password>
//   node cli.js me
//   node cli.js ask "<question>"
//
// The JWT from register/login is saved to .token and sent on later calls.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import { loadProto } from "@upa/proto";

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(here, ".token");
const USER_SERVICE_ADDR = process.env.USER_SERVICE_ADDR || "localhost:50051";

const userProto = loadProto("user");
const client = new userProto.UserService(USER_SERVICE_ADDR, grpc.credentials.createInsecure());

// ---------- gRPC calls ----------

const readToken = () => (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8").trim() : "");

function authMetadata() {
  const md = new grpc.Metadata();
  md.set("authorization", `Bearer ${readToken()}`);
  return md;
}

const unaryCall = (method, request, metadata = new grpc.Metadata()) =>
  new Promise((resolve, reject) => {
    client[method](request, metadata, (err, res) => (err ? reject(err) : resolve(res)));
  });

async function register(name, email, password, age, city) {
  const res = await unaryCall("Register", { name, email, password, age: Number(age) || 0, city: city ?? "" });
  fs.writeFileSync(TOKEN_FILE, res.token);
  return res.user;
}

async function login(email, password) {
  const res = await unaryCall("Login", { email, password });
  fs.writeFileSync(TOKEN_FILE, res.token);
  return res.user;
}

const getProfile = () => unaryCall("GetProfile", {}, authMetadata());

// Server streaming: onText is called for every chunk as it arrives.
// Returns { done, cancel } so a caller can stop the answer midway.
function ask(question, onText) {
  const stream = client.Ask({ question }, authMetadata());
  const done = new Promise((resolve, reject) => {
    stream.on("data", (chunk) => onText(chunk.text));
    stream.on("end", resolve);
    stream.on("error", (err) => (err.code === grpc.status.CANCELLED ? resolve() : reject(err)));
  });
  return { done, cancel: () => stream.cancel() };
}

const errorText = (err) => `Error (${grpc.status[err.code] ?? err.code}): ${err.details || err.message}`;

// ---------- interactive mode ----------

const HELP = `
Commands
  login              log in (asks for email and password)
  register           create an account (asks for details)
  me                 show your profile and orders
  logout             log out
  help               show this guide
  exit               quit

Anything else you type is sent as a question to the AI.
Press Ctrl+C while an answer is streaming to stop it.
`;

async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let currentUser = null;
  let activeAnswer = null;
  let hideInput = false;

  // Masks typed characters while entering a password.
  const writeOutput = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => writeOutput(hideInput && !s.includes("\n") ? "*".repeat(s.length) : s);

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));
  async function password(prompt) {
    rl.output.write(prompt);
    hideInput = true;
    const value = await question("");
    hideInput = false;
    return value;
  }

  const promptText = () => (currentUser ? `${currentUser.name.split(" ")[0]}> ` : "guest> ");

  rl.on("SIGINT", () => {
    if (activeAnswer) {
      activeAnswer.cancel();
      process.stdout.write("\n(stopped)");
    } else {
      rl.close();
    }
  });
  rl.on("close", () => {
    console.log("\nBye!");
    process.exit(0);
  });

  // Resume a saved login if the token is still valid.
  if (readToken()) {
    try {
      currentUser = await getProfile();
    } catch {
      fs.rmSync(TOKEN_FILE, { force: true });
    }
  }

  console.log(`Connected to user-service at ${USER_SERVICE_ADDR}`);
  console.log(currentUser ? `Logged in as ${currentUser.name}.` : "You are not logged in. Type 'login' or 'register'.");
  console.log("Type 'help' for commands.\n");

  async function handle(line) {
    const input = line.trim();
    if (!input) return;

    switch (input.toLowerCase()) {
      case "help":
        console.log(HELP);
        return;

      case "exit":
      case "quit":
        rl.close();
        return;

      case "login": {
        const email = await question("Email: ");
        const pass = await password("Password: ");
        currentUser = await login(email.trim(), pass);
        console.log(`Logged in as ${currentUser.name}.`);
        return;
      }

      case "register": {
        const name = await question("Name: ");
        const email = await question("Email: ");
        const pass = await password("Password (min 8 chars): ");
        const age = await question("Age (optional): ");
        const city = await question("City (optional): ");
        currentUser = await register(name.trim(), email.trim(), pass, age.trim(), city.trim());
        console.log(`Account created. Logged in as ${currentUser.name}.`);
        return;
      }

      case "logout":
        fs.rmSync(TOKEN_FILE, { force: true });
        currentUser = null;
        console.log("Logged out.");
        return;

      case "me": {
        if (!currentUser) return console.log("Please log in first.");
        const u = await getProfile();
        console.log(`\n${u.name} <${u.email}>  |  ${u.city || "-"}  |  age ${u.age || "-"}  |  ${u.plan} plan`);
        if (!u.orders.length) console.log("No orders.");
        for (const o of u.orders) console.log(`  #${o.id}  ${o.item}  ₹${o.amount}  ${o.status}`);
        console.log();
        return;
      }

      default: {
        if (!currentUser) return console.log("Please log in first (type 'login' or 'register').");
        activeAnswer = ask(input, (text) => process.stdout.write(text));
        try {
          await activeAnswer.done;
        } finally {
          activeAnswer = null;
          process.stdout.write("\n\n");
        }
      }
    }
  }

  // One line at a time: the next prompt appears only after the previous answer finishes.
  while (true) {
    const line = await question(promptText());
    try {
      await handle(line);
    } catch (err) {
      console.log(errorText(err));
      if (err.code === grpc.status.UNAUTHENTICATED && currentUser) {
        fs.rmSync(TOKEN_FILE, { force: true });
        currentUser = null;
        console.log("Your session expired. Please log in again.");
      }
    }
  }
}

// ---------- one-shot commands ----------

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function oneShot(command, args) {
  switch (command) {
    case "register": {
      const [name, email, password, age, city] = args;
      if (!password) fail("Usage: node cli.js register <name> <email> <password> [age] [city]");
      const u = await register(name, email, password, age, city);
      console.log(`Logged in as ${u.name} <${u.email}> (id ${u.id}). Token saved.`);
      break;
    }
    case "login": {
      const [email, password] = args;
      if (!password) fail("Usage: node cli.js login <email> <password>");
      const u = await login(email, password);
      console.log(`Logged in as ${u.name} <${u.email}> (id ${u.id}). Token saved.`);
      break;
    }
    case "me":
      if (!readToken()) fail("Not logged in. Run: node cli.js login <email> <password>");
      console.log(JSON.stringify(await getProfile(), null, 2));
      break;
    case "ask": {
      const q = args.join(" ");
      if (!q) fail('Usage: node cli.js ask "<question>"');
      if (!readToken()) fail("Not logged in. Run: node cli.js login <email> <password>");
      await ask(q, (text) => process.stdout.write(text)).done;
      process.stdout.write("\n");
      break;
    }
    default:
      fail('Run "node cli.js" for interactive mode, or: register | login | me | ask "<question>"');
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  await interactive();
} else {
  try {
    await oneShot(command, args);
  } catch (err) {
    fail(errorText(err));
  }
}
