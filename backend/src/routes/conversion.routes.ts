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
// 2000 req / 15 min budget, even a 500-file batch polling every 2s stays clear.
conversionRouter.post('/status/batch', handleStatusBatch);
conversionRouter.get('/status/:jobId', handleStatus);
conversionRouter.get('/download-zip', handleDownloadZip);
conversionRouter.post('/download-zip', handleDownloadZip);
conversionRouter.get('/download/:jobId', handleDownload);
