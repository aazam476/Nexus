import express from 'express';
import morgan from 'morgan';
import http from 'http';
import logger from './logger';

async function startServer() {
    const app = express();

    const morganFormat = ":remote-addr - :remote-user \":method :url HTTP/:http-version\" :status :res[content-length] \":referrer\" \":user-agent\"";
    app.use(morgan(morganFormat, {
        stream: {
            write: message => logger.info(message.trim())
        },
    }));

    app.use(express.json());

    const port = parseInt(process.env.PORT) || 3000;
    return app.listen(port, () => {
        logger.info(`Server is running on port ${port}`);
    });
}

async function stopServer() {
    logger.info('Attempting a graceful shutdown');
    server.close(async () => {
        process.exit(0);
    });
}

let server: http.Server;
startServer().then((result) => server = result);
process.on('SIGTERM', stopServer);
process.on('SIGINT', stopServer);