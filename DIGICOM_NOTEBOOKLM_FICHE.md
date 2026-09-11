# FICHE DE SYNTHÈSE DE RÉFÉRENCE : DIGICOM
**Plateforme Souveraine de Communication Privée, Salons Collaboratifs & Visioconférence WebRTC**

---

## 1. VUE D'ENSEMBLE & PHILOSOPHIE DU PROJET

### 1.1 Présentation générale
**DigiCom** (Digital Communication) est une plateforme souveraine de communication temps réel, conçue comme une alternative éthique, ultra-légère et totalement indépendante aux messageries grand public (WhatsApp, Telegram, Slack). 

Accessible via l'adresse **`https://chat.digiroys.com`**, DigiCom fonctionne sous forme de **Progressive Web App (PWA) Offline-First**, installable en un clic sur tous les appareils (Android, iOS, Windows, macOS, Linux) sans passer par les magasins d'applications centralisés (Google Play Store ou Apple App Store).

### 1.2 La doctrine de souveraineté numérique
DigiCom repose sur quatre piliers fondamentaux :
1. **Contrôle absolu des données** : 100 % du code source, de la base de données et des flux médias sont hébergés sur une infrastructure VPS privée dédiée. Aucune donnée ne transite par les serveurs des géants du web (zéro Big Tech).
2. **Confidentialité par défaut (Discrétion & Zéro distraction)** : Aucun annuaire public ouvert, aucun pistage publicitaire, aucun spam. Les communications directes et les appels sont strictement conditionnés à une approbation mutuelle des deux correspondants.
3. **Sobriété et performance extrême** : Rejet des frameworks JavaScript lourds (pas de React, Vue ou Angular). L'ensemble de l'interface est développé en **Vanilla JavaScript** et **Vanilla CSS**, garantissant un temps de chargement quasi-instantané (< 1 seconde) et une consommation mémoire minimale (< 512 Mo de RAM sur le serveur).
4. **Résilience et fonctionnement hors-ligne (Offline-First)** : Grâce aux Service Workers et à IndexedDB, les messages et contacts restent consultables même en l'absence totale de connexion Internet, avec synchronisation automatique au rétablissement du réseau.

---

## 2. ARCHITECTURE TECHNIQUE & STACK LOGICIELLE

### 2.1 Front-End (Client PWA)
- **Langages de base** : HTML5 sémantique, Vanilla CSS3 (Design Tokens, variables natives, Flexbox & Grid), Vanilla JavaScript ES6+ moderne.
- **Gestionnaire d'état local** : Objet réactif `state` couplé à une base de données locale **IndexedDB** (`idb-store.js`) pour stocker l'historique des discussions, les contacts et les salons.
- **Service Worker (`sw.js`)** :
  - Mise en cache intelligente des actifs statiques (CSS, JS, images, icônes) via versionnement strict (`v1265`).
  - Prise en charge des notifications d'arrière-plan (**Web Push API**) avec clés cryptographiques **VAPID**.
  - Gestion des actions directes depuis la barre de notification (répondre, marquer comme lu, rejeter un appel).
- **Compression et optimisation client-side** :
  - **Photos et Avatars** : Recadrage carré et compression automatique en format **WebP** haute fidélité directement sur l'appareil du client avant téléversement (**~25 Ko seulement** au lieu de plusieurs mégaoctets).
  - **Notes vocales** : Enregistrement et encodage direct en **WebM/Opus** avec analyse spectrale temps réel (visualiseur de forme d'onde dynamique).
- **Optimisation des actifs déployés** : Pipeline automatisé (`build-minify.js`) avec **Terser** et **Clean-CSS**, produisant des bundles minifiés pré-compressés en double format **Gzip** et **Brotli** (.br).

### 2.2 Back-End (Serveur applicatif)
- **Environnement d'exécution** : Node.js (v20+ LTS).
- **Framework Web HTTP** : Express.js avec gestion des sessions par cookies sécurisés HTTP-Only et jetons JWT (JSON Web Tokens).
- **Moteur temps réel** : **Socket.IO (v4)** assurant une signalisation bidirectionnelle instantanée pour les messages, statuts de présence en direct, accusés de réception et signalisation d'appels.
- **Tâches planifiées** : `node-cron` orchestrant la maintenance automatique, la détection des inactifs et la purge sélective du stockage temporaire.

### 2.3 Base de données & Persistance
- **Moteur** : **SQLite3** configuré en mode haute performance **WAL (Write-Ahead Logging)**, éliminant les verrous de concurrence en lecture/écriture.
- **Schéma relationnel structuré** :
  - `users` : Comptes, mots de passe hachés via `bcryptjs`, rôles (`admin`, `family`, etc.), statut et `avatar_url`.
  - `contacts` : Relations d'amitié mutuellement approuvées et demandes de contact en attente (`pending`).
  - `messages` : Messages privés 1-à-1 avec métadonnées d'accusés (envoyé, reçu, lu), drapeaux d'épinglage et durées d'éphémérité.
  - `salons` & `salon_members` : Canaux de groupe, rôles internes (`creator`, `admin`, `member`), droits de gestion, photo de salon (`avatar_url`) et blocages administratifs.
  - `salon_messages` : Fils de discussion collectifs avec gestion des pièces jointes et mentions.
  - `salon_tasks`, `salon_announcements`, `salon_decisions`, `salon_vault_files`, `salon_treasury` : Modules collaboratifs intégrés à chaque salon.
  - `pinned_messages` : Table dédiée pour l'épinglage rapide avec indexation directe.
  - `push_subscriptions` : Enregistrement des terminaux mobiles pour les notifications Web Push d'arrière-plan.

### 2.4 Infrastructure & Déploiement
- **Conteneurisation** : Déploiement automatisé via **Docker** et **Docker-Compose** avec plafond de mémoire vive contraint à 512 Mo.
- **Reverse Proxy & Sécurité TLS** : Intégration dans le réseau `n8n_default` avec **Traefik**, assurant le routage sécurisé HTTPS et le renouvellement automatique des certificats SSL/TLS **Let's Encrypt**.
- **Serveur de stockage distant & Sauvegarde** :
  - Serveur de stockage dédié déporté sur IP `162.35.166.27`.
  - Synchronisation instantanée via SSH / SCP dès qu'un média (audio, document, avatar) est déposé sur le serveur principal.
  - **Stratégie de rétention vertueuse** : Purge automatique des médias non-essentiels âgés de plus de 7 jours sur le VPS principal pour ne jamais saturer le disque, tandis que les photos de profil, avatars de salons et documents d'archives sont formellement protégés et conservés.

---

## 3. CATALOGUE DES FONCTIONNALITÉS MAJEURES

### 3.1 Messagerie instantanée 1-à-1
- **Discussions en direct** : Transmission instantanée des messages via WebSockets avec repli sur polling si nécessaire.
- **Accusés de réception complets** : Horodatage précis avec triple état visuel (envoi en cours, distribué sur l'appareil, lu par le destinataire avec doubles coches émeraude).
- **Indicateur de frappe & statut de présence** : Affichage en direct du correspondant qui écrit (« En train d'écrire... ») et pastille de statut en ligne sans divulgation indiscrète d'horaires d'absence.
- **Épinglage de messages ultra-rapide** : Possibilité d'épingler des messages clés dans chaque conversation avec saut direct côté serveur vers le message ciblé.
- **Messages éphémères** : Programmation d'une durée de disparition automatique (ex: 24h, 7 jours) pour les échanges hautement confidentiels.
- **Réactions et réponses ciblées (Quotes)** : Répondre spécifiquement à un message avec aperçu visuel du message d'origine.

### 3.2 Notes vocales & Fichiers multimédias
- **Enregistreur vocal intégré** : Enregistrement d'une touche avec pause, reprise, écoute préalable et annulation par glissement. Visualiseur d'onde dynamique et lecture audio accélérée (1.0x, 1.5x, 2.0x).
- **Documents & Photos** : Envoi de PDF, images, vidéos courtes et fichiers bureautiques avec génération d'aperçu miniature et téléchargement sécurisé.

### 3.3 Salons communautaires & Espaces de travail
- **Salons thématiques privés** : Création d'espaces de discussion pour familles, équipes de projet ou communautés spécifiques.
- **Photo et identité de Salon** : Chaque salon dispose de sa propre photo de groupe (compressée en WebP 320×320) modifiable par le créateur ou les administrateurs délégués.
- **Gouvernance et rôles avancés** :
  - **Créateur du Salon** : Propriétaire souverain disposant de tous les droits de modification, suppression, promotion et modération.
  - **Administrateurs délégués** : Membres désignés pour gérer les membres, annonces et décisions.
  - **Membres** : Participants actifs avec droits de lecture, écriture et partage.
- **Modules collaboratifs intégrés par Salon** :
  1. **Tâches & To-Do List** : Attribution, suivi et validation de missions au sein du groupe.
  2. **Annonces officielles** : Tableau d'affichage pour les informations prioritaires épinglées à l'attention de tous les participants.
  3. **Registre des Décisions** : Historique formel des accords et votes validés par le salon.
  4. **Caisse & Trésorerie** : Suivi des cotisations, dépenses et solde financier du groupe avec journal de transparence.
  5. **Coffre-fort de fichiers partagés** : Répertoire centralisé de tous les documents échangés dans le salon.

### 3.4 Visioconférence & Appels vocaux (WebRTC & Jitsi Meet)
- **Appels 1-à-1 audio et vidéo** :
  - Signalisation de bout en bout via WebSockets sur DigiCom.
  - Écran d'appel animé (« Pulse Ring ») avec photo de profil grand format du correspondant, sonnerie personnalisée et vibration sur mobile.
  - Moteur média propulsé par l'instance privée souveraine **`meet.digiroys.com`** (Jitsi Meet).
- **Réunions de groupe dans les Salons** :
  - Lancement d'une conférence vidéo collective en un clic depuis le menu du salon.
  - Aucune inscription requise sur une plateforme externe : intégration transparente dans l'interface DigiCom.
  - Transmission des vrais avatars et pseudonymes DigiCom dans la visioconférence (affichage de la photo quand la caméra est coupée).

### 3.5 Gestion des Avatars & Profils personnalisés
- **Photos de profil universelles** :
  - Chaque utilisateur peut téléverser sa propre photo depuis la modale de profil ou la supprimer à tout moment.
  - Recadrage carré interactif et compression locale à ~25 Ko pour un respect rigoureux de la bande passante mobile.
  - Repli élégant sur une pastille colorée avec l'initiale en l'absence de photo.
- **Diffusion temps réel** :
  - Toute modification d'avatar est propagée instantanément à tous les contacts connectés via l'événement WebSocket `user_avatar_updated`.
  - L'avatar est automatiquement affiché dans tous les filtres (« Toutes », « Salons », « Non lus », « Archivés »), dans l'en-tête de chat, dans la liste des participants de salon et sur les écrans d'appel.

### 3.6 Centre de contrôle SuperAdmin
- **Accès discret et protégé** : Réservé aux utilisateurs ayant le rôle `admin`, accessible via une icône de bouclier blindé dans la barre d'outils.
- **Supervision en temps réel** :
  - Nombre d'utilisateurs connectés, statut des processus mémoire et CPU.
  - Gestion des utilisateurs (modification de rôles, réinitialisation, activation/désactivation).
  - Diffusion de messages d'annonce globale à l'ensemble des utilisateurs connectés.
  - Historique d'audit des connexions et rejets de sécurité.

### 3.7 Widget externe RebOnly / Support SOS
- **Widget JavaScript autonome** (`rebonly-widget.js`) : Permet d'intégrer une bulle d'assistance sur n'importe quel site web externe (ex: plateforme d'apprentissage ou vitrine).
- **Canal SOS direct** : Les visiteurs ou étudiants peuvent dialoguer en direct avec l'équipe administrative de DigiCom sans créer de compte complet.

---

## 4. DESIGN & EXPÉRIENCE UTILISATEUR (UX)

### 4.1 Identité visuelle : « WhatsApp Dark Souverain »
- **Fonds sombres profonds** : Combinaison de `#111b21` (fond principal WhatsApp Dark), `#1f2c34` (cartes et panneaux latéraux) et `#202c33` (bulles de message).
- **Accents émeraude vivants** : `#00a884` et `#10b981` utilisés pour les statuts en ligne, les boutons d'action clés, les coches de lecture et les badges de notification.
- **Contraste et lisibilité** : Typographie système moderne haute lisibilité (`system-ui`, `Segoe UI`, `Roboto`), pensée pour réduire la fatigue oculaire et maximiser l'autonomie des batteries sur écrans OLED.
- **Ergonomie mobile native** : Barre d'onglets ergonomique en bas d'écran (« Bento navigation »), gestes tactiles fluides, transitions douces et compatibilité tactile plein écran sur iOS Safari et Android Chrome.

---

## 5. SPÉCIFICATIONS CLÉS & INDICATEURS DE PERFORMANCE

| Métrique / Élément | Spécification DigiCom |
| :--- | :--- |
| **Domaine applicatif** | `chat.digiroys.com` |
| **Domaine visioconférence** | `meet.digiroys.com` (Jitsi Meet souverain) |
| **Empreinte mémoire serveur** | Contrainte stricte à **< 512 Mo de RAM** |
| **Taille du bundle JS minifié** | **~400 Ko** (compressé Brotli : **~65 Ko**) |
| **Taille du bundle CSS minifié** | **~134 Ko** (compressé Brotli : **~20 Ko**) |
| **Poids moyen d'un avatar** | **~20 à 25 Ko** (format WebP 320×320) |
| **Base de données** | SQLite3 WAL mode avec indexation composite |
| **Protocoles réseau** | HTTPS (TLS 1.3), WSS (WebSocket Secure), WebRTC |
| **Notifications** | Web Push RFC 8291 / RFC 8292 (VAPID) |
| **Sauvegarde déportée** | Réplication automatisée SSH/SCP sur VPS `162.35.166.27` |
| **Politique de cookies** | `SameSite=Strict`, `HttpOnly`, `Secure` |
| **Pisteurs tiers / Analytics** | **0 %** (aucun script externe, aucun cookie tiers) |

---

## 6. SYNTHÈSE DES QUESTIONS CLÉS POUR NOTEBOOKLM

- **Qu'est-ce qui différencie DigiCom de WhatsApp ou Telegram ?**  
  DigiCom est auto-hébergé sur infrastructure privée souveraine, sans dépendance vis-à-vis des serveurs de Meta ou de tiers. Il n'impose pas de numéro de téléphone obligatoire pour être indexé, n'exploite aucune métadonnée commerciale et applique une politique stricte d'approbation mutuelle préalable pour empêcher tout contact non désiré.

- **Comment DigiCom préserve-t-il les ressources de son serveur VPS ?**  
  Grâce à la compression locale côté client des images en WebP avant tout envoi, à l'absence de frameworks JS côté serveur, à l'optimisation SQLite en mode WAL et à une purge automatique à 7 jours des fichiers temporaires, tout en répliquant les données importantes sur un serveur de stockage externe.

- **Comment fonctionne la sécurité des appels ?**  
  La signalisation d'appel s'exécute exclusivement entre contacts mutuellement vérifiés via Socket.IO. Dès l'acceptation, la conférence bascule sur une instance privée et souveraine de Jitsi Meet hébergée sur le sous-domaine de l'organisation (`meet.digiroys.com`), avec transmission sécurisée de l'identité et de l'avatar.
