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

router.get('/all', async (req, res) => {
    try {
        const db = await getDatabase();
        const requesterEmail = req["userEmail"];
        const requesterUser = await db.collection('users').findOne({email: requesterEmail});

        if (!requesterUser || requesterUser.type !== 'admin') {
            logger.warn('Unauthorized access attempt');
            return res.status(403).json({error: 'Forbidden'});
        }

        const users = await db.collection('users').find().toArray();
        logger.info('Retrieved all users');
        res.status(200).json(users);
    } catch (error) {
        logger.error('Failed to get all users', error);
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
        const allowedChanges = ['firstName', 'lastName', 'email', 'type', 'schoolID'];

        if (!allowedChanges.includes(change)) {
            logger.warn('Bad request: invalid field');
            return res.status(400).json({error: 'Invalid field'});
        }

        const value = change !== 'email' ? req.body[change] : req.body.newEmail;
        if (!value) {
            logger.warn('Bad request: missing value');
            return res.status(400).json({error: 'Missing value'});
        }

        if (change === 'email') {
            const existingUser = await db.collection('users').findOne({email: value});
            if (existingUser) {
                logger.warn('Bad request: user with this email already exists');
                return res.status(400).json({error: 'User with this email already exists'});
            }
        }

        if (change === 'type') {
            if (value === user.type) {
                logger.info(`Updated user: ${userEmail}, field: type`);
                return res.status(200).json();
            }

            const userTypes = {
                'student': {type: value, clubsAttending: [], clubsOfficer: [], clubsAdvisor: null},
                'teacher': {type: value, clubsAttending: null, clubsOfficer: null, clubsAdvisor: []},
                'admin': {type: value, clubsAttending: null, clubsOfficer: null, clubsAdvisor: null}
            };

            if (!Object.keys(userTypes).includes(value)) {
                logger.warn('Bad request: invalid type');
                return res.status(400).json({error: 'Invalid user type'});
            }

            const clubs = await db.collection('clubs').find({
                $or: [
                    { 'members.students': userEmail },
                    { 'members.officers': userEmail },
                    { 'members.advisors': userEmail }
                ]
            }).toArray();

            for (let club of clubs) {
                club.members.students = club.members.students.filter((member: any) => member !== userEmail);
                club.members.officers = club.members.officers.filter((member: any) => member !== userEmail);
                club.members.advisors = club.members.advisors.filter((member: any) => member !== userEmail);

                await db.collection('clubs').updateOne({name: club.name}, {
                    $set: {
                        members: club.members
                    }
                });
            }

            await db.collection('notes').deleteMany({
                $or: [
                    { creatorEmail: userEmail },
                    { memberEmail: userEmail }
                ]
            });

            if (value === 'admin') {
                const clubs = await db.collection('clubs').find().toArray();

                for (let club of clubs) {
                    for (let member of [...club.members.students, ...club.members.officers]) {
                        const note = {
                            creatorEmail: userEmail,
                            memberEmail: member,
                            clubName: club.name,
                            type: "personal",
                            note: ""
                        };
                        await db.collection('notes').insertOne(note);
                    }
                }
            }

            await db.collection('users').updateOne({email: userEmail}, {$set: userTypes[value]});

            logger.info(`Updated user: ${userEmail}, field: type`);
        } else if (change === 'email') {
            await db.collection('clubs').updateMany(
                { 'members.students': userEmail },
                { $set: { 'members.students.$': value } }
            );
            await db.collection('clubs').updateMany(
                { 'members.officers': userEmail },
                { $set: { 'members.officers.$': value } }
            );
            await db.collection('clubs').updateMany(
                { 'members.advisors': userEmail },
                { $set: { 'members.advisors.$': value } }
            );
            await db.collection('notes').updateMany(
                { creatorEmail: userEmail },
                { $set: { creatorEmail: value } }
            );
            await db.collection('notes').updateMany(
                { memberEmail: userEmail },
                { $set: { memberEmail: value } }
            );

            await db.collection('users').updateOne({email: userEmail}, {$set: {email: value}});

            logger.info(`Updated user: ${value}, field: email`);
        } else {
            await db.collection('users').updateOne({email: userEmail}, {$set: {[change]: value}});

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

        if (type === 'admin') {
            const clubs = await db.collection('clubs').find().toArray();

            for (let club of clubs) {
                for (let member of [...club.members.students, ...club.members.officers]) {
                    const note = {
                        creatorEmail: email,
                        memberEmail: member.email,
                        clubName: club.name,
                        type: "personal",
                        note: ""
                    };
                    await db.collection('notes').insertOne(note);
                }
            }
        }

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

        const user = await db.collection('users').findOne({email: userEmail});
        if (!user) {
            logger.warn(`User not found: ${userEmail}`);
            return res.status(404).json({error: 'User not found'});
        }

        const clubs = await db.collection('clubs').find({
            $or: [
                { 'members.students': userEmail },
                { 'members.officers': userEmail },
                { 'members.advisors': userEmail }
            ]
        }).toArray();

        for (let club of clubs) {
            club.members.students = club.members.students.filter((member: any) => member !== userEmail);
            club.members.officers = club.members.officers.filter((member: any) => member !== userEmail);
            club.members.advisors = club.members.advisors.filter((member: any) => member !== userEmail);

            await db.collection('clubs').updateOne({name: club.name}, {
                $set: {
                    members: club.members
                }
            });
        }

        await db.collection('notes').deleteMany({
            $or: [
                { creatorEmail: userEmail },
                { memberEmail: userEmail }
            ]
        });

        await db.collection('users').deleteOne({email: userEmail});

        logger.info(`Deleted user: ${userEmail}`);
        res.status(200).json();
    } catch (error) {
        logger.error('Failed to delete user', error);
        res.status(500).json({error: 'Internal Server Error'});
    }
});

export default router;
