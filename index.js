// imports
import express from "express";
import mongoose from "mongoose";
import { config } from "dotenv";
import fs from "fs";

// old-style imports
//var session = require('express-session')


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
    res.render('index');
});

//User Register Route
app.get('/register', (req, res) => {
  res.render('register', {errors: null});
});

app.post('/register', (req, res) => {
  const body = req.body;

    // check for errors 
    let errs = [];

  if (req.body.password != req.body.password2) {
    errs.push('Passwords do not match');
  }

  if (errs.length > 0){
    res.render('register', {errors: errs})
  }

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

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/dashboard', (req, res) => {

  // read reqs 

  // read person 

  // compare person's classes to reqs

  // create a object that holds the progress of each req for this person
  
  // render our ejs with this object

});