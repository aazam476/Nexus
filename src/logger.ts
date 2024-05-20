import winston from "winston";

const logLevel = process.env.LOG_LEVEL || 'error';

const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => {
            return `${info.timestamp} - ${info.level}: ${info.message}`;
        })
    ),
    transports: [
        new winston.transports.Console()
    ]
});

export default logger;