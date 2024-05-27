import express from 'express';
import logger from './logger';
import {getDatabase} from './dbConnection';
import { WithId, Document } from 'mongodb';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const {
            memberEmail,
            clubName,
            type
        } = req.body

        if (!memberEmail || !clubName || !type) {
            logger.warn('Bad request: missing fields');
            return res.status(400).json({error: 'Missing fields'});
        }

        const member = await db.collection('users').findOne({email: memberEmail});

        if (!member) {
            logger.warn(`User not found: ${memberEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        const club = await db.collection('clubs').findOne({name: clubName});

        if (!club) {
            logger.warn(`Club not found: ${clubName}`);
            return res.status(404).json({error: 'Club not found'});
        }

        const allowedTypes = ["personal", "admin", "advisor", "officer", "student"];

        if (!allowedTypes.includes(type)) {
            logger.warn('Bad request: invalid type');
            return res.status(400).json({error: 'Invalid type'});
        }

        let userRole = null;
        if (member.type === 'admin') {
            userRole = 'admin';
        } else if (club.members.students.includes(memberEmail)) {
            userRole = 'student';
        } else if (club.members.officers.includes(memberEmail)) {
            userRole = 'officer';
        } else if (club.members.advisors.includes(memberEmail)) {
            userRole = 'advisor';
        }

        if (!userRole) {
            logger.warn(`User not in club: ${memberEmail}, club: ${clubName}`);
            return res.status(404).json({error: 'User not in club'});
        }

        if (type === 'student' && (userRole === 'admin' || userRole === 'advisor')) {
            logger.warn('Bad request: student notes do not exist for advisors or admins');
            return res.status(400).json({error: 'Student notes do not exist for advisors or admins'});
        }

        const roleAccess = {
            'admin': ['admin'],
            'advisor': ['admin', 'advisor'],
            'officer': ['admin', 'advisor', 'officer'],
            'student': ['admin', 'advisor', 'officer']
        };

        if (type === 'personal' && requesterUser.type === 'student' && memberEmail !== requesterEmail ||
            type === 'personal' && requesterUser.type === 'officer' && (memberEmail !== requesterEmail || club.members.students.includes(memberEmail)) ||
            type !== 'personal' && !roleAccess[type].includes(requesterUser.type)) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        let note: WithId<Document>;
        if (type === 'personal') {
            note = await db.collection('notes').findOne({
                creatorEmail: requesterEmail,
                memberEmail: memberEmail,
                clubName: clubName,
                type: "personal"
            });
        } else {
            note = await db.collection('notes').findOne({
                memberEmail: memberEmail,
                clubName: clubName,
                type: type
            });
        }

        logger.info(`Note retrieved for ${memberEmail} in ${clubName}, type: ${type}`);

        res.status(200).json(note);
    } catch (error) {
        logger.error('Failed to create note', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.put('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const {
            memberEmail,
            clubName,
            type,
            note
        } = req.body

        if (!memberEmail || !clubName || !type || !note) {
            logger.warn('Bad request: missing fields');
            return res.status(400).json({error: 'Missing fields'});
        }

        const member = await db.collection('users').findOne({email: memberEmail});

        if (!member) {
            logger.warn(`User not found: ${memberEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        const club = await db.collection('clubs').findOne({name: clubName});

        if (!club) {
            logger.warn(`Club not found: ${clubName}`);
            return res.status(404).json({error: 'Club not found'});
        }

        const allowedTypes = ["personal", "admin", "advisor", "officer", "student"];

        if (!allowedTypes.includes(type)) {
            logger.warn('Bad request: invalid type');
            return res.status(400).json({error: 'Invalid type'});
        }

        let userRole = null;
        if (member.type === 'admin') {
            userRole = 'admin';
        } else if (club.members.students.includes(memberEmail)) {
            userRole = 'student';
        } else if (club.members.officers.includes(memberEmail)) {
            userRole = 'officer';
        } else if (club.members.advisors.includes(memberEmail)) {
            userRole = 'advisor';
        }

        if (!userRole) {
            logger.warn(`User not in club: ${memberEmail}, club: ${clubName}`);
            return res.status(404).json({error: 'User not in club'});
        }

        if (type === 'student' && (userRole === 'admin' || userRole === 'advisor')) {
            logger.warn('Bad request: student notes do not exist for advisors or admins');
            return res.status(400).json({error: 'Student notes do not exist for advisors or admins'});
        }

        const roleAccess = {
            'admin': ['admin'],
            'advisor': ['admin', 'advisor'],
            'officer': ['admin', 'advisor', 'officer'],
            'student': ['admin', 'advisor', 'officer']
        };

        if (type === 'personal' && requesterUser.type === 'student' && memberEmail !== requesterEmail ||
            type === 'personal' && requesterUser.type === 'officer' && (memberEmail !== requesterEmail || club.members.students.includes(memberEmail)) ||
            type !== 'personal' && !roleAccess[type].includes(requesterUser.type)) {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        if (type === 'personal') {
            await db.collection('notes').updateOne({
                creatorEmail: requesterEmail,
                memberEmail: memberEmail,
                clubName: clubName,
                type: "personal"
            }, {
                $set: {
                    note: note
                }
            });
        } else {
            await db.collection('notes').updateOne({
                memberEmail: memberEmail,
                clubName: clubName,
                type: type
            }, {
                $set: {
                    note: note
                }
            });
        }

        logger.info(`Note modified for ${memberEmail} in ${clubName}, type: ${type}`);

        res.status(200).json();
    } catch (error) {
        logger.error('Failed to modify note', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

export default router;