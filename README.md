# PittPlanner

## What is PittPlanner?

PittPlanner is a collaborative full-stack web application made as a university final project. It allows Information Science students at the University of Pittsburgh to track their degree progress by adding classes they have taken. Students can see a summary of completed requirements and an in-depth report from their dashboard.

## Technologies
- Node.js / Express.js server
- [EJS templating engine](https://ejs.co/)
- [MongoDB Database](https://www.mongodb.com/)
- express-session, connect-mongo, and bcryptjs for authentication and persistent sessions
- Bootstrap and Bootstrap Icons, served locally from the installed packages


## Run locally

Requirements: **Node.js 24 LTS** (see `.nvmrc`), npm, and a running **MongoDB 8.0** server or an active MongoDB Atlas cluster. The old Heroku deployment and Atlas hostname are not required.

```sh
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `.env`: replace `SESSION_SECRET` with the generated value and set `MONGO_CONNECTION_STRING` to your database URI. Keep the same secret across restarts so existing sessions stay valid. Never commit `.env`.

For a local MongoDB installation, start MongoDB and use:

```dotenv
MONGO_CONNECTION_STRING=mongodb://127.0.0.1:27017/pittplanner
```

Alternatively, start just the database with Docker (bind it to localhost and persist its data):

```sh
docker run --name pittplanner-mongo -d -p 127.0.0.1:27017:27017 -v pittplanner-mongo-data:/data/db mongo:8.0
```

Then start the app:

```sh
npm start
```

Open **http://localhost:4444**. Register an account, log in, and add classes from the dashboard. `PORT` defaults to `4444`. Use `npm run dev` for Node's built-in watch mode.

## Deploy as a standalone container

The repository's `Dockerfile` builds a single application container using Node.js 24 and runs it as a non-root user. MongoDB is hosted separately; supply its connection string at runtime. The app stores users, classes, and sessions in that database, so the app container does not need a persistent volume.

Create `.env` as above and set `MONGO_CONNECTION_STRING` to a database reachable from the container, then build and run:

```sh
docker build -t pittplanner .
docker run -d --name pittplanner --restart unless-stopped --env-file .env -p 4444:4444 pittplanner
```

Keep `PORT=4444` for this port mapping. Inside a container, `127.0.0.1` refers to the app container itself: use your MongoDB service's reachable hostname rather than the local-development URI in `.env.example`. If MongoDB is on a private Docker network, attach the app with `--network <database-network>`. Secrets are passed at runtime; `.env` files are excluded from the image.

### Deploy on Coolify

1. Create an application from this repository and select the **Dockerfile** build pack. Use the repository root as the base directory and `/Dockerfile` as the Dockerfile location.
2. Create or select your separately hosted MongoDB resource in Coolify and start it. Ensure the app and database share a Docker network so the app can resolve and reach the database's internal hostname.
3. Add these **runtime environment variables** to the app in Coolify:

   | Variable | Value |
   | --- | --- |
   | `MONGO_CONNECTION_STRING` | The MongoDB resource's internal connection URI, including the `pittplanner` database name and credentials. |
   | `SESSION_SECRET` | A generated random secret (use the command in **Run locally**); keep it stable across deployments. |
   | `PORT` | `4444` |

   For example, a MongoDB user created in the `admin` authentication database would use `mongodb://USERNAME:URL_ENCODED_PASSWORD@MONGODB_INTERNAL_HOST:27017/pittplanner?authSource=admin`. Use the hostname and authentication settings from your actual MongoDB resource, and URL-encode special characters in credentials. The URI must be reachable from the app container.
4. Set the app's **Ports Exposes** to `4444`, configure your domain, and deploy. Coolify builds the Dockerfile and routes traffic to the app. If you enable an HTTP health check, use `GET /` on port `4444`.

The Dockerfile supplies the start command (`node index.ts`) and production mode. No build-time database connection or `.env` file in the image is needed. Use the same MongoDB URI and session secret on redeployment to retain data and login sessions.

### Use MongoDB Atlas

1. Create or resume a cluster and copy its **Connect → Drivers** connection string.
2. Create a database user, substitute its username/password in the URI, and include the `pittplanner` database name. URL-encode special characters in credentials.
3. Allow the app server's IP address in Atlas **Network Access**.
4. Set `MONGO_CONNECTION_STRING` in `.env` (or in your hosting environment) and restart the app.

Existing users and classes are retained when you connect to the same database; no schema migration is needed. Connecting to a new local database starts with an empty planner.

## Troubleshooting startup

- **`querySrv ENOTFOUND _mongodb._tcp.cluster0.mhfqe.mongodb.net`**: DNS cannot find the Atlas cluster's SRV record. The old project cluster may have been removed, or the hostname is incorrect. Updating packages cannot restore a deleted cluster. Use the URI from an active cluster or switch to local MongoDB. If a current cluster also fails, check your network's DNS/SRV support.
- **`strictQuery` deprecation warning**: this came from Mongoose 6. The app now uses Mongoose 9 with an explicit `strictQuery` setting and no obsolete driver options.
- **Connection refused or server selection timeout**: check that MongoDB is running and reachable; for Atlas, also check credentials and the IP access list.
- **Missing configuration**: the app validates `MONGO_CONNECTION_STRING`, `SESSION_SECRET`, and `PORT` before connecting. It exits with a nonzero status and an actionable message on failure, rather than leaving an unusable process running. Database server selection is limited to 10 seconds (DNS resolution also depends on the system resolver).

## Verification

```sh
npm run check
npm test
npm audit
```

This is a server-rendered TypeScript app. Node.js 24 runs `.ts` files directly (native type stripping), so there is no compilation/build step. `check` (`tsc --noEmit`) validates every type in the codebase; the integration tests render the EJS pages and exercise real database operations, session persistence, startup failures, and shutdown.

Tests use `mongodb-memory-server-core` to start an isolated, temporary MongoDB process. On the first run it downloads a MongoDB binary, so internet access is required. It never connects to your `.env` database. If needed, use `MONGOMS_SYSTEM_BINARY=/path/to/mongod` to supply a compatible installed binary.
