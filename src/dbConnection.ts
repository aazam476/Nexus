import { Db, MongoClient } from 'mongodb';
import logger from "./logger";

const mongoHost = process.env.MONGODB_HOST || 'db';
const mongoPort = process.env.MONGODB_PORT || '27017';
const mongoUsername = process.env.MONGODB_USER || 'nexus';
const mongoPassword = process.env.MONGODB_PASS || 'change_me';
const mongoDBName = process.env.MONGODB_DB || 'nexus';

const url = `mongodb://${mongoUsername}:${mongoPassword}@${mongoHost}:${mongoPort}/${mongoDBName}`;

let client: MongoClient;
let db: Db;

async function establishDBConnection() {
    if (!client) {
        client = new MongoClient(url, {
            maxPoolSize: 1000,
        });
        await client.connect();
        logger.info('DB connection established successfully');
    }
}

async function closeDBConnection() {
    if (client) {
        await client.close();
        logger.info('DB connection closed successfully');
    }
}

async function getDatabase() {
    if (!db) {
        db = client.db(mongoDBName);
    }
    return db;
}

export { establishDBConnection, closeDBConnection, getDatabase };
