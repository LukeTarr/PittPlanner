import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import sessions from "express-session";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./models/User.ts";
import type { UserDocument } from "./models/User.ts";

declare module "express-session" {
  interface SessionData {
    userid?: string;
  }
}

declare module "express" {
  interface Locals {
    currentUser?: UserDocument;
  }
}

interface Requirement {
  name: string;
  amount: number;
  req_type: string;
}

const requirements = readRequirements(
  fileURLToPath(new URL("./reqs.json", import.meta.url))
);
const requirementNames: readonly string[] = requirements.map(
  (requirement) => requirement.name
);
const assetPath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function readRequirements(path: string): Requirement[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new TypeError("reqs.json must contain an array of requirements.");
  }
  return parsed.map((entry) => {
    if (
      typeof entry !== "object" || entry === null ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).amount !== "number" ||
      typeof (entry as Record<string, unknown>).req_type !== "string"
    ) {
      throw new TypeError(
        "Every requirement in reqs.json needs string name and req_type properties and a number amount."
      );
    }
    return entry as Requirement;
  });
}

interface LoginBody {
  email: string;
  password: string;
}

function parseLogin(body: unknown): LoginBody | null {
  const { email, password } = readRecord(body);
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return null;
  }
  return { email: email.trim(), password };
}

interface RegisterBody {
  email: string;
  password: string;
  password2: unknown;
}

function parseRegister(body: unknown): RegisterBody | null {
  const { email, password, password2 } = readRecord(body);
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return null;
  }
  return { email: email.trim(), password, password2 };
}

interface ClassBody {
  name: string;
  credits: number;
  requirement: string;
}

function parseClass(body: unknown): ClassBody | null {
  const { name, credits, requirement } = readRecord(body);
  if (typeof name !== "string" || !name.trim()) return null;
  if (
    typeof credits !== "string" || !credits.trim() ||
    !Number.isInteger(Number(credits)) || Number(credits) < 1
  ) {
    return null;
  }
  if (typeof requirement !== "string" || !requirementNames.includes(requirement)) return null;
  return { name: name.trim(), credits: Number(credits), requirement };
}

function parseClassName(body: unknown): string | null {
  const { class: className } = readRecord(body);
  return typeof className === "string" ? className : null;
}

function readRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function authorizedUser(res: Response): UserDocument {
  const user = res.locals.currentUser;
  if (!user) {
    throw new Error("Route reached without the auth middleware attaching a user.");
  }
  return user;
}

export function createApp({ sessionSecret, sessionStore }: { sessionSecret: string; sessionStore: sessions.Store }): express.Express {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.set("view engine", "ejs");
  app.set("views", fileURLToPath(new URL("./views", import.meta.url)));

  app.use("/assets/bootstrap", express.static(assetPath("./node_modules/bootstrap/dist")));
  app.use("/assets/bootstrap-icons", express.static(assetPath("./node_modules/bootstrap-icons/font")));
  app.use(
    sessions({
      secret: sessionSecret,
      store: sessionStore,
      saveUninitialized: false,
      cookie: { maxAge: 86400000, secure: false, httpOnly: true, sameSite: "lax" },
      resave: false,
    })
  );

  const renderLogin = (req: Request, res: Response, error: string | null = null, success: string | null = null) =>
    res.render("login", { error, success, user: req.session.userid });
  const renderRegister = (req: Request, res: Response, error: string | null = null) =>
    res.render("register", { error, user: req.session.userid });

  const auth: RequestHandler = async (req, res, next) => {
    if (req.session.userid) {
      const user = await User.findOne({ email: req.session.userid });
      if (user) {
        res.locals.currentUser = user;
        return next();
      }
      await promisify(req.session.destroy).call(req.session);
      return res.redirect("/login");
    }
    return renderLogin(req, res, "You must be logged in to view that page");
  };

  app.get("/", (req, res) => res.render("index", { user: req.session.userid }));
  app.get("/login", (req, res) => renderLogin(req, res));

  app.post("/login", async (req, res) => {
    const credentials = parseLogin(req.body);
    if (!credentials) {
      return renderLogin(req, res.status(400), "Email and password are required.");
    }
    const user = await User.findOne({ email: credentials.email });
    if (!user || !(await bcrypt.compare(credentials.password, user.password))) {
      return renderLogin(req, res, "Incorrect email and password combination");
    }

    await promisify(req.session.regenerate).call(req.session);
    req.session.userid = user.email;
    await promisify(req.session.save).call(req.session);
    return res.redirect("/dashboard");
  });

  app.get("/register", (req, res) => renderRegister(req, res));
  app.post("/register", async (req, res) => {
    const input = parseRegister(req.body);
    if (!input) {
      return renderRegister(req, res.status(400), "Email and password are required.");
    }
    if (input.password2 !== input.password) {
      return renderRegister(req, res, "Passwords do not match.");
    }
    if (await User.findOne({ email: input.email })) {
      return renderRegister(req, res, "User with that email already exists");
    }
    await User.create({ email: input.email, password: await bcrypt.hash(input.password, 10) });
    return renderLogin(req, res, null, "Successfully registered, you can now log in");
  });

  app.get("/class", auth, (req, res) => {
    res.render("add", { user: req.session.userid, reqs: requirementNames });
  });

  app.post("/class", auth, async (req, res) => {
    const course = parseClass(req.body);
    if (!course) {
      return res.status(400).send("Provide a class name, positive whole-number credits, and a valid requirement.");
    }
    await User.updateOne(
      { _id: authorizedUser(res)._id },
      { $push: { classes: course } }
    );
    return res.redirect("/dashboard");
  });

  app.post("/remove", auth, async (req, res) => {
    const className = parseClassName(req.body);
    if (className === null) {
      return res.status(400).send("Provide a class name to remove.");
    }
    await User.updateOne(
      { _id: authorizedUser(res)._id },
      { $pull: { classes: { name: className } } }
    );
    return res.redirect("/dashboard");
  });

  app.get("/logout", auth, async (req, res) => {
    await promisify(req.session.destroy).call(req.session);
    res.clearCookie("connect.sid");
    return res.render("login", { error: null, success: "Successfully logged out", user: null });
  });

  app.get("/dashboard", auth, (req, res) => {
    res.render("dashboard", {
      user: req.session.userid,
      reqs: requirements,
      classes: authorizedUser(res).classes,
    });
  });

  // Express 5 forwards rejected async route handlers here instead of hanging requests.
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    console.error("Request failed:", error instanceof Error ? error.name : String(error));
    if (res.headersSent) return next(error);
    const status = httpStatus(error);
    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).send("Invalid request.");
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).send("Database unavailable. Please try again later.");
    }
    return res.status(500).send("Something went wrong. Please try again.");
  });

  return app;
}
