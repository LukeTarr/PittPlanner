// imports
import fs from "fs";
import express from "express";
import mongoose from "mongoose";
import sessions from "express-session";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

//Model imports
import { User } from "./models/User.js";
import session from "express-session";

// Init the app and express with some setup
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

//ejs setup
app.set("view engine", "ejs");
app.set("views", "./views");

// Call config so we can access the env vars
config();

// Set up express-sessions to handle auth
app.use(
  sessions({
    // Set a secret to encode our sessions with
    secret: process.env.SESSION_SECRET,
    saveUninitialized: true,
    // set the cookies max age to 24 hours (in ms)
    cookie: { maxAge: 86400000, secure: false, httpOnly: false },
    resave: false,
  })
);

const PORT = process.env.PORT || 4444;

//Connect to the mongoDB with the env var connection string
mongoose
  .connect(process.env.MONGO_CONNECTION_STRING, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() =>
    // If no errors connecting to db, start listening to handle requests
    app.listen(PORT, () => {
      console.log("Server running on:", PORT);
    })
  )
  .catch((err) => {
    console.log(err.message);
  });

const auth = (req, res, next) => {
  if (req.session && req.session.userid) {
    return next();
  } else {
    res.render("index", {
      error: "You must be loged in to view that page",
      success: null,
    });
  }
};

// routes

// Index Routes
app.get("/login", (req, res) => {
  res.render("index", { error: null, success: null });
});

app.post("/login", (req, res) => {
  User.findOne({ email: req.body.email }).then((user) => {
    if (user) {
      bcrypt.compare(req.body.password, user.password, (err, result) => {
        if (err) {
          res.render("index", {
            error: "Failed to Authenticate",
            success: null,
          });
          return;
        }

        if (result) {
          req.session.userid = req.body.email;
          console.log(req.session);
          req.session.save();
          res.render("partials/dashboard", { user: req.session.userid });
        } else {
          res.render("index", {
            error: "Incorrect email and password combination",
            success: null,
          });
        }
      });
    } else {
      res.render("index", {
        error: `No user with email: ${req.body.email}`,
        success: null,
      });
    }
  });
});

//User Register Routes
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  if (req.body.password != req.body.password2) {
    res.render("register", { error: "Passwords do not match." });
    return;
  }

  User.findOne({ email: req.body.email }).then((user) => {
    if (user) {
      res.render("register", { error: "User with that email already exists" });
    } else {
      const newUser = new User({
        email: req.body.email,
        password: req.body.password,
      });
      // generate a password hash so we aren't storing raw text password in db
      bcrypt.genSalt(10, (error, salt) => {
        bcrypt.hash(newUser.password, salt, (error, hash) => {
          if (error) throw error;
          newUser.password = hash;
          // save the user to db, return user to login page
          newUser
            .save()
            .then((user) => {
              res.render("index", {
                error: null,
                success: "Successfully register, you can now log in",
              });
            })
            .catch((error) => {
              console.log(error);
              return;
            });
        });
      });
    }
  });
});

// Auth Routes

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.render("index", { error: null, success: "Successfully logged out" });
});

// Content Routes

app.get("/dashboard", auth, (req, res) => {
  // read reqs
  // read person
  // compare person's classes to reqs
  // create a object that holds the progress of each req for this person
  // render our ejs with this object
  res.render("partials/dashboard", { user: req.session.userid });
});

// Data routes (temp / dev)

app.get("/json", (req, res) => {
  fs.readFile("reqs.json", (err, data) => {
    if (err) throw err;
    let student = JSON.parse(data);
    student.forEach((element) => {
      console.log(element.name);
    });
  });
  console.log("This is after the read call");
});
