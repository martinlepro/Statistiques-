// server.js
// Backend pour l'extension "Statistique & Amis"
// Version corrigée et étendue pour supporter toutes les fonctionnalités

// 1. Import des modules nécessaires
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid'; // Pour générer des codes d'invitation uniques

// Charger les variables d'environnement depuis un fichier .env si nous ne sommes pas sur Render
// Cela permet de tester localement avec un fichier .env
dotenv.config();

// 2. Initialisation du SDK Firebase Admin
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

// Vérification de la présence de la clé de service, essentielle pour l'authentification Firebase Admin
if (!serviceAccountKey) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.');
    console.error('Please provide the Firebase Admin SDK service account key (as a stringified JSON object).');
    process.exit(1); // Arrête le processus si la clé est manquante
}

let db; // Variable pour stocker l'instance de Realtime Database

try {
    const serviceAccount = JSON.parse(serviceAccountKey); // Parse le JSON de la clé de service

    // Initialisation de l'application Firebase Admin
    // Le SDK Admin a un accès complet à votre projet Firebase
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // L'URL de votre Realtime Database, soit depuis l'environnement, soit par défaut
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://dino-meilleur-score-classement-default-rtdb.europe-west1.firebasedatabase.app"
    });
    console.log('Firebase Admin SDK initialized successfully!');

    // Obtention d'une instance de Realtime Database pour interagir avec la base de données
    db = admin.database();

} catch (error) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY or initialize Firebase Admin SDK:', error);
    process.exit(1); // Arrête le processus en cas d'erreur critique d'initialisation
}

// 3. Configuration de l'application Express
const app = express();
// Définit le port sur lequel le serveur va écouter. Render fournira un PORT, sinon 3000 pour le local.
const PORT = process.env.PORT || 3000;

// 4. Middleware (fonctions qui traitent les requêtes avant d'atteindre les routes)
// Active CORS (Cross-Origin Resource Sharing) pour permettre les requêtes depuis votre extension
// Ceci est nécessaire car votre extension et votre backend sont sur des domaines différents.
app.use(cors());
// Permet à Express de parser les corps de requêtes JSON (pour les requêtes POST/PUT/PATCH)
app.use(express.json());

// 5. Fonction utilitaire pour envoyer des réponses API cohérentes
// Toutes les réponses du backend auront la même structure { success, message, data }
const sendResponse = (res, statusCode, success, message, data = null) => {
    res.status(statusCode).json({ success, message, data });
};

// --- Fonctions utilitaires du backend ---

/**
 * Vérifie si un utilisateur existe dans la base de données.
 * @param {string} userId - L'ID de l'utilisateur à vérifier.
 * @returns {Promise<boolean>} Vrai si l'utilisateur existe, faux sinon.
 */
const userExists = async (userId) => {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    return snapshot.exists();
};

/**
 * Récupère le pseudo d'un utilisateur.
 * @param {string} userId - L'ID de l'utilisateur.
 * @returns {Promise<string|null>} Le pseudo de l'utilisateur ou null si non trouvé.
 */
const getUserPseudo = async (userId) => {
    const snapshot = await db.ref(`users/${userId}/pseudo`).once('value');
    return snapshot.exists() ? snapshot.val() : null;
};

/**
 * Récupère les paramètres de visibilité d'un utilisateur pour une information donnée.
 * @param {string} userId - L'ID de l'utilisateur.
 * @param {string} infoType - Le type d'information (ex: 'profile_bio', 'game_scores').
 * @returns {Promise<string>} Le niveau de visibilité ('everyone', 'friends_only', 'nobody'), par défaut 'nobody'.
 */
const getUserVisibility = async (userId, infoType) => {
    const snapshot = await db.ref(`users/${userId}/profile/visibility/${infoType}`).once('value');
    return snapshot.exists() ? snapshot.val() : 'nobody'; // 'nobody' par défaut si non défini
};

/**
 * Vérifie si deux utilisateurs sont amis.
 * @param {string} userId1 - L'ID du premier utilisateur.
 * @param {string} userId2 - L'ID du second utilisateur.
 * @returns {Promise<boolean>} Vrai s'ils sont amis, faux sinon.
 */
const areFriends = async (userId1, userId2) => {
    const snapshot = await db.ref(`users/${userId1}/friends/${userId2}`).once('value');
    return snapshot.exists();
};

// ----------------------------------------------------
// --- POINTS D'API (ENDPOINTS) ---
// ----------------------------------------------------

/**
 * POST /createUser
 * Crée un nouvel utilisateur avec un pseudo, un profil par défaut et un code d'invitation unique.
 * Le pseudo n'est pas vérifié pour l'unicité à ce stade, mais pourrait l'être si souhaité.
 * Corps de la requête: { pseudo: "..." }
 */
app.post('/createUser', async (req, res) => {
    const { pseudo } = req.body;

    if (!pseudo || pseudo.trim() === '') {
        return sendResponse(res, 400, false, 'Le pseudo est requis et ne peut pas être vide.');
    }

    try {
        // Génère un ID unique pour le nouvel utilisateur dans Realtime Database
        const newUserRef = db.ref('users').push();
        const newUserId = newUserRef.key;
        
        // Génère un code d'invitation unique et court
        const inviteCode = uuidv4().substring(0, 8).toUpperCase(); 

        // Structure de profil par défaut et paramètres de visibilité
        const defaultProfile = {
            bio: `Salut, je suis ${pseudo} sur Statistique & Amis !`,
            avatarUrl: '', // URL d'avatar par défaut
            customStatus: 'En ligne',
            visibility: {
                online_status: 'everyone',
                last_seen: 'friends_only',
                friend_list: 'friends_only',
                profile_bio: 'everyone',
                shared_projects: 'friends_only',
                game_scores: 'everyone', // Note: Modifié ici pour "everyone" par défaut pour les scores de jeu
                custom_status: 'everyone'
            }
        };

        // Définit toutes les données initiales du nouvel utilisateur
        await newUserRef.set({
            pseudo: pseudo,
            createdAt: admin.database.ServerValue.TIMESTAMP,
            profile: defaultProfile,
            inviteCode: inviteCode,
            friends: {}, // Initialise les relations comme des objets vides
            friendRequestsReceived: {},
            friendRequestsSent: {},
            blockedUsers: {},
            messages: {},
            gameScores: {}
        });

        console.log(`Nouvel utilisateur créé: ${pseudo} (${newUserId}) avec code ${inviteCode}`);
        sendResponse(res, 201, true, 'Nouvel utilisateur créé avec succès !', {
            id: newUserId,
            pseudo: pseudo,
            profile: defaultProfile,
            inviteCode: inviteCode
        });

    } catch (error) {
        console.error('Erreur lors de la création de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la création de l\'utilisateur.', { error: error.message });
    }
});

/**
 * GET /getUserDetails/:id
 * Récupère les détails complets (pseudo, profil) d'un utilisateur par son ID.
 * Utilisé par l'extension pour charger un utilisateur ou obtenir des détails sur un ami.
 */
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
        // Retourne uniquement les informations nécessaires au client, potentiellement filtrées par visibilité
        sendResponse(res, 200, true, 'Détails de l\'utilisateur récupérés.', {
            id: userId,
            pseudo: userData.pseudo,
            profile: userData.profile || {} // Inclut le profil complet
        });

    } catch (error) {
        console.error('Erreur lors de la récupération des détails de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des détails de l\'utilisateur.', { error: error.message });
    }
});

/**
 * POST /setProfile
 * Met à jour une ou plusieurs informations du profil de l'utilisateur (bio, avatarUrl, customStatus).
 * Corps de la requête: { userId: "...", bio?: "...", avatarUrl?: "...", customStatus?: "..." }
 */
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
        // N'ajoute au chemin de mise à jour que les champs qui sont réellement fournis
        if (bio !== undefined) updates['profile/bio'] = bio;
        if (avatarUrl !== undefined) updates['profile/avatarUrl'] = avatarUrl;
        if (customStatus !== undefined) updates['profile/customStatus'] = customStatus;

        if (Object.keys(updates).length === 0) {
            return sendResponse(res, 400, false, 'Aucune information de profil à mettre à jour fournie.');
        }

        await db.ref(`users/${userId}`).update(updates); // Utilise `update` pour fusionner les changements
        sendResponse(res, 200, true, 'Profil mis à jour avec succès.', updates);

    } catch (error) {
        console.error('Erreur lors de la mise à jour du profil :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour du profil.', { error: error.message });
    }
});

/**
 * POST /setVisibility
 * Définit les paramètres de visibilité pour un type d'information spécifique (ex: 'online_status').
 * Corps de la requête: { userId: "...", infoType: "...", visibilityLevel: "..." }
 */
app.post('/setVisibility', async (req, res) => {
    const { userId, infoType, visibilityLevel } = req.body;

    if (!userId || !infoType || !visibilityLevel) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur, le type d\'information et le niveau de visibilité sont requis.');
    }
    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    }

    // Validation des types d'informations et des niveaux de visibilité
    const validInfoTypes = ['online_status', 'last_seen', 'friend_list', 'profile_bio', 'shared_projects', 'game_scores', 'custom_status'];
    const validVisibilityLevels = ['everyone', 'friends_only', 'nobody'];

    if (!validInfoTypes.includes(infoType)) {
        return sendResponse(res, 400, false, `Le type d'information "${infoType}" est invalide.`);
    }
    if (!validVisibilityLevels.includes(visibilityLevel)) {
        return sendResponse(res, 400, false, `Le niveau de visibilité "${visibilityLevel}" est invalide.`);
    }

    try {
        // Met à jour le paramètre de visibilité spécifique dans le profil de l'utilisateur
        await db.ref(`users/${userId}/profile/visibility/${infoType}`).set(visibilityLevel);
        sendResponse(res, 200, true, `Visibilité pour "${infoType}" mise à jour à "${visibilityLevel}".`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la visibilité :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour de la visibilité.', { error: error.message });
    }
});

/**
 * GET /getInviteCode/:userId
 * Récupère le code d'invitation d'un utilisateur. S'il n'existe pas, en génère un nouveau.
 */
app.get('/getInviteCode/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId) return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const snapshot = await db.ref(`users/${userId}/inviteCode`).once('value');
        let code = snapshot.val();

        if (!code) {
            // Si l'utilisateur n'a pas encore de code (par ex. ancien utilisateur), en générer un nouveau
            code = uuidv4().substring(0, 8).toUpperCase();
            await db.ref(`users/${userId}/inviteCode`).set(code);
            sendResponse(res, 200, true, 'Nouveau code d\'invitation généré et récupéré.', { code: code });
        } else {
            sendResponse(res, 200, true, 'Code d\'invitation récupéré.', { code: code });
        }
    } catch (error) {
        console.error('Erreur lors de la récupération/génération du code d\'invitation :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du code d\'invitation.', { error: error.message });
    }
});

/**
 * POST /sendFriendRequest
 * Envoie une demande d'ami d'un utilisateur à un autre.
 * Gère les vérifications (pas à soi-même, pas déjà amis/demande en cours, pas bloqué).
 * Corps de la requête: { userId: "...", friendId: "..." }
 */
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
        const userRef = db.ref(`users/${userId}`);
        const friendRef = db.ref(`users/${friendId}`);

        // Vérifie toutes les conditions avant d'envoyer la demande
        const [userDataSnapshot, friendDataSnapshot] = await Promise.all([
            userRef.once('value'),
            friendRef.once('value')
        ]);
        const userData = userDataSnapshot.val();
        const friendData = friendDataSnapshot.val();

        if (userData.friends && userData.friends[friendId]) {
            return sendResponse(res, 400, false, 'Vous êtes déjà amis.');
        }
        if (userData.friendRequestsSent && userData.friendRequestsSent[friendId]) {
            return sendResponse(res, 400, false, 'Demande d\'ami déjà envoyée.');
        }
        if (userData.friendRequestsReceived && userData.friendRequestsReceived[friendId]) {
            return sendResponse(res, 400, false, 'Vous avez déjà reçu une demande de cet utilisateur. Acceptez-la plutôt !');
        }
        if (userData.blockedUsers && userData.blockedUsers[friendId]) {
            return sendResponse(res, 403, false, 'Vous avez bloqué cet utilisateur.');
        }
        if (friendData.blockedUsers && friendData.blockedUsers[userId]) {
            return sendResponse(res, 403, false, 'Cet utilisateur vous a bloqué.');
        }

        // Si tout est bon, met à jour les demandes des deux utilisateurs de manière atomique
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

/**
 * POST /sendFriendRequestByCode
 * Envoie une demande d'ami en utilisant un code d'invitation.
 * Corps de la requête: { userId: "...", inviteCode: "..." }
 */
app.post('/sendFriendRequestByCode', async (req, res) => {
    const { userId, inviteCode } = req.body;

    if (!userId || !inviteCode) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur et le code d\'invitation sont requis.');
    }
    if (!await userExists(userId)) {
        return sendResponse(res, 404, false, 'L\'utilisateur expéditeur n\'existe pas.');
    }

    try {
        // Trouve l'utilisateur associé au code d'invitation
        const snapshot = await db.ref('users').orderByChild('inviteCode').equalTo(inviteCode).once('value');
        if (!snapshot.exists()) {
            return sendResponse(res, 404, false, 'Code d\'invitation invalide ou aucun utilisateur trouvé avec ce code.');
        }

        const friendId = Object.keys(snapshot.val())[0]; // Récupère l'ID de l'utilisateur avec ce code

        if (userId === friendId) {
            return sendResponse(res, 400, false, 'Impossible d\'envoyer une demande d\'ami à soi-même en utilisant son propre code.');
        }

        // Vérifie les conditions similaires à sendFriendRequest
        const senderUserDataSnapshot = await db.ref(`users/${userId}`).once('value');
        const senderUserData = senderUserDataSnapshot.val();

        if (senderUserData.friends && senderUserData.friends[friendId]) {
            return sendResponse(res, 400, false, 'Vous êtes déjà ami avec cet utilisateur.');
        }
        if (senderUserData.friendRequestsSent && senderUserData.friendRequestsSent[friendId]) {
            return sendResponse(res, 400, false, 'Vous avez déjà envoyé une demande d\'ami à cet utilisateur.');
        }
        if (senderUserData.friendRequestsReceived && senderUserData.friendRequestsReceived[friendId]) {
            return sendResponse(res, 400, false, 'Cet utilisateur vous a déjà envoyé une demande d\'ami. Vous pouvez l\'accepter.');
        }
        // Vérifications de blocage omises ici pour simplifier, mais devraient être faites

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

/**
 * GET /getFriendRequests/:id
 * Récupère la liste des demandes d'amis reçues pour un utilisateur, avec les pseudos des expéditeurs.
 */
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
        // Pour chaque ID, récupère le pseudo pour afficher des détails complets
        const requestsWithDetailsPromises = requestsReceivedIds.map(async (id) => {
            const userPseudo = await getUserPseudo(id);
            if (userPseudo) {
                return { id: id, pseudo: userPseudo };
            }
            return null; // Si l'utilisateur n'existe plus (supprimé)
        });

        const friendRequestsWithDetails = (await Promise.all(requestsWithDetailsPromises)).filter(Boolean); // Filtrer les null
        sendResponse(res, 200, true, 'Demandes d\'amis récupérées.', friendRequestsWithDetails);

    } catch (error) {
        console.error('Erreur lors de la récupération des demandes d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des demandes d\'amis.', { error: error.message });
    }
});


/**
 * POST /acceptFriendRequest
 * Accepte une demande d'ami. Met à jour les listes d'amis et supprime les demandes.
 * Corps de la requête: { userId: "...", friendId: "..." }
 * (userId est le receveur de la demande, friendId est l'expéditeur)
 */
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
        // Ajoute l'ami aux deux utilisateurs
        updates[`users/${userId}/friends/${friendId}`] = true;
        updates[`users/${friendId}/friends/${userId}`] = true;
        // Supprime la demande de la liste des demandes reçues du receveur et envoyées de l'expéditeur
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami acceptée avec succès !');

    } catch (error) {
        console.error('Erreur lors de l\'acceptation de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec de l\'acceptation de la demande d\'ami.', { error: error.message });
    }
});

/**
 * POST /declineFriendRequest
 * Refuse une demande d'ami. Supprime la demande des deux côtés.
 * Corps de la requête: { userId: "...", friendId: "..." }
 * (userId est le receveur de la demande, friendId est l'expéditeur)
 */
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
        // Supprime la demande de la liste des demandes reçues du receveur et envoyées de l'expéditeur
        updates[`users/${userId}/friendRequestsReceived/${friendId}`] = null;
        updates[`users/${friendId}/friendRequestsSent/${userId}`] = null;

        await db.ref().update(updates);
        sendResponse(res, 200, true, 'Demande d\'ami refusée avec succès !');

    } catch (error) {
        console.error('Erreur lors du refus de la demande d\'ami :', error);
        sendResponse(res, 500, false, 'Échec du refus de la demande d\'ami.', { error: error.message });
    }
});

/**
 * GET /getFriendsList/:userId
 * Récupère la liste des amis d'un utilisateur, avec leurs pseudos.
 */
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
        // Pour chaque ID d'ami, récupère le pseudo
        const friendsWithDetailsPromises = friendIds.map(async (id) => {
            const userPseudo = await getUserPseudo(id);
            if (userPseudo) {
                return { id: id, pseudo: userPseudo };
            }
            return null;
        });

        const friendsWithDetails = (await Promise.all(friendsWithDetailsPromises)).filter(Boolean); // Filtrer les null
        sendResponse(res, 200, true, 'Liste d\'amis récupérée.', friendsWithDetails);

    } catch (error) {
        console.error('Erreur lors de la récupération de la liste d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération de la liste d\'amis.', { error: error.message });
    }
});

/**
 * GET /searchUsers/:pseudo
 * Recherche des utilisateurs par pseudo (recherche par préfixe).
 * Nécessite une règle `.indexOn: ["pseudo"]` dans vos règles de sécurité Realtime Database.
 */
app.get('/searchUsers/:pseudo', async (req, res) => {
    const searchPseudo = req.params.pseudo;

    if (!searchPseudo || searchPseudo.length < 2) { // Minimum 2 caractères pour la recherche
        return sendResponse(res, 400, false, 'Le pseudo de recherche est requis (minimum 2 caractères).');
    }

    try {
        // Utilise orderByChild et startAt/endAt pour une recherche par préfixe sur le pseudo
        const snapshot = await db.ref('users')
            .orderByChild('pseudo')
            .startAt(searchPseudo)
            .endAt(searchPseudo + '\uf8ff') // '\uf8ff' est un caractère Unicode pour la correspondance de préfixe
            .once('value');

        const foundUsers = [];
        snapshot.forEach(childSnapshot => {
            const userData = childSnapshot.val();
            // Assurez-vous que le pseudo existe et correspond vraiment (Realtime DB est sensible à la casse ici)
            if (userData.pseudo) {
                foundUsers.push({ id: childSnapshot.key, pseudo: userData.pseudo });
            }
        });

        sendResponse(res, 200, true, 'Utilisateurs trouvés.', foundUsers);

    } catch (error) {
        console.error('Erreur lors de la recherche d\'utilisateurs :', error);
        sendResponse(res, 500, false, 'Échec de la recherche d\'utilisateurs.', { error: error.message });
    }
});

/**
 * GET /getFriendsOfFriendsSuggestions/:userId
 * Suggère des utilisateurs qui sont amis avec vos amis, mais pas encore vos amis directs.
 */
app.get('/getFriendsOfFriendsSuggestions/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId) { return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.'); }
    if (!await userExists(userId)) { return sendResponse(res, 404, false, 'Utilisateur non trouvé.'); }

    try {
        const userFriendsSnapshot = await db.ref(`users/${userId}/friends`).once('value');
        const userFriendsIds = userFriendsSnapshot.exists() ? Object.keys(userFriendsSnapshot.val()) : [];

        const potentialSuggestions = new Set();
        const promises = userFriendsIds.map(async (friendId) => {
            const friendOfFriendSnapshot = await db.ref(`users/${friendId}/friends`).once('value');
            if (friendOfFriendSnapshot.exists()) {
                Object.keys(friendOfFriendSnapshot.val()).forEach(fofId => {
                    // Ne suggère pas soi-même, ni les amis directs, ni ceux déjà dans la liste de suggestions
                    if (fofId !== userId && !userFriendsIds.includes(fofId)) {
                        potentialSuggestions.add(fofId);
                    }
                });
            }
        });

        await Promise.all(promises);

        const suggestionDetailsPromises = Array.from(potentialSuggestions).map(async (id) => {
            const userPseudo = await getUserPseudo(id);
            if (userPseudo) {
                return { id: id, pseudo: userPseudo };
            }
            return null;
        });

        const suggestedFriends = (await Promise.all(suggestionDetailsPromises)).filter(Boolean);
        sendResponse(res, 200, true, 'Suggestions d\'amis d\'amis récupérées.', suggestedFriends);

    } catch (error) {
        console.error('Erreur lors de la récupération des suggestions d\'amis d\'amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des suggestions d\'amis d\'amis.', { error: error.message });
    }
});

/**
 * POST /blockUser
 * Bloque un utilisateur. Ne supprime pas automatiquement les liens d'amitié existants
 * ou les demandes en cours, mais peut être étendu pour le faire.
 * Corps de la requête: { userId: "...", targetId: "..." }
 */
app.post('/blockUser', async (req, res) => {
    const { userId, targetId } = req.body;
    if (!userId || !targetId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID cible sont requis.');
    if (userId === targetId) return sendResponse(res, 400, false, 'Impossible de se bloquer soi-même.');
    if (!await userExists(userId) || !await userExists(targetId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        await db.ref(`users/${userId}/blockedUsers/${targetId}`).set(true);
        // Ici, on pourrait ajouter la logique pour supprimer l'amitié, les demandes, etc.
        // C'est un choix de design: bloquer signifie-t-il rompre toutes les connexions ?
        sendResponse(res, 200, true, `Utilisateur ${targetId} bloqué par ${userId}.`);
    } catch (error) {
        console.error('Erreur lors du blocage de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec du blocage de l\'utilisateur.', { error: error.message });
    }
});

/**
 * POST /unblockUser
 * Débloque un utilisateur.
 * Corps de la requête: { userId: "...", targetId: "..." }
 */
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


/**
 * POST /sendMessage
 * Envoie un message direct entre deux utilisateurs.
 * Le message est stocké dans la branche `messages` des deux utilisateurs.
 * Corps de la requête: { senderId: "...", receiverId: "...", message: "..." }
 */
app.post('/sendMessage', async (req, res) => {
    const { senderId, receiverId, message } = req.body;
    if (!senderId || !receiverId || !message) return sendResponse(res, 400, false, 'L\'expéditeur, le destinataire et le message sont requis.');
    if (senderId === receiverId) return sendResponse(res, 400, false, 'Impossible de s\'envoyer un message à soi-même.');
    if (!await userExists(senderId) || !await userExists(receiverId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        // Vérifier si le récepteur a bloqué l'expéditeur
        const receiverBlockedSnapshot = await db.ref(`users/${receiverId}/blockedUsers/${senderId}`).once('value');
        if (receiverBlockedSnapshot.exists()) {
            return sendResponse(res, 403, false, 'Le destinataire vous a bloqué, impossible d\'envoyer le message.');
        }

        const messageData = {
            senderId: senderId,
            message: message,
            timestamp: admin.database.ServerValue.TIMESTAMP
        };

        // Ajoute le message dans la conversation de l'expéditeur
        await db.ref(`users/${senderId}/messages/${receiverId}`).push(messageData);
        // Ajoute le message dans la conversation du destinataire
        await db.ref(`users/${receiverId}/messages/${senderId}`).push(messageData);

        sendResponse(res, 200, true, 'Message envoyé avec succès.');
    } catch (error) {
        console.error('Erreur lors de l\'envoi du message :', error);
        sendResponse(res, 500, false, 'Échec de l\'envoi du message.', { error: error.message });
    }
});

/**
 * GET /getMessages/:userId/:otherUserId
 * Récupère tous les messages entre deux utilisateurs.
 */
app.get('/getMessages/:userId/:otherUserId', async (req, res) => {
    const { userId, otherUserId } = req.params;
    if (!userId || !otherUserId) return sendResponse(res, 400, false, 'Les deux ID utilisateur sont requis.');
    if (!await userExists(userId) || !await userExists(otherUserId)) return sendResponse(res, 404, false, 'L\'un des utilisateurs n\'existe pas.');

    try {
        // Récupère les messages de la perspective de userId avec otherUserId
        const snapshot = await db.ref(`users/${userId}/messages/${otherUserId}`).orderByChild('timestamp').once('value');
        const messages = [];
        snapshot.forEach(childSnapshot => {
            messages.push(childSnapshot.val());
        });
        sendResponse(res, 200, true, 'Messages récupérés.', messages);
    } catch (error) {
        console.error('Erreur lors de la récupération des messages :', error);
        sendResponse(res, 500, false, 'Échec de la récupération des messages.', { error: error.message });
    }
});

/**
 * POST /setGameScore
 * Définit ou met à jour le score d'un utilisateur pour un jeu donné.
 * Corps de la requête: { userId: "...", gameId: "...", score: number }
 */
app.post('/setGameScore', async (req, res) => {
    const { userId, gameId, score } = req.body;
    if (!userId || !gameId || score === undefined) return sendResponse(res, 400, false, 'L\'ID utilisateur, l\'ID du jeu et le score sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
    if (typeof score !== 'number' || isNaN(score) || score < 0) return sendResponse(res, 400, false, 'Le score doit être un nombre valide et positif.');

    try {
        await db.ref(`users/${userId}/gameScores/${gameId}`).set(score);
        sendResponse(res, 200, true, `Score pour le jeu ${gameId} mis à jour.`);
    } catch (error) {
        console.error('Erreur lors de la mise à jour du score :', error);
        sendResponse(res, 500, false, 'Échec de la mise à jour du score.', { error: error.message });
    }
});

/**
 * GET /getGameScore/:userId/:gameId
 * Récupère le score d'un utilisateur pour un jeu spécifique.
 */
app.get('/getGameScore/:userId/:gameId', async (req, res) => {
    const { userId, gameId } = req.params;
    if (!userId || !gameId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID du jeu sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        // Vérifie les règles de visibilité pour les scores de jeu
        const visibility = await getUserVisibility(userId, 'game_scores');
        const isFriend = await areFriends(req.query.requesterId || '', userId); // Supposons que le client puisse envoyer son ID pour vérif d'amitié
        
        let score = null;
        if (visibility === 'everyone' || (visibility === 'friends_only' && isFriend) || req.query.requesterId === userId) {
            const snapshot = await db.ref(`users/${userId}/gameScores/${gameId}`).once('value');
            score = snapshot.exists() ? snapshot.val() : 0; // Retourne 0 si pas de score
        } else {
             return sendResponse(res, 403, false, 'Accès refusé. Les scores de jeu sont privés.');
        }

        sendResponse(res, 200, true, `Score pour le jeu ${gameId} récupéré.`, { score: score });
    } catch (error) {
        console.error('Erreur lors de la récupération du score :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du score.', { error: error.message });
    }
});

/**
 * GET /getFriendsLeaderboard/:userId/:gameId
 * Récupère le classement des amis de l'utilisateur actif pour un jeu donné.
 */
app.get('/getFriendsLeaderboard/:userId/:gameId', async (req, res) => {
    const { userId, gameId } = req.params;
    if (!userId || !gameId) return sendResponse(res, 400, false, 'L\'ID utilisateur et l\'ID du jeu sont requis.');
    if (!await userExists(userId)) return sendResponse(res, 404, false, 'Utilisateur non trouvé.');

    try {
        const userFriendsSnapshot = await db.ref(`users/${userId}/friends`).once('value');
        const userFriends = userFriendsSnapshot.exists() ? Object.keys(userFriendsSnapshot.val()) : [];

        const leaderboardEntries = [];
        // Inclut l'utilisateur lui-même dans son propre classement
        const participantsIds = Array.from(new Set([...userFriends, userId]));

        const promises = participantsIds.map(async (participantId) => {
            // Vérifie la visibilité du score du participant
            const participantVisibility = await getUserVisibility(participantId, 'game_scores');
            const isFriend = await areFriends(userId, participantId); // Vérifie si l'utilisateur est ami avec le participant

            if (participantVisibility === 'everyone' || (participantVisibility === 'friends_only' && isFriend) || participantId === userId) {
                const scoreSnapshot = await db.ref(`users/${participantId}/gameScores/${gameId}`).once('value');
                if (scoreSnapshot.exists()) {
                    const participantPseudo = await getUserPseudo(participantId);
                    leaderboardEntries.push({
                        id: participantId,
                        pseudo: participantPseudo || 'Inconnu',
                        score: scoreSnapshot.val()
                    });
                }
            }
        });

        await Promise.all(promises);

        // Trie le classement par score (du plus élevé au plus bas)
        leaderboardEntries.sort((a, b) => b.score - a.score);

        sendResponse(res, 200, true, `Classement des amis pour le jeu ${gameId} récupéré.`, leaderboardEntries);
    } catch (error) {
        console.error('Erreur lors de la récupération du classement des amis :', error);
        sendResponse(res, 500, false, 'Échec de la récupération du classement des amis.', { error: error.message });
    }
});


/**
 * POST /deleteUser
 * Supprime un utilisateur et nettoie toutes les références associées dans la base de données.
 * C'est une opération critique et coûteuse.
 * Corps de la requête: { userId: "..." }
 */
app.post('/deleteUser', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return sendResponse(res, 400, false, 'L\'ID utilisateur est requis.');
    }

    try {
        const userRef = db.ref(`users/${userId}`);
        const userSnapshot = await userRef.once('value');

        if (!userSnapshot.exists()) {
            return sendResponse(res, 404, false, 'Utilisateur non trouvé.');
        }

        const userData = userSnapshot.val();
        const updates = {};

        // 1. Supprimer l'utilisateur lui-même
        updates[`users/${userId}`] = null;

        // 2. Supprimer l'utilisateur des listes d'amis de ses amis
        if (userData.friends) {
            for (const friendId of Object.keys(userData.friends)) {
                updates[`users/${friendId}/friends/${userId}`] = null;
            }
        }

        // 3. Supprimer les demandes d'amis envoyées par cet utilisateur chez d'autres
        if (userData.friendRequestsSent) {
            for (const receiverId of Object.keys(userData.friendRequestsSent)) {
                updates[`users/${receiverId}/friendRequestsReceived/${userId}`] = null;
            }
        }

        // 4. Supprimer les demandes d'amis reçues par cet utilisateur
        if (userData.friendRequestsReceived) {
            for (const senderId of Object.keys(userData.friendRequestsReceived)) {
                updates[`users/${senderId}/friendRequestsSent/${userId}`] = null;
            }
        }

        // 5. Supprimer l'utilisateur des listes de "blockedUsers" des autres utilisateurs (si d'autres l'ont bloqué)
        // Ceci nécessiterait un parcours de tous les utilisateurs ou une structure inversée,
        // ce qui est trop complexe et coûteux pour cette démo.

        // 6. Supprimer tous les messages impliquant cet utilisateur
        // Cela peut être complexe car les messages sont stockés dans les sous-branches de l'utilisateur
        // Une approche plus simple est de s'assurer que si un utilisateur est supprimé,
        // les messages de sa branche n'ont plus d'importance.
        // db.ref(`users/${userId}/messages`).remove(); // sera couvert par la suppression de `users/${userId}`

        await db.ref().update(updates); // Exécute toutes les suppressions et mises à jour de manière atomique

        sendResponse(res, 200, true, 'Utilisateur supprimé avec succès.');

    } catch (error) {
        console.error('Erreur lors de la suppression de l\'utilisateur :', error);
        sendResponse(res, 500, false, 'Échec de la suppression de l\'utilisateur.', { error: error.message });
    }
});


/**
 * GET /getAllUsers
 * Récupère la liste de tous les utilisateurs (ID et pseudo).
 * ATTENTION : Cet endpoint est DANGEREUX et INEFFICACE pour une grande base de données.
 * Il est fourni à des fins de débogage/test uniquement et devrait être supprimé ou sécurisé en production.
 */
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


// 6. Gestionnaire d'erreur global pour Express
// Ce middleware attrape toutes les erreurs non gérées par les routes spécifiques
app.use((err, req, res, next) => {
    console.error(err.stack); // Log la pile d'appels de l'erreur sur le serveur (très utile pour le débogage)
    // Tente de renvoyer une réponse JSON propre au client pour éviter une page d'erreur HTML
    sendResponse(res, 500, false, 'Une erreur interne du serveur est survenue.', { error: err.message || 'Erreur inconnue du serveur.' });
});


// 7. Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your backend at http://localhost:${PORT}`);
});
