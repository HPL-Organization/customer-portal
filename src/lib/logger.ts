import winston from 'winston';
const { format } = winston;

const jsonFormat = format.combine(
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss:SSS',
  }),
  format.errors({
    stack: true,
  }),
  format.json(),
)

// Create the logger
const logger = winston.createLogger({
  levels: winston.config.syslog.levels,
  silent: false,
  format: jsonFormat,
  defaultMeta: { service: 'customer-portal' },
  transports: [
    // Write all logs with importance level of `error` or less to `error.log`
    new winston.transports.Console({
      format: format.combine(jsonFormat, format.colorize({ all: true })),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: jsonFormat,
    }),
    // Write all logs with importance level of `info` or less to `combined.log`
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: jsonFormat,
    }),
  ],
});

// Handle uncaught exceptions and unhandled rejections
logger.exceptions.handle(
  new winston.transports.File({ filename: 'logs/exceptions.log' })
);

logger.rejections.handle(
  new winston.transports.File({ filename: 'logs/rejections.log' })
);

export default logger;
