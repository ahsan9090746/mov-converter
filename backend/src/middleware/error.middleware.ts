import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  // Multer errors (file too large etc.) -> clean user messages
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        message: `File is too large. Maximum allowed size is ${env.maxFileSizeMb} MB.`,
      });
      return;
    }
    res.status(400).json({ success: false, message: 'Upload failed. Please try a valid MOV file.' });
    return;
  }

  if (err instanceof Error) {
    if (err.message === 'ONLY_MOV_ALLOWED') {
      res.status(400).json({ success: false, message: 'Only MOV files are supported.' });
      return;
    }
    const apiErr = err as ApiError;
    if (typeof apiErr.statusCode === 'number') {
      res.status(apiErr.statusCode).json({ success: false, message: apiErr.message });
      return;
    }
  }

  console.error('[UNEXPECTED_ERROR]', err instanceof Error ? err.message : err);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}

export function httpError(statusCode: number, message: string): ApiError {
  const e = new Error(message) as ApiError;
  e.statusCode = statusCode;
  return e;
}
