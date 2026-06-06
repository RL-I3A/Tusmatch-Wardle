// game.js

// --- SUPABASE CONFIGURATION ---
// Initialisation déplacée dans supabase-client.js
// supabaseClient est maintenant disponible globalement via window.supabaseClient

// --- CONFIGURATION ---
let wordLength = 5;
const MAX_GUESSES = 6;
let DICTIONARY = []; // Mots valides pour les essais (mots.txt)
window.COMMON_WORDS = []; // Mots cibles possibles (mots_courants.txt)

// Variables globales
window.targetWord = "";
let currentGuess = [];
let guesses = [];
let isGameOver = false;
let currentHints = [];
let hasPlayedDailyToday = false; // Track if daily game already played
const gameUrlParams = new URLSearchParams(window.location.search);
const gameMode = gameUrlParams.get('mode') || 'daily';
const isMultiplayerMode = gameMode === 'private';
const isDailyMode = gameMode === 'daily';
const DAILY_PROGRESS_STORAGE_KEY = 'tusmatch_daily_progress_v1';

const grid = document.getElementById("grid");
const themeBtn = document.getElementById("themeToggle");

async function loadDictionaries() {
    try {
        // Charger le dictionnaire complet (mots valides)
        // Ajout d'un timestamp pour éviter le cache navigateur
        const responseDict = await fetch('mots.txt?v=' + new Date().getTime());
        const textDict = await responseDict.text();
        DICTIONARY = textDict.split('\n')
            .map(line => {
                let clean = line.trim();
                if (clean.endsWith(',')) clean = clean.slice(0, -1);
                return clean.replace(/^"|"$/g, '');
            })
            .filter(word => word.length > 0);

        // Charger les mots courants (mots cibles)
        const responseCommon = await fetch('mots_courants.txt?v=' + new Date().getTime());
        const textCommon = await responseCommon.text();
        window.COMMON_WORDS = textCommon.split('\n')
            .map(line => {
                let clean = line.trim();
                if (clean.endsWith(',')) clean = clean.slice(0, -1);
                return clean.replace(/^"|"$/g, '');
            })
            .filter(word => word.length > 0);

    } catch (e) {
        console.error("Erreur chargement dictionnaires:", e);
        // Fallback
        DICTIONARY = ["POMME", "MONDE", "TESTS"];
        COMMON_WORDS = ["POMME", "MONDE"];
    }
}

// --- LOCAL DAILY WORD LOGIC ---
// Générateur pseudo-aléatoire basé sur une graine (seed)
function seededRandom(seed) {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function getLocalDateString(offset = 0) {
    const now = new Date();
    now.setDate(now.getDate() + offset);

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDailyWord(offset = 0) {
    if (COMMON_WORDS.length === 0) return "ERREUR";

    // Créer une chaîne de date locale YYYY-MM-DD
    // Cela garantit que c'est basé sur le fuseau horaire de l'utilisateur
    const dateString = getLocalDateString(offset);

    // Créer un hash simple de la date pour servir de graine
    let seed = 0;
    for (let i = 0; i < dateString.length; i++) {
        seed = ((seed << 5) - seed) + dateString.charCodeAt(i);
        seed |= 0; // Convertir en entier 32 bits
    }

    // Générer un nombre aléatoire avec cette graine
    const rand = seededRandom(seed);
    
    // Choisir un index aléatoire dans la liste
    const index = Math.floor(rand * COMMON_WORDS.length);
    
    // console.log(`Date: ${dateString}, Seed: ${seed}, Index: ${index}, Mot: ${COMMON_WORDS[index]}`);
    return COMMON_WORDS[index];
}

// Fonction de test pour le développeur
window.testNextDay = function(days = 1) {
    console.log(`Test: Récupération du mot dans ${days} jours...`);
    const word = getDailyWord(days);
    if (word) {
        console.log(`Le mot dans ${days} jours sera : ${word}`);
        alert(`Le mot dans ${days} jours sera : ${word}`);
    } else {
        console.log("Impossible de récupérer le mot.");
    }
};

async function checkDailyStatus() {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    try {
        // MODIF : on sélectionne aussi les colonnes de sauvegarde en cours
        const { data: stats, error } = await window.supabaseClient
            .from('user_stats')
            .select('last_daily_date, daily_current_guesses, daily_current_date')
            .eq('user_id', session.user.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error("Error checking daily status:", error);
            return;
        }

        if (stats && stats.last_daily_date) {
            const today = getLocalDateString();
            if (stats.last_daily_date === today) {
                hasPlayedDailyToday = true;
                setTimeout(() => {
                    showToast("Vous avez déjà joué aujourd'hui. Cette partie ne comptera pas pour vos statistiques.");
                }, 1000);
            // MODIF : sinon, si une partie est en cours (pas encore terminée), on restaure les essais depuis la DB
            } else if (stats.daily_current_date === today && stats.daily_current_guesses) {
                try {
                    const savedGuesses = JSON.parse(stats.daily_current_guesses);
                    if (Array.isArray(savedGuesses) && savedGuesses.length > 0) {
                        
                        // Vider le localStorage pour éviter la double restauration
                        localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
                        
                        savedGuesses.forEach(g => {
                            if (typeof g === 'string' && g.length === wordLength) {
                                window.restoreGuess(g);
                            }
                        });
                        showToast("Partie du jour reprise");
                    }
                } catch(e) {
                    console.error("Erreur restauration guesses DB:", e);
                }
            }
        }
    } catch (e) {
        console.error("Exception checking daily status:", e);
    }
}

// MODIF : nouvelle fonction pour sauvegarder les guesses en cours dans Supabase (anti-triche)
async function saveDailyProgressToDB(currentGuesses) {
    if (!isDailyMode || isMultiplayerMode) return;

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    try {
        await window.supabaseClient
            .from('user_stats')
            .update({
                daily_current_guesses: JSON.stringify(currentGuesses),
                daily_current_date: getLocalDateString()
            })
            .eq('user_id', session.user.id);
    } catch (e) {
        console.error("Erreur sauvegarde guesses DB:", e);
    }
}

function cleanupStaleDailyProgress() {
    if (!isDailyMode) return;

    const raw = localStorage.getItem(DAILY_PROGRESS_STORAGE_KEY);
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.date !== getLocalDateString()) {
            localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
        }
    } catch (e) {
        localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
    }
}

function readDailyProgress() {
    if (!isDailyMode) return null;

    const raw = localStorage.getItem(DAILY_PROGRESS_STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.date !== getLocalDateString()) {
            localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
            return null;
        }
        return parsed;
    } catch (e) {
        localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
        return null;
    }
}

function saveDailyProgress({ completed = false, victory = null, score = null } = {}) {
    if (!isDailyMode || !targetWord || isMultiplayerMode) return;

    const payload = {
        date: getLocalDateString(),
        word: targetWord,
        guesses: [...guesses],
        completed,
        victory,
        score
    };

    localStorage.setItem(DAILY_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
}

function restoreDailyProgressIfAny() {
    if (!isDailyMode || isMultiplayerMode) return false;

    const saved = readDailyProgress();
    if (!saved || !Array.isArray(saved.guesses) || saved.guesses.length === 0) return false;
    if (saved.word && saved.word !== targetWord) {
        localStorage.removeItem(DAILY_PROGRESS_STORAGE_KEY);
        return false;
    }

    saved.guesses.forEach((guessWord) => {
        if (typeof guessWord === 'string' && guessWord.length === wordLength) {
            window.restoreGuess(guessWord);
        }
    });

    const lastGuess = guesses[guesses.length - 1] || "";
    const inferredVictory = lastGuess === targetWord;
    const resolvedVictory = (typeof saved.victory === 'boolean') ? saved.victory : inferredVictory;
    const shouldShowCompletedState = Boolean(saved.completed) || isGameOver;

    if (shouldShowCompletedState && isGameOver) {
        const fallbackScore = lastGuess ? calculateScore(resolvedVictory, guesses.length, lastGuess) : 0;
        const finalScore = Number.isFinite(saved.score) ? saved.score : fallbackScore;
        showEndScreen(resolvedVictory, targetWord, null, finalScore);
    } else {
        showToast("Partie du jour reprise");
    }

    return true;
}

cleanupStaleDailyProgress();

// --- INITIALISATION ---
async function initGame(customWord = null) {
    if (DICTIONARY.length === 0 || COMMON_WORDS.length === 0) {
        await loadDictionaries();
    }
    
    if (customWord) {
        targetWord = customWord.toUpperCase();
    } else {
        // Récupérer le mot du jour localement (basé sur la date)
        let dailyWord = getDailyWord();
        
        if (dailyWord) {
            targetWord = dailyWord.toUpperCase();
        } else {
            // Fallback ultime
            targetWord = COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)];
        }
    }
    wordLength = targetWord.length;
    
    // Reset variables
    currentGuess = Array(wordLength).fill("");
    guesses = [];
    isGameOver = false;
    
    // Reset Keyboard Hints
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('correct', 'present', 'absent');
    });

    // Init hints
    updateHintsFromHistory();
    currentGuess[0] = targetWord[0];

    // Show Leave Button (if hidden)
    const leaveBtn = document.getElementById('btn-leave-game');
    if (leaveBtn) leaveBtn.classList.remove('hidden');

    // Création de la grille HTML
    grid.innerHTML = "";
    
    updateMaxScoreDisplay();
    grid.style.setProperty('--cols', wordLength);
    for (let i = 0; i < MAX_GUESSES; i++) {
        const row = document.createElement("div");
        row.className = "row";
        // row.style.gridTemplateColumns = `repeat(${wordLength}, 1fr)`; // Removed for Flexbox
        for (let j = 0; j < wordLength; j++) {
            const tile = document.createElement("div");
            tile.className = "tile";
            // La première lettre est donnée pour la ligne active (style Tusmo)
            if (i === 0 && j === 0) {
                tile.textContent = targetWord[0];
                tile.classList.add("given", "start-tile");
            }
            row.appendChild(tile);
        }
        grid.appendChild(row);
    }
    
    // Charger le thème (par défaut 'light' -> Clair)
    const savedTheme = localStorage.getItem('theme');
    if (!savedTheme || savedTheme === 'light' || savedTheme === '') {
        document.body.className = 'claire';
        localStorage.setItem('theme', 'claire');
    } else {
        document.body.className = savedTheme;
    }

    // MODIFICATION ICI : On vérifie les restaurations (DB et Local) APRÈS avoir construit la grille
    if (isDailyMode && !isMultiplayerMode) {
        await checkDailyStatus(); 
        const restored = restoreDailyProgressIfAny();
        // Si checkDailyStatus ou restoreDailyProgressIfAny ont restauré, guesses n'est pas vide
        if (!restored && guesses.length === 0) {
            updateGrid();
        }
    } else {
        updateGrid();
    }
}

// --- LOGIQUE DE JEU ---

// Gestion Clavier Physique
document.addEventListener("keydown", (e) => {
    if (isGameOver) return;
    
    // Ignore input if typing in chat
    if (document.activeElement && document.activeElement.id === 'chat-input-field') return;

    const key = e.key;
    if (key === "Enter") handleEnter();
    else if (key === "Backspace") handleBackspace();
    else if (/^[a-zA-Z]$/.test(key)) handleInput(key.toUpperCase());
});

// Gestion Clavier Virtuel
document.getElementById("keyboard").addEventListener("click", (e) => {
    if (isGameOver) return;
    
    const target = e.target;
    if (!target.classList.contains("key")) return;
    
    const key = target.dataset.key;
    if (key === "Enter") handleEnter();
    else if (key === "Backspace") handleBackspace();
    else handleInput(key);
});

function handleInput(letter) {
    const index = currentGuess.findIndex((val) => val === "");
    if (index === -1) return;
    currentGuess[index] = letter;
    updateGrid();
}

function handleBackspace() {
    for (let i = wordLength - 1; i >= 0; i--) {
        if (currentGuess[i]) {
            currentGuess[i] = "";
            // Supprimer temporairement le hint pour cette tentative
            // Il sera restauré au prochain tour grâce à updateHintsFromHistory()
            currentHints[i] = null; 
            break;
        }
    }
    updateGrid();
}

function handleEnter() {
    const guessString = currentGuess.join("");
    const filled = currentGuess.filter(Boolean).length;
    if (filled !== wordLength) {
        animateShake();
        // Faire clignoter toutes les lettres manquantes
        const row = grid.children[guesses.length];
        const tiles = row.children;
        for (let i = 0; i < wordLength; i++) {
            if (!currentGuess[i]) {
                tiles[i].classList.add('blink');
                setTimeout(() => tiles[i].classList.remove('blink'), 2400);
            }
        }
        return;
    }
    
    // Vérification basique si mot existe (optionnel pour ce prototype)
    if (!DICTIONARY.includes(guessString)) {
        // alert("Mot inconnu !"); // À remplacer par une jolie notification
        animateShake();
        showToast("Mot inconnu");
        return;
    }

    submitGuess();
}

function showToast(message) {
    const container = document.getElementById('message-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Trigger reflow
    toast.offsetHeight;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 2000);
}

function updateGrid() {
    const row = grid.children[guesses.length];
    const tiles = row.children;
    
    for (let i = 0; i < wordLength; i++) {
        const letter = currentGuess[i];
        const hint = currentHints[i];
        
        // Display content: either the typed letter or the hint
        const content = letter || hint || "";
        
        // Determine if this tile should be marked as a start tile (hint)
        // The first letter (index 0) is always colored (start-tile) if it matches
        const isStartTile = (i === 0 && hint && content === hint);

        tiles[i].textContent = content;

        if (letter) {
            tiles[i].dataset.state = "active";
        } else {
            delete tiles[i].dataset.state;
        }

        if (isStartTile) {
            tiles[i].classList.add("start-tile");
        } else {
            tiles[i].classList.remove("start-tile");
        }
    }

    // Envoyer l'état au multijoueur si actif
    if (typeof window.sendMultiplayerState === 'function') {
        const filledCount = currentGuess.filter(l => l !== "").length;
        window.sendMultiplayerState(filledCount, guesses.length);
    }
}

function updateHintsFromHistory() {
    // Réinitialiser les hints
    currentHints = Array(wordLength).fill(null);
    // Toujours donner la première lettre
    if (targetWord && targetWord.length > 0) {
        currentHints[0] = targetWord[0];
    }
    
    // Parcourir tous les essais précédents pour trouver les lettres bien placées
    guesses.forEach(guess => {
        for (let i = 0; i < wordLength; i++) {
            if (guess[i] === targetWord[i]) {
                currentHints[i] = guess[i];
            }
        }
    });
}

function submitGuess() {
    // Stop Pressure Timer if active
    if (typeof clearPressureTimer === 'function') {
        clearPressureTimer();
    }

    const guessParts = [...currentGuess];
    const targetParts = targetWord.split("");
    const row = grid.children[guesses.length];
    
    // Algorithme de vérification (Vert, Jaune, Gris)
    const result = Array(wordLength).fill("absent");
    
    // 1. Trouver les VERTS (Bien placés)
    for (let i = 0; i < wordLength; i++) {
        if (guessParts[i] === targetParts[i]) {
            result[i] = "correct";
            targetParts[i] = null; // Marquer comme utilisé
            guessParts[i] = null;
        }
    }
    
    // 2. Trouver les JAUNES (Mal placés)
    for (let i = 0; i < wordLength; i++) {
        if (guessParts[i] && targetParts.includes(guessParts[i])) {
            result[i] = "present";
            targetParts[targetParts.indexOf(guessParts[i])] = null;
        }
    }

    // --- MULTIPLAYER HOOK ---
    if (typeof window.sendMultiplayerGuess === 'function') {
        const pattern = result.map(r => r === 'correct' ? '2' : r === 'present' ? '1' : '0').join('');
        window.sendMultiplayerGuess(pattern, guesses.length);
    }
    
    // ANIMATION DE RÉVÉLATION (Flip successif)
    result.forEach((status, i) => {
        setTimeout(() => {
            const tile = row.children[i];
            tile.classList.add("flip");
            
            // Changer la couleur à mi-chemin de l'animation
            setTimeout(() => {
                tile.classList.add(status);
                // Mettre à jour le clavier
                const key = document.querySelector(`.key[data-key="${currentGuess[i]}"]`);
                if (key) {
                    // Logique de priorité couleur clavier : Vert > Jaune > Gris
                    const oldClass = key.classList.contains("correct") ? "correct" : 
                                     key.classList.contains("present") ? "present" : "absent";
                                     
                    if (status === "correct") key.className = "key correct";
                    else if (status === "present" && oldClass !== "correct") key.className = "key present";
                    else if (status === "absent" && oldClass === "absent") key.className = "key absent"; // Default
                    else if (status === "absent" && !key.classList.contains("correct") && !key.classList.contains("present")) key.classList.add("absent");
                }
            }, 250);
        }, i * 150); // Délai en cascade
    });

    const guessString = currentGuess.join("");
    guesses.push(guessString);
    
    // Session Save Hook
    if (typeof window.saveGuessesToSession === 'function') {
        window.saveGuessesToSession();
    }

    if (isDailyMode && !isMultiplayerMode) {
        saveDailyProgress();
        // MODIF : sauvegarde aussi dans Supabase après chaque essai (anti-triche retour arrière)
        saveDailyProgressToDB([...guesses]);
    }
    
    // Vérification Victoire/Défaite après l'animation
    setTimeout(() => {
        const isMultiplayer = isMultiplayerMode;

        if (guessString === targetWord) {
            const score = calculateScore(true, guesses.length, guessString);
            
            // 1. Notify Server IMMEDIATELY (if multiplayer)
            if (isMultiplayer && window.notifyMultiplayerFinish) {
                window.notifyMultiplayerFinish(true, targetWord, score);
            }

            // 2. Trigger Animation
            animateScoring(true, guesses.length - 1, guessString, () => {
                // If single player, show screen.
                if (!isMultiplayer) {
                    showEndScreen(true, targetWord, null, score);
                    // Update Daily Stats
                    if (isDailyMode && typeof updateDailyStats === 'function') {
                        // MODIF : on passe le score en 3ème paramètre
                        updateDailyStats(true, guesses.length, score);
                    }
                    if (isDailyMode) {
                        saveDailyProgress({ completed: true, victory: true, score });
                    }
                }
                // If multiplayer, handleRoundEnd will take over when ready
            });
            isGameOver = true;
        } else if (guesses.length === MAX_GUESSES) {
            const score = calculateScore(false, guesses.length, guessString);
            
            // 1. Notify Server IMMEDIATELY (if multiplayer)
            if (isMultiplayer && window.notifyMultiplayerFinish) {
                window.notifyMultiplayerFinish(false, targetWord, score);
            }

            // 2. Trigger Animation
            animateScoring(false, guesses.length - 1, guessString, () => {
                // If single player, show screen.
                if (!isMultiplayer) {
                    showEndScreen(false, targetWord, null, score);
                    // Update Daily Stats
                    if (isDailyMode && typeof updateDailyStats === 'function') {
                        // MODIF : on passe le score en 3ème paramètre
                        updateDailyStats(false, guesses.length, score);
                    }
                    if (isDailyMode) {
                        saveDailyProgress({ completed: true, victory: false, score });
                    }
                }
                // If multiplayer, handleRoundEnd will take over when ready
            });
            isGameOver = true;
        } else {
            // Copier les lettres correctes (sans style) vers la ligne suivante
            if (guesses.length < MAX_GUESSES) {
                // Recalculer les indices basés sur l'historique complet
                updateHintsFromHistory();

                currentGuess = Array(wordLength).fill("");
                // Only pre-fill the first letter if it's a hint
                if (currentHints[0]) {
                    currentGuess[0] = currentHints[0];
                }
                
                updateGrid();
            }
        }
    }, wordLength * 150 + 500);
}

function animateShake() {
    const row = grid.children[guesses.length];
    row.querySelectorAll('.tile').forEach(tile => {
        tile.classList.add('shake');
        setTimeout(() => tile.classList.remove('shake'), 500);
    });
}

// --- END SCREEN ---
const endModal = document.getElementById('endModal');
const endTitle = document.getElementById('endTitle');
const endMessage = document.getElementById('endMessage');
const wordDisplay = document.getElementById('wordDisplay');
const restartBtn = document.getElementById('restartBtn');
const shareBtn = document.getElementById('shareBtn');

function showEndScreen(victory, word, scores = null, myScore = null) {
    endModal.classList.remove('hidden');
    endModal.classList.remove('victory', 'defeat');
    endModal.classList.add(victory ? 'victory' : 'defeat');

    // Reset content
    endTitle.textContent = "";
    endMessage.innerHTML = ""; 
    wordDisplay.style.display = 'none';
    
    // Multiplayer Mode
    if (scores) {
        // WAITING STATE (Word hidden)
        if (word === null) {
            endTitle.textContent = "Terminé !";
            endMessage.innerHTML = `En attente des autres joueurs...<br>Le résultat s'affichera bientôt.<br><strong>Score manche: ${myScore !== null ? myScore : '?'} pts</strong>`;
            wordDisplay.style.display = 'none';
            
            // Hide button while waiting
            restartBtn.style.display = 'none';
            return;
        }

        // FINAL STATE
        restartBtn.style.display = 'block'; // Ensure visible
        endTitle.textContent = "Manche terminée";
        wordDisplay.textContent = word;
        wordDisplay.style.display = 'block';
        
        // Build Scoreboard
        let scoreHtml = '<div class="scoreboard" style="margin-top: 20px; text-align: left; max-height: 200px; overflow-y: auto;">';
        scores.sort((a, b) => b.score - a.score).forEach(p => {
            const displayName = p.pseudo.split('|')[0];
            const avatarUrl = window.getAvatarUrl ? window.getAvatarUrl(p.pseudo) : 'assets/1.gif';
            scoreHtml += `
                <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid var(--tile-border); align-items: center;">
                    <span style="display: flex; align-items: center; gap: 10px;">
                        <img src="${avatarUrl}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid var(--tile-border);">
                        ${displayName} ${p.est_host ? '👑' : ''}
                        ${p.id === window.myPlayerId ? '<span style="font-size:0.8em; opacity:0.7;">(Moi)</span>' : ''}
                    </span>
                    <strong>${p.score} pts</strong>
                </div>
            `;
        });
        scoreHtml += '</div>';
        
        endMessage.innerHTML = `Le mot était : <br>${scoreHtml}`;
        
        // Update Button
        if (window.isHost) {
            restartBtn.textContent = "Suite (Lancer la manche)";
            restartBtn.disabled = false;
            restartBtn.classList.remove('btn-disabled');
        } else {
            restartBtn.textContent = "En attente de l'hôte...";
            restartBtn.disabled = true;
            restartBtn.classList.add('btn-disabled');
        }
    } else {
        // Single Player Mode
        restartBtn.textContent = "Rejouer";
        restartBtn.disabled = false;
        restartBtn.classList.remove('btn-disabled');
        
        if (victory) {
            endTitle.textContent = "Victoire !";
            let msg = `Bien joué, tu as trouvé le mot !`;
            if (guesses.length === MAX_GUESSES) {
                msg += `<br><span style="font-size: 1.2em;">PHEW 😮‍💨</span>`;
            }
            endMessage.innerHTML = `${msg}<br><br><strong>Score: ${myScore || 0} pts</strong>`;
            wordDisplay.style.display = 'none';
        } else {
            endTitle.textContent = "Défaite...";
            endMessage.innerHTML = `Dommage, le mot était :<br><br><strong>Score: ${myScore || 0} pts</strong>`;
            wordDisplay.textContent = word;
            wordDisplay.style.display = 'block';
        }
    }
}

restartBtn.addEventListener('click', () => {
    endModal.classList.add('hidden');
    
    // Multiplayer Hook
    if (typeof window.triggerMultiplayerRestart === 'function' && window.currentRoomCode) {
        window.triggerMultiplayerRestart();
    } else {
        initGame();
    }
});

shareBtn.addEventListener('click', () => {
    // Placeholder for share functionality
    alert("Fonctionnalité de partage bientôt disponible !");
});

// Gestion du bouton Thème (affiche le label du thème)
const themes = ['', 'claire', 'sombre'];
function themeLabel(cls) {
    // SVG Icons for themes
    const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const sparklesIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

    if (!cls || cls === '') return sparklesIcon; // Coloré -> Paillettes
    if (cls === 'claire') return sunIcon; // Claire -> Soleil
    if (cls === 'sombre') return moonIcon; // Sombre -> Lune
    return sparklesIcon;
}

// Initialiser label bouton thème

let savedThemeBtn = localStorage.getItem('theme');
if (!savedThemeBtn || savedThemeBtn === 'light' || savedThemeBtn === '') {
    document.body.className = 'claire';
    localStorage.setItem('theme', 'claire');
    savedThemeBtn = 'claire';
} else {
    document.body.className = savedThemeBtn;
}
themeBtn.innerHTML = themeLabel(savedThemeBtn);

themeBtn.addEventListener('click', () => {
    let currentTheme = document.body.className || '';
    let nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
    let newTheme = themes[nextIndex];
    document.body.className = newTheme;
    localStorage.setItem('theme', newTheme);
    themeBtn.innerHTML = themeLabel(newTheme);
});

// Gestion de la modale de règles
const helpBtn = document.getElementById('helpBtn');
const rulesModal = document.getElementById('rules-modal');
const closeRulesBtn = document.getElementById('close-rules');

if (helpBtn && rulesModal) {
    helpBtn.addEventListener('click', () => {
        rulesModal.classList.remove('hidden');
    });

    closeRulesBtn.addEventListener('click', () => {
        rulesModal.classList.add('hidden');
    });

    rulesModal.addEventListener('click', (e) => {
        if (e.target === rulesModal) {
            rulesModal.classList.add('hidden');
        }
    });
}

// Gestion de la modale des modes de jeu
const helpModesBtn = document.getElementById('helpModesBtn');
const modesModal = document.getElementById('modes-modal');
const closeModesBtn = document.getElementById('close-modes');

if (helpModesBtn && modesModal) {
    helpModesBtn.addEventListener('click', () => { 
        modesModal.classList.remove('hidden');
    });

    closeModesBtn.addEventListener('click', () => {
        modesModal.classList.add('hidden');
    });

    modesModal.addEventListener('click', (e) => {
        if (e.target === modesModal) {
            modesModal.classList.add('hidden');
        }
    });
}

// --- SESSION RESTORATION HELPERS ---

window.saveGuessesToSession = function() {
    if (typeof currentRoomCode !== 'undefined' && currentRoomCode) {
        sessionStorage.setItem('tusmatch_guesses_' + currentRoomCode, JSON.stringify(guesses));
    }
};

window.restoreGuess = function(guessWord) {
    if (!targetWord) return;
    
    // Set current guess
    currentGuess = guessWord.split("");
    const guessParts = [...currentGuess];
    const targetParts = targetWord.split("");
    const row = grid.children[guesses.length];
    
    const result = Array(wordLength).fill("absent");
    
    // 1. Verts
    for (let i = 0; i < wordLength; i++) {
        if (guessParts[i] === targetParts[i]) {
            result[i] = "correct";
            targetParts[i] = null;
            guessParts[i] = null;
        }
    }
    
    // 2. Jaunes
    for (let i = 0; i < wordLength; i++) {
        if (guessParts[i] && targetParts.includes(guessParts[i])) {
            result[i] = "present";
            targetParts[targetParts.indexOf(guessParts[i])] = null;
        }
    }

    // UI Update (Instant)
    result.forEach((status, i) => {
        const tile = row.children[i];
        tile.textContent = currentGuess[i];
        tile.classList.add(status);
        tile.classList.add("flip"); 
        
        // Keyboard
        const key = document.querySelector(`.key[data-key="${currentGuess[i]}"]`);
        if (key) {
            const oldClass = key.classList.contains("correct") ? "correct" : 
                             key.classList.contains("present") ? "present" : "absent";
            if (status === "correct") key.className = "key correct";
            else if (status === "present" && oldClass !== "correct") key.className = "key present";
            else if (status === "absent" && !key.classList.contains("correct") && !key.classList.contains("present")) key.classList.add("absent");
        }
    });

    guesses.push(guessWord);
    
    if (guessWord === targetWord) {
        isGameOver = true;
    } else if (guesses.length >= MAX_GUESSES) {
        isGameOver = true;
    }
    
    currentGuess = [];
    updateHintsFromHistory();
    // Prepare next row
    if (!isGameOver) {
        currentGuess = Array(wordLength).fill("");
        if (currentHints[0]) {
            currentGuess[0] = currentHints[0];
        }
        updateGrid();
    }
    
    updateMaxScoreDisplay();
};

window.loadGuessesFromSession = function() {
    if (typeof currentRoomCode !== 'undefined' && currentRoomCode) {
        const stored = sessionStorage.getItem('tusmatch_guesses_' + currentRoomCode);
        if (stored) {
            const savedGuesses = JSON.parse(stored);
            // Clear current grid first if needed, but usually we call this on fresh init
            savedGuesses.forEach(g => window.restoreGuess(g));
        }
    }
};

// --- SCORING SYSTEM ---

function calculateScore(victory, attemptsUsed, lastGuess) {
    let score = 0;
    const maxGuesses = 6;
    
    if (victory) {
        // 1. Tile Points (All Red) -> Length * 10
        score += targetWord.length * 10;
        
        // 2. Win Bonus
        score += 50;
        
        // 3. Speed Bonus (Unused Lines)
        const unusedLines = maxGuesses - attemptsUsed;
        score += unusedLines * 30;
        
    } else {
        // Defeat: Count Reds and Yellows in last guess
        const targetParts = targetWord.split("");
        const guessParts = lastGuess.split("");
        let reds = 0;
        let yellows = 0;
        
        // First pass: Reds
        for (let i = 0; i < targetWord.length; i++) {
            if (guessParts[i] === targetParts[i]) {
                reds++;
                targetParts[i] = null;
                guessParts[i] = null;
            }
        }
        
        // Second pass: Yellows
        for (let i = 0; i < targetWord.length; i++) {
            if (guessParts[i] && targetParts.includes(guessParts[i])) {
                yellows++;
                const idx = targetParts.indexOf(guessParts[i]);
                targetParts[idx] = null;
            }
        }
        
        score += (reds * 10) + (yellows * 5);
    }
    
    return score;
}

window.calculateScore = calculateScore;

function updateMaxScoreDisplay() {
    const display = document.getElementById('max-score-display');
    if (!display) return;
    
    if (isGameOver) return; 
    
    // Calculate Max Possible Score from current state
    // Assume next guess is a win
    const nextAttemptIndex = guesses.length + 1; // 1-based
    const maxGuesses = 6;
    
    if (nextAttemptIndex > maxGuesses) {
        display.textContent = "0";
        return;
    }
    
    // Max Score = Win on next attempt
    const tilePoints = wordLength * 10;
    const winBonus = 50;
    const unusedLines = maxGuesses - nextAttemptIndex;
    const speedBonus = unusedLines * 30;
    
    const maxScore = tilePoints + winBonus + speedBonus;
    display.textContent = maxScore;
}

// Lancer le jeu (sauf si mode privé, on attend le lobby)
if (!isMultiplayerMode) {
    initGame();
}

// --- SCORING ANIMATIONS ---

window.isScoringAnimationPlaying = false;

function animateScoring(victory, lastRowIndex, lastGuess, onComplete) {
    window.isScoringAnimationPlaying = true;
    const row = grid.children[lastRowIndex];
    const tiles = row.children;
    
    let delay = 0;

    // 1. Animate Tile Points (Red/Green = +10, Yellow = +5)
    Array.from(tiles).forEach((tile, i) => {
        setTimeout(() => {
            let points = 0;
            if (tile.classList.contains('correct')) points = 10;
            else if (tile.classList.contains('present')) points = 5;
            
            if (points > 0) {
                showFloatingScore(tile, `+${points}`);
            }
        }, delay);
        delay += 150; // Cascade effect
    });

    delay += 500;

    // 2. Victory Bonuses
    if (victory) {
        // Win Bonus
        setTimeout(() => {
            showBigFloatingScore("+50");
        }, delay);
        delay += 1000;

        // Eco Bonuses (Unused lines)
        const maxGuesses = 6;
        for (let i = lastRowIndex + 1; i < maxGuesses; i++) {
            const emptyRow = grid.children[i];
            // Capture index for closure
            const rowIndex = i; 
            setTimeout(() => {
                emptyRow.classList.add('row-highlight-eco');
                // Show +30 in the middle of the row
                // Use the 3rd tile (index 2) as anchor for 5-letter words, or middle
                const middleTile = emptyRow.children[Math.floor(emptyRow.children.length / 2)];
                if (middleTile) {
                    showFloatingScore(middleTile, "+30", "eco-score");
                }
            }, delay);
            delay += 400;
        }
    }

    // 3. Finish
    setTimeout(() => {
        window.isScoringAnimationPlaying = false;
        onComplete();
    }, delay + 500);
}

function showFloatingScore(element, text, extraClass = "") {
    const rect = element.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.textContent = text;
    popup.className = `score-popup ${extraClass}`;
    
    // Position absolute relative to document
    popup.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    popup.style.top = `${rect.top + window.scrollY}px`;
    
    // Center horizontally
    popup.style.marginLeft = "-20px"; 

    document.body.appendChild(popup);
    
    // Remove after animation
    setTimeout(() => {
        popup.remove();
    }, 1500);
}

function showBigFloatingScore(text) {
    const popup = document.createElement('div');
    popup.textContent = text;
    popup.className = 'big-score-popup';
    document.body.appendChild(popup);
    
    setTimeout(() => {
        popup.remove();
    }, 2000);
}

// --- MODE TEMPS LOGIC ---

let pressureTimerInterval = null;
let chronoDuration = 30; // Default

window.setChronoDuration = function(seconds) {
    chronoDuration = seconds;
};

window.triggerPressureTimer = function(opponentRowIndex) {
    if (isGameOver) return;
    
    const currentRowIndex = guesses.length;
    
    // Only trigger if opponent finished a row >= my current row
    // (Meaning they are moving to next row, or are already ahead)
    if (opponentRowIndex < currentRowIndex) return;

    // If timer already running, do nothing (pressure is already on)
    if (pressureTimerInterval) return;

    if (currentRowIndex >= MAX_GUESSES) return;

    const row = grid.children[currentRowIndex];
    
    // Create Timer UI
    let timeLeft = chronoDuration;
    const timerDisplay = document.createElement('div');
    timerDisplay.className = 'timer-display';
    timerDisplay.textContent = timeLeft;
    row.appendChild(timerDisplay);
    
    pressureTimerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(pressureTimerInterval);
            pressureTimerInterval = null;
            timerDisplay.remove();
            submitSkippedGuess();
        }
    }, 1000);
};

window.clearPressureTimer = function() {
    if (pressureTimerInterval) {
        clearInterval(pressureTimerInterval);
        pressureTimerInterval = null;
    }
    // Remove UI
    const timers = document.querySelectorAll('.timer-display');
    timers.forEach(t => t.remove());
};

function submitSkippedGuess() {
    // Fill current guess with dummy data to skip the turn
    const dummyGuess = Array(wordLength).fill("!"); 
    const dummyString = dummyGuess.join("");
    
    // Update UI to show gray/skipped
    const row = grid.children[guesses.length];
    Array.from(row.children).forEach(tile => {
        tile.textContent = "-";
        tile.classList.add('absent'); // Gray
        tile.classList.add('skipped'); // New class for styling
        tile.classList.add('flip'); // Animate
    });
    
    guesses.push(dummyString);

    if (isDailyMode && !isMultiplayerMode) {
        saveDailyProgress();
        // MODIF : sauvegarde aussi dans Supabase
        saveDailyProgressToDB([...guesses]);
    }
    
    // Send to multiplayer (all absent pattern)
    if (typeof window.sendMultiplayerGuess === 'function') {
        const pattern = Array(wordLength).fill('0').join('');
        window.sendMultiplayerGuess(pattern, guesses.length - 1);
    }
    
    // Check Game Over (Defeat by exhaustion)
    if (guesses.length === MAX_GUESSES) {
        const isMultiplayer = isMultiplayerMode;
        const score = calculateScore(false, guesses.length, dummyString);
        
        // Trigger Animation then End Game
        animateScoring(false, guesses.length - 1, dummyString, () => {
            if (isMultiplayer && window.handleMultiplayerEnd) {
                window.handleMultiplayerEnd(false, targetWord, score);
            } else {
                showEndScreen(false, targetWord, null, score);
                if (isDailyMode) {
                    saveDailyProgress({ completed: true, victory: false, score });
                }
            }
        });
        isGameOver = true;
    } else {
        // Move to next line
        currentGuess = Array(wordLength).fill("");
        // Restore hints?
        updateHintsFromHistory();
        if (currentHints[0]) currentGuess[0] = currentHints[0];
        updateGrid();
    }
}

// --- FORCED ANIMATION FOR MULTIPLAYER END ---

window.getLastValidGuess = function() {
    for (let i = guesses.length - 1; i >= 0; i--) {
        // Check if guess is dummy (skipped)
        // In submitSkippedGuess: const dummyGuess = Array(wordLength).fill("!");
        if (!guesses[i].includes("!")) {
            return { index: i, word: guesses[i] };
        }
    }
    return null;
};

window.forceEndRoundAnimation = function(onComplete) {
    if (isGameOver) {
        onComplete();
        return;
    }
    
    isGameOver = true;
    
    // Stop any active timer
    if (typeof clearPressureTimer === 'function') {
        clearPressureTimer();
    }
    
    const lastValid = window.getLastValidGuess();
    
    if (lastValid) {
        // Animate scoring for this row
        animateScoring(false, lastValid.index, lastValid.word, onComplete);
    } else {
        // No valid guesses made yet
        onComplete();
    }
};

// --- STATS UPDATE LOGIC ---

// MODIF : ajout du paramètre score (3ème argument)
async function updateDailyStats(victory, guessCount, score = 0) {
    if (!isDailyMode) return;

    // Check if user is logged in
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    // Check if already played today
    if (hasPlayedDailyToday) {
        console.log("Stats not updated: Already played today.");
        return;
    }

    const userId = session.user.id;

    try {
        // 1. Fetch current stats
        let { data: stats, error } = await window.supabaseClient
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code === 'PGRST116') {
            // Create if not exists
            const { data: newStats, error: createError } = await window.supabaseClient
                .from('user_stats')
                .insert({ user_id: userId })
                .select()
                .single();
            if (createError) throw createError;
            stats = newStats;
        } else if (error) {
            throw error;
        }

        // 2. Calculate new stats
        const newPlayed = (stats.daily_played || 0) + 1;
        const newWins = victory ? (stats.daily_wins || 0) + 1 : (stats.daily_wins || 0);
        
        let newStreak = stats.daily_current_streak || 0;
        if (victory) {
            newStreak++;
        } else {
            newStreak = 0;
        }
        
        const newMaxStreak = Math.max(stats.daily_max_streak || 0, newStreak);
        
        // Distribution
        let distribution = stats.daily_distribution || [0,0,0,0,0,0];
        if (victory && guessCount >= 1 && guessCount <= 6) {
            distribution[guessCount - 1]++;
        }

        // MODIF : calcul du nouveau total de points
        const newTotalPoints = (stats.daily_total_points || 0) + score;

        // 3. Update DB
        await window.supabaseClient
            .from('user_stats')
            .update({
                daily_played: newPlayed,
                daily_wins: newWins,
                daily_current_streak: newStreak,
                daily_max_streak: newMaxStreak,
                daily_distribution: distribution,
                daily_total_points: newTotalPoints,       // MODIF : sauvegarde du score
                daily_current_guesses: null,              // MODIF : nettoyage fin de partie
                daily_current_date: null,                 // MODIF : nettoyage fin de partie
                last_daily_date: getLocalDateString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);
            
        console.log("Daily Stats Updated!");
        hasPlayedDailyToday = true; // Prevent double update in same session

    } catch (e) {
        console.error("Error updating daily stats:", e);
    }
}
window.updateDailyStats = updateDailyStats;
