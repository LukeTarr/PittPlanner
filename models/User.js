import mongoose from "mongoose";

const Schema = mongoose.Schema;
// User Schema

const UserSchema = new Schema({
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    classes: {
        type: [Object],
        required: false
    }
})

export const User = mongoose.model("User", UserSchema);