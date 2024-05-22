import * as admin from 'firebase-admin';

// @ts-ignore
import * as serviceAccount from '/usr/src/app/dist/firebaseServiceAccountKey.json';

async function establishFirebaseConnection() {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
}

const firebaseMiddleware = async (req: any, res: any, next: any) => {
    const idToken = req.headers.authorization;

    if (!idToken) {
        return res.status(400).json();
    }

    try {
        const user = await admin.auth().verifyIdToken(idToken.replace("Bearer ", ""));
        req["userEmail"] = user.email;
    } catch (error) {
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
            return res.status(401).json();
        } else {
            throw error;
        }
    }

    next();
};

export {establishFirebaseConnection, firebaseMiddleware};