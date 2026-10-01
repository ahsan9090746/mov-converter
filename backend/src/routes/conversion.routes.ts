import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import {
  handleConvert,
  handleDownload,
  handleDownloadZip,
  handleStatus,
  handleStatusBatch,
} from '../controllers/conversion.controller.js';
import { assignJobId, uploadSingleMov } from '../middleware/upload.middleware.js';

export const conversionRouter = Router();

const convertLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down and try again later.' },
});

conversionRouter.post('/convert', convertLimiter, assignJobId, uploadSingleMov, handleConvert);
// Batch status polls ride on the global limiter only: with the default
// 300 req / 15 min budget, a 10-file batch polling every 2s stays well clear.
conversionRouter.post('/status/batch', handleStatusBatch);
conversionRouter.get('/status/:jobId', handleStatus);
conversionRouter.get('/download-zip', handleDownloadZip);
conversionRouter.get('/download/:jobId', handleDownload);
