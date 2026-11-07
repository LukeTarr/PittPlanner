export function readConfig(env = process.env) {
  const mongoUri = env.MONGO_CONNECTION_STRING?.trim();
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(mongoUri)) {
    throw new Error(
      "Set MONGO_CONNECTION_STRING to a valid MongoDB URI. See .env.example and README.md."
    );
  }

  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret === "replace-with-a-random-secret") {
    throw new Error(
      "Set SESSION_SECRET to a random secret. See .env.example and README.md."
    );
  }

  const port = Number(env.PORT ?? 4444);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return { mongoUri, sessionSecret, port };
}
