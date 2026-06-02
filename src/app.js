import express from "express";
import path from "path";
import cron from "node-cron";
import { createServer } from "http";
import connectDb from "./config/db.js";
import routes from "./routes/index.js";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";
import "./utils/cronJobs.js";
import errorHandler from "./middleware/errorHandler.js";
import { ApiError } from "./utils/errorHandler.js";
import { validateAllConfigs } from "./utils/validateConfig.js";

const app = express();

const server = createServer(app);
import 'dotenv/config';


console.log('🔑 ENV CHECK:', {
  KEY_ID: process.env.RAZORPAY_KEY_ID,
  SECRET_PREVIEW: process.env.RAZORPAY_KEY_SECRET?.slice(0, 4) + '...',
  ENV_FILE: process.cwd()
});
// CORS Configuration - Allow multiple Vercel deployment URLs and local development
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://samarth-path-dashbaord.vercel.app",
  "https://*.vercel.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, mobile apps, curl)
    if (!origin) return callback(null, true);

    // Allow all Vercel preview deployments too
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app")       
    ) {
      return callback(null, true);
    }

    console.log("Blocked origin:", origin);
    return callback(new Error("Not allowed by CORS")); // send actual error
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(requestLogger);

app.get("/", (req, res) => {
  res.send("API is working");
});


app.use("/api", routes);

// 404 handler
app.use((req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});

// Global error handler — MUST have 4 params
app.use(errorHandler);

// Validate critical configurations on startup
validateAllConfigs();

connectDb();

export { server };
export default app;