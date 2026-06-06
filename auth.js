// auth.js

// --- VARIABLES ---
let currentUser = null;
let profileAvatarIndex = 1;
const TOTAL_AVATARS = 12;

// --- AUTH FUNCTIONS ---

async function signInWithGoogle() {
    try {
        // Construit l'URL de redirection basée sur la page actuelle
        // Ex: http://127.0.0.1:5500/Tusmatch-Wardle/index.html
        const redirectUrl = window.location.origin + window.location.pathname;
        
        console.log("Tentative de connexion avec redirection vers :", redirectUrl);

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
        if (error) throw error;
    } catch (error) {
        console.error("Erreur connexion Google:", error.message);
        alert("Erreur lors de la connexion : " + error.message);
    }
}

async function signOut() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        window.location.reload();
    } catch (error) {
        console.error("Erreur déconnexion:", error.message);
    }
}

async function updateUserProfile(name, avatarIndex) {
    try {
        const avatarUrl = `assets/${avatarIndex}.gif`;
        
        // Use 'display_name' to avoid Google overwriting 'full_name'
        const { data, error } = await supabaseClient.auth.updateUser({
            data: { 
                display_name: name, 
                avatar_url: avatarUrl,
                custom_avatar_index: avatarIndex 
            }
        });

        if (error) throw error;
        
        currentUser = data.user;
        
        // Sync Pseudo AND Avatar to User Stats (for Leaderboard/Friends)
        try {
            await supabaseClient
                .from('user_stats')
                .update({ pseudo: name, avatar_index: avatarIndex })
                .eq('user_id', currentUser.id);
        } catch (e) {
            console.warn("Failed to sync avatar to DB, trying pseudo only...", e);
            await supabaseClient
                .from('user_stats')
                .update({ pseudo: name })
                .eq('user_id', currentUser.id);
        }

        // Save to Session Storage for Multiplayer
        sessionStorage.setItem('tusmatch_pseudo', name);
        sessionStorage.setItem('tusmatch_saved_avatar', avatarIndex);

        updateUI(currentUser);
        closeProfileModal();
        
        // Show success toast
        showAuthToast("Profil mis à jour !");

    } catch (error) {
        console.error("Erreur mise à jour profil:", error.message);
        alert("Erreur : " + error.message);
    }
}

// --- UI MANAGEMENT ---

function updateUI(user) {
    const loginBtn = document.getElementById('btn-login-google');
    const userProfileDiv = document.getElementById('user-profile-display');
    const userNameSpan = document.getElementById('user-name-display');
    const userAvatarImg = document.getElementById('user-avatar-display');

    if (user) {
        // LOGGED IN
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userProfileDiv) {
            userProfileDiv.classList.remove('hidden');
            
            // Prioritize display_name, then full_name, then email
            const name = user.user_metadata.display_name || user.user_metadata.full_name || user.email.split('@')[0];
            
            // Fix Avatar Persistence: Prioritize custom_avatar_index
            let avatar = 'assets/1.gif';
            if (user.user_metadata.custom_avatar_index) {
                avatar = `assets/${user.user_metadata.custom_avatar_index}.gif`;
            } else if (user.user_metadata.avatar_url) {
                avatar = user.user_metadata.avatar_url;
            }
            
            if (userNameSpan) userNameSpan.textContent = name;
            if (userAvatarImg) userAvatarImg.src = avatar;

            // Save to Session Storage for Multiplayer Pre-fill
            sessionStorage.setItem('tusmatch_pseudo', name);
            if (user.user_metadata.custom_avatar_index) {
                sessionStorage.setItem('tusmatch_saved_avatar', user.user_metadata.custom_avatar_index);
            }
            
            // Update Multiplayer Inputs if they exist
            const lobbyPseudoInput = document.getElementById('player-pseudo');
            if (lobbyPseudoInput) {
                lobbyPseudoInput.value = name;
            }
            
            // Sync with Multiplayer Global Variables (via sessionStorage)
            sessionStorage.setItem('tusmatch_saved_pseudo', name);
            const avatarIdx = user.user_metadata.custom_avatar_index || 1;
            sessionStorage.setItem('tusmatch_saved_avatar', avatarIdx);

            // Initialize Invite Listener
            initInviteListener();
            // Check for pending invites (missed while offline)
            checkPendingInvites();
            
            // Auto-sync Pseudo to DB (ensure it's not null)
            syncUserStats(user);
        }
    } else {
        // LOGGED OUT
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userProfileDiv) userProfileDiv.classList.add('hidden');
    }
}

async function syncUserStats(user) {
    if (!user) return;
    const name = user.user_metadata.display_name || user.user_metadata.full_name || user.email.split('@')[0];
    const avatarIdx = user.user_metadata.custom_avatar_index || 1;
    
    try {
        // Check if pseudo is already set to avoid unnecessary writes
        const { data: stats } = await supabaseClient
            .from('user_stats')
            .select('pseudo, avatar_index') // Try to select avatar_index too
            .eq('user_id', user.id)
            .single();
            
        // Update if pseudo OR avatar is different (assuming avatar_index column exists or we try to write it)
        // We'll try to update both. If avatar_index column is missing, this might fail, but we'll catch it.
        // Actually, to be safe, let's just update.
        
        const updates = { pseudo: name };
        // Only add avatar_index if we think it might work (user asked for it). 
        // We will try to update it.
        updates.avatar_index = avatarIdx;

        if (stats && (stats.pseudo !== name || stats.avatar_index !== avatarIdx)) {
             await supabaseClient
                .from('user_stats')
                .update(updates)
                .eq('user_id', user.id);
            console.log("Profile synced to DB:", name);
        }
    } catch (e) {
        console.error("Auto-sync profile failed (maybe avatar_index column missing?)", e);
        // Fallback: try syncing ONLY pseudo if the previous one failed
        try {
             await supabaseClient
                .from('user_stats')
                .update({ pseudo: name })
                .eq('user_id', user.id);
        } catch (e2) {
             console.error("Auto-sync pseudo retry failed", e2);
        }
    }
}

// --- TOAST HELPER ---
function showAuthToast(message) {
    // Check if global showToast exists (game.js)
    if (typeof showToast === 'function') {
        showToast(message);
        return;
    }

    // Fallback for index.html if game.js is not loaded
    let container = document.getElementById('auth-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'auth-toast-container';
        container.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 5000; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = 'background: #333; color: white; padding: 10px 20px; border-radius: 5px; font-weight: bold; opacity: 0; transition: opacity 0.3s; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
    
    container.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    // Remove after 3s
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- MODAL LOGIC ---

function injectProfileModal() {
    if (document.getElementById('profile-modal')) return;

    const modalHtml = `
    <div id="profile-modal" class="custom-modal-overlay hidden" style="z-index: 4000;">
        <div class="custom-modal-box" style="max-width: 600px;">
            <h3>Mon Profil</h3>
            
            <!-- TABS -->
            <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                <button id="tab-profile-info" class="tab-btn active" onclick="switchProfileTab('info')">Infos</button>
                <button id="tab-profile-friends" class="tab-btn" onclick="switchProfileTab('friends')">Amis</button>
            </div>

            <!-- TAB CONTENT: INFO -->
            <div id="content-profile-info" style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: center;">
                <!-- Left: Avatar & Pseudo -->
                <div style="margin: 20px 0; text-align: center; flex: 1; min-width: 200px;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px;">
                        <button id="btn-prev-profile-avatar" class="avatar-nav-btn">‹</button>
                        <img id="profile-modal-avatar" src="assets/1.gif" style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid var(--tile-border);">
                        <button id="btn-next-profile-avatar" class="avatar-nav-btn">›</button>
                    </div>
                    <label style="display:block; font-size:0.8rem; margin-bottom:5px; opacity:0.7;">Pseudo</label>
                    <input type="text" id="profile-modal-pseudo" class="lobby-input" placeholder="Votre pseudo" maxlength="12">
                    
                    <div style="margin-top: 15px; font-size: 0.8rem; opacity: 0.8;">
                        Code Ami: <strong id="my-friend-code" style="letter-spacing: 1px; user-select: all; cursor: pointer;" title="Cliquer pour copier">------</strong>
                    </div>
                </div>

                <!-- Right: Stats -->
                <div style="flex: 1; min-width: 200px; text-align: left; background: rgba(0,0,0,0.05); padding: 15px; border-radius: 10px;">
                    <h4 style="margin-bottom: 10px; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Statistiques</h4>
                    
                    <div style="margin-bottom: 15px;">
                        <strong style="font-size: 0.9rem; color: var(--correct);">Mot du Jour</strong>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 5px;">
                            <span>Victoires:</span>
                            <span id="stat-daily-wins">0</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                            <span>Taux de réussite:</span>
                            <span id="stat-daily-rate">0%</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                            <span>Série actuelle:</span>
                            <span id="stat-daily-streak">0</span>
                        </div>
                    </div>

                    <div>
                        <strong style="font-size: 0.9rem; color: var(--present);">Match Privé</strong>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 5px;">
                            <span>Victoires:</span>
                            <span id="stat-multi-wins">0</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                            <span>Taux de réussite:</span>
                            <span id="stat-multi-rate">0%</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                            <span>Moyenne pts/manche:</span>
                            <span id="stat-multi-avg">0</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB CONTENT: FRIENDS -->
            <div id="content-profile-friends" class="hidden" style="text-align: left;">
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <input type="text" id="add-friend-input" class="lobby-input" placeholder="Code Ami (ex: A7B2X9)" style="margin: 0; flex: 1; text-transform: uppercase;">
                    <button id="btn-add-friend" class="lobby-btn" style="margin: 0; width: auto; padding: 0 20px; border-radius: 50px; background: var(--correct); color: white; border: none; font-weight: bold;">Ajouter</button>
                </div>
                
                <div id="friends-list-container" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--tile-border); border-radius: 8px; padding: 10px;">
                    <p style="text-align: center; opacity: 0.6; font-size: 0.9rem;">Chargement...</p>
                </div>
            </div>

            <div class="modal-actions">
                <button id="btn-save-profile" class="btn-confirm">Enregistrer</button>
                <button id="btn-modal-logout" class="btn-cancel" style="background: var(--absent); color: white;">Déconnexion</button>
                <button id="btn-close-profile" class="btn-cancel">Fermer</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Listeners for Modal
    document.getElementById('btn-prev-profile-avatar').addEventListener('click', () => changeProfileAvatar(-1));
    document.getElementById('btn-next-profile-avatar').addEventListener('click', () => changeProfileAvatar(1));
    document.getElementById('btn-save-profile').addEventListener('click', () => {
        const name = document.getElementById('profile-modal-pseudo').value.trim();
        if (name) updateUserProfile(name, profileAvatarIndex);
    });
    document.getElementById('btn-modal-logout').addEventListener('click', signOut);
    document.getElementById('btn-close-profile').addEventListener('click', closeProfileModal);
    
    // Friend Listeners
    document.getElementById('btn-add-friend').addEventListener('click', () => addFriendByCode('add-friend-input'));
    document.getElementById('my-friend-code').addEventListener('click', (e) => {
        navigator.clipboard.writeText(e.target.textContent);
        showAuthToast("Code copié !");
    });
}

window.switchProfileTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-profile-${tab}`).classList.add('active');
    
    document.getElementById('content-profile-info').classList.add('hidden');
    document.getElementById('content-profile-friends').classList.add('hidden');
    
    document.getElementById(`content-profile-${tab}`).classList.remove('hidden');
    
    if (tab === 'friends') {
        loadFriendsList();
    }
};

function openProfileModal() {
    if (!currentUser) return;
    
    const modal = document.getElementById('profile-modal');
    const avatarImg = document.getElementById('profile-modal-avatar');
    const pseudoInput = document.getElementById('profile-modal-pseudo');
    
    // Load current data
    const meta = currentUser.user_metadata;
    profileAvatarIndex = meta.custom_avatar_index || 1;
    
    avatarImg.src = `assets/${profileAvatarIndex}.gif`;
    // Fix: Use display_name (custom) if available, otherwise full_name
    pseudoInput.value = meta.display_name || meta.full_name || "";
    
    // Fetch and display stats
    fetchUserStats(currentUser.id);

    modal.classList.remove('hidden');
}

async function fetchUserStats(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // Ignore "Row not found"
            console.error("Error fetching stats:", error);
            return;
        }

        if (data) {
            // Friend Code
            if (data.friend_code) {
                const codeEl = document.getElementById('my-friend-code');
                const inviteCodeEl = document.getElementById('invite-my-code');
                if (codeEl) codeEl.textContent = data.friend_code;
                if (inviteCodeEl) inviteCodeEl.textContent = data.friend_code;
            }

            // Daily Stats
            document.getElementById('stat-daily-wins').textContent = data.daily_wins;
            const rate = data.daily_played > 0 ? Math.round((data.daily_wins / data.daily_played) * 100) : 0;
            document.getElementById('stat-daily-rate').textContent = `${rate}%`;
            document.getElementById('stat-daily-streak').textContent = data.daily_current_streak;

            // Multiplayer Stats
            document.getElementById('stat-multi-wins').textContent = data.multiplayer_wins;
            const multiRate = data.multiplayer_played > 0 ? Math.round((data.multiplayer_wins / data.multiplayer_played) * 100) : 0;
            document.getElementById('stat-multi-rate').textContent = `${multiRate}%`;
            
            const avg = data.multiplayer_rounds_played > 0 ? Math.round(data.multiplayer_total_score / data.multiplayer_rounds_played) : 0;
            document.getElementById('stat-multi-avg').textContent = avg;
        } else {
            // Reset if no stats found
            document.getElementById('stat-daily-wins').textContent = '0';
            document.getElementById('stat-daily-rate').textContent = '0%';
            document.getElementById('stat-daily-streak').textContent = '0';
            document.getElementById('stat-multi-wins').textContent = '0';
            document.getElementById('stat-multi-rate').textContent = '0%';
            document.getElementById('stat-multi-avg').textContent = '0';
            document.getElementById('my-friend-code').textContent = '------';
        }

    } catch (e) {
        console.error("Exception fetching stats:", e);
    }
}

// --- FRIEND LOGIC ---

async function addFriendByCode(inputId = 'add-friend-input') {
    // Defensive check: if inputId is an event object (or not a string), use default
    if (typeof inputId !== 'string') {
        console.warn("addFriendByCode called with non-string argument, defaulting to 'add-friend-input'", inputId);
        inputId = 'add-friend-input';
    }

    console.log("addFriendByCode appelé avec inputId:", inputId);
    const input = document.getElementById(inputId);
    console.log("Input trouvé:", input);
    
    if (!input) {
        console.error("Input not found:", inputId);
        showAuthToast("Erreur: champ de saisie introuvable");
        return;
    }
    const code = input.value.trim().toUpperCase();
    
    console.log("Tentative d'ajout ami avec code:", code);
    
    if (code.length < 3) {
        showAuthToast("Code invalide (trop court)");
        return;
    }
    
    if (!currentUser) {
        showAuthToast("Vous devez être connecté !");
        return;
    }
    
    input.disabled = true;
    
    try {
        console.log("Recherche du code ami dans user_stats...");
        // 1. Find User ID from Code
        const { data: targetStats, error: findError } = await supabaseClient
            .from('user_stats')
            .select('user_id')
            .eq('friend_code', code)
            .single();
        
        console.log("Résultat recherche:", targetStats, findError);
            
        if (findError || !targetStats) {
            showAuthToast("Code ami introuvable !");
            input.disabled = false;
            return;
        }
        
        const targetId = targetStats.user_id;
        
        if (targetId === currentUser.id) {
            showAuthToast("Vous ne pouvez pas vous ajouter vous-même !");
            input.disabled = false;
            return;
        }
        
        console.log("Insertion dans la table friends...");
        // 2. Send Request
        const { error: insertError } = await supabaseClient
            .from('friends')
            .insert({
                user_id_1: currentUser.id,
                user_id_2: targetId,
                status: 'pending'
            });
        
        console.log("Résultat insertion:", insertError);
            
        if (insertError) {
            if (insertError.code === '23505') { // Unique violation
                showAuthToast("Déjà amis ou demande envoyée !");
            } else {
                console.error("Erreur insertion:", insertError);
                showAuthToast("Erreur lors de l'ajout: " + insertError.message);
            }
        } else {
            showAuthToast("Demande envoyée !");
            input.value = "";
            loadFriendsList('friends-list-container');
            loadFriendsList('invite-friends-list');
        }
        
    } catch (e) {
        console.error("Exception addFriendByCode:", e);
        showAuthToast("Erreur inattendue: " + e.message);
    }
    
    input.disabled = false;
}

async function loadFriendsList(containerId = 'friends-list-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<p style="text-align: center; opacity: 0.6; font-size: 0.9rem;">Chargement...</p>';
    
    try {
        // Fetch friendships where I am user_1 or user_2
        const { data: friendships, error } = await supabaseClient
            .from('friends')
            .select('*')
            .or(`user_id_1.eq.${currentUser.id},user_id_2.eq.${currentUser.id}`);
            
        if (error) throw error;
        
        if (!friendships || friendships.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.6; font-size: 0.9rem;">Aucun ami pour le moment.</p>';
            return;
        }
        
        container.innerHTML = '';
        
        // Check if we are in a lobby (global var from multiplayer.js)
        const inLobby = typeof currentRoomCode !== 'undefined' && currentRoomCode;
        
        for (const f of friendships) {
            const isMeSender = f.user_id_1 === currentUser.id;
            const friendId = isMeSender ? f.user_id_2 : f.user_id_1;
            const status = f.status;
            
            // Fetch friend stats to get code
            const { data: friendStats } = await supabaseClient
                .from('user_stats')
                .select('*')
                .eq('user_id', friendId)
                .single();
                
            const displayName = friendStats ? (friendStats.pseudo || `Joueur ${friendStats.friend_code}`) : "Inconnu";
            const avatarIdx = (friendStats && friendStats.avatar_index) ? friendStats.avatar_index : 1;
            const avatarUrl = `assets/${avatarIdx}.gif`;
            
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--tile-border);';
            
            let actionBtn = '';
            if (status === 'pending') {
                if (isMeSender) {
                    actionBtn = '<span style="font-size: 0.8rem; opacity: 0.7;">En attente...</span>';
                } else {
                    actionBtn = `<button onclick="acceptFriend('${f.id}')" class="lobby-btn" style="width: auto; padding: 2px 8px; font-size: 0.8rem; background: var(--correct);">Accepter</button>`;
                }
            } else {
                if (inLobby) {
                     actionBtn = `<button onclick="inviteFriend('${friendId}')" class="lobby-btn" style="width: auto; padding: 2px 8px; font-size: 0.8rem;">Inviter</button>`;
                } else {
                     actionBtn = '<span style="font-size: 0.8rem; color: var(--correct);">Amis</span>';
                }
            }
            
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="${avatarUrl}" style="width:30px; height:30px; border-radius:50%; border: 1px solid var(--tile-border);">
                    <span style="font-weight: bold;">${displayName}</span>
                </div>
                ${actionBtn}
            `;
            container.appendChild(div);
        }
        
    } catch (e) {
        console.error(e);
        container.innerHTML = '<p style="text-align: center; color: var(--absent);">Erreur chargement.</p>';
    }
}

window.acceptFriend = async function(friendshipId) {
    try {
        const { error } = await supabaseClient
            .from('friends')
            .update({ status: 'accepted' })
            .eq('id', friendshipId);
            
        if (error) throw error;
        loadFriendsList('friends-list-container');
        loadFriendsList('invite-friends-list');
        showAuthToast("Ami accepté !");
    } catch (e) {
        console.error(e);
        showAuthToast("Erreur.");
    }
};

window.inviteFriend = async function(friendId) {
    if (typeof currentRoomCode === 'undefined' || !currentRoomCode) return;
    
    try {
        const { error } = await supabaseClient
            .from('game_invites')
            .insert({
                sender_id: currentUser.id,
                receiver_id: friendId,
                room_code: currentRoomCode
            });
            
        if (error) throw error;
        showAuthToast("Invitation envoyée !");
    } catch (e) {
        console.error(e);
        showAuthToast("Erreur invitation.");
    }
};

// Listen for invites
function initInviteListener() {
    if (!currentUser) return;
    
    // 1. Listen for incoming invites
    supabaseClient
        .channel('public:game_invites')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_invites', filter: `receiver_id=eq.${currentUser.id}` }, payload => {
            const invite = payload.new;
            showInviteToast(invite);
        })
        .subscribe();

    // 2. Listen for invite responses (Accepted/Declined)
    supabaseClient
        .channel(`user_notifications:${currentUser.id}`)
        .on('broadcast', { event: 'invite_declined' }, payload => {
            showAuthToast(`❌ ${payload.payload.decliner} a refusé l'invitation.`);
        })
        .on('broadcast', { event: 'invite_accepted' }, payload => {
            showAuthToast(`✅ ${payload.payload.acceptor} a accepté l'invitation !`);
        })
        .subscribe();
}

function showInviteToast(invite) {
    // Check if toast already exists for this invite
    if (document.getElementById(`invite-toast-${invite.id}`)) return;

    // Custom toast with "Accept" button
    const toast = document.createElement('div');
    toast.id = `invite-toast-${invite.id}`;
    toast.className = 'auth-toast';
    toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #333; color: white; padding: 15px; border-radius: 8px; z-index: 6000; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 10px; min-width: 200px; animation: slideIn 0.3s ease-out;';
    
    toast.innerHTML = `
        <div style="font-weight: bold; color: var(--present);">Invitation à jouer !</div>
        <div style="font-size:0.9rem;">Code: ${invite.room_code}</div>
        <div style="display: flex; gap: 10px;">
            <button onclick="acceptInvite('${invite.room_code}', '${invite.id}')" style="flex: 1; background: var(--correct); color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-weight: bold;">Rejoindre</button>
            <button onclick="declineInvite('${invite.id}')" style="flex: 1; background: rgba(255,255,255,0.2); color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer;">Ignorer</button>
        </div>
    `;
    document.body.appendChild(toast);
    
    // Auto remove after 30s (extended)
    setTimeout(() => {
        if (document.body.contains(toast)) toast.remove();
    }, 30000);
}

window.acceptInvite = async function(code, inviteId) {
    if (inviteId) {
        // Notify Sender (Host)
        const { data: invite } = await supabaseClient
            .from('game_invites')
            .select('sender_id')
            .eq('id', inviteId)
            .single();

        if (invite) {
            supabaseClient.channel(`user_notifications:${invite.sender_id}`).send({
                type: 'broadcast',
                event: 'invite_accepted',
                payload: { acceptor: currentUser ? (currentUser.user_metadata.display_name || 'Un joueur') : 'Un joueur' }
            });
        }

        // Delete invite from DB
        await supabaseClient.from('game_invites').delete().eq('id', inviteId);
    }
    // Redirect to game with auto-join param
    window.location.href = `game.html?mode=private&code=${code}&autojoin=true`;
};

window.declineInvite = async function(inviteId) {
    const toast = document.getElementById(`invite-toast-${inviteId}`);
    if (toast) toast.remove();
    
    if (inviteId) {
        // Notify Sender (Host)
        const { data: invite } = await supabaseClient
            .from('game_invites')
            .select('sender_id')
            .eq('id', inviteId)
            .single();

        if (invite) {
            supabaseClient.channel(`user_notifications:${invite.sender_id}`).send({
                type: 'broadcast',
                event: 'invite_declined',
                payload: { decliner: currentUser ? (currentUser.user_metadata.display_name || 'Un joueur') : 'Un joueur' }
            });
        }

        await supabaseClient.from('game_invites').delete().eq('id', inviteId);
    }
};

async function checkPendingInvites() {
    if (!currentUser) return;
    
    try {
        const { data: invites, error } = await supabaseClient
            .from('game_invites')
            .select('*')
            .eq('receiver_id', currentUser.id);
            
        if (error) throw error;
        
        if (invites && invites.length > 0) {
            invites.forEach(invite => showInviteToast(invite));
        }
    } catch (e) {
        console.error("Error checking invites:", e);
    }
}


function closeProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
}

function changeProfileAvatar(direction) {
    profileAvatarIndex += direction;
    if (profileAvatarIndex > TOTAL_AVATARS) profileAvatarIndex = 1;
    if (profileAvatarIndex < 1) profileAvatarIndex = TOTAL_AVATARS;
    
    document.getElementById('profile-modal-avatar').src = `assets/${profileAvatarIndex}.gif`;
}

// --- LEADERBOARD LOGIC ---

function injectLeaderboardModal() {
    if (document.getElementById('leaderboard-modal')) return;

    const modalHtml = `
    <div id="leaderboard-modal" class="custom-modal-overlay hidden" style="z-index: 4000;">
        <div class="custom-modal-box" style="max-width: 600px;">
            <h3>Classement</h3>
            
            <!-- TABS -->
            <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                <button id="tab-leaderboard-global" class="tab-btn active" onclick="switchLeaderboardTab('global')">Global</button>
                <button id="tab-leaderboard-friends" class="tab-btn" onclick="switchLeaderboardTab('friends')">Amis</button>
            </div>

            <!-- CONTENT -->
            <div id="leaderboard-content" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--tile-border); border-radius: 8px; padding: 10px;">
                <p style="text-align: center; opacity: 0.6;">Chargement...</p>
            </div>

            <div class="modal-actions">
                <button id="btn-close-leaderboard" class="btn-cancel">Fermer</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
        document.getElementById('leaderboard-modal').classList.add('hidden');
    });
}

window.switchLeaderboardTab = function(tab) {
    document.querySelectorAll('#leaderboard-modal .tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-leaderboard-${tab}`).classList.add('active');
    loadLeaderboard(tab);
};

async function loadLeaderboard(type) {
    const container = document.getElementById('leaderboard-content');
    container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Chargement...</p>';

    try {
        // MODIFICATION ICI: order par 'daily_total_points' au lieu de 'daily_wins'
        let query = supabaseClient
            .from('user_stats')
            .select('*')
            .order('daily_total_points', { ascending: false }) 
            .limit(50);

        if (type === 'friends') {
            if (!currentUser) {
                container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Connectez-vous pour voir le classement amis.</p>';
                return;
            }
            
            // 1. Get Friend IDs
            const { data: friendships } = await supabaseClient
                .from('friends')
                .select('*')
                .or(`user_id_1.eq.${currentUser.id},user_id_2.eq.${currentUser.id}`)
                .eq('status', 'accepted');
                
            const friendIds = (friendships || []).map(f => f.user_id_1 === currentUser.id ? f.user_id_2 : f.user_id_1);
            friendIds.push(currentUser.id); // Include self

            // 2. Filter Query
            // MODIFICATION ICI: order par 'daily_total_points'
            query = supabaseClient
                .from('user_stats')
                .select('*')
                .in('user_id', friendIds)
                .order('daily_total_points', { ascending: false });
        }

        const { data: stats, error } = await query;

        if (error) throw error;

        if (!stats || stats.length === 0) {
            container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Aucune donnée.</p>';
            return;
        }

        let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';
        
        html += '<tr style="border-bottom: 1px solid #ccc; text-align: left;"><th style="padding: 5px;">#</th><th style="padding: 5px;">Joueur</th><th style="padding: 5px;">Victoires Jour</th><th style="padding: 5px;">Points Jour</th><th style="padding: 5px;">Victoires Multi</th></tr>';
        
        stats.forEach((s, index) => {
            const isMe = currentUser && s.user_id === currentUser.id;
            const style = isMe ? 'background: rgba(0, 255, 0, 0.1); font-weight: bold;' : '';
            // Use pseudo if available, otherwise fallback to friend_code
            const name = s.pseudo ? s.pseudo : (s.friend_code ? `Joueur ${s.friend_code}` : 'Inconnu');
            
            html += `<tr style="${style} border-bottom: 1px solid var(--tile-border);">
                <td style="padding: 8px;">${index + 1}</td>
                <td style="padding: 8px;">${name}</td>
                <td style="padding: 8px;">${s.daily_wins || 0}</td>
                <td style="padding: 8px; font-weight: bold; color: var(--correct-color);">${s.daily_total_points || 0} pts</td>
                <td style="padding: 8px;">${s.multiplayer_wins || 0}</td>
            </tr>`;
        });
        html += '</table>';
        
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = '<p style="text-align: center; color: var(--absent);">Erreur chargement.</p>';
    }
}

// --- INVITE MODAL LOGIC ---

function initInviteModal() {
    const inviteBtn = document.getElementById('inviteBtn');
    const inviteBtnLobby = document.getElementById('btn-invite-friend-lobby');
    const closeBtn = document.getElementById('close-invite');
    const addBtn = document.getElementById('btn-invite-add');
    const myCode = document.getElementById('invite-my-code');

    if (inviteBtn) inviteBtn.addEventListener('click', openInviteModal);
    if (inviteBtnLobby) inviteBtnLobby.addEventListener('click', openInviteModal);
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('invite-modal').classList.add('hidden');
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => addFriendByCode('invite-friend-input'));
    }

    if (myCode) {
        myCode.addEventListener('click', (e) => {
            navigator.clipboard.writeText(e.target.textContent);
            showAuthToast("Code copié !");
        });
    }
}

function openInviteModal() {
    if (!currentUser) {
        showAuthToast("Connectez-vous pour inviter des amis !");
        return;
    }
    
    const modal = document.getElementById('invite-modal');
    if (modal) {
        modal.classList.remove('hidden');
        // Load friend code (and stats)
        fetchUserStats(currentUser.id);
        loadFriendsList('invite-friends-list');
    }
}

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', async () => {
    injectProfileModal();
    injectLeaderboardModal();
    initInviteModal();

    const loginBtn = document.getElementById('btn-login-google');
    const logoutBtn = document.getElementById('btn-logout');
    const userProfileDiv = document.getElementById('user-profile-display');
    const leaderboardBtn = document.getElementById('leaderboardBtn');

    // Listeners
    if (loginBtn) loginBtn.addEventListener('click', signInWithGoogle);
    if (logoutBtn) logoutBtn.addEventListener('click', signOut);
    if (leaderboardBtn) leaderboardBtn.addEventListener('click', () => {
        document.getElementById('leaderboard-modal').classList.remove('hidden');
        loadLeaderboard('global');
    });
    
    // Click on profile to edit
    if (userProfileDiv) {
        const profileClickable = document.getElementById('profile-clickable');
        if (profileClickable) {
            profileClickable.addEventListener('click', openProfileModal);
        } else {
            // Fallback if structure is different (e.g. game.html)
            userProfileDiv.addEventListener('click', (e) => {
                if (e.target.closest('#btn-logout')) return;
                openProfileModal();
            });
        }
        // Add cursor pointer to indicate clickable
        userProfileDiv.style.cursor = 'default'; // Container is default, inner part is pointer
    }

    // Check Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        currentUser = session.user;
        updateUI(currentUser);
    } else {
        updateUI(null);
    }

    // Listen for auth changes
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            updateUI(currentUser);
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            updateUI(null);
        }
    });
});
