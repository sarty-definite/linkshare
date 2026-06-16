import { rateLimit } from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false
});

export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false
});
