import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { handleConvert, handleDownload, handleStatus } from '../controllers/conversion.controller.js';
import { uploadSingleMov } from '../middleware/upload.middleware.js';

export const conversionRouter = Router();

const convertLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down and try again later.' },
});

conversionRouter.post('/convert', convertLimiter, uploadSingleMov, handleConvert);
conversionRouter.get('/status/:jobId', handleStatus);
conversionRouter.get('/download/:jobId', handleDownload);
