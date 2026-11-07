import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import request from "supertest";
import { startServer, type RunningServer } from "../index.ts";
import { User } from "../models/User.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = fileURLToPath(new URL("../index.ts", import.meta.url));
let database: MongoMemoryServer | undefined;
let runtime: RunningServer | undefined;
let environment: Record<string, string> = {};

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine an unused port.");
  }
  const { port } = address;
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}

interface LaunchedProcess {
  child: ReturnType<typeof spawn>;
  stop: (signal?: NodeJS.Signals) => void;
  output: () => string;
  exited: Promise<unknown[]>;
}

function launch(overrides: Record<string, string> = {}, { npm = false, cwd = root } = {}): LaunchedProcess {
  const child = spawn(npm ? "npm" : process.execPath, npm ? ["start"] : [entrypoint], {
    cwd,
    env: { ...process.env, ...environment, NODE_ENV: "production", ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
    detached: npm && process.platform !== "win32",
  });
  let output = "";
  child.stdout.on("data", (data) => { output += String(data); });
  child.stderr.on("data", (data) => { output += String(data); });
  const stop = (signal: NodeJS.Signals = "SIGTERM") => {
    try {
      if (npm && process.platform !== "win32") {
        if (typeof child.pid !== "number") {
          throw new Error("Process exited before it could be stopped.");
        }
        globalThis.process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if (errnoCode(error) !== "ESRCH") throw error;
    }
  };
  return { child, stop, output: () => output, exited: once(child, "close") };
}

async function waitForStartup(process: LaunchedProcess) {
  const deadline = Date.now() + 15000;
  while (!process.output().includes("PittPlanner running on port")) {
    assert.equal(process.child.exitCode, null, process.output());
    assert.ok(Date.now() < deadline, `Timed out waiting for startup: ${process.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function running(): RunningServer {
  assert.ok(runtime, "The integration server should be running");
  return runtime;
}

before(async () => {
  // MongoDB does not publish Debian ARM64 binaries; Ubuntu 22.04 binaries
  // work on ARM64 Linux with the same OpenSSL 3 runtime (including this harness).
  const arm64Ubuntu =
    process.platform === "linux" && process.arch === "arm64" && !process.env.MONGOMS_DISTRO;
  database = await MongoMemoryServer.create({
    binary: {
      version: "8.0.17",
      os: arm64Ubuntu ? { os: "linux", dist: "ubuntu", release: "22.04" } : undefined,
    },
  });
  environment = {
    MONGO_CONNECTION_STRING: database.getUri("pittplanner-test"),
    SESSION_SECRET: "integration-test-secret-not-for-deployment",
    PORT: await unusedPort(),
  };
  runtime = await startServer(environment);
}, { timeout: 180000 });


after(async () => {
  await runtime?.close();
  await database?.stop();
});

test("renders public pages and serves the updated CSS, JavaScript, and icons locally", async () => {
  for (const path of ["/", "/login", "/register"]) {
    const response = await request(running().server).get(path).expect(200);
    assert.match(response.text, /PittPlanner/);
    assert.match(response.text, /\/assets\/bootstrap\/js\/bootstrap.bundle.min.js/);
    assert.equal(response.headers["set-cookie"], undefined);
  }
  for (const path of [
    "/assets/bootstrap/css/bootstrap.min.css",
    "/assets/bootstrap/js/bootstrap.bundle.min.js",
    "/assets/bootstrap-icons/bootstrap-icons.css",
    "/assets/bootstrap-icons/fonts/bootstrap-icons.woff2",
  ]) {
    await request(running().server).get(path).expect(200);
  }
});

test("protects dashboard and class changes from anonymous visitors", async () => {
  for (const path of ["/dashboard", "/class"]) {
    const response = await request(running().server).get(path).expect(200);
    assert.match(response.text, /You must be logged in/);
  }
  for (const path of ["/class", "/remove"]) {
    const response = await request(running().server).post(path).type("form").send({}).expect(200);
    assert.match(response.text, /You must be logged in/);
  }
});

test("registers, logs in, tracks classes and degree progress, and logs out", async () => {
  const agent = request.agent(running().server);
  const credentials = { email: "student@example.com", password: "test-password" };
  const registered = await agent.post("/register").type("form")
    .send({ ...credentials, password2: credentials.password }).expect(200);
  assert.match(registered.text, /Successfully registered/);
  const stored = await User.findOne({ email: credentials.email });
  assert.ok(stored, "A registered user should be stored");
  assert.notEqual(stored.password, credentials.password);
  assert.ok(await bcrypt.compare(credentials.password, stored.password));

  const login = await agent.post("/login").type("form").send(credentials).expect(302);
  assert.equal(login.headers.location, "/dashboard");
  const loginCookie = login.headers["set-cookie"]?.[0] ?? "";
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /SameSite=Lax/);
  const addPage = await agent.get("/class").expect(200);
  assert.match(addPage.text, /Programming Course/);
  await agent.post("/class").type("form")
    .send({ name: "INFSCI 1570", credits: "3", requirement: "Programming Course" }).expect(302)
    .expect("Location", "/dashboard");
  const dashboard = await agent.get("/dashboard").expect(200);
  assert.match(dashboard.text, /INFSCI 1570/);
  assert.match(dashboard.text, /3 Credit Hours Complete/);
  assert.match(dashboard.text, /Requirement Satisfied/);

  await agent.post("/remove").type("form").send({ class: "INFSCI 1570" }).expect(302);
  assert.doesNotMatch((await agent.get("/dashboard").expect(200)).text, /INFSCI 1570/);
  const cleared = await User.findOne({ email: credentials.email });
  assert.ok(cleared, "The user should still exist");
  assert.equal(cleared.classes.length, 0);
  assert.ok(mongoose.connection.db, "The in-memory database should be connected");
  assert.ok(await mongoose.connection.db.collection("sessions").findOne({}));
  assert.match((await agent.get("/logout").expect(200)).text, /Successfully logged out/);
  assert.match((await agent.get("/dashboard").expect(200)).text, /You must be logged in/);
});

test("retains compatibility with legacy bcrypt hashes and stored class objects", async () => {
  assert.ok(mongoose.connection.db, "The in-memory database should be connected");
  await mongoose.connection.db.collection("users").insertOne({
    email: "legacy@example.com",
    password: (await bcrypt.hash("legacy-password", 10)).replace("$2b$", "$2a$"),
    classes: [{ name: "Legacy Class", credits: "3", requirement: "Programming Course" }],
  });
  const agent = request.agent(running().server);
  await agent.post("/login").type("form")
    .send({ email: "legacy@example.com", password: "legacy-password" }).expect(302);
  const dashboard = await agent.get("/dashboard").expect(200);
  assert.match(dashboard.text, /Legacy Class/);
  assert.match(dashboard.text, /3 Credit Hours Complete/);
});

test("handles registration and authentication failures without hanging", async () => {
  const agent = request.agent(running().server);
  const mismatch = await agent.post("/register").type("form")
    .send({ email: "bad@example.com", password: "one", password2: "two" }).expect(200);
  assert.match(mismatch.text, /Passwords do not match/);
  const duplicate = await agent.post("/register").type("form")
    .send({ email: "student@example.com", password: "test", password2: "test" }).expect(200);
  assert.match(duplicate.text, /already exists/);
  for (const email of ["student@example.com", "missing@example.com"]) {
    assert.match((await agent.post("/login").type("form")
      .send({ email, password: "wrong" }).expect(200)).text, /Incorrect email and password/);
  }
  for (const path of ["/login", "/register"]) {
    await agent.post(path).expect(400);
    await agent.post(path).send({ email: { $ne: null }, password: "wrong" }).expect(400);
  }
});

test("rejects invalid class data and keeps each user's classes separate", async () => {
  const agent = request.agent(running().server);
  await agent.post("/login").type("form")
    .send({ email: "student@example.com", password: "test-password" }).expect(302);
  for (const credits of ["", "-3", "no", "1.5"]) {
    await agent.post("/class").type("form")
      .send({ name: "Invalid", credits, requirement: "Programming Course" }).expect(400);
  }
  await agent.post("/class").type("form")
    .send({ name: "Invalid", credits: "3", requirement: "Unknown Requirement" }).expect(400);
  await agent.post("/remove").send({ class: { $ne: null } }).expect(400);
  await agent.post("/remove").type("form").send({ class: "Legacy Class" }).expect(302);
  const legacy = await User.findOne({ email: "legacy@example.com" });
  assert.ok(legacy, "The legacy user should still exist");
  assert.equal(legacy.classes.length, 1);
});

test("handles a session whose account has been deleted", async () => {
  await User.create({ email: "deleted@example.com", password: await bcrypt.hash("test", 10) });
  const agent = request.agent(running().server);
  await agent.post("/login").type("form").send({ email: "deleted@example.com", password: "test" }).expect(302);
  await User.deleteOne({ email: "deleted@example.com" });
  await agent.get("/dashboard").expect(302).expect("Location", "/login");
});

test("persists login sessions across an application restart", async () => {
  const login = await request(running().server).post("/login").type("form")
    .send({ email: "legacy@example.com", password: "legacy-password" }).expect(302);
  assert.ok(login.headers["set-cookie"], "Logging in should set a session cookie");
  const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  await running().close();
  runtime = undefined;
  runtime = await startServer(environment);
  const dashboard = await request(runtime.server).get("/dashboard").set("Cookie", cookie).expect(200);
  assert.match(dashboard.text, /Legacy Class/);
});

test("forwards rejected database queries to the error handler", async () => {
  await mongoose.disconnect();
  try {
    const response = await request(running().server).post("/login").type("form")
      .send({ email: "student@example.com", password: "test-password" }).expect(503);
    assert.match(response.text, /Database unavailable/);
  } finally {
    await running().close();
    runtime = undefined;
    runtime = await startServer(environment);
  }
});

test("fails startup clearly for missing configuration", { timeout: 15000 }, async (t) => {
  const process = launch({ MONGO_CONNECTION_STRING: "", SESSION_SECRET: "" });
  t.after(() => process.child.kill("SIGKILL"));
  assert.equal((await process.exited)[0], 1);
  assert.match(process.output(), /Startup failed: Set MONGO_CONNECTION_STRING/);
  assert.doesNotMatch(process.output(), /PittPlanner running/);
});

test("reports missing Atlas SRV records without logging credentials", { timeout: 20000 }, async (t) => {
  const process = launch({ MONGO_CONNECTION_STRING: "mongodb+srv://test:private-password@missing.invalid/pittplanner" });
  t.after(() => process.child.kill("SIGKILL"));
  assert.equal((await process.exited)[0], 1);
  assert.match(process.output(), /Unable to connect to MongoDB/);
  assert.match(process.output(), /querySrv ENOTFOUND/);
  assert.doesNotMatch(process.output(), /private-password|DeprecationWarning|PittPlanner running/);
});

test("reports occupied ports and cleans up its database connection", { timeout: 15000 }, async (t) => {
  const process = launch();
  t.after(() => process.child.kill("SIGKILL"));
  assert.equal((await process.exited)[0], 1);
  assert.match(process.output(), /already in use/);
});

test("npm start serves the app in production mode without deprecation warnings", { timeout: 20000 }, async (t) => {
  const port = await unusedPort();
  const process = launch({ PORT: port }, { npm: true });
  t.after(() => process.stop("SIGKILL"));
  await waitForStartup(process);
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /PittPlanner/);
  assert.doesNotMatch(process.output(), /DeprecationWarning|MemoryStore/);
  process.stop();
  await process.exited;
});

test("starts from another working directory and shuts down cleanly on SIGTERM", { timeout: 20000 }, async (t) => {
  const port = await unusedPort();
  const process = launch({ PORT: port }, { cwd: tmpdir() });
  t.after(() => process.child.kill("SIGKILL"));
  await waitForStartup(process);
  assert.equal((await fetch(`http://127.0.0.1:${port}/class`)).status, 200);
  process.child.kill("SIGTERM");
  assert.deepEqual(await process.exited, [0, null]);
  assert.doesNotMatch(process.output(), /DeprecationWarning/);
});
