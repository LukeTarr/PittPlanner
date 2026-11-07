import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";
import sessions from "express-session";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./models/User.js";

const requirements = JSON.parse(readFileSync(new URL("./reqs.json", import.meta.url), "utf8"));
const requirementNames = requirements.map((requirement) => requirement.name);
const assetPath = (path) => fileURLToPath(new URL(path, import.meta.url));

export function createApp({ sessionSecret, sessionStore }) {
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

  const renderLogin = (req, res, error = null, success = null) =>
    res.render("login", { error, success, user: req.session.userid });
  const renderRegister = (req, res, error = null) =>
    res.render("register", { error, user: req.session.userid });

  const auth = async (req, res, next) => {
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
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return renderLogin(req, res.status(400), "Email and password are required.");
    }
    const user = await User.findOne({ email: email.trim() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return renderLogin(req, res, "Incorrect email and password combination");
    }

    await promisify(req.session.regenerate).call(req.session);
    req.session.userid = user.email;
    await promisify(req.session.save).call(req.session);
    return res.redirect("/dashboard");
  });

  app.get("/register", (req, res) => renderRegister(req, res));
  app.post("/register", async (req, res) => {
    const { email, password, password2 } = req.body ?? {};
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return renderRegister(req, res.status(400), "Email and password are required.");
    }
    if (password !== password2) {
      return renderRegister(req, res, "Passwords do not match.");
    }
    if (await User.findOne({ email: email.trim() })) {
      return renderRegister(req, res, "User with that email already exists");
    }
    await User.create({ email: email.trim(), password: await bcrypt.hash(password, 10) });
    return renderLogin(req, res, null, "Successfully registered, you can now log in");
  });

  app.get("/class", auth, (req, res) => {
    res.render("add", { user: req.session.userid, reqs: requirementNames });
  });

  app.post("/class", auth, async (req, res) => {
    const { name, credits, requirement } = req.body ?? {};
    if (
      typeof name !== "string" || !name.trim() ||
      typeof credits !== "string" || !credits.trim() ||
      !Number.isInteger(Number(credits)) || Number(credits) < 1 ||
      !requirementNames.includes(requirement)
    ) {
      return res.status(400).send("Provide a class name, positive whole-number credits, and a valid requirement.");
    }
    await User.updateOne(
      { _id: res.locals.currentUser._id },
      { $push: { classes: { name: name.trim(), credits: Number(credits), requirement } } }
    );
    return res.redirect("/dashboard");
  });

  app.post("/remove", auth, async (req, res) => {
    if (typeof req.body?.class !== "string") {
      return res.status(400).send("Provide a class name to remove.");
    }
    await User.updateOne(
      { _id: res.locals.currentUser._id },
      { $pull: { classes: { name: req.body.class } } }
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
      classes: res.locals.currentUser.classes,
    });
  });

  // Express 5 forwards rejected async route handlers here instead of hanging requests.
  app.use((error, req, res, next) => {
    console.error("Request failed:", error.name);
    if (res.headersSent) return next(error);
    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).send("Invalid request.");
    }
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).send("Database unavailable. Please try again later.");
    }
    return res.status(500).send("Something went wrong. Please try again.");
  });

  return app;
}
