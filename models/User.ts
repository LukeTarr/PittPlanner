import mongoose from "mongoose";

export interface Course {
  name: string;
  credits: number;
  requirement: string;
}

export interface UserDocument extends mongoose.Document<unknown, object, UserDocument> {
  email: string;
  password: string;
  classes: Course[];
}

const CourseSchema = new mongoose.Schema<Course>(
  {
    name: { type: String, required: true },
    credits: { type: Number, required: true },
    requirement: { type: String, required: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema<UserDocument>(
  {
    email: { type: String, required: true },
    password: { type: String, required: true },
    classes: { type: [CourseSchema], required: false, default: [] },
  },
  { minimize: false }
);

export const User = mongoose.model<UserDocument>("User", UserSchema);
