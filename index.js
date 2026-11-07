import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

export async function startServer(env = process.env) {
  const { mongoUri, sessionSecret, port } = readConfig(env);

  // Use current Mongoose defaults explicitly; never buffer requests while offline.
  mongoose.set("strictQuery", false);
  mongoose.set("bufferCommands", false);

  // Label the app's connections so self-hosted MongoDB logs can tell them
  // apart from other clients (healthchecks, shells) on the same network.
  try {
    await mongoose.connect(mongoUri, { appName: "pittplanner", serverSelectionTimeoutMS: 10000 });
  } catch {
    await mongoose.disconnect();
    // Driver errors can contain credentials, so do not log the URI or raw error.
    throw new Error(
      "Unable to connect to MongoDB. Check MONGO_CONNECTION_STRING, that the server is running, " +
        "and your database credentials/network access. For querySrv ENOTFOUND, the Atlas hostname " +
        "has no DNS SRV record: copy the URI from an active Atlas cluster (Connect > Drivers) " +
        "or use local MongoDB. See README.md."
    );
  }

  try {
    const sessionStore = MongoStore.create({ client: mongoose.connection.getClient() });
    sessionStore.on("error", () => console.error("MongoDB session store error."));
    // Finish creating the TTL index before accepting traffic or closing the client.
    await sessionStore.collectionP.catch(() => {
      throw new Error("Unable to initialize MongoDB session storage. Check database permissions.");
    });
    const app = createApp({ sessionSecret, sessionStore });
    const server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, (error) => {
        if (error) reject(error);
        else resolve(listener);
      });
    });

    const close = async () => {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await mongoose.disconnect();
      }
    };

    return { app, server, close };
  } catch (error) {
    await mongoose.disconnect();
    if (error.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Stop the other server or change PORT.`);
    }
    throw error;
  }
}

async function main() {
  config({ quiet: true });
  try {
    const { server, close } = await startServer();
    console.log(`PittPlanner running on port ${server.address().port}`);

    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      try {
        await close();
      } catch {
        console.error("Failed to shut down cleanly.");
        process.exitCode = 1;
      } finally {
        clearTimeout(timeout);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
