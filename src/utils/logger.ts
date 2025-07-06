import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  errors({ stack: true }),
  json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' 
      ? format 
      : combine(colorize({ all: true }), simple())
  }),
];

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
  exitOnError: false,
});

export { logger }; 