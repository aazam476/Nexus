import express from 'express';
import logger from './logger';
import {getDatabase} from './dbConnection';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const name = req.body.name;

        if (!name) {
            logger.warn('No name provided');
            return res.status(400).json({error: 'No name provided'});
        }

        const club = await db.collection('clubs').findOne({name});
        if (!club) {
            logger.warn(`Club not found: ${name}`);
            return res.status(404).json({error: 'Club not found'});
        }

        logger.info(`Retrieved club: ${name}`);
        res.status(200).json(club);
    } catch (error) {
        logger.error('Failed to get club', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.put('/:change', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser || requesterUser.type !== 'admin') {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const name = req.body.currentName;

        if (!name) {
            logger.warn('No current name provided');
            return res.status(400).json({error: 'No current name provided'});
        }

        const club = await db.collection('clubs').findOne({name});
        if (!club) {
            logger.warn(`Club not found: ${name}`);
            return res.status(404).json({error: 'Club not found'});
        }

        let change = req.params.change;
        const allowedChanges = ['name', 'dates', 'picture', 'description', 'newMember', 'removeMember'];

        if (!allowedChanges.includes(change)) {
            logger.warn('Bad request: invalid field');
            return res.status(400).json({error: 'Invalid field'});
        }

        if (change === 'newMember' || change === 'removeMember') {
            const type = req.body.type;
            const email = req.body.email;

            if (!email || (change === 'newMember' && !type)) {
                logger.warn('Bad request: missing required fields');
                return res.status(400).json({error: 'Missing required fields'});
            }

            const user = await db.collection('users').findOne({email});

            if (!user) {
                logger.warn(`User not found: ${email}`);
                return res.status(404).json({error: 'User not found'});
            }

            if (change === 'newMember') {
                const userType = user.type;
                const validTypes = ['student', 'officer', 'advisor'];
                const userTypeRequired = type === 'advisor' ? 'teacher' : 'student';

                if (!validTypes.includes(type)) {
                    logger.warn('Bad request: invalid type');
                    return res.status(400).json({error: 'Invalid type'});
                }

                if (userType !== userTypeRequired) {
                    logger.warn(`Bad request: user is not a ${userTypeRequired}`);
                    return res.status(400).json({error: `User is not a ${userTypeRequired}`});
                }

                if (type === 'student' && club.members.officers.includes(email)) {
                    club.members.officers = club.members.officers.filter((officer: any) => officer !== email);
                } else if (type === 'officer' && club.members.students.includes(email)) {
                    club.members.students = club.members.students.filter((student: any) => student !== email);
                }

                club.members[type + "s"].push(email);
            } else {
                let memberTypes = ['students', 'officers', 'advisors'];
                let found = false;
                for (let memberType of memberTypes) {
                    if (club.members[memberType].includes(email)) {
                        club.members[memberType] = club.members[memberType].filter((member: any) => member !== email);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    logger.warn(`User not found in club: ${email}`);
                    return res.status(404).json({error: 'User not found in club'});
                }
            }

            await db.collection('clubs').updateOne({name: name}, {$set: {members: club.members}});

            logger.info(`Updated club: ${name}, field: members`);

            return res.status(200).json();
        }

        const value = change !== 'name' ? req.body[change] : req.body.newName;
        if (!value) {
            logger.warn('Bad request: missing value');
            return res.status(400).json({error: 'Missing value'});
        }

        if (change === 'name') {
            const existingUser = await db.collection('clubs').findOne({name: value});
            if (existingUser) {
                logger.warn('Bad request: user with this email already exists');
                return res.status(400).json({error: 'User with this email already exists'});
            }
        }

        await db.collection('clubs').updateOne({name: name}, {$set: {[change]: value}});

        if (change === 'name') {
            logger.info(`Updated club: ${value}, field: name`);
        } else {
            logger.info(`Updated club: ${name}, field: ${change}`);
        }

        res.status(200).json();
    } catch (error) {
        logger.error('Failed to update club', error);
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

        const name = req.body.name;
        const dates = req.body.dates;
        if (!name && !dates) {
            logger.warn('Bad request: missing required fields');
            return res.status(400).json({error: 'Missing required fields'});
        }

        const club = await db.collection('clubs').findOne({name});
        if (club) {
            logger.warn(`Club already exists: ${name}`);
            return res.status(409).json({error: 'Club already exists'});
        }

        const picture = req.body.picture ? req.body.picture : '';
        const description = req.body.description ? req.body.description : '';

        await db.collection('clubs').insertOne({
            name,
            dates,
            picture,
            description,
            members: {
                students: [],
                officers: [],
                advisors: [],
            },
        });
        logger.info(`Created club: ${name}`);
        res.status(201).json();
    } catch (error) {
        logger.error('Failed to create club', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

router.delete('/', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser || requesterUser.type !== 'admin') {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const name = req.body.name;
        if (!name) {
            logger.warn('No name provided');
            return res.status(400).json({error: 'No name provided'});
        }

        const club = await db.collection('clubs').findOne({name});
        if (!club) {
            logger.warn(`Club not found: ${name}`);
            return res.status(404).json({error: 'Club not found'});
        }

        const users = await db.collection('users').find({
            $or: [
                {clubsAttending: name},
                {clubsOfficer: name},
                {clubsAdvisor: name}
            ]
        }).toArray();

        for (let user of users) {
            user.clubsAttending = user.clubsAttending.filter((club: any) => club !== name);
            user.clubsOfficer = user.clubsOfficer.filter((club: any) => club !== name);
            user.clubsAdvisor = user.clubsAdvisor.filter((club: any) => club !== name);

            await db.collection('users').updateOne({email: user.email}, {
                $set: {
                    clubsAttending: user.clubsAttending,
                    clubsOfficer: user.clubsOfficer,
                    clubsAdvisor: user.clubsAdvisor
                }
            });
        }

        await db.collection('clubs').deleteOne({name});

        logger.info(`Deleted club: ${name}`);
        res.status(200).json();
    } catch (error) {
        logger.error('Failed to delete club', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

export default router;