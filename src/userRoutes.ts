import express from 'express';
import logger from './logger';
import {getDatabase} from './dbConnection';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});
        const userEmail = req.body.email;

        if (!userEmail) {
            logger.warn('Bad request: missing email');
            return res.status(400).json({error: 'Missing email'});
        }

        if (!requesterUser || requesterUser.type !== 'admin' && requesterEmail !== userEmail) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const user = await db.collection('users').findOne({email: userEmail});
        if (!user) {
            logger.warn(`User not found: ${userEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        logger.info(`Retrieved user: ${userEmail}`);
        res.status(200).json(user);
    } catch (error) {
        logger.error('Failed to get user', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.put('/:change', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});
        const userEmail = req.body.currentEmail;

        if (!userEmail) {
            logger.warn('Bad request: missing email');
            return res.status(400).json({error: 'Missing email'});
        }

        if (!requesterUser || requesterUser.type !== 'admin' && requesterEmail !== userEmail) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const user = await db.collection('users').findOne({email: userEmail});
        if (!user) {
            logger.warn(`User not found: ${userEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        let change = req.params.change;
        const allowedChanges = ['firstName', 'lastName', 'newEmail', 'type', 'schoolID'];

        if (!allowedChanges.includes(change)) {
            logger.warn('Bad request: invalid field');
            return res.status(400).json({error: 'Invalid field'});
        }

        const value = req.body[change];
        if (!value) {
            logger.warn('Bad request: missing value');
            return res.status(400).json({error: 'Missing value'});
        }

        if (change === 'newEmail') {
            const existingUser = await db.collection('users').findOne({email: value});
            if (existingUser) {
                logger.warn('Bad request: user with this email already exists');
                return res.status(400).json({error: 'User with this email already exists'});
            }
            change = 'email';
        }

        if (change === 'type') {
            const userTypes = {
                'student': {type: value, clubsAttending: [], clubsOfficer: [], clubsAdvisor: null},
                'teacher': {type: value, clubsAttending: null, clubsOfficer: null, clubsAdvisor: []},
                'admin': {type: value, clubsAttending: null, clubsOfficer: null, clubsAdvisor: null}
            };

            if (!Object.keys(userTypes).includes(value)) {
                logger.warn('Bad request: invalid type');
                return res.status(400).json({error: 'Invalid user type'});
            }

            await db.collection('users').updateOne({email: userEmail}, {$set: userTypes[value]});
        } else {
            await db.collection('users').updateOne({email: userEmail}, {$set: {[change]: value}});
        }

        if (change === 'email') {
            logger.info(`Updated user: ${value}, field: email`);
        } else {
            logger.info(`Updated user: ${userEmail}, field: ${change}`);
        }

        res.status(200).json();
    } catch (error) {
        logger.error('Failed to update user', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.post('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser || requesterUser.type !== 'admin') {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const {firstName, lastName, email, type, schoolID} = req.body;
        if (!firstName || !lastName || !email || !type) {
            logger.warn('Bad request: missing required fields');
            return res.status(400).json({error: 'Missing required fields'});
        }

        const existingUser = await db.collection('users').findOne({email: email});
        if (existingUser) {
            logger.warn('Bad request: user with this email already exists');
            return res.status(400).json({error: 'User with this email already exists'});
        }

        const allowedTypes = ['student', 'teacher', 'admin'];
        if (!allowedTypes.includes(type)) {
            logger.warn('Bad request: invalid type');
            return res.status(400).json({error: 'Invalid user type'});
        }

        const clubsAttending = type === 'student' ? [] : null;
        const clubsOfficer = type === 'student' ? [] : null;
        const clubsAdvisor = type === 'teacher' ? [] : null;

        await db.collection('users').insertOne({
            firstName,
            lastName,
            email,
            type,
            schoolID,
            clubsAttending,
            clubsOfficer,
            clubsAdvisor
        });

        logger.info(`Created new user: ${email}`);
        res.status(201).json();
    } catch (error) {
        logger.error('Failed to create user', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.delete('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});
        const userEmail = req.body.email;

        if (!userEmail) {
            logger.warn('Bad request: missing email');
            return res.status(400).json({error: 'Missing email'});
        }

        if (!requesterUser || requesterUser.type !== 'admin') {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const result = await db.collection('users').deleteOne({email: userEmail});

        if (result.deletedCount === 0) {
            logger.warn(`User not found: ${userEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        logger.info(`Deleted user: ${userEmail}`);
        res.status(200).json();
    } catch (error) {
        logger.error('Failed to delete user', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

export default router;
