// imports
import express from "express";
import mongoose from "mongoose";
import { config } from "dotenv";


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
  res.render('register');
}); 









