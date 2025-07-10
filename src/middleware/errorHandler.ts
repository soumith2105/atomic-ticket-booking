import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export class ErrorHandler {
  static handle = (error: AppError, req: Request, res: Response, next: NextFunction): void => {
    // Log the error
    logger.error('Error occurred', {
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      url: req.url,
      method: req.method,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });

    // Determine status code
    const statusCode = error.statusCode || 500;

    // Determine if error details should be exposed
    const isProduction = process.env.NODE_ENV === 'production';
    const isDeveloperError = !error.isOperational;

    // Prepare error response
    const errorResponse: any = {
      error: true,
      message: isProduction && isDeveloperError ? 'Internal Server Error' : error.message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.url,
    };

    // Add stack trace in development
    if (!isProduction) {
      errorResponse.stack = error.stack;
    }

    // Send error response
    res.status(statusCode).json(errorResponse);
  };

  static createError(message: string, statusCode: number = 500, isOperational: boolean = true): AppError {
    const error: AppError = new Error(message);
    error.statusCode = statusCode;
    error.isOperational = isOperational;
    return error;
  }

  static notFound = (req: Request, res: Response, next: NextFunction): void => {
    const error = ErrorHandler.createError(`Route ${req.originalUrl} not found`, 404);
    next(error);
  };

  static validationError(message: string): AppError {
    return ErrorHandler.createError(message, 400);
  }

  static unauthorizedError(message: string = 'Unauthorized'): AppError {
    return ErrorHandler.createError(message, 401);
  }

  static forbiddenError(message: string = 'Forbidden'): AppError {
    return ErrorHandler.createError(message, 403);
  }

  static notFoundError(message: string = 'Resource not found'): AppError {
    return ErrorHandler.createError(message, 404);
  }

  static conflictError(message: string = 'Conflict'): AppError {
    return ErrorHandler.createError(message, 409);
  }

  static internalServerError(message: string = 'Internal Server Error'): AppError {
    return ErrorHandler.createError(message, 500, false);
  }
} 