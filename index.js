// imports
import express from "express";
import mongoose from "mongoose";
import { config } from "dotenv";
import { User } from './models/User.js';
import bcrypt from 'bcryptjs';
import fs from "fs";


// Init the app and express with some setup
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

//ejs setup
app.set('view engine', 'ejs');
app.set('views', './views');

// Call config so we can access the env vars
config();

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

app.get("/", (req, res) => {
  res.render('index', { errors: null, success: null });
});

//User Register Route
app.get('/register', (req, res) => {
  res.render('register', { errors: null });
});

app.post('/register', async (req, res) => {
  const body = req.body;

  // check for errors 
  let errs = [];

  if (req.body.password != req.body.password2) {
    errs.push('Passwords do not match');
  }

  if (errs.length > 0) {
    res.render('register', { errors: errs })
  } else {
    User.findOne({ email: req.body.email }).then(user => {
      if (user) {
        errs.push('User with that email already exists');
        res.render('register', { errors: errs })
      } else {
        const newUser = new User({
          email: req.body.email,
          password: req.body.password
        });

        // generate a password hash so we aren't storing raw text password in db
        bcrypt.genSalt(10, (error, salt) => {
          bcrypt.hash(newUser.password, salt, (error, hash) => {
            if (error) throw error;
            newUser.password = hash;
            // save the user to db, return user to login page
            newUser.save().then(user => {
              res.render('index', { errors: null, success: 'Successfully register, you can now log in' });
            })
              .catch(error => {
                console.log(error);
                return;
              });
          });
        });
      }
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/', { errors: null, success: 'Successfully logged out' });
});

app.get('/dashboard', (req, res) => {

  // read reqs 

  // read person 

  // compare person's classes to reqs

  // create a object that holds the progress of each req for this person

  // render our ejs with this object

});

app.get('/json', (req, res) => {


  fs.readFile('reqs.json', (err, data) => {
    if (err) throw err;
    let student = JSON.parse(data);
    student.forEach(element => {
      console.log(element.name)
    });
  });

  console.log('This is after the read call');

});

