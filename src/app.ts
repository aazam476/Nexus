import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import http from 'http';
import logger from './logger';
import {closeDBConnection, establishDBConnection} from "./dbConnection";
import {establishFirebaseConnection, firebaseMiddleware} from "./firebaseConnection";
import userRoutes from "./userRoutes";
import clubRoutes from "./clubRoutes";
import noteRoutes from "./noteRoutes";

async function startServer() {
    await establishDBConnection();
    await establishFirebaseConnection();

    const app = express();

    const corsOrigin = process.env.CORS_ORIGIN || '*';
    app.use(cors({origin: corsOrigin}));

    const morganFormat = ":remote-addr - :remote-user \":method :url HTTP/:http-version\" :status :res[content-length] \":referrer\" \":user-agent\"";
    app.use(morgan(morganFormat, {
        stream: {
            write: message => logger.info(message.trim())
        },
    }));

    app.use(express.json());
    app.use(firebaseMiddleware);

    app.use('/users', userRoutes);
    app.use('/clubs', clubRoutes);
    app.use('/notes', noteRoutes);

    const port = parseInt(process.env.PORT) || 3000;
    return app.listen(port, () => {
        logger.info(`Server is running on port ${port}`);
    });
}

async function stopServer() {
    logger.info('Attempting a graceful shutdown');

    if (!server) {
        logger.error('Server is not running');
        process.exit(1);
    }

    server.close(async () => {
        logger.info('API is no longer accepting connections');
        await closeDBConnection();
        logger.info('Server shutdown successful');
        process.exit(0);
    });
}

let server: http.Server;
startServer().then((result) => server = result);
process.on('SIGTERM', stopServer);
process.on('SIGINT', stopServer);