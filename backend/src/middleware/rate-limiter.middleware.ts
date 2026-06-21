import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_API,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_AUTH,
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_UPLOAD,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

export const fileInitiateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_FILE_INITIATE,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many files uploaded, please try again later." },
});
