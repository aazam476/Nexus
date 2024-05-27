import logger from './logger';
import {getDatabase} from './dbConnection';

const authMiddleware = async (req: any, res: any, next: any) => {
    const db = await getDatabase();
    const user = await db.collection('users').findOne({email: req["userEmail"]});

    if (!user) {
        logger.warn(`Unauthorized access attempt by non-existent user: ${req["userEmail"]}`);
        return res.status(403).json({error: 'Forbidden'});
    }

    req["requesterUser"] = user;

    next();
};

export default authMiddleware;