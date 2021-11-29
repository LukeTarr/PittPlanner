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

// Auth middleware

const auth = (req, res, next) => {
  if (req.session && req.session.userid) {
    return next();
  } else {
    res.render("login", {
      error: "You must be loged in to view that page",
      success: null,
      user: req.session.userid,
    });
  }
};

// routes

app.get("/", (req, res) => {
  res.render("index", { user: req.session.userid });
});

// Index Routes
app.get("/login", (req, res) => {
  res.render("login", { error: null, success: null, user: req.session.userid });
});

app.post("/login", (req, res) => {
  User.findOne({ email: req.body.email }).then((user) => {
    if (user) {
      bcrypt.compare(req.body.password, user.password, (err, result) => {
        if (err) {
          res.render("login", {
            error: "Failed to Authenticate",
            success: null,
            user: req.session.userid,
          });
          return;
        }

        if (result) {
          req.session.userid = req.body.email;
          req.session.save();
          res.redirect("/dashboard");
        } else {
          res.render("login", {
            error: "Incorrect email and password combination",
            success: null,
            user: req.session.userid,
          });
        }
      });
    } else {
      res.render("login", {
        error: `No user with email: ${req.body.email}`,
        success: null,
        user: req.session.userid,
      });
    }
  });
});

//User Register Routes
app.get("/register", (req, res) => {
  res.render("register", { error: null, user: req.session.userid });
});

app.post("/register", async (req, res) => {
  if (req.body.password != req.body.password2) {
    res.render("register", {
      error: "Passwords do not match.",
      user: req.session.userid,
    });
    return;
  }

  User.findOne({ email: req.body.email }).then((user) => {
    if (user) {
      res.render("register", {
        error: "User with that email already exists",
        user: req.session.userid,
      });
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
              res.render("login", {
                error: null,
                success: "Successfully register, you can now log in",
                user: req.session.userid,
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

app.get("/class", auth, (req, res) => {
  fs.readFile("reqs.json", (err, data) => {
    const vals = [];
    JSON.parse(data).forEach(element => {
      vals.push(element.name); 
    })
    res.render("add", {
      user: req.session.userid,
      reqs: vals
    });
  });
});

app.post("/remove", auth, async (req, res) => {
  console.log(req.body);
  const tempUser = await User.findOne({ email: req.session.userid });
  let classList = tempUser.classes;
  classList = classList.filter(e => e.name !== req.body.class);

  const user = await User.findOneAndUpdate(
    {email: req.session.userid},
    {classes: classList}
  )
  res.redirect("/dashboard");
});

app.post("/class", auth, async (req, res) => {
  console.log(req.body);

  // get user from database using userid
  const tempUser = await User.findOne({ email: req.session.userid });
  const newClass = req.body;
  let classList = tempUser.classes;
  classList.push(newClass);

  const user = await User.findOneAndUpdate(
    { email: req.session.userid },
    { classes: classList }
  );

  res.redirect("dashboard");
});

// Auth Routes

app.get("/logout", auth, (req, res) => {
  req.session.destroy();
  res.render("login", {
    error: null,
    success: "Successfully logged out",
    user: null,
  });
});

// Content Routes

app.get("/dashboard", auth, async (req, res) => {

  const tempUser = await User.findOne({ email: req.session.userid });
  const classList = tempUser.classes;
  fs.readFile("reqs.json", (err, data) => {
    res.render("dashboard", {
      user: req.session.userid,
      reqs: JSON.parse(data),
      classes: classList,
    });
  });
});
