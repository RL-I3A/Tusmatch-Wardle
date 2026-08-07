// multiplayer.js

// --- VARIABLES GLOBALES ---
let myPlayerId = null;
let myPseudo = null;
window.currentRoomCode = null; // Exposed for Auth/Invite system
let isHost = false;
let roomChannel = null;
let playerCount = 0; // Track number of players for cleanup logic
let currentAvatarIndex = 1;
let selectedGameMode = 'preums';
let currentChronoDuration = 30; // Default duration
let maxRounds = 'inf'; // 'inf' or number
let currentRound = 1;
let lastRoundVictory = false; // Track local victory state for round end display

// --- DOM ELEMENTS ---
const lobbyOverlay = document.getElementById('lobby-overlay');
const lobbyStart = document.getElementById('lobby-start');
const lobbyWaiting = document.getElementById('lobby-waiting');
const playersList = document.getElementById('players-list');
const opponentsContainer = document.getElementById('opponents-container');
const displayRoomCode = document.getElementById('display-room-code');
const waitingMessage = document.getElementById('waiting-message');
const btnStartGame = document.getElementById('btn-start-game');
const roomInfoBar = document.getElementById('room-info-bar');
const ingameRoomCode = document.getElementById('ingame-room-code');

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Load saved avatar preference from Auth
    const savedAvatar = sessionStorage.getItem('tusmatch_saved_avatar');
    if (savedAvatar) {
        currentAvatarIndex = parseInt(savedAvatar);
        const preview = document.getElementById('avatar-preview');
        if (preview) preview.src = `assets/${currentAvatarIndex}.gif`;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    // Auto-rejoin Session
    const savedRoom = sessionStorage.getItem('tusmatch_room');
    const savedPlayerId = sessionStorage.getItem('tusmatch_player_id');
    if (savedRoom && savedPlayerId && mode === 'private') {
        rejoinSession(savedRoom, savedPlayerId);
    }

    if (mode === 'private') {
        // Afficher le lobby
        lobbyOverlay.classList.remove('hidden');
        
        // Event Listeners du Lobby
        document.getElementById('btn-create-game').addEventListener('click', createGame);
        document.getElementById('btn-join-game').addEventListener('click', () => {
            const code = document.getElementById('lobby-code-input').value.toUpperCase();
            if (code.length >= 3) {
                joinGame(code);
            } else {
                // alert("Code trop court !");
                const input = document.getElementById('lobby-code-input');
                input.classList.add('shake');
                setTimeout(() => input.classList.remove('shake'), 500);
            }
        });

        // Avatar Carousel Logic
        const avatarImg = document.querySelector('.avatar-preview-container img');
        const btnPrevAvatar = document.getElementById('btn-prev-avatar');
        const btnNextAvatar = document.getElementById('btn-next-avatar');

        if (btnPrevAvatar && btnNextAvatar && avatarImg) {
            btnPrevAvatar.addEventListener('click', () => {
                currentAvatarIndex--;
                if (currentAvatarIndex < 1) currentAvatarIndex = 12;
                avatarImg.src = `assets/${currentAvatarIndex}.gif`;
            });

            btnNextAvatar.addEventListener('click', () => {
                currentAvatarIndex++;
                if (currentAvatarIndex > 12) currentAvatarIndex = 1;
                avatarImg.src = `assets/${currentAvatarIndex}.gif`;
            });
        }

        // Game Mode Selector Logic
        const modeOptions = document.querySelectorAll('.mode-option');
        const chronoSettings = document.getElementById('chrono-settings');

        modeOptions.forEach(option => {
            option.addEventListener('click', () => {
                if (option.classList.contains('disabled')) return;
                
                // Remove selected from all
                modeOptions.forEach(opt => opt.classList.remove('selected'));
                // Add to clicked
                option.classList.add('selected');
                // Update variable
                selectedGameMode = option.dataset.mode;

                // Show/Hide Chrono Settings
                if (selectedGameMode === 'temps') {
                    chronoSettings.classList.remove('hidden');
                } else {
                    chronoSettings.classList.add('hidden');
                }
            });
        });

        // Round Slider Logic
        const roundsSlider = document.getElementById('rounds-slider');
        const roundsValue = document.getElementById('rounds-value');
        if (roundsSlider && roundsValue) {
            const updateRounds = () => {
                const val = parseInt(roundsSlider.value);
                roundsValue.textContent = val >= 21 ? '∞' : val;
                maxRounds = val >= 21 ? 'inf' : val;
            };
            roundsSlider.addEventListener('input', updateRounds);
            // Init
            updateRounds();
        }
        
        // Event Listener pour le bouton "Lancer" (Host seulement)
        btnStartGame.addEventListener('click', launchGame);

        // Event Listener pour le bouton "Retour" du lobby
        const btnLobbyBack = document.getElementById('btn-lobby-back');
        if (btnLobbyBack) {
            btnLobbyBack.addEventListener('click', () => {
                window.location.href = 'index.html';
            });
        }

        // Event Listeners pour les boutons de partage (Lobby & In-Game)
        setupShareButtons('btn-share-link', 'btn-copy-code');
        setupShareButtons('ingame-share-link', 'ingame-copy-code');

        // Event Listener pour le bouton "Retour" (Quitter la partie)
        const btnLeave = document.getElementById('btn-leave-game');
        if (btnLeave) {
            btnLeave.addEventListener('click', (e) => {
                e.preventDefault(); // Empêcher le lien par défaut
                openLeaveModal();
            });
        }

        // Modal Leave Actions
        document.getElementById('confirm-leave').addEventListener('click', confirmLeaveGame);
        document.getElementById('cancel-leave').addEventListener('click', closeLeaveModal);

    // Auto-fill code from URL
    const codeParam = urlParams.get('code');
    const autoJoin = urlParams.get('autojoin');

    if (codeParam) {
        document.getElementById('lobby-code-input').value = codeParam;
        
        // Auto-fill pseudo from session if available
        const savedPseudo = sessionStorage.getItem('tusmatch_pseudo');
        if (savedPseudo) {
            document.getElementById('player-pseudo').value = savedPseudo;
        }

        if (autoJoin === 'true') {
            // Small delay to ensure everything is loaded
            setTimeout(() => {
                joinGame(codeParam);
            }, 500);
        }
    } else {
        // Pre-fill pseudo anyway
        const savedPseudo = sessionStorage.getItem('tusmatch_pseudo');
        if (savedPseudo) {
            document.getElementById('player-pseudo').value = savedPseudo;
        }
    }

        // Hook pour le typing (Broadcast)
        document.addEventListener('keydown', (e) => {
            // Ignore typing if in chat input
            if (e.target.id === 'chat-input-field') return;
            
            if (currentRoomCode && !isGameOver) {
                sendTypingSignal();
            }
        });

        // Initialize Chat
        initChat();
    }
});

function setupShareButtons(linkBtnId, codeBtnId) {
    const btnShare = document.getElementById(linkBtnId);
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            if (currentRoomCode) {
                const url = `${window.location.origin}${window.location.pathname}?mode=private&code=${currentRoomCode}`;
                navigator.clipboard.writeText(url).then(() => {
                    // Bounce animation
                    btnShare.classList.add('bounce');
                    setTimeout(() => btnShare.classList.remove('bounce'), 500);
                });
            }
        });
    }

    const btnCopyCode = document.getElementById(codeBtnId);
    if (btnCopyCode) {
        btnCopyCode.addEventListener('click', () => {
            if (currentRoomCode) {
                navigator.clipboard.writeText(currentRoomCode).then(() => {
                    // Bounce animation
                    btnCopyCode.classList.add('bounce');
                    setTimeout(() => btnCopyCode.classList.remove('bounce'), 500);
                });
            }
        });
    }
}

// --- LOGIQUE LOBBY ---

async function createGame() {
    const btn = document.getElementById('btn-create-game');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Création...";

    try {
        const pseudoInput = document.getElementById('player-pseudo').value.trim();
        let pseudo = pseudoInput || "Joueur " + Math.floor(Math.random() * 1000);
        
        // Append Avatar ID
        if (typeof currentAvatarIndex !== 'undefined') {
            pseudo = `${pseudo}|${currentAvatarIndex}`;
        }
        
        myPseudo = pseudo;
        
        // 1. Générer un code unique (4 caractères, sans 0 ni O)
        const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789";
        let code = "";
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // 2. Choisir un mot aléatoire (On utilise la liste locale de game.js)
        // Assurons-nous que les dictionnaires sont chargés
        if (typeof COMMON_WORDS === 'undefined' || COMMON_WORDS.length === 0) {
            if (typeof loadDictionaries === 'function') {
                await loadDictionaries();
            } else {
                console.warn("loadDictionaries non disponible, utilisation fallback");
                COMMON_WORDS = ["POMME", "MONDE"];
            }
        }
        
        const mot = COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)];

        // Prefix the word with the game mode to sync it with all players
        // Format: "MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD"
        const modePrefix = (selectedGameMode || 'preums').toUpperCase();
        
        let duration = 0;
        if (selectedGameMode === 'temps') {
            const durationInput = document.getElementById('chrono-duration');
            duration = durationInput ? durationInput.value : 30;
        }

        // Ensure maxRounds is set (default 'inf')
        const slider = document.getElementById('rounds-slider');
        if (slider) {
            const val = parseInt(slider.value);
            maxRounds = val >= 21 ? 'inf' : val;
        }
        if (!maxRounds) maxRounds = 'inf';
        
        // Initialize currentRound to 1
        currentRound = 1;

        let motWithMode = `${modePrefix}:${duration}:${maxRounds}:${currentRound}:${mot}`;

        // 3. Créer la partie
        const { data: partyData, error: partyError } = await supabaseClient
            .from('parties')
            .insert({ 
                code: code, 
                mot_a_trouver: motWithMode, 
                statut: 'attente' 
            })
            .select()
            .single();

        if (partyError) {
            console.error(partyError);
            alert("Erreur création partie (Code: " + partyError.code + ")");
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        currentRoomCode = code;
        window.currentRoomCode = code; // Sync global
        isHost = true;

        // Session Persistence
        sessionStorage.setItem('tusmatch_room', code);
        sessionStorage.setItem('tusmatch_pseudo', pseudo);
        sessionStorage.setItem('tusmatch_is_host', 'true');

        // 4. S'ajouter comme joueur
        await joinLobbyAsPlayer(partyData.id, pseudo, true);
        sessionStorage.setItem('tusmatch_player_id', myPlayerId);
        
        // 5. Afficher la salle d'attente
        showWaitingRoom(code);
        
        // Rétablir le bouton (même s'il est caché ensuite)
        btn.disabled = false;
        btn.textContent = originalText;

    } catch (e) {
        console.error("Erreur createGame:", e);
        alert("Une erreur est survenue : " + e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function joinGame(code) {
    const btn = document.getElementById('btn-join-game');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Connexion...";

    try {
        const pseudoInput = document.getElementById('player-pseudo').value.trim();
        let pseudo = pseudoInput || "Invité " + Math.floor(Math.random() * 1000);
        
        // Append Avatar ID
        if (typeof currentAvatarIndex !== 'undefined') {
            pseudo = `${pseudo}|${currentAvatarIndex}`;
        }
        
        myPseudo = pseudo;

        // 1. Trouver la partie
        const { data: party, error } = await supabaseClient
            .from('parties')
            .select('*')
            .eq('code', code)
            .single();

        if (error || !party) {
            alert("Partie introuvable !");
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        // On autorise à rejoindre même si c'est "en_cours"
        // if (party.statut !== 'attente') { ... }

        currentRoomCode = code;
        isHost = false;

        // Session Persistence
        sessionStorage.setItem('tusmatch_room', code);
        sessionStorage.setItem('tusmatch_pseudo', pseudo);
        sessionStorage.setItem('tusmatch_is_host', 'false');

        // 2. S'ajouter
        await joinLobbyAsPlayer(party.id, pseudo, false);
        sessionStorage.setItem('tusmatch_player_id', myPlayerId);

        // 3. Si la partie est déjà en cours, on lance direct
        if (party.statut === 'en_cours') {
            startGameMultiplayer(party.mot_a_trouver);
        } else {
            // Sinon on affiche la salle d'attente
            showWaitingRoom(code);
        }
        
        btn.disabled = false;
        btn.textContent = originalText;

    } catch (e) {
        console.error("Erreur joinGame:", e);
        alert("Erreur de connexion : " + e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function joinLobbyAsPlayer(partyId, pseudo, hostStatus) {
    const { data: player, error } = await supabaseClient
        .from('joueurs')
        .insert({ 
            pseudo: pseudo, 
            partie_id: partyId, 
            est_host: hostStatus 
        })
        .select()
        .single();

    if (error) {
        console.error(error);
        return;
    }

    myPlayerId = player.id;
    subscribeToRoom(partyId);
    
    // Charger les joueurs déjà présents
    refreshPlayerList(partyId);
}

function showWaitingRoom(code) {
    lobbyStart.classList.add('hidden');
    lobbyWaiting.classList.remove('hidden');
    displayRoomCode.textContent = code;
    
    if (isHost) {
        btnStartGame.classList.remove('hidden');
        waitingMessage.classList.add('hidden');
    } else {
        btnStartGame.classList.add('hidden');
        waitingMessage.classList.remove('hidden');
    }
}

async function refreshPlayerList(partyId) {
    const { data: players } = await supabaseClient
        .from('joueurs')
        .select('*')
        .eq('partie_id', partyId);
    
    updatePlayerListUI(players);
}

function updatePlayerListUI(players) {
    const ingamePlayersList = document.getElementById('ingame-players-content');
    
    // Sécurité : on revérifie si on est host via la session
    if (sessionStorage.getItem('tusmatch_is_host') === 'true') {
        isHost = true;
    }

    const renderList = (container) => {
        if (!container) return;
        container.innerHTML = players.map(p => {
            const avatarUrl = getAvatarUrl(p.pseudo);
            const displayName = getDisplayName(p.pseudo);
            const hostIcon = p.est_host ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>` : '';
            
            // Bouton Kick
            let kickBtn = '';
            const amIHost = (isHost === true || isHost === 'true');
            const isTargetHost = (p.est_host === true || p.est_host === 'true');

            // Debug: Afficher un petit point rouge si je suis host pour vérifier
            // if (amIHost) console.log("Je suis host, affichage boutons...");

            if (amIHost && !isTargetHost) {
                kickBtn = `
                <button class="btn-kick" data-id="${p.id}" title="Exclure" style="pointer-events: auto;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </button>`;
            }

            // Style différent pour le lobby vs in-game
            const isLobby = container.id === 'players-list';
            const cardStyle = isLobby 
                ? `padding: 8px; border-bottom: 1px solid var(--tile-border); display: flex; align-items: center; gap: 10px;`
                : `padding: 8px; border-bottom: 1px solid var(--tile-border); display: flex; align-items: center; gap: 10px; min-width: 200px; background: rgba(0,0,0,0.2); border-radius: 8px;`;

            return `
            <div class="player-card-item" style="${cardStyle}">
                <img src="${avatarUrl}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 2px solid var(--tile-border);">
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; text-align: left;">${displayName}</span>
                ${hostIcon}
                ${kickBtn}
            </div>`;
        }).join('');
    };

    // Update Lobby List
    renderList(playersList);
    // Update In-Game List
    renderList(ingamePlayersList);

    // Ajouter les event listeners pour les boutons kick (Globalement)
    document.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.target.closest('.btn-kick');
            if (targetBtn) {
                const playerId = targetBtn.dataset.id;
                kickPlayer(playerId);
            }
        });
    });
}

// --- CUSTOM ALERTS ---

function showCustomAlert(title, message) {
    const modal = document.getElementById('custom-alert-modal');
    if (!modal) {
        alert(message); // Fallback
        return;
    }
    document.getElementById('custom-alert-title').textContent = title;
    document.getElementById('custom-alert-message').textContent = message;
    modal.classList.remove('hidden');
    
    const btnOk = document.getElementById('custom-alert-ok');
    const closeHandler = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', closeHandler);
    };
    btnOk.addEventListener('click', closeHandler);
}

function showCustomConfirm(title, message, onConfirm) {
    const modal = document.getElementById('custom-confirm-modal');
    if (!modal) {
        if (confirm(message)) onConfirm(); // Fallback
        return;
    }
    document.getElementById('custom-confirm-title').textContent = title;
    document.getElementById('custom-confirm-message').textContent = message;
    modal.classList.remove('hidden');
    
    const btnYes = document.getElementById('custom-confirm-yes');
    const btnNo = document.getElementById('custom-confirm-no');
    
    const cleanup = () => {
        modal.classList.add('hidden');
        btnYes.replaceWith(btnYes.cloneNode(true)); // Remove listeners
        btnNo.replaceWith(btnNo.cloneNode(true));
    };

    // Re-select after clone
    document.getElementById('custom-confirm-yes').addEventListener('click', () => {
        cleanup();
        onConfirm();
    });
    
    document.getElementById('custom-confirm-no').addEventListener('click', () => {
        cleanup();
    });
}

async function kickPlayer(playerId) {
    showCustomConfirm("Exclure le joueur ?", "Voulez-vous vraiment exclure ce joueur de la partie ?", async () => {
        // 1. Récupérer le partyId avant de supprimer (pour refresh)
        // On peut le trouver via currentRoomCode ou via le DOM, mais le plus sûr est de le chercher
        // ou d'utiliser une variable globale si on l'a stockée.
        // Ici on va faire un refresh optimiste en supprimant l'élément du DOM tout de suite
        
        const { error } = await supabaseClient
            .from('joueurs')
            .delete()
            .eq('id', playerId);

        if (error) {
            console.error("Erreur kick:", error);
            showCustomAlert("Erreur", "Impossible d'exclure le joueur.");
        } else {
            // Force refresh immédiat pour l'hôte
            if (currentRoomCode) {
                const { data: party } = await supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single();
                if (party) refreshPlayerList(party.id);
            }
        }
    });
}

// --- REALTIME & JEU ---

function subscribeToRoom(partyId) {
    roomChannel = supabaseClient.channel('room_' + partyId);

    // Enable chat button if hidden
    const btnToggleChat = document.getElementById('btn-toggle-chat');
    if (btnToggleChat) btnToggleChat.classList.remove('hidden');

    roomChannel
        // Écouter les nouveaux joueurs (INSERT), départs (DELETE) et changements de statut/host (UPDATE)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'joueurs', filter: `partie_id=eq.${partyId}` }, (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE' || payload.eventType === 'UPDATE') {
                refreshPlayerList(partyId);

                // Si je suis le joueur supprimé (Kick)
                if (payload.eventType === 'DELETE' && payload.old.id === myPlayerId) {
                    // CRUCIAL: Clear session to prevent auto-rejoin as ghost
                    sessionStorage.clear();
                    
                    showCustomAlert("Exclu", "Vous avez été exclu de la partie.");
                    // Wait for user to click OK or just redirect after delay
                    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
                }
            }
        })
        // Écouter le lancement du jeu ou la fin de manche
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` }, (payload) => {
            if (payload.new.statut === 'en_cours') {
                startGameMultiplayer(payload.new.mot_a_trouver);
            } else if (payload.new.statut === 'fin_manche' && payload.new.fin_round_at) {
                handleRoundEnd(payload.new.fin_round_at);
            } else if (payload.new.statut === 'finished') {
                showEndGameRecap();
            }
        })
        // Écouter les essais des adversaires
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'essais', filter: `partie_id=eq.${partyId}` }, (payload) => {
            if (payload.new.joueur_id !== myPlayerId) {
                handleOpponentGuess(payload.new);
            }
        })
        // Écouter le typing (Broadcast)
        .on('broadcast', { event: 'typing' }, (event) => {
            const payload = event.payload;
            if (payload && payload.id !== myPlayerId) {
                showTypingIndicator(payload);
            }
        })
        // Écouter les mises à jour d'état (typing progress)
        .on('broadcast', { event: 'state_update' }, (event) => {
            // console.log("Reçu state_update:", event); // DEBUG
            const payload = event.payload;
            if (payload && payload.id !== myPlayerId) {
                handleOpponentStateUpdate(payload);
            }
        })
        // Écouter les réactions
        .on('broadcast', { event: 'reaction' }, (event) => {
            const payload = event.payload;
            if (payload && payload.id !== myPlayerId) {
                if (typeof window.showReaction === 'function') {
                    window.showReaction(payload.type, payload.id);
                }
            }
        })
        // Écouter les messages du chat
        .on('broadcast', { event: 'chat_message' }, (event) => {
            const payload = event.payload;
            if (payload && payload.senderId !== myPlayerId) {
                addChatMessage(payload.sender, payload.text, false, payload.isSystem, payload.msgType);
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("Connecté au canal temps réel !");
            }
        });
}

async function launchGame() {
    // Le host lance la partie
    // On récupère l'ID de la partie via le code (ou on le stocke globalement)
    // Pour faire simple, on refait un select ou on stocke l'ID. 
    // Optimisation : stocker partyId globalement.
    // Mais ici on va utiliser le code pour retrouver l'ID si besoin, ou juste update via le code si unique.
    
    await supabaseClient
        .from('parties')
        .update({ statut: 'en_cours' })
        .eq('code', currentRoomCode);
}

function startGameMultiplayer(mot) {
    lastRoundVictory = false;
    
    // 1. Hide End Modal if open
    const endModal = document.getElementById('endModal');
    if (endModal) endModal.classList.add('hidden');

    // 2. Clear local session guesses for this room
    if (currentRoomCode) {
        sessionStorage.removeItem('tusmatch_guesses_' + currentRoomCode);
    }

    // 3. Hide Lobby
    lobbyOverlay.classList.add('hidden');
    
    // 4. Parse Mode from Word (Format: "MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD")
    // Legacy formats: "MODE:WORD" or "MODE:DURATION:WORD"
    let realWord = mot;
    let duration = 30; // Default

    if (mot.includes(':')) {
        const parts = mot.split(':');
        const modePrefix = parts[0].toLowerCase();
        
        if (['preums', 'libre', 'temps'].includes(modePrefix)) {
            selectedGameMode = modePrefix;
        }

        // Check for new format (5 parts)
        if (parts.length >= 5) {
            // MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD
            duration = parseInt(parts[1], 10);
            maxRounds = parts[2]; // 'inf' or number
            currentRound = parseInt(parts[3], 10);
            realWord = parts[4];
            
            currentChronoDuration = duration;
        } 
        // Legacy formats
        else if (modePrefix === 'temps' && parts.length === 3) {
            duration = parseInt(parts[1], 10);
            realWord = parts[2];
            currentChronoDuration = duration;
        } else if (parts.length === 2) {
            realWord = parts[1];
        }
    }

    // Set global duration for game.js
    if (typeof window.setChronoDuration === 'function') {
        window.setChronoDuration(duration);
    }

    // 5. Lancer le jeu avec le mot imposé
    initGame(realWord);
    
    // 6. Update Sidebar Mode Display
    const modeDisplay = document.getElementById('sidebar-game-mode');
    if (modeDisplay) {
        const displayMode = selectedGameMode === 'temps' ? 'CHRONO' : 
                            selectedGameMode === 'preums' ? 'PREMIER' : 
                            selectedGameMode.toUpperCase();
        modeDisplay.textContent = displayMode;
    }

    // Update Sidebar Round Info
    const roundDisplay = document.getElementById('sidebar-round-info');
    if (roundDisplay) {
        const max = (maxRounds === 'inf' || !maxRounds) ? '∞' : maxRounds;
        roundDisplay.textContent = `${currentRound} / ${max}`;
    }
    
    // 7. Initialiser l'interface des adversaires
    setupOpponentsUI();

    // 8. Show Sidebar & Toggle
    const sidebar = document.getElementById('ingame-sidebar');
    if (sidebar) sidebar.classList.remove('hidden');
    
    const btnToggle = document.getElementById('btn-toggle-sidebar');
    if (btnToggle) btnToggle.classList.remove('hidden');

    const btnToggleOpponents = document.getElementById('btn-toggle-opponents');
    if (btnToggleOpponents) btnToggleOpponents.classList.remove('hidden');
    
    // 9. Update list immediately
    if (currentRoomCode) {
        supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single()
            .then(({data}) => {
                if(data) refreshPlayerList(data.id);
            });
    }
}

async function setupOpponentsUI() {
    // Récupérer la liste des autres joueurs
    const { data: players } = await supabaseClient
        .from('parties')
        .select('joueurs(*)')
        .eq('code', currentRoomCode)
        .single();
        
    const opponents = players.joueurs.filter(p => p.id !== myPlayerId);
    
    // Set count class for dynamic sizing
    opponentsContainer.className = ''; // Reset
    opponentsContainer.classList.add(`count-${opponents.length}`);

    opponentsContainer.innerHTML = opponents.map(p => `
        <div class="opponent-card" id="opp-${p.id}">
            <div class="opponent-header" style="display:flex; align-items:center; justify-content:center; gap:5px; margin-bottom:5px;">
                 <img src="${getAvatarUrl(p.pseudo)}" style="width:20px; height:20px; border-radius:50%; object-fit:cover; border:1px solid var(--tile-border);">
                 <div class="opponent-name" style="margin-bottom:0;">${getDisplayName(p.pseudo)}</div>
            </div>
            <div class="mini-grid" id="grid-${p.id}" style="--mini-cols: ${wordLength}">
                ${Array(6).fill(0).map(() => `
                    <div class="mini-row">
                        ${Array(wordLength).fill('<div class="mini-tile"></div>').join('')}
                    </div>
                `).join('')}
            </div>
            <div class="typing-indicator" id="typing-${p.id}"></div>
        </div>
    `).join('');
}

// --- INTERACTION JEU -> MULTI ---

// Appelée par game.js quand le joueur valide une ligne
window.sendMultiplayerGuess = async function(guessPattern, rowIndex) {
    if (!currentRoomCode) return;

    // Retrouver l'ID de la partie (on pourrait le stocker mieux)
    const { data: party } = await supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single();
    
    if (party) {
        await supabaseClient.from('essais').insert({
            partie_id: party.id,
            joueur_id: myPlayerId,
            numero_ligne: rowIndex,
            pattern: guessPattern // ex: "20102"
        });
    }
};

// Appelée par game.js pour le typing
let typingTimeout = null;
function sendTypingSignal() {
    if (typingTimeout) return; // Limiter les envois
    
    roomChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user: myPseudo, id: myPlayerId }
    });

    typingTimeout = setTimeout(() => { typingTimeout = null; }, 2000);
}

// Appelée par game.js pour envoyer l'état (lettres remplies)
let stateTimeout = null;
window.sendMultiplayerState = function(filledCount, rowIndex) {
    if (stateTimeout) clearTimeout(stateTimeout);
    
    // Debounce léger pour éviter de spammer à chaque frappe rapide
    stateTimeout = setTimeout(() => {
        if (roomChannel) {
            const payload = { 
                user: myPseudo,
                id: myPlayerId,
                row: rowIndex,
                filled: filledCount
            };
            // console.log("Sending State Update:", payload); 
            roomChannel.send({
                type: 'broadcast',
                event: 'state_update',
                payload: payload
            });
        }
    }, 50);
};

// --- RECEPTION MULTI -> JEU ---

function handleOpponentStateUpdate(payload) {
    // payload: { user, id, row, filled }
    // console.log("Processing State Update:", payload);

    let card = null;

    // 1. Essayer par ID
    if (payload.id) {
        card = document.getElementById(`opp-${payload.id}`);
    }

    // 2. Fallback par Pseudo
    if (!card && payload.user) {
        const cards = document.querySelectorAll('.opponent-card');
        cards.forEach(c => {
            if (c.querySelector('.opponent-name').textContent === payload.user) {
                card = c;
            }
        });
    }

    if (card) {
        const miniGrid = card.querySelector('.mini-grid');
        // Vérification robuste de la ligne
        const rowIndex = payload.row !== undefined ? payload.row : 0; // Fallback 0 si undefined (ne devrait pas arriver)
        
        if (miniGrid && miniGrid.children[rowIndex]) {
            const row = miniGrid.children[rowIndex];
            const tiles = row.children;
            
            for (let i = 0; i < tiles.length; i++) {
                if (i < payload.filled) {
                    tiles[i].classList.add('filled');
                    tiles[i].style.backgroundColor = "var(--filled-tile)"; // Force style
                    tiles[i].style.borderColor = "var(--filled-tile)";
                } else {
                    tiles[i].classList.remove('filled');
                    tiles[i].style.backgroundColor = ""; // Reset
                    tiles[i].style.borderColor = "";
                }
            }
        } else {
            console.warn("Row not found for index:", rowIndex);
        }
    } else {
        console.warn("Opponent card not found for:", payload);
    }
}

function handleOpponentGuess(essai) {
    // essai contient: joueur_id, numero_ligne, pattern (ex: "20102")
    const gridId = `grid-${essai.joueur_id}`;
    const miniGrid = document.getElementById(gridId);
    
    if (miniGrid) {
        const row = miniGrid.children[essai.numero_ligne];
        const tiles = row.children;
        const pattern = essai.pattern; // string "20102"
        
        for (let i = 0; i < pattern.length; i++) {
            tiles[i].classList.remove('filled'); // Nettoyer l'état de typing
            
            // IMPORTANT: Nettoyer les styles inline forcés par handleOpponentStateUpdate
            tiles[i].style.backgroundColor = "";
            tiles[i].style.borderColor = "";

            const val = pattern[i];
            if (val === '2') tiles[i].classList.add('correct');
            else if (val === '1') tiles[i].classList.add('present');
            else tiles[i].classList.add('absent');
        }
    }

    // --- MODE TEMPS TRIGGER ---
    if (selectedGameMode === 'temps') {
        // If an opponent finishes a line, trigger pressure timer for me
        if (typeof window.triggerPressureTimer === 'function') {
            window.triggerPressureTimer(essai.numero_ligne);
        }
    }
}

function showTypingIndicator(payload) {
    // Trouver l'adversaire par ID
    const card = document.getElementById(`opp-${payload.id}`);
    if (card) {
        const indicator = card.querySelector('.typing-indicator');
        indicator.textContent = "...";
        setTimeout(() => { indicator.textContent = ""; }, 2000);
    }
}

// --- RESTART LOGIC ---

// --- GAME END & RESTART LOGIC ---

// Renamed from handleMultiplayerEnd to separate notification from UI
window.notifyMultiplayerFinish = async function(victory, word, roundScore) {
    if (!myPlayerId || !currentRoomCode) return;

    // SECURITY CHECK: Verify if I am still a valid player in the DB
    // This prevents kicked players from triggering game end
    const { data: meCheck, error: meError } = await supabaseClient
        .from('joueurs')
        .select('id')
        .eq('id', myPlayerId)
        .single();

    if (meError || !meCheck) {
        console.warn("Security Check Failed: Player not found in DB. Aborting victory signal.");
        sessionStorage.clear();
        window.location.href = 'index.html';
        return;
    }

    lastRoundVictory = victory;

    // 1. Update my status in DB
    const updates = {
        a_fini: true
    };
    
    // Fetch current stats to update score
    const { data: me } = await supabaseClient.from('joueurs').select('victoires, score').eq('id', myPlayerId).single();
    if (me) {
        if (victory) {
            updates.victoires = (me.victoires || 0) + 1;
        }
        // Add calculated round score
        updates.score = (me.score || 0) + (roundScore || 0);
    }

    await supabaseClient
        .from('joueurs')
        .update(updates)
        .eq('id', myPlayerId);

    // 2. Trigger Round End Sequence
    // Logic depends on Game Mode
    // "Temps" mode behaves like "Preums" (Race mode)
    const isLibre = (selectedGameMode === 'libre');
    
    // Check if I should trigger the end
    let shouldTriggerEnd = false;
    
    const { data: party } = await supabaseClient.from('parties').select('id, statut').eq('code', currentRoomCode).single();
    if (party) {
        const { data: players } = await supabaseClient.from('joueurs').select('*').eq('partie_id', party.id);
        
        // Note: my status is already updated to true above, so I am included in this check
        const allFinished = players.every(p => p.a_fini);
        const isRoundOver = party.statut === 'fin_manche';

        if (isRoundOver) {
            // Already over, nothing to do here. 
            // The subscription will handle the UI via handleRoundEnd
            return;
        }

        if (isLibre) {
            // Libre: End only if ALL finished
            if (allFinished) {
                shouldTriggerEnd = true;
            }
        } else {
            // Preums OR Temps: End if I won OR if ALL finished
            if (victory || allFinished) {
                shouldTriggerEnd = true;
            }
        }

        if (shouldTriggerEnd) {
            // Increase delay to 10s to allow for animations (approx 4-5s) + reading time (5s)
            const finTime = new Date(Date.now() + 10000).toISOString();
            await supabaseClient
                .from('parties')
                .update({ 
                    statut: 'fin_manche',
                    fin_round_at: finTime
                })
                .eq('id', party.id);
            
            // We do NOT call showEndScreen here anymore.
            // We wait for the subscription to 'fin_manche' to trigger handleRoundEnd
        }
    }
};

// Kept for backward compatibility if needed, but game.js now calls notifyMultiplayerFinish
window.handleMultiplayerEnd = window.notifyMultiplayerFinish; 


window.triggerMultiplayerRestart = async function() {
    // This function is now called automatically by the host client when timer ends
    // But we keep the check just in case
    if (!isHost) return; 
    
    // Check Max Rounds
    if (maxRounds !== 'inf' && currentRound >= parseInt(maxRounds)) {
        // Game Over
        const { data: party } = await supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single();
        if (party) {
            await supabaseClient
                .from('parties')
                .update({ statut: 'finished' })
                .eq('id', party.id);
        }
        return;
    }

    // Increment Round
    currentRound++;

    const btn = document.getElementById('restartBtn');
    if(btn) btn.textContent = "Lancement...";

    // Choisir un nouveau mot
    if (typeof COMMON_WORDS === 'undefined' || COMMON_WORDS.length === 0) await loadDictionaries();
    const rawMot = COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)];
    
    // Prefix with current mode
    const modePrefix = (selectedGameMode || 'preums').toUpperCase();
    
    let duration = 0;
    if (selectedGameMode === 'temps') {
        duration = currentChronoDuration || 30;
    }

    // Format: MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD
    let mot = `${modePrefix}:${duration}:${maxRounds}:${currentRound}:${rawMot}`;
    
    // Retrouver l'ID de la partie
    const { data: party } = await supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single();
    
    if (party) {
        // 1. Reset all players status
        await supabaseClient
            .from('joueurs')
            .update({ a_fini: false })
            .eq('partie_id', party.id);

        // 2. Supprimer les anciens essais
        await supabaseClient.from('essais').delete().eq('partie_id', party.id);
        
        // 3. Mettre à jour la partie (ce qui va trigger le restart chez tout le monde)
        await supabaseClient
            .from('parties')
            .update({ 
                mot_a_trouver: mot,
                statut: 'en_cours', 
                fin_round_at: null 
            })
            .eq('id', party.id);
    }
};

// --- LEAVE GAME LOGIC ---

async function leaveGame() {
    if (!currentRoomCode) {
        // Si pas en partie, retour simple
        window.location.href = 'index.html';
        return;
    }

    // Confirmation handled by Modal now
    // if (!confirm("Voulez-vous vraiment quitter la partie ?")) return;

    try {
        // 1. Récupérer la partie et les joueurs
        const { data: party } = await supabaseClient
            .from('parties')
            .select('id, joueurs(*)')
            .eq('code', currentRoomCode)
            .single();

        if (party) {
            const players = party.joueurs;
            const remainingPlayers = players.filter(p => p.id !== myPlayerId);

            // 2. Si je suis le dernier joueur -> Supprimer la partie
            if (remainingPlayers.length === 0) {
                await supabaseClient.from('parties').delete().eq('id', party.id);
            } else {
                // 3. Si je suis l'hôte -> Transférer la couronne
                if (isHost) {
                    const newHost = remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)];
                    await supabaseClient
                        .from('joueurs')
                        .update({ est_host: true })
                        .eq('id', newHost.id);
                }

                // 4. Me supprimer de la liste des joueurs
                await supabaseClient.from('joueurs').delete().eq('id', myPlayerId);
            }
        }
    } catch (e) {
        console.error("Erreur lors du départ:", e);
    }

    // Clear Session to prevent auto-rejoin
    sessionStorage.removeItem('tusmatch_room');
    // sessionStorage.removeItem('tusmatch_pseudo'); // On peut garder le pseudo pour la prochaine fois
    sessionStorage.removeItem('tusmatch_is_host');
    sessionStorage.removeItem('tusmatch_player_id');
    if (currentRoomCode) {
        sessionStorage.removeItem('tusmatch_guesses_' + currentRoomCode);
    }

    // 5. Redirection
    window.location.href = 'index.html';
}

// --- NEW UI FUNCTIONS (APPENDED) ---

function updateIngamePlayerList(players) {
    const list = document.getElementById('ingame-players-content');
    if (!list) return;

    // Update Room Code in Sidebar
    const codeDisplay = document.getElementById('sidebar-room-code');
    if (codeDisplay && currentRoomCode) {
        codeDisplay.textContent = currentRoomCode;
    }

    // Sort by score descending for ranking
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

    // Sécurité Host
    if (sessionStorage.getItem('tusmatch_is_host') === 'true') {
        isHost = true;
    }

    list.innerHTML = sortedPlayers.map((p, index) => {
        const isMe = p.id === myPlayerId;
        const isTargetHost = p.est_host;
        const avatarUrl = getAvatarUrl(p.pseudo);
        const displayName = getDisplayName(p.pseudo);
        
        const hostIcon = isTargetHost ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>` : '';
        
        const statusIcon = p.a_fini 
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` 
            : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`;
            
        const score = p.score || 0;
        
        // Ranking Logic
        const rank = index + 1;
        let rankColor = '#666'; // Default Grey
        if (rank === 1) rankColor = '#FFD700'; // Gold
        if (rank === 2) rankColor = '#C0C0C0'; // Silver
        if (rank === 3) rankColor = '#CD7F32'; // Bronze

        // Kick Button Logic
        let kickBtn = '';
        const amIHost = (isHost === true || isHost === 'true');
        
        if (amIHost && !isTargetHost) {
             kickBtn = `
                <button class="btn-kick" data-id="${p.id}" title="Exclure" style="pointer-events: auto; margin-left: auto;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </button>`;
        }
        
        return `
            <div class="ingame-player-card ${isMe ? 'is-me' : ''}" style="position: relative; padding-right: ${kickBtn ? '40px' : '10px'};">
                <div style="color:${rankColor}; font-weight:bold; margin-right:8px; min-width:20px; font-size:0.9rem;">#${rank}</div>
                <img src="${avatarUrl}" class="ingame-player-avatar-img">
                <div class="ingame-player-info" style="flex: 1; min-width: 0;">
                    <div class="ingame-player-name" style="display: flex; align-items: center; gap: 5px;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</span> 
                        ${hostIcon}
                    </div>
                    <div class="ingame-player-status">
                        ${isMe ? '<span style="font-size:0.8em; opacity:0.7; margin-right:4px;">(Moi)</span>' : ''} 
                        ${statusIcon} 
                        <span style="margin-left:4px; font-weight:bold;">${score}pts</span>
                    </div>
                </div>
                ${kickBtn ? `<div style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); z-index: 10;">${kickBtn}</div>` : ''}
            </div>
        `;
    }).join('');

    // Add Listeners
    list.querySelectorAll('.btn-kick').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent card click if any
            const targetBtn = e.target.closest('.btn-kick');
            if (targetBtn) {
                const playerId = targetBtn.dataset.id;
                kickPlayer(playerId);
            }
        });
    });
}

// Override refreshPlayerList to update both lists
window.refreshPlayerList = async function(partyId) {
    const { data: players } = await supabaseClient
        .from('joueurs')
        .select('*')
        .eq('partie_id', partyId);
    
    if (players) {
        playerCount = players.length;

        // Host Transfer Logic
        const hasHost = players.some(p => p.est_host);
        if (!hasHost && players.length > 0) {
            // If no host, and I am the first one in the list, I claim host.
            // We sort by created_at to be deterministic if possible, but here we trust the array order (usually insertion order)
            // or we can just check if I am the first one.
            if (players[0].id === myPlayerId) {
                console.log("No host found. Claiming host status...");
                await supabaseClient
                    .from('joueurs')
                    .update({ est_host: true })
                    .eq('id', myPlayerId);
                isHost = true;
                sessionStorage.setItem('tusmatch_is_host', 'true');
            }
        }

        updatePlayerListUI(players);
        updateIngamePlayerList(players);
        
        // NEW: Sync Opponents Grids (Remove kicked players immediately)
        syncOpponentsGrids(players);
    }
};

function syncOpponentsGrids(players) {
    const container = document.getElementById('opponents-container');
    if (!container) return;

    // 1. Remove kicked players (Cards in DOM but not in DB list)
    const existingCards = container.querySelectorAll('.opponent-card');
    existingCards.forEach(card => {
        const id = card.id.replace('opp-', '');
        const playerExists = players.find(p => p.id === id);
        
        // If player is gone OR it's me (shouldn't be there anyway but safety check)
        if (!playerExists || id === myPlayerId) {
            card.remove();
        }
    });

    // 2. Update container count class for sizing
    const opponentCount = players.filter(p => p.id !== myPlayerId).length;
    
    // Remove old count classes
    container.classList.forEach(cls => {
        if (cls.startsWith('count-')) container.classList.remove(cls);
    });
    // Add new count class
    container.classList.add(`count-${opponentCount}`);
    
    // (Optional) We could add new players here too, but setupOpponentsUI handles init.
    // If we want to support mid-game joiners fully, we would add them here.
}

// --- CLEANUP ON CLOSE ---
/* 
// Désactivé pour permettre le refresh sans perdre la session.
// Le nettoyage se fait uniquement via le bouton "Quitter" (leaveGame).
window.addEventListener('beforeunload', () => {
    if (myPlayerId) {
        // 1. Delete Player
        const headers = {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        };

        // Delete player using keepalive
        fetch(`${supabaseUrl}/rest/v1/joueurs?id=eq.${myPlayerId}`, {
            method: 'DELETE',
            headers: headers,
            keepalive: true
        });

        // 2. If I am the last player (locally known), try to delete the party
        if (playerCount <= 1 && currentRoomCode) {
             fetch(`${supabaseUrl}/rest/v1/parties?code=eq.${currentRoomCode}`, {
                method: 'DELETE',
                headers: headers,
                keepalive: true
            });
        }
    }
});
*/



// --- EVENT LISTENERS FIX ---
document.addEventListener('DOMContentLoaded', () => {
    // Fix for Leave Modal
    const btnLeave = document.getElementById('btn-leave-game');
    if (btnLeave) {
        const newBtn = btnLeave.cloneNode(true);
        btnLeave.parentNode.replaceChild(newBtn, btnLeave);
        
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLeaveModal();
        });
    }

    const confirmLeave = document.getElementById('confirm-leave');
    if (confirmLeave) confirmLeave.addEventListener('click', confirmLeaveGame);
    
    const cancelLeave = document.getElementById('cancel-leave');
    if (cancelLeave) cancelLeave.addEventListener('click', closeLeaveModal);

    // Fix for Share Buttons (Sidebar)
    setupShareButtons('sidebar-share-link', 'sidebar-copy-code');
    // Also keep lobby buttons working
    setupShareButtons('btn-share-link', 'btn-copy-code');

    // Sidebar Toggle Logic
    const btnToggle = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('ingame-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    // New Opponents Toggle
    const btnToggleOpponents = document.getElementById('btn-toggle-opponents');

    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('visible');
        });
    }
    
    if (btnToggleOpponents) {
        // Note: Visibility is handled by startGameMultiplayer / leaveGame
        
        btnToggleOpponents.addEventListener('click', () => {
            document.body.classList.toggle('opponents-open');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        });
    }
});

function openLeaveModal() {
    const modal = document.getElementById('leave-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeLeaveModal() {
    const modal = document.getElementById('leave-modal');
    if (modal) modal.classList.add('hidden');
}

function confirmLeaveGame() {
    closeLeaveModal();
    leaveGame();
}

function setupShareButtons(linkBtnId, codeBtnId) {
    const btnShare = document.getElementById(linkBtnId);
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            if (currentRoomCode) {
                const url = `${window.location.origin}${window.location.pathname}?mode=private&code=${currentRoomCode}`;
                navigator.clipboard.writeText(url).then(() => {
                    // Bounce animation
                    btnShare.classList.add('bounce');
                    setTimeout(() => btnShare.classList.remove('bounce'), 500);
                });
            }
        });
    }

    const btnCopyCode = document.getElementById(codeBtnId);
    if (btnCopyCode) {
        btnCopyCode.addEventListener('click', () => {
            if (currentRoomCode) {
                navigator.clipboard.writeText(currentRoomCode).then(() => {
                    // Bounce animation
                    btnCopyCode.classList.add('bounce');
                    setTimeout(() => btnCopyCode.classList.remove('bounce'), 500);
                });
            }
        });
    }
}

// --- ANIMATED PLACEHOLDERS (TYPEWRITER EFFECT) ---
document.addEventListener('DOMContentLoaded', () => {
    const pseudoInput = document.getElementById('player-pseudo');
    const codeInput = document.getElementById('lobby-code-input');
    
    if (pseudoInput && codeInput) {
        const pseudos = ['COOLKID67', 'WORDSLAYER', 'TUSMASTER', 'WORDLE_KING', 'GUESS_WHO', 'ALPHA_WOLF', 'NINJA_WORD'];
        // Codes réalistes (Alphanumérique 4 chars, sans 0/O)
        const codes = ['XJ9K', 'A7B2', 'K9L1', 'P4R5', '9X2Y', 'M3G4', 'Q8W7', 'Z1X2'];
        
        animateInputPlaceholder(pseudoInput, pseudos, '');
        animateInputPlaceholder(codeInput, codes, '');
    }
});

function animateInputPlaceholder(input, texts, prefix = '') {
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let currentFullText = prefix + texts[0];

    function type() {
        // Définir le texte cible actuel
        const targetText = prefix + texts[textIndex];
        
        if (isDeleting) {
            // Suppression
            currentFullText = targetText.substring(0, charIndex);
            charIndex--;
        } else {
            // Écriture
            currentFullText = targetText.substring(0, charIndex + 1);
            charIndex++;
        }

        input.setAttribute('placeholder', currentFullText);

        let typeSpeed = 100; // Vitesse de frappe normale

        if (!isDeleting && charIndex === targetText.length) {
            // Fin du mot : Pause longue avant d'effacer
            typeSpeed = 2000;
            isDeleting = true;
        } else if (isDeleting && charIndex < prefix.length) {
            // Fin de suppression (on a gardé le préfixe ou tout effacé)
            // Ici on efface jusqu'à la fin du préfixe pour garder "Ex: " ? 
            // Non, effaçons tout pour réécrire "Ex: NouveauMot" proprement ou juste le mot.
            // Simplification : on efface jusqu'au préfixe.
            isDeleting = false;
            textIndex = (textIndex + 1) % texts.length;
            typeSpeed = 500;
            // Reset charIndex pour recommencer à écrire après le préfixe
            charIndex = prefix.length; 
        } else if (isDeleting) {
            typeSpeed = 50; // Vitesse d'effacement rapide
        }

        setTimeout(type, typeSpeed);
    }

    // Initialiser charIndex à la longueur du préfixe pour commencer à écrire le mot direct
    charIndex = prefix.length;
    input.setAttribute('placeholder', prefix);
    setTimeout(type, 500);
}

// --- SESSION RESTORATION LOGIC ---

async function rejoinSession(code, playerId) {
    console.log("Restoring session for room:", code);
    
    // Hide lobby immediately to prevent flickering
    if (lobbyOverlay) lobbyOverlay.classList.add('hidden');
    
    currentRoomCode = code;
    // myPlayerId = playerId; // Don't set it yet, verify first
    myPseudo = sessionStorage.getItem('tusmatch_pseudo');
    isHost = sessionStorage.getItem('tusmatch_is_host') === 'true'; // Restore host status immediately
    
    try {
        // Fetch party details to get the word and status
        const { data: party, error } = await supabaseClient
            .from('parties')
            .select('*')
            .eq('code', code)
            .single();
            
        if (error || !party) {
            console.error("Session invalid or party ended");
            sessionStorage.clear();
            if (lobbyOverlay) lobbyOverlay.classList.remove('hidden');
            return;
        }

        // Verify if player exists
        const { data: player } = await supabaseClient
            .from('joueurs')
            .select('*')
            .eq('id', playerId)
            .single();

        if (!player) {
            console.log("Player not found in DB (maybe kicked or deleted). Clearing session.");
            // Si le joueur n'existe plus en base, c'est qu'il a été kické ou que la DB a été nettoyée.
            // On ne doit PAS le recréer automatiquement, sinon le kick ne sert à rien (il revient en fantôme).
            sessionStorage.clear();
            showCustomAlert("Session Expirée", "Vous n'êtes plus dans la partie (Exclu ou session expirée).");
            setTimeout(() => { window.location.href = 'index.html'; }, 2000);
            return;
        } else {
            // Player exists
            myPlayerId = player.id;
            isHost = player.est_host;
            sessionStorage.setItem('tusmatch_is_host', isHost);
        }
        
        // Re-subscribe to realtime events
        subscribeToRoom(party.id);
        
        // Restore Game State
        if (typeof initGame === 'function') {
            // Initialize game with the correct word (handling mode prefix)
            let word = party.mot_a_trouver;
            if (word.includes(':')) {
                const parts = word.split(':');
                const modePrefix = parts[0].toLowerCase();
                if (['preums', 'libre', 'temps'].includes(modePrefix)) {
                    selectedGameMode = modePrefix;
                }
                
                if (parts.length >= 5) {
                    // MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD
                    currentChronoDuration = parseInt(parts[1], 10);
                    maxRounds = parts[2];
                    currentRound = parseInt(parts[3], 10);
                    word = parts[4];
                    
                    if (typeof window.setChronoDuration === 'function') {
                        window.setChronoDuration(currentChronoDuration);
                    }
                } else if (modePrefix === 'temps' && parts.length === 3) {
                    currentChronoDuration = parseInt(parts[1], 10);
                    word = parts[2];
                    if (typeof window.setChronoDuration === 'function') {
                        window.setChronoDuration(currentChronoDuration);
                    }
                } else {
                    word = parts[1];
                }
            }
            
            await initGame(word);
            
            // Update Sidebar Mode Display
            const modeDisplay = document.getElementById('sidebar-game-mode');
            if (modeDisplay) {
                const displayMode = selectedGameMode === 'temps' ? 'CHRONO' : 
                                    selectedGameMode === 'preums' ? 'PREMIER' : 
                                    (selectedGameMode || 'PREMIER').toUpperCase();
                modeDisplay.textContent = displayMode;
            }

            // Update Sidebar Round Info
            const roundDisplay = document.getElementById('sidebar-round-info');
            if (roundDisplay) {
                const max = (maxRounds === 'inf' || !maxRounds) ? '∞' : maxRounds;
                roundDisplay.textContent = `${currentRound} / ${max}`;
            }
            
            // Restore guesses from session storage
            if (typeof window.loadGuessesFromSession === 'function') {
                window.loadGuessesFromSession();
            }
        }
        
        // Restore UI based on game status
        if (party.statut === 'attente') {
             showWaitingRoom(code);
             if (lobbyOverlay) lobbyOverlay.classList.remove('hidden');
        } else {
            // Game is running
            if (lobbyOverlay) lobbyOverlay.classList.add('hidden');
            
            // Show Sidebar and Opponents
            setupOpponentsUI();
            const sidebar = document.getElementById('ingame-sidebar');
            if (sidebar) sidebar.classList.remove('hidden');
            
            // Show Toggle Button
            const btnToggle = document.getElementById('btn-toggle-sidebar');
            if (btnToggle) btnToggle.classList.remove('hidden');

            const btnToggleOpponents = document.getElementById('btn-toggle-opponents');
            if (btnToggleOpponents) btnToggleOpponents.classList.remove('hidden');
            
            // Refresh player list
            refreshPlayerList(party.id);
        }
        
    } catch (e) {
        console.error("Error rejoining session:", e);
        sessionStorage.clear();
        if (lobbyOverlay) lobbyOverlay.classList.remove('hidden');
    }
}

// --- AVATAR HELPER ---
function getDisplayName(pseudo) {
    if (!pseudo) return "Joueur";
    return pseudo.split('|')[0];
}

window.getAvatarUrl = function(pseudoString) {
    if (!pseudoString) return 'assets/1.gif';
    
    // Check for composite pseudo "Name|AvatarID"
    if (pseudoString.includes('|')) {
        const parts = pseudoString.split('|');
        const avatarId = parseInt(parts[1]);
        if (!isNaN(avatarId) && avatarId >= 1 && avatarId <= 12) {
            return `assets/${avatarId}.gif`;
        }
        // Fallback to name part if ID is invalid
        pseudoString = parts[0];
    }

    // Simple hash to get a consistent number between 1 and 12
    let hash = 0;
    for (let i = 0; i < pseudoString.length; i++) {
        hash = pseudoString.charCodeAt(i) + ((hash << 5) - hash);
    }
    const num = (Math.abs(hash) % 12) + 1;
    return `assets/${num}.gif`;
};

const getAvatarUrl = window.getAvatarUrl;

// --- ROUND END TIMER LOGIC ---

let roundTimerInterval = null;

async function handleRoundEnd(finRoundAt) {
    // 1. Fetch players for scoreboard (Initial fetch)
    const { data: party } = await supabaseClient.from('parties').select('id, mot_a_trouver').eq('code', currentRoomCode).single();
    if (!party) return;

    const { data: players } = await supabaseClient
        .from('joueurs')
        .select('*')
        .eq('partie_id', party.id);

    // Helper to show screen
    const proceedToShowScreen = async () => {
        // Calculate my score based on LAST VALID GUESS
        let myScore = 0;
        if (typeof window.calculateScore === 'function' && typeof guesses !== 'undefined' && typeof targetWord !== 'undefined') {
             let lastGuess = "";
             // Use helper if available
             if (typeof window.getLastValidGuess === 'function') {
                 const valid = window.getLastValidGuess();
                 if (valid) lastGuess = valid.word;
             } else {
                 lastGuess = guesses.length > 0 ? guesses[guesses.length - 1] : "";
             }
             
             myScore = window.calculateScore(lastRoundVictory, guesses.length, lastGuess);
        }

        // CRITICAL: If I am the loser (and haven't updated DB), I need to update my score in DB now.
        const me = players.find(p => p.id === myPlayerId);
        if (me && !me.a_fini) {
             await supabaseClient.from('joueurs').update({ 
                 score: (me.score || 0) + myScore,
                 a_fini: true 
             }).eq('id', myPlayerId);
        }

        // --- SYNC BARRIER START ---
        
        // 1. Show "Waiting" Screen immediately
        if (typeof showEndScreen === 'function') {
            // Pass null as word to trigger "Waiting" state
            showEndScreen(lastRoundVictory, null, players, myScore);
        }

        // 2. Send "ANIMATION_DONE" Signal
        await supabaseClient.from('essais').insert({
            partie_id: party.id,
            joueur_id: myPlayerId,
            numero_ligne: 99,
            pattern: 'ANIMATION_DONE'
        });

        // 3. Wait for ALL players to finish animation
        const checkSync = setInterval(async () => {
            // Safety: If time is up, force proceed
            const now = new Date().getTime();
            const end = new Date(finRoundAt).getTime();
            
            // Count signals
            const { count: signalCount } = await supabaseClient
                .from('essais')
                .select('*', { count: 'exact', head: true })
                .eq('partie_id', party.id)
                .eq('pattern', 'ANIMATION_DONE');
            
            // Count current players
            const { count: currentTotalPlayers } = await supabaseClient
                .from('joueurs')
                .select('*', { count: 'exact', head: true })
                .eq('partie_id', party.id);

            // Proceed if all ready OR timeout reached
            if ((signalCount >= currentTotalPlayers) || (now >= end)) {
                clearInterval(checkSync);
                
                // 4. Fetch Final Scores (Everyone should be updated now)
                const { data: finalPlayers } = await supabaseClient
                    .from('joueurs')
                    .select('*')
                    .eq('partie_id', party.id);

                // 5. Show FINAL Screen
                if (typeof showEndScreen === 'function') {
                    const victory = lastRoundVictory; 
                    let displayWord = party.mot_a_trouver;
                    if (displayWord && displayWord.includes(':')) {
                        const parts = displayWord.split(':');
                        // Handle new format: MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD
                        if (parts.length >= 5) {
                            displayWord = parts[4];
                        } else {
                            // Handle legacy formats
                            displayWord = parts.length === 3 ? parts[2] : parts[1];
                        }
                    }
                    showEndScreen(victory, displayWord, finalPlayers, myScore);
                }
                
                // 6. Start Countdown Logic
                const btn = document.getElementById('restartBtn');
                if (btn) {
                    btn.disabled = true;
                    btn.classList.add('btn-disabled');
                }
            
                if (roundTimerInterval) clearInterval(roundTimerInterval);
            
                roundTimerInterval = setInterval(() => {
                    const nowLoop = new Date().getTime();
                    const endLoop = new Date(finRoundAt).getTime();
                    const diff = endLoop - nowLoop;
            
                    if (diff <= 0) {
                        clearInterval(roundTimerInterval);
                        if (btn) btn.textContent = "Lancement...";
                        if (isHost) triggerMultiplayerRestart();
                    } else {
                        const seconds = Math.ceil(diff / 1000);
                        if (btn) btn.textContent = `Prochaine manche dans ${seconds}s...`;
                    }
                }, 1000);
            }
        }, 1000); // Check every 1s
        // --- SYNC BARRIER END ---
    };

    // 2. Trigger Animation if needed
    if (window.isScoringAnimationPlaying) {
        // I am the winner (or finished naturally just now)
        // Wait for animation to finish
        const checkAnim = setInterval(() => {
            if (!window.isScoringAnimationPlaying) {
                clearInterval(checkAnim);
                proceedToShowScreen();
            }
        }, 100);
    } else if (!lastRoundVictory && typeof window.forceEndRoundAnimation === 'function') {
        // I am the loser (or finished long ago?)
        // Force animation
        window.forceEndRoundAnimation(() => {
            proceedToShowScreen();
        });
    } else {
        // Fallback
        proceedToShowScreen();
    }
}

// --- REACTIONS LOGIC ---

// --- REACTIONS LOGIC ---

const REACTION_SVGS = {
    happy: `<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="16" r="14" fill="#FFD93D"/><circle cx="10" cy="14" r="2" fill="#5C3D2E"/><circle cx="22" cy="14" r="2" fill="#5C3D2E"/><path d="M10 20 Q16 26 22 20" stroke="#5C3D2E" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="7" cy="18" r="1.5" fill="#FF8B8B" opacity="0.6"/><circle cx="25" cy="18" r="1.5" fill="#FF8B8B" opacity="0.6"/></svg>`,
    sad: `<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="16" r="14" fill="#89CFF0"/><path d="M9 14 Q11 12 13 14" stroke="#1A5F7A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 14 Q21 12 23 14" stroke="#1A5F7A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 22 Q16 18 20 22" stroke="#1A5F7A" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="23" cy="18" r="1.5" fill="#4FA3D1"/></svg>`,
    angry: `<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="16" r="14" fill="#FF6B6B"/><path d="M9 13 L13 15" stroke="#8B0000" stroke-width="2" stroke-linecap="round"/><path d="M23 13 L19 15" stroke="#8B0000" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="17" r="1.5" fill="#8B0000"/><circle cx="21" cy="17" r="1.5" fill="#8B0000"/><path d="M13 22 H19" stroke="#8B0000" stroke-width="2" stroke-linecap="round"/></svg>`,
    surprised: `<svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="16" r="14" fill="#C780FA"/><circle cx="10" cy="14" r="2" fill="#4A148C"/><circle cx="22" cy="14" r="2" fill="#4A148C"/><ellipse cx="16" cy="22" rx="3" ry="4" fill="#4A148C"/><path d="M8 10 Q10 8 12 10" stroke="#4A148C" stroke-width="1" fill="none"/><path d="M20 10 Q22 8 24 10" stroke="#4A148C" stroke-width="1" fill="none"/></svg>`
};

window.sendReaction = function(type) {
    if (!roomChannel) return;
    
    if (!REACTION_SVGS[type]) return;

    // Send as chat message with type 'reaction'
    roomChannel.send({
        type: 'broadcast',
        event: 'chat_message',
        payload: {
            senderId: myPlayerId,
            sender: myPseudo,
            text: type, // Send the key (e.g., 'happy')
            isSystem: false,
            msgType: 'reaction' // New field to identify reactions
        }
    });

    // Add locally
    addChatMessage(myPseudo, type, true, false, 'reaction');
};

// Deprecated: showReaction (removed floating logic)
window.showReaction = function(type, playerId) {
    // No-op: Reactions are now chat messages
};

// --- CHAT SYSTEM ---

function initChat() {
    const chatPanel = document.getElementById('chat-panel');
    const btnToggleChat = document.getElementById('btn-toggle-chat');
    const btnSendChat = document.getElementById('btn-send-chat');
    const chatInput = document.getElementById('chat-input-field');
    const btnCloseChat = document.getElementById('btn-close-chat');

    if (!chatPanel || !btnToggleChat) return;

    // Toggle Chat
    btnToggleChat.addEventListener('click', () => {
        toggleChat();
    });

    // Close Chat Button
    if (btnCloseChat) {
        btnCloseChat.addEventListener('click', () => {
            toggleChat();
        });
    }

    // Send Message
    btnSendChat.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    // Show toggle button
    btnToggleChat.classList.remove('hidden');
    
    // Ensure button is above lobby
    btnToggleChat.style.zIndex = '2500';
}

function toggleChat() {
    const chatPanel = document.getElementById('chat-panel');
    const btnToggleChat = document.getElementById('btn-toggle-chat');
    
    chatPanel.classList.toggle('hidden');
    
    if (!chatPanel.classList.contains('hidden')) {
        // Chat opened
        btnToggleChat.classList.remove('has-unread');
        // Focus input
        setTimeout(() => document.getElementById('chat-input-field').focus(), 100);
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input-field');
    const text = chatInput.value.trim();
    
    if (!text) return;
    if (!roomChannel) return;

    // Send Broadcast
    roomChannel.send({
        type: 'broadcast',
        event: 'chat_message',
        payload: {
            senderId: myPlayerId,
            sender: myPseudo,
            text: text,
            isSystem: false
        }
    });

    // Add locally
    addChatMessage(myPseudo, text, true);
    
    // Clear input
    chatInput.value = '';
}

function addChatMessage(sender, text, isSelf = false, isSystem = false, msgType = 'text') {
    const chatMessages = document.getElementById('chat-messages');
    const btnToggleChat = document.getElementById('btn-toggle-chat');
    const chatPanel = document.getElementById('chat-panel');

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';
    if (isSelf) msgDiv.classList.add('self');
    if (isSystem) msgDiv.classList.add('system');

    if (isSystem) {
        msgDiv.textContent = text;
    } else if (msgType === 'reaction') {
        // Render SVG Reaction
        const strong = document.createElement('strong');
        strong.textContent = isSelf ? 'Moi' : sender;
        msgDiv.appendChild(strong);

        const reactionContainer = document.createElement('div');
        reactionContainer.style.width = '40px';
        reactionContainer.style.height = '40px';
        reactionContainer.innerHTML = REACTION_SVGS[text] || '❓';
        msgDiv.appendChild(reactionContainer);
        
        // Make message background transparent for reactions if desired, or keep bubble
        msgDiv.style.display = 'flex';
        msgDiv.style.flexDirection = 'column';
        msgDiv.style.alignItems = isSelf ? 'flex-end' : 'flex-start';
    } else {
        const strong = document.createElement('strong');
        strong.textContent = isSelf ? 'Moi' : sender;
        msgDiv.appendChild(strong);
        
        const span = document.createElement('span');
        span.textContent = text;
        msgDiv.appendChild(span);
    }

    chatMessages.appendChild(msgDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Notification if chat is closed and message is not from me
    if (!isSelf && chatPanel.classList.contains('hidden')) {
        btnToggleChat.classList.add('has-unread');
    }
}

// --- END GAME RECAP ---

async function showEndGameRecap() {
    const modal = document.getElementById('end-game-modal');
    const scoreboard = document.getElementById('final-scoreboard');
    const hostActions = document.getElementById('host-actions');
    const clientMsg = document.getElementById('client-waiting-msg');
    
    if (!modal || !scoreboard) return;

    // 1. Fetch final scores
    const { data: party } = await supabaseClient
        .from('parties')
        .select('joueurs(*)')
        .eq('code', currentRoomCode)
        .single();

    if (!party) return;

    const players = party.joueurs.sort((a, b) => (b.score || 0) - (a.score || 0));

    // 2. Build Scoreboard HTML
    let html = '';
    players.forEach((p, index) => {
        const rank = index + 1;
        let rankColor = '#666';
        let medal = '';
        if (rank === 1) { rankColor = '#FFD700'; medal = '🥇'; }
        if (rank === 2) { rankColor = '#C0C0C0'; medal = '🥈'; }
        if (rank === 3) { rankColor = '#CD7F32'; medal = '🥉'; }

        const avatarUrl = getAvatarUrl(p.pseudo);
        const displayName = getDisplayName(p.pseudo);

        html += `
            <div style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid var(--tile-border); background: ${p.id === myPlayerId ? 'rgba(255,255,255,0.1)' : 'transparent'};">
                <div style="font-size: 1.5rem; width: 40px; text-align: center; color: ${rankColor};">${medal || rank}</div>
                <img src="${avatarUrl}" style="width: 40px; height: 40px; border-radius: 50%; margin: 0 15px; border: 2px solid ${rankColor};">
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 1.1rem;">${displayName}</div>
                    <div style="font-size: 0.9rem; opacity: 0.7;">${p.score || 0} pts</div>
                </div>
            </div>
        `;
    });

    scoreboard.innerHTML = html;

    // --- UPDATE STATS ---
    // Find my player data
    const myData = players.find(p => p.id === myPlayerId);
    if (myData) {
        const myRank = players.indexOf(myData) + 1;
        const isWinner = (myRank === 1);
        // We need total rounds played. 
        // We can estimate it from currentRound global variable if available, or just increment by 1 match played.
        // The user asked for "moyenne des points par manche".
        // So we need to know how many rounds were played in this match.
        // currentRound holds the current round number.
        
        if (typeof updateMultiplayerStats === 'function') {
            updateMultiplayerStats(isWinner, myData.score || 0, currentRound);
        }
    }

    // 3. Show Actions based on role
    if (isHost) {
        hostActions.classList.remove('hidden');
        clientMsg.classList.add('hidden');
    } else {
        hostActions.classList.add('hidden');
        clientMsg.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
}

// Replay Logic
document.addEventListener('DOMContentLoaded', () => {
    // Replay Round Slider Logic
    const replaySlider = document.getElementById('rounds-slider-replay');
    const replayValue = document.getElementById('rounds-value-replay');
    if (replaySlider && replayValue) {
        const updateReplayRounds = () => {
            const val = parseInt(replaySlider.value);
            replayValue.textContent = val >= 21 ? '∞' : val;
        };
        replaySlider.addEventListener('input', updateReplayRounds);
        // Init
        updateReplayRounds();
    }

    // Replay Button
    const btnReplay = document.getElementById('btn-replay-game');
    if (btnReplay) {
        btnReplay.addEventListener('click', async () => {
            if (!isHost) return;
            
            btnReplay.disabled = true;
            btnReplay.textContent = "Relancement...";

            // Get selected rounds
            let newMaxRounds = 'inf';
            if (replaySlider) {
                const val = parseInt(replaySlider.value);
                newMaxRounds = val >= 21 ? 'inf' : val;
            }
            
            // Reset Game
            await resetGameForReplay(newMaxRounds);
            
            // Hide Modal
            document.getElementById('end-game-modal').classList.add('hidden');
            btnReplay.disabled = false;
            btnReplay.textContent = "Rejouer avec ces paramètres";
        });
    }

    // Leave Final Button
    const btnLeaveFinal = document.getElementById('btn-leave-final');
    if (btnLeaveFinal) {
        btnLeaveFinal.addEventListener('click', () => {
            leaveGame();
        });
    }
});

async function resetGameForReplay(newMaxRounds) {
    // 1. Reset Scores
    const { data: party } = await supabaseClient.from('parties').select('id').eq('code', currentRoomCode).single();
    if (!party) return;

    await supabaseClient.from('joueurs').update({ score: 0, a_fini: false }).eq('partie_id', party.id);
    await supabaseClient.from('essais').delete().eq('partie_id', party.id);

    // 2. Generate New Word
    if (typeof COMMON_WORDS === 'undefined' || COMMON_WORDS.length === 0) await loadDictionaries();
    const rawMot = COMMON_WORDS[Math.floor(Math.random() * COMMON_WORDS.length)];
    
    const modePrefix = (selectedGameMode || 'preums').toUpperCase();
    let duration = 0;
    if (selectedGameMode === 'temps') {
        duration = currentChronoDuration || 30;
    }

    // Reset Round Count
    currentRound = 1;
    maxRounds = newMaxRounds;

    // Format: MODE:DURATION:MAX_ROUNDS:CURRENT_ROUND:WORD
    let mot = `${modePrefix}:${duration}:${maxRounds}:${currentRound}:${rawMot}`;

    // 3. Update Party
    await supabaseClient
        .from('parties')
        .update({ 
            mot_a_trouver: mot,
            statut: 'en_cours', 
            fin_round_at: null 
        })
        .eq('id', party.id);
}

// --- STATS UPDATE LOGIC ---

async function updateMultiplayerStats(isWinner, totalScore, roundsPlayed) {
    // Check if user is logged in
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session || !session.user) return;

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
        const newPlayed = (stats.multiplayer_played || 0) + 1;
        const newWins = isWinner ? (stats.multiplayer_wins || 0) + 1 : (stats.multiplayer_wins || 0);
        const newRounds = (stats.multiplayer_rounds_played || 0) + roundsPlayed;
        const newTotalScore = (stats.multiplayer_total_score || 0) + totalScore;

        // 3. Update DB
        await window.supabaseClient
            .from('user_stats')
            .update({
                multiplayer_played: newPlayed,
                multiplayer_wins: newWins,
                multiplayer_rounds_played: newRounds,
                multiplayer_total_score: newTotalScore,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId);

        if (totalScore > 0 && typeof window.recordScoreEvent === 'function') {
            await window.recordScoreEvent(totalScore, 'multiplayer');
        }
            
        console.log("Multiplayer Stats Updated!");

    } catch (e) {
        console.error("Error updating multiplayer stats:", e);
    }
}
window.updateMultiplayerStats = updateMultiplayerStats;

// --- FORCE FINISH LOGIC ---

document.addEventListener('DOMContentLoaded', () => {
    const btnForceFinish = document.getElementById('btn-force-finish');
    if (btnForceFinish) {
        btnForceFinish.addEventListener('click', forceFinishGame);
    }
});

async function forceFinishGame() {
    if (!isHost || !currentRoomCode) return;

    showCustomConfirm("Finir la partie ?", "Voulez-vous vraiment arrêter la partie maintenant ? Le classement sera finalisé.", async () => {
        try {
            const { data: party } = await supabaseClient
                .from('parties')
                .select('id')
                .eq('code', currentRoomCode)
                .single();

            if (party) {
                await supabaseClient
                    .from('parties')
                    .update({ statut: 'finished' })
                    .eq('id', party.id);
            }
        } catch (e) {
            console.error("Error forcing finish:", e);
        }
    });
}

// Update UI to show button for host
const originalUpdateIngamePlayerList = window.updateIngamePlayerList; // Hook if exists, or just override
// Actually, we can just check in refreshPlayerList or updatePlayerListUI

// We'll inject the check into updateIngamePlayerList since it runs often
// But better to do it in refreshPlayerList where we determine host status
const _originalRefresh = window.refreshPlayerList;
window.refreshPlayerList = async function(partyId) {
    await _originalRefresh(partyId);
    
    // Update Finish Button Visibility
    const btnForceFinish = document.getElementById('btn-force-finish');
    if (btnForceFinish) {
        if (isHost) {
            btnForceFinish.classList.remove('hidden');
        } else {
            btnForceFinish.classList.add('hidden');
        }
    }
};
