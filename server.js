// server.js

// 1. Import des modules nécessaires
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid'; // Pour générer des codes d'invitation uniques

// Charger les variables d'environnement depuis un fichier .env si nous ne sommes pas sur Render
dotenv.config();

// 2. Initialisation du SDK Firebase Admin
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (!serviceAccountKey) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.');
    console.error('Please provide the Firebase Admin SDK service account key (as a stringified JSON object).');
    process.exit(1);
}

let db; // Variable pour stocker l'instance de Realtime Database

try {
    const serviceAccount = JSON.parse(serviceAccountKey);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://dino-meilleur-score-classement-default-rtdb.europe-west1.firebasedatabase.app"
    });
    console.log('Firebase Admin SDK initialized successfully!');

    db = admin.database();

} catch (error) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY or initialize Firebase Admin SDK:', error);
    process.exit(1);
}

// 3. Configuration de l'application Express
const app = express();
const PORT = process.env.PORT || 3000;

// 4. Middleware
app.use(cors());
app.use(express.json());

// 5. Fonction utilitaire pour envoyer des réponses API cohérentes
const sendResponse = (res, statusCode, success, message, data = null) => {
    res.status(statusCode).json({ success, message, data });
};

// --- Fonctions utilitaires du serveur ---

// Vérifie si un utilisateur existe
const userExists = async (userId) => {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    return snapshot.exists();
};

// Vérifie si un pseudo est unique (pour la recherche, pas pour la création)
const pseudoExists = async (pseudo) => {
    const snapshot = await db.ref('users').orderByChild('pseudo').equalTo(pseudo).once('value');
    return snapshot.exists();
};

// ----------------------------------------------------
// --- POINTS D'API (ENDPOINTS) ---
// ----------------------------------------------------

// POST /createUser
app.post('/createUser', async (req, res) => {
    const { pseudo } = req.body;

    if (!pseudo || pseudo.trim() === '') {
        return sendResponse(res, 400, false, 'Le pseudo est requis et ne peut pas être vide.');
    }

    try {
        const newUserRef = db.ref('users').push();
        const newUserId = newUserRef.key;
        const inviteCode = uuidv4().substring(0, 8); // Génère un code d'invitation court et unique

        await newUserRef.set({
            pseudo: pseudo,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            profile: {
                bio: `Salut, je suis ${pseudo} !`,
                avatarUrl: '', // URL par défaut
                customStatus: 'En ligne',
                visibility: { // Visibilité par défaut
                    online_status: 'everyone',
                    last_seen: 'friends_only',
                    friend_list: 'friends_only',
                    profile_bio: 'everyone',
                    shared_projects: 'friends_only',
                    game_scores: 'friends_only',
                    custom_status: 'everyone'
                }
            },
            inviteCode: inviteCode,
            friends: {},
            friendRequestsReceived: {},
            friendRequestsSent: {},
            blockedUsers: {},
            messages: {},
            gameScores: {}
        });
        console.log(`Nouvel utilisateur créé: ${pseudo} (${newUserId})`);
        sendResponse(res, 201, true, 'Nouvel utilisateur créé avec succès !', {
            id: newUserId,
            pseudo: pseudo,
            profile: {
                bio: `Salut, je suis ${pseudo} !`,
                avatarUrl: '',
                customStatus: 'En ligne',
                visibility: {
                    online_status: 'everyone',
                    last_seen: 'friends_only',
                    friend_list: 'friends_only',
                    profile_bio: 'everyone',
                    shared_projects: 'friends_only',
                    game_scores: 'friends_only',
                    custom_status: 'everyone'
                }
            },
            inviteCode: inviteCode
        });

    } catch (error) {
        console.error('Erreur lors de la création de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la création de l\'utilisateur.', { error: error.message });
    }
});

// GET /getUserDetails/:id
app.get('/getUserDetails/:id', async (req, res) => {
    const userId = req.params.id;

    if (!userId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    }

    try {
        const snapshot = await db.ref(`users/${userId}`).once('value');

        if (!snapshot.exists()) {
            return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
        }

        const userData = snapshot.val();
        sendResponse(res, 200, true, 'Détails de l\'utilisateur récupérés.', {
            id: userId,
            pseudo: userData.pseudo,
            profile: userData.profile || {}, // Retourne le profil complet
            inviteCode: userData.inviteCode || null
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des détails de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des détails de l\'utilisateur.', { error: error.message });
    }
});

// POST /setProfile
// Met à jour une ou plusieurs informations du profil de l'utilisateur.
app.post('/setProfile', async (req, res) => {
    const { userId, bio, avatarUrl, customStatus } = req.body;

    if (!userId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    }

    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    }

    try {
        const updates = {};
        if (bio !== undefined) updates['profile/bio'] = bio;
        if (avatarUrl !== undefined) updates['profile/avatarUrl'] = avatarUrl;
        if (customStatus !== undefined) updates['profile/customStatus'] = customStatus;

        if (Object.keys(updates).length === 0) {
            return sendResponse(res, 400, false, 'Aucune information de profil à mettre à jour fournie.');
        }

        await db.ref(`users/${userId}`).update(updates);
        sendResponse(res, 200, true, 'Profil mis à jour avec succès.', updates);

    } catch (error) {
        console.error('Erreur lors de la mise à jour du profil :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour du profil.', { error: error.message });
    }
});

// POST /setVisibility
app.post('/setVisibility', async (req, res) => {
    const { userId, infoType, visibilityLevel } = req.body;

    if (!userId || !infoType || !visibilityLevel) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur, le type d\'information et le niveau de visibilité sont requis.');
    }

    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    }

    const validInfoTypes = ['online_status', 'last_seen', 'friend_list', 'profile_bio', 'shared_projects', 'game_scores', 'custom_status'];
    const validVisibilityLevels = ['everyone', 'friends_only', 'nobody'];

    if (!validInfoTypes.includes(infoType)) {
        return sendResponse(res, 400, false, `Le type d'information "${infoType}" est invalide.`);
    }
    if (!validVisibilityLevels.includes(visibilityLevel)) {
        return sendResponse(res, 400, false, `Le niveau de visibilité "${visibilityLevel}" est invalide.`);
    }

    try {
        await db.ref(`users/${userId}/profile/visibility/${infoType}`).set(visibilityLevel);
        sendResponse(res, 200, true, `Visibilité pour "${infoType}" mise à jour à "${visibilityLevel}".`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la visibilité :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour de la visibilité.', { error: error.message });
    }
});

// GET /getInviteCode/:userId
app.get('/getInviteCode/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const snapshot = await db.ref(`users/${userId}/inviteCode`).once('value');
        if (snapshot.exists()) {
            sendResponse(res, 200, true, 'Code d\'invitation récupéré.', { code: snapshot.val() });
        } else {
            // Si pour une raison quelconque il n'y a pas de code, en générer un nouveau
            const newCode = uuidv4().substring(0, 8);
            await db.ref(`users/${userId}/inviteCode`).set(newCode);
            sendResponse(res, 200, true, 'Nouveau code d\'invitation généré et récupéré.', { code: newCode });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération/génération du code d\'invitation :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du code d\'invitation.', { error: error.message });
    }
});

// POST /sendFriendRequest
app.post('/sendFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;

    if (!userId || !friendId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    }
    if (userId === friendId) {
        return sendResponse(res, 400, false, 'Impossible d\'envoyer une demande d\'ami à soi-même.');
    }
    if (!await userExists(userId) || !await userExists(friendId)) {
        return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');
    }

    try {
        const updates = {};
        updates[`users/${userId}/friendRequestsSent/${friendId}`] = true;
        updates[`users/${friendId}/friendRequestsReceived/${userId}`] = true;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami envoyée avec succès.');

    } catch (error) {
        console.error('Erreur lors de l\'envoi de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec de l\'envoi de la demande d\'ami.', { error: error.message });
    }
});

// POST /sendFriendRequestByCode
app.post('/sendFriendRequestByCode', async (req, res) => {
    const { userId, inviteCode } = req.body;

    if (!userId || !inviteCode) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur et le code d\'invitation sont requis.');
    }
    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'L\'utilisateur expéditeur n\'existe pas.');
    }

    try {
        const snapshot = await db.ref('users').orderByChild('inviteCode').equalTo(inviteCode).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 404, false, 'Code d\'invitation invalide ou aucun utilisateur trouvé avec ce code.');
        }

        const friendId = Object.keys(snapshot.val())[0]; // Récupère l'ID de l'utilisateur avec ce code

        if (userId === friendId) {
            return sendResponse(res, 400, false, 'Impossible d\'envoyer une demande d\'ami à soi-même.');
        }

        // Vérifier si la demande existe déjà ou s'ils sont déjà amis
        const senderFriendsSnapshot = await db.ref(`users/${userId}/friends/${friendId}`).once('value');
        const senderSentSnapshot = await db.ref(`users/${userId}/friendRequestsSent/${friendId}`).once('value');
        const senderReceivedSnapshot = await db.ref(`users/${userId}/friendRequestsReceived/${friendId}`).once('value');

        if (senderFriendsSnapshot.exists()) {
            return sendResponse(res, 400, false, 'Vous êtes déjà ami avec cet utilisateur.');
        }
        if (senderSentSnapshot.exists()) {
            return sendResponse(res, 400, false, 'Vous avez déjà envoyé une demande d\'ami à cet utilisateur.');
        }
        if (senderReceivedSnapshot.exists()) {
            return sendResponse(res, 400, false, 'Cet utilisateur vous a déjà envoyé une demande d\'ami. Vous pouvez l\'accepter.');
        }


        const updates = {};
        updates[`users/${userId}/friendRequestsSent/${friendId}`] = true;
        updates[`users/${friendId}/friendRequestsReceived/${userId}`] = true;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami envoyée avec succès via code.', { friendId: friendId });

    } catch (error) {
        console.error('Erreur lors de l\'envoi de la demande d\'ami par code :', error);
        sendResponse(res, 500, false, 'Échec de l\'envoi de la demande d\'ami par code.', { error: error.message });
    }
});


// GET /getFriendRequests/:id
app.get('/getFriendRequests/:id', async (req, res) => {
    const userId = req.params.id;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const snapshot = await db.ref(`users/${userId}/friendRequestsReceived`).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucune demande d\'ami.', []);
        }

        const requestsReceivedIds = Object.keys(snapshot.val());
        const requestsWithDetailsPromises = requestsReceivedIds.map(async (id) => {
            const userSnapshot = await db.ref(`users/${id}/pseudo`).once('value');
            if (userSnapshot.exists()) {
                return { id: id, pseudo: userSnapshot.val() };
            }
            return null;
        });

        const friendRequestsWithDetails = (await Promise.all(requestsWithDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Demandes d\'amis récupérées.', friendRequestsWithDetails);

    } catch (error) {
        console.error('Erreur lors de la récupération des demandes d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des demandes d\'amis.', { error: error.message });
    }
});


// POST /acceptFriendRequest
app.post('/acceptFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;

    if (!userId || !friendId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    }
    if (!await userExists(userId) || !await userExists(friendId)) {
        return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');
    }

    try {
        const updates = {};
        updates[`users/${userId}/friends/${friendId}`] = true;
        updates[`users/${friendId}/friends/${userId}`] = true;
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami acceptée avec succès !');

    } catch (error) {
        console.error('Erreur lors de l\'acceptation de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec de l\'acceptation de la demande d\'ami.', { error: error.message });
    }
});

// POST /declineFriendRequest
app.post('/declineFriendRequest', async (req, res) => {
    const { userId, friendId } = req.body;

    if (!userId || !friendId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID ami sont requis.');
    }
    if (!await userExists(userId) || !await userExists(friendId)) {
        return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');
    }

    try {
        const updates = {};
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami refusée avec succès !');

    } catch (error) {
        console.error('Erreur lors du refus de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec du refus de la demande d\'ami.', { error: error.message });
    }
});

// GET /getFriendsList/:userId
app.get('/getFriendsList/:userId', async (req, res) => {
    const userId = req.params.userId;

    if (!userId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    }
    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    }

    try {
        const snapshot = await db.ref(`users/${userId}/friends`).once('value');

        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun ami pour le moment.', []);
        }

        const friendIds = Object.keys(snapshot.val());
        const friendsWithDetailsPromises = friendIds.map(async (id) => {
            const userSnapshot = await db.ref(`users/${id}/pseudo`).once('value');
            if (userSnapshot.exists()) {
                return { id: id, pseudo: userSnapshot.val() };
            }
            return null;
        });

        const friendsWithDetails = (await Promise.all(friendsWithDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Liste d\'amis récupérée.', friendsWithDetails);

    } catch (error) {
        console.error('Erreur lors de la récupération de la liste d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération de la liste d\'amis.', { error: error.message });
    }
});

// POST /deleteUser
app.post('/deleteUser', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    }

    try {
        const userRef = db.ref(`users/${userId}`);
        const snapshot = await userRef.once('value');

        if (!snapshot.exists()) {
            return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
        }

        // --- Supprimer les références à l'utilisateur partout où c'est possible ---
        // ATTENTION: C'est un processus complexe et coûteux en performance
        // pour une très grande base de données. Pour cette démo, on le simplifie.
        const userData = snapshot.val();

        // 1. Supprimer l'utilisateur lui-même
        await userRef.remove();

        // 2. Supprimer l'utilisateur des listes d'amis de ses amis
        if (userData.friends) {
            const friendIds = Object.keys(userData.friends);
            const friendUpdates = {};
            friendIds.forEach(id => {
                friendUpdates[`users/${id}/friends/${userId}`] = null;
            });
            await db.ref().update(friendUpdates);
        }

        // 3. Supprimer les demandes d'amis envoyées par cet utilisateur chez d'autres
        if (userData.friendRequestsSent) {
            const sentToIds = Object.keys(userData.friendRequestsSent);
            const sentToUpdates = {};
            sentToIds.forEach(id => {
                sentToUpdates[`users/${id}/friendRequestsReceived/${userId}`] = null;
            });
            await db.ref().update(sentToUpdates);
        }

        // 4. Supprimer les demandes d'amis reçues par cet utilisateur
        if (userData.friendRequestsReceived) {
            const receivedFromIds = Object.keys(userData.friendRequestsReceived);
            const receivedFromUpdates = {};
            receivedFromIds.forEach(id => {
                receivedFromUpdates[`users/${id}/friendRequestsSent/${userId}`] = null;
            });
            await db.ref().update(receivedFromUpdates);
        }

        // 5. Supprimer l'utilisateur des listes de bloqueurs des autres (si d'autres l'ont bloqué)
        // Ceci nécessiterait un parcours de tous les utilisateurs ou une structure inversée,
        // ce qui est trop complexe pour une démo simple. On se contente des cas les plus directs.


        sendResponse(res, 200, true, 'Utilisateur supprimé avec succès.');

    } catch (error) {
        console.error('Erreur lors de la suppression de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la suppression de l\'utilisateur.', { error: error.message });
    }
});

// GET /getAllUsers
app.get('/getAllUsers', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun utilisateur trouvé.', []);
        }

        const allUsersData = snapshot.val();
        const allUsers = Object.entries(allUsersData).map(([id, user]) => ({
            id: id,
            pseudo: user.pseudo || 'Pseudo inconnu'
        }));
        sendResponse(res, 200, true, 'Tous les utilisateurs récupérés.', allUsers);
    } catch (error) {
        console.error('Erreur lors de la récupération de tous les utilisateurs :', error);
        sendResponse(res, 500, false, 'Échec de la récupération de tous les utilisateurs.', { error: error.message });
    }
});

// GET /searchUsers/:pseudo
app.get('/searchUsers/:pseudo', async (req, res) => {
    const pseudoQuery = req.params.pseudo;
    if (!pseudoQuery) {
        return sendResponse(res, 400, false, 'Le pseudo à rechercher est requis.');
    }

    try {
        // La règle de sécurité ".indexOn": "pseudo" est essentielle ici
        const snapshot = await db.ref('users')
                                .orderByChild('pseudo')
                                .startAt(pseudoQuery)
                                .endAt(pseudoQuery + '\uf8ff') // Cherche les pseudos qui commencent par pseudoQuery
                                .once('value');

        if (!snapshot.exists()) {
            return sendResponse(res, 200, true, 'Aucun utilisateur trouvé.', []);
        }

        const matchingUsers = [];
        snapshot.forEach(childSnapshot => {
            const userData = childSnapshot.val();
            matchingUsers.push({ id: childSnapshot.key, pseudo: userData.pseudo });
        });

        sendResponse(res, 200, true, 'Utilisateurs trouvés.', matchingUsers);
    } catch (error) {
        console.error('Erreur lors de la recherche d\'utilisateurs :', error);
        sendResponse(res, 500, false, 'Échec de la recherche d\'utilisateurs.', { error: error.message });
    }
});

// GET /getFriendsOfFriendsSuggestions/:userId
app.get('/getFriendsOfFriendsSuggestions/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const userFriendsSnapshot = await db.ref(`users/${userId}/friends`).once('value');
        const userFriends = userFriendsSnapshot.exists() ? Object.keys(userFriendsSnapshot.val()) : [];

        const suggestedFriends = new Set();
        const promises = userFriends.map(async (friendId) => {
            const friendOfFriendSnapshot = await db.ref(`users/${friendId}/friends`).once('value');
            if (friendOfFriendSnapshot.exists()) {
                const friendsOfFriend = Object.keys(friendOfFriendSnapshot.val());
                friendsOfFriend.forEach(fofId => {
                    // Si ce n'est pas l'utilisateur courant, et pas déjà un ami de l'utilisateur courant
                    if (fofId !== userId && !userFriends.includes(fofId)) {
                        suggestedFriends.add(fofId);
                    }
                });
            }
        });

        await Promise.all(promises);

        const suggestionsWithDetailsPromises = Array.from(suggestedFriends).map(async (id) => {
            const userSnapshot = await db.ref(`users/${id}/pseudo`).once('value');
            if (userSnapshot.exists()) {
                return { id: id, pseudo: userSnapshot.val() };
            }
            return null;
        });

        const suggestionsWithDetails = (await Promise.all(suggestionsWithDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Suggestions d\'amis d\'amis récupérées.', suggestionsWithDetails);

    } catch (error) {
        console.error('Erreur lors de la récupération des suggestions d\'amis d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des suggestions d\'amis d\'amis.', { error: error.message });
    }
});


// POST /blockUser
app.post('/blockUser', async (req, res) => {
    const { userId, targetId } = req.body;
    if (!userId || !targetId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID cible sont requis.');
    if (userId === targetId) return sendResponse(res, 400, false, 'Impossible de se bloquer soi-même.');
    if (!await userExists(userId) || !await userExists(targetId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        await db.ref(`users/${userId}/blockedUsers/${targetId}`).set(true);
        // Optionnel: Supprimer les amis, demandes d'amis etc.
        // C'est un choix de design: bloquer signifie-t-il rompre toutes les connexions ?
        // Pour l'instant, on se contente de l'ajouter à la liste des bloqués.
        sendResponse(res, 200, true, `Utilisateur ${targetId} bloqué par ${userId}.`);
    } catch (error) {
        console.error('Erreur lors du blocage de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec du blocage de l\'utilisateur.', { error: error.message });
    }
});

// POST /unblockUser
app.post('/unblockUser', async (req, res) => {
    const { userId, targetId } = req.body;
    if (!userId || !targetId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID cible sont requis.');
    if (!await userExists(userId) || !await userExists(targetId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        await db.ref(`users/${userId}/blockedUsers/${targetId}`).remove();
        sendResponse(res, 200, true, `Utilisateur ${targetId} débloqué par ${userId}.`);
    } catch (error) {
        console.error('Erreur lors du déblocage de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec du déblocage de l\'utilisateur.', { error: error.message });
    }
});


// POST /sendMessage
app.post('/sendMessage', async (req, res) => {
    const { senderId, receiverId, message } = req.body;
    if (!senderId || !receiverId || !message) return sendResponse(res, 400, false, 'L\'expéditeur, le destinataire et le message sont requis.');
    if (!await userExists(senderId) || !await userExists(receiverId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        const messageData = {
            senderId: senderId,
            message: message,
            timestamp: admin.database.ServerValue.TIMESTAMP
        };
        // Ajouter le message dans la conversation de l'expéditeur
        await db.ref(`users/${senderId}/messages/${receiverId}`).push(messageData);
        // Ajouter le message dans la conversation du destinataire
        await db.ref(`users/${receiverId}/messages/${senderId}`).push(messageData);

        sendResponse(res, 200, true, 'Message envoyé avec succès.');
    } catch (error) {
        console.error('Erreur lors de l\'envoi du message :', error);
        sendResponse(res, 500, false, 'Échec de l\'envoi du message.', { error: error.message });
    }
});

// GET /getMessages/:userId/:otherUserId
app.get('/getMessages/:userId/:otherUserId', async (req, res) => {
    const { userId, otherUserId } = req.params;
    if (!userId || !otherUserId) return sendResponse(res, 400, false, 'Les deux ID utilisateur sont requis.');
    if (!await userExists(userId) || !await userExists(otherUserId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        const snapshot = await db.ref(`users/${userId}/messages/${otherUserId}`).once('value');
        const messages = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                messages.push(childSnapshot.val());
            });
        }
        sendResponse(res, 200, true, 'Messages récupérés.', messages);
    } catch (error) {
        console.error('Erreur lors de la récupération des messages :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des messages.', { error: error.message });
    }
});

// POST /setGameScore
app.post('/setGameScore', async (req, res) => {
    const { userId, gameId, score } = req.body;
    if (!userId || !gameId || score === undefined) return sendResponse(res, 400, false, 'L\'ID utilisateur, l\'ID du jeu et le score sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    if (typeof score !== 'number' || isNaN(score)) return sendResponse(res, 400, false, 'Le score doit être un nombre valide.');

    try {
        await db.ref(`users/${userId}/gameScores/${gameId}`).set(score);
        sendResponse(res, 200, true, `Score pour le jeu ${gameId} mis à jour.`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour du score :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour du score.', { error: error.message });
    }
});

// GET /getGameScore/:userId/:gameId
app.get('/getGameScore/:userId/:gameId', async (req, res) => {
    const { userId, gameId } = req.params;
    if (!userId || !gameId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID du jeu sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const snapshot = await db.ref(`users/${userId}/gameScores/${gameId}`).once('value');
        const score = snapshot.exists() ? snapshot.val() : 0; // Retourne 0 si pas de score

        sendResponse(res, 200, true, `Score pour le jeu ${gameId} récupéré.`, { score: score });
    } catch (error) {
        console.error('Erreur lors de la récupération du score :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du score.', { error: error.message });
    }
});

// GET /getFriendsLeaderboard/:userId/:gameId
app.get('/getFriendsLeaderboard/:userId/:gameId', async (req, res) => {
    const { userId, gameId } = req.params;
    if (!userId || !gameId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID du jeu sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const userFriendsSnapshot = await db.ref(`users/${userId}/friends`).once('value');
        const userFriends = userFriendsSnapshot.exists() ? Object.keys(userFriendsSnapshot.val()) : [];

        const leaderboardEntries = [];
        const promises = userFriends.map(async (friendId) => {
            const friendScoreSnapshot = await db.ref(`users/${friendId}/gameScores/${gameId}`).once('value');
            if (friendScoreSnapshot.exists()) {
                const friendPseudoSnapshot = await db.ref(`users/${friendId}/pseudo`).once('value');
                leaderboardEntries.push({
                    id: friendId,
                    pseudo: friendPseudoSnapshot.val() || 'Inconnu',
                    score: friendScoreSnapshot.val()
                });
            }
        });

        await Promise.all(promises);

        // Trier le classement par score (du plus élevé au plus bas)
        leaderboardEntries.sort((a, b) => b.score - a.score);

        sendResponse(res, 200, true, `Classement des amis pour le jeu ${gameId} récupéré.`, leaderboardEntries);
    } catch (error) {
        console.error('Erreur lors de la récupération du classement des amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du classement des amis.', { error: error.message });
    }
});


// 6. Gestionnaire d'erreur global pour Express
app.use((err, req, res, next) => {
    console.error(err.stack);
    sendResponse(res, 500, false, 'Une erreur interne du serveur est survenue.', { error: err.message || 'Erreur inconnue du serveur.' });
});

// 7. Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your backend at http://localhost:${PORT}`);
});
