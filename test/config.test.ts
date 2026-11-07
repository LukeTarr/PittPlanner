import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../config.ts";

const valid = {
  MONGO_CONNECTION_STRING: "mongodb://127.0.0.1:27017/pittplanner",
  SESSION_SECRET: "a-test-only-session-secret",
};

test("accepts local and Atlas URIs and defaults to port 4444", () => {
  assert.deepEqual(readConfig(valid), {
    mongoUri: valid.MONGO_CONNECTION_STRING,
    sessionSecret: valid.SESSION_SECRET,
    port: 4444,
  });
  assert.equal(readConfig({ ...valid, MONGO_CONNECTION_STRING: "mongodb+srv://example.com/planner", PORT: "8080" }).port, 8080);
});

test("rejects missing or invalid database configuration", () => {
  for (const uri of [undefined, "", "https://example.com", "mongodb://", "mongodb://has whitespace"]) {
    assert.throws(() => readConfig({ ...valid, MONGO_CONNECTION_STRING: uri }), /MONGO_CONNECTION_STRING/);
  }
});

test("requires a real session secret", () => {
  for (const secret of [undefined, "", "   ", "replace-with-a-random-secret"]) {
    assert.throws(() => readConfig({ ...valid, SESSION_SECRET: secret }), /SESSION_SECRET/);
  }
});

test("rejects invalid ports", () => {
  for (const port of ["", "0", "65536", "-1", "4444.5", "not-a-number"]) {
    assert.throws(() => readConfig({ ...valid, PORT: port }), /PORT/);
  }
});
