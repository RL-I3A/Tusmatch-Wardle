// auth.js

// --- VARIABLES ---
let currentUser = null;
let profileAvatarIndex = 1;
const TOTAL_AVATARS = 12;
const AVATAR_CACHE = new Map();

function preloadAvatarAssets() {
    for (let i = 1; i <= TOTAL_AVATARS; i++) {
        const url = `assets/${i}.gif`;
        if (AVATAR_CACHE.has(url)) continue;
        const image = new Image();
        image.decoding = 'async';
        image.loading = 'eager';
        image.src = url;
        AVATAR_CACHE.set(url, image);
    }
}

function setAvatarImage(imageElement, avatarUrl) {
    if (!imageElement) return;

    const resolvedUrl = avatarUrl || 'assets/1.gif';
    const cachedImage = AVATAR_CACHE.get(resolvedUrl);

    if (cachedImage && cachedImage.complete) {
        imageElement.style.opacity = '1';
        imageElement.src = resolvedUrl;
        return;
    }

    imageElement.style.opacity = '0';
    const loader = new Image();
    loader.decoding = 'async';
    loader.onload = () => {
        AVATAR_CACHE.set(resolvedUrl, loader);
        imageElement.src = resolvedUrl;
        requestAnimationFrame(() => {
            imageElement.style.opacity = '1';
        });
    };
    loader.onerror = () => {
        imageElement.src = resolvedUrl;
        imageElement.style.opacity = '1';
    };
    loader.src = resolvedUrl;
}

preloadAvatarAssets();

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
        // Non-critique : le profil (nom/avatar Google) est déjà mis à jour avec succès
        // à ce stade, donc un échec ici ne doit jamais déclencher l'alerte d'erreur
        // ci-dessous (d'où le try/catch imbriqué, y compris sur le repli).
        try {
            await supabaseClient
                .from('user_stats')
                .update({ pseudo: name, avatar_index: avatarIndex })
                .eq('user_id', currentUser.id);
        } catch (e) {
            console.warn("Failed to sync avatar to DB, trying pseudo only...", e);
            try {
                await supabaseClient
                    .from('user_stats')
                    .update({ pseudo: name })
                    .eq('user_id', currentUser.id);
            } catch (e2) {
                console.warn("Failed to sync pseudo to DB (non-blocking):", e2);
            }
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
            setAvatarImage(userAvatarImg, avatar);

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

                    <div class="win-stars-row">
                        <div class="win-star-item" title="Nombre de fois n°1 du classement du jour">
                            <div id="win-star-day" class="win-star win-star-bronze" data-digits="1"><span>0</span></div>
                            <div class="win-star-label">Jours<br>gagnés</div>
                        </div>
                        <div class="win-star-item" title="Nombre de fois n°1 du classement de la semaine">
                            <div id="win-star-week" class="win-star win-star-silver" data-digits="1"><span>0</span></div>
                            <div class="win-star-label">Semaines<br>gagnées</div>
                        </div>
                        <div class="win-star-item" title="Nombre de fois n°1 d'une saison">
                            <div id="win-star-season" class="win-star win-star-gold" data-digits="1"><span>0</span></div>
                            <div class="win-star-label">Saisons<br>gagnées</div>
                        </div>
                    </div>

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

// --- PUBLIC PROFILE (lecture seule, depuis le classement) ---

function injectPublicProfileModal() {
    if (document.getElementById('public-profile-modal')) return;

    const modalHtml = `
    <div id="public-profile-modal" class="custom-modal-overlay hidden" style="z-index: 4500;">
        <div class="custom-modal-box" style="max-width: 380px;">
            <button id="close-public-profile" class="rules-close-btn">×</button>

            <div style="text-align: center; margin-top: 10px;">
                <img id="public-profile-avatar" src="assets/1.gif" style="width: 80px; height: 80px; border-radius: 50%; border: 2px solid var(--tile-border);">
                <h3 id="public-profile-pseudo" style="margin-top: 10px;">Joueur</h3>
            </div>

            <div class="win-stars-row">
                <div class="win-star-item" title="Nombre de fois n°1 du classement du jour">
                    <div id="public-win-star-day" class="win-star win-star-bronze" data-digits="1"><span>0</span></div>
                    <div class="win-star-label">Jours<br>gagnés</div>
                </div>
                <div class="win-star-item" title="Nombre de fois n°1 du classement de la semaine">
                    <div id="public-win-star-week" class="win-star win-star-silver" data-digits="1"><span>0</span></div>
                    <div class="win-star-label">Semaines<br>gagnées</div>
                </div>
                <div class="win-star-item" title="Nombre de fois n°1 d'une saison">
                    <div id="public-win-star-season" class="win-star win-star-gold" data-digits="1"><span>0</span></div>
                    <div class="win-star-label">Saisons<br>gagnées</div>
                </div>
            </div>

            <div style="text-align: left; background: rgba(0,0,0,0.05); padding: 15px; border-radius: 10px;">
                <div style="margin-bottom: 15px;">
                    <strong style="font-size: 0.9rem; color: var(--correct);">Mot du Jour</strong>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 5px;">
                        <span>Victoires:</span>
                        <span id="public-stat-daily-wins">0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span>Taux de réussite:</span>
                        <span id="public-stat-daily-rate">0%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span>Série actuelle:</span>
                        <span id="public-stat-daily-streak">0</span>
                    </div>
                </div>

                <div>
                    <strong style="font-size: 0.9rem; color: var(--present);">Match Privé</strong>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-top: 5px;">
                        <span>Victoires:</span>
                        <span id="public-stat-multi-wins">0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span>Taux de réussite:</span>
                        <span id="public-stat-multi-rate">0%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span>Moyenne pts/manche:</span>
                        <span id="public-stat-multi-avg">0</span>
                    </div>
                </div>
            </div>

            <div class="modal-actions">
                <button id="btn-close-public-profile" class="btn-cancel">Fermer</button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const close = () => document.getElementById('public-profile-modal').classList.add('hidden');
    document.getElementById('close-public-profile').addEventListener('click', close);
    document.getElementById('btn-close-public-profile').addEventListener('click', close);
    document.getElementById('public-profile-modal').addEventListener('click', (e) => {
        if (e.target.id === 'public-profile-modal') close();
    });
}

window.openPublicProfile = async function(userId) {
    if (!userId) return;

    injectPublicProfileModal();
    const modal = document.getElementById('public-profile-modal');
    modal.classList.remove('hidden');

    document.getElementById('public-profile-pseudo').textContent = 'Chargement...';

    try {
        const { data, error } = await supabaseClient
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            document.getElementById('public-profile-pseudo').textContent = 'Joueur introuvable';
            return;
        }

        const name = data.pseudo ? data.pseudo : (data.friend_code ? `Joueur ${data.friend_code}` : 'Joueur');
        document.getElementById('public-profile-pseudo').textContent = name;
        setAvatarImage(document.getElementById('public-profile-avatar'), `assets/${data.avatar_index || 1}.gif`);

        document.getElementById('public-stat-daily-wins').textContent = data.daily_wins || 0;
        const rate = data.daily_played > 0 ? Math.round((data.daily_wins / data.daily_played) * 100) : 0;
        document.getElementById('public-stat-daily-rate').textContent = `${rate}%`;
        document.getElementById('public-stat-daily-streak').textContent = data.daily_current_streak || 0;

        document.getElementById('public-stat-multi-wins').textContent = data.multiplayer_wins || 0;
        const multiRate = data.multiplayer_played > 0 ? Math.round((data.multiplayer_wins / data.multiplayer_played) * 100) : 0;
        document.getElementById('public-stat-multi-rate').textContent = `${multiRate}%`;
        const avg = data.multiplayer_rounds_played > 0 ? Math.round(data.multiplayer_total_score / data.multiplayer_rounds_played) : 0;
        document.getElementById('public-stat-multi-avg').textContent = avg;

        setWinStarValue('public-win-star-day', data.day_wins_count);
        setWinStarValue('public-win-star-week', data.week_wins_count);
        setWinStarValue('public-win-star-season', data.season_wins_count);
    } catch (e) {
        console.error('Erreur chargement profil public:', e);
        document.getElementById('public-profile-pseudo').textContent = 'Erreur de chargement';
    }
};

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
    
    setAvatarImage(avatarImg, `assets/${profileAvatarIndex}.gif`);
    // Fix: Use display_name (custom) if available, otherwise full_name
    pseudoInput.value = meta.display_name || meta.full_name || "";
    
    // Fetch and display stats
    fetchUserStats(currentUser.id);

    modal.classList.remove('hidden');
}

function setWinStarValue(elId, value) {
    const el = document.getElementById(elId);
    if (!el) return;
    const n = Number(value) || 0;
    const span = el.querySelector('span');
    if (span) span.textContent = n;
    el.dataset.digits = String(n).length;
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

            // Étoiles de victoires (jour / semaine / saison)
            setWinStarValue('win-star-day', data.day_wins_count);
            setWinStarValue('win-star-week', data.week_wins_count);
            setWinStarValue('win-star-season', data.season_wins_count);
        } else {
            // Reset if no stats found
            document.getElementById('stat-daily-wins').textContent = '0';
            document.getElementById('stat-daily-rate').textContent = '0%';
            document.getElementById('stat-daily-streak').textContent = '0';
            document.getElementById('stat-multi-wins').textContent = '0';
            document.getElementById('stat-multi-rate').textContent = '0%';
            document.getElementById('stat-multi-avg').textContent = '0';
            document.getElementById('my-friend-code').textContent = '------';
            setWinStarValue('win-star-day', 0);
            setWinStarValue('win-star-week', 0);
            setWinStarValue('win-star-season', 0);
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
                    <img src="${avatarUrl}" loading="eager" decoding="async" style="width:30px; height:30px; border-radius:50%; border: 1px solid var(--tile-border); background: var(--tile-bg); object-fit: cover;">
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
    
    setAvatarImage(document.getElementById('profile-modal-avatar'), `assets/${profileAvatarIndex}.gif`);
}

function getLocalDayStart(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
}

function getLocalWeekStart(date = new Date()) {
    const start = new Date(date);
    const dayIndex = start.getDay();
    const offset = (dayIndex + 6) % 7;
    start.setDate(start.getDate() - offset);
    start.setHours(0, 0, 0, 0);
    return start;
}

function getTimeUntilReset(period) {
    const now = new Date();
    let target;

    if (period === 'daily') {
        target = getLocalDayStart(now);
        target.setDate(target.getDate() + 1);
    } else if (period === 'weekly') {
        target = getLocalWeekStart(now);
        target.setDate(target.getDate() + 7);
    } else {
        return null;
    }

    const diffMs = target - now;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}

function getLeaderboardScore(stats) {
    return (stats.daily_total_points || 0) + (stats.multiplayer_total_score || 0);
}

// --- SEASONS (classement Global divisé par saison) ---
// Repose sur deux tables Supabase optionnelles : `seasons` (dates de chaque
// saison) et `season_frozen_scores` (totaux figés des saisons closes, utile
// surtout pour la Saison 1 dont l'historique complet n'est pas forcément
// dans score_events). Si ces tables n'existent pas encore, tout retombe
// silencieusement sur l'ancien classement Global simple.

function formatSeasonCountdown(diffMs) {
    if (diffMs === null || diffMs === undefined || diffMs <= 0) return null;
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}j ${hours}h`;
    return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}

async function loadSeasonsConfig() {
    const { data, error } = await supabaseClient
        .from('seasons')
        .select('id, number, label, starts_at, ends_at')
        .order('number', { ascending: true });
    if (error) throw error;
    return data || [];
}

function getSeasonPhase(season, now) {
    const start = season.starts_at ? new Date(season.starts_at) : null;
    const end = season.ends_at ? new Date(season.ends_at) : null;
    if (start && now < start) return 'upcoming';
    if (end && now >= end) return 'closed';
    return 'active';
}

async function loadSeasonLiveTotals(startsAt, endsAt) {
    let query = supabaseClient.from('score_events').select('user_id, points');
    if (startsAt) query = query.gte('created_at', startsAt);
    if (endsAt) query = query.lt('created_at', endsAt);

    const { data, error } = await query;
    if (error) throw error;

    const totals = new Map();
    (data || []).forEach(event => {
        totals.set(event.user_id, (totals.get(event.user_id) || 0) + (Number(event.points) || 0));
    });
    return totals;
}

async function loadSeasonFrozenTotals(seasonId) {
    const { data, error } = await supabaseClient
        .from('season_frozen_scores')
        .select('user_id, total_points')
        .eq('season_id', seasonId);
    if (error) throw error;

    const totals = new Map();
    (data || []).forEach(row => totals.set(row.user_id, Number(row.total_points) || 0));
    return totals;
}

// Construit les données du classement par saison, ou renvoie { legacy: true }
// si aucune saison n'est encore close (on garde alors l'ancien affichage,
// avec juste un bandeau "Saison X commence dans..." si une saison est prévue).
async function buildSeasonalLeaderboard() {
    const seasons = await loadSeasonsConfig();
    if (!seasons.length) return null;

    const now = new Date();
    const withPhase = seasons.map(s => ({ ...s, phase: getSeasonPhase(s, now) }));

    const currentSeason = withPhase.find(s => s.phase === 'active') || null;
    const upcomingSeason = withPhase.find(s => s.phase === 'upcoming') || null;
    const closedSeasons = withPhase.filter(s => s.phase === 'closed');

    if (closedSeasons.length === 0) {
        return { legacy: true, currentSeason, upcomingSeason };
    }

    // Totaux par saison close : figés si disponibles, sinon recalculés depuis score_events
    const seasonTotalsList = [];
    for (const season of closedSeasons) {
        let totals = await loadSeasonFrozenTotals(season.id);
        if (totals.size === 0) {
            totals = await loadSeasonLiveTotals(season.starts_at, season.ends_at);
        }
        seasonTotalsList.push({ season, totals });
    }

    // Saison en cours : toujours calculée en direct depuis score_events
    const currentTotals = currentSeason
        ? await loadSeasonLiveTotals(currentSeason.starts_at, currentSeason.ends_at)
        : new Map();

    const { data: stats, error } = await supabaseClient
        .from('user_stats')
        .select('user_id, pseudo, friend_code, avatar_index');
    if (error) throw error;

    const rows = (stats || []).map(stat => {
        const seasonScores = {};
        let total = 0;

        seasonTotalsList.forEach(({ season, totals }) => {
            const pts = totals.get(stat.user_id) || 0;
            seasonScores[season.number] = pts;
            total += pts;
        });

        const currentSeasonScore = currentTotals.get(stat.user_id) || 0;
        total += currentSeasonScore;

        return {
            user_id: stat.user_id,
            pseudo: stat.pseudo,
            friend_code: stat.friend_code,
            avatar_index: stat.avatar_index,
            seasonScores,
            currentSeasonScore,
            total_score: total
        };
    });

    // Classement basé sur la saison en cours (tout le monde repart de 0),
    // le total départage en cas d'égalité.
    rows.sort((a, b) => (b.currentSeasonScore - a.currentSeasonScore) || (b.total_score - a.total_score));

    return { legacy: false, closedSeasons, currentSeason, upcomingSeason, rows };
}

function updateSeasonCountdownBanner(currentSeason, upcomingSeason) {
    const resetInfo = document.getElementById('leaderboard-reset-info');
    if (!resetInfo) return;

    if (upcomingSeason && upcomingSeason.starts_at) {
        const countdown = formatSeasonCountdown(new Date(upcomingSeason.starts_at) - new Date());
        const mainLine = countdown
            ? `🎉 ${upcomingSeason.label} commence dans ${countdown} — les scores repartiront à 0 !`
            : `🎉 ${upcomingSeason.label} vient de commencer !`;
        resetInfo.innerHTML = `${mainLine}<br><span style="opacity:0.8;">Les scores actuels ne sont pas perdus : ils restent consultables dans le classement.</span>`;
        resetInfo.classList.remove('hidden');
        return;
    }

    if (currentSeason && currentSeason.ends_at) {
        const countdown = formatSeasonCountdown(new Date(currentSeason.ends_at) - new Date());
        resetInfo.textContent = countdown
            ? `${currentSeason.label} se termine dans ${countdown}`
            : `${currentSeason.label} est terminée`;
        resetInfo.classList.remove('hidden');
        return;
    }

    resetInfo.classList.add('hidden');
}

function leaderboardNameCell(row) {
    const name = row.pseudo ? row.pseudo : (row.friend_code ? `Joueur ${row.friend_code}` : 'Inconnu');
    return `<span class="leaderboard-player-link" onclick="openPublicProfile('${row.user_id}')">${name}</span>`;
}

function renderSimpleLeaderboardTable(rows, scoreTitle) {
    const container = document.getElementById('leaderboard-content');

    if (!rows || rows.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Aucune donnée.</p>';
        return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';
    html += `<tr style="border-bottom: 1px solid #ccc; text-align: left;"><th style="padding: 5px;">#</th><th style="padding: 5px;">Joueur</th><th style="padding: 5px;">${scoreTitle}</th></tr>`;

    rows.slice(0, 50).forEach((row, index) => {
        const isMe = currentUser && row.user_id === currentUser.id;
        const style = isMe ? 'background: rgba(0, 255, 0, 0.1); font-weight: bold;' : '';

        html += `<tr style="${style} border-bottom: 1px solid var(--tile-border);">
            <td style="padding: 8px;">${index + 1}</td>
            <td style="padding: 8px;">${leaderboardNameCell(row)}</td>
            <td style="padding: 8px; font-weight: bold; color: var(--correct-color);">${row.total_score || 0} pts</td>
        </tr>`;
    });
    html += '</table>';

    container.innerHTML = html;
}

function renderSeasonalLeaderboardTable(data) {
    const container = document.getElementById('leaderboard-content');
    const { closedSeasons, currentSeason, rows } = data;

    if (!rows || rows.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Aucune donnée.</p>';
        return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">';
    html += '<tr style="border-bottom: 1px solid #ccc; text-align: left;"><th style="padding: 5px;">#</th><th style="padding: 5px;">Joueur</th>';
    closedSeasons.forEach(season => {
        html += `<th style="padding: 5px; opacity: 0.5; font-weight: normal;" title="Saison terminée">${season.label}</th>`;
    });
    if (currentSeason) {
        html += `<th style="padding: 5px; color: var(--correct);">${currentSeason.label}</th>`;
    }
    html += '<th style="padding: 5px;">Total</th></tr>';

    rows.slice(0, 50).forEach((row, index) => {
        const isMe = currentUser && row.user_id === currentUser.id;
        const style = isMe ? 'background: rgba(0, 255, 0, 0.1); font-weight: bold;' : '';

        html += `<tr style="${style} border-bottom: 1px solid var(--tile-border);">
            <td style="padding: 8px;">${index + 1}</td>
            <td style="padding: 8px;">${leaderboardNameCell(row)}</td>`;

        closedSeasons.forEach(season => {
            const pts = row.seasonScores[season.number] || 0;
            html += `<td style="padding: 8px; opacity: 0.45;">${pts}</td>`;
        });

        if (currentSeason) {
            html += `<td style="padding: 8px; font-weight: bold; color: var(--correct);">${row.currentSeasonScore}</td>`;
        }

        html += `<td style="padding: 8px; font-weight: bold;">${row.total_score} pts</td></tr>`;
    });
    html += '</table>';

    container.innerHTML = html;
}

async function recordScoreEvent(points, source) {
    const score = Number(points) || 0;
    if (score <= 0) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || !session.user) return;

    try {
        const { error } = await supabaseClient
            .from('score_events')
            .insert({
                user_id: session.user.id,
                points: score,
                source,
                created_at: new Date().toISOString()
            });

        if (error) throw error;
    } catch (error) {
        console.warn('Impossible d’enregistrer le score dans score_events:', error);
    }
}

window.recordScoreEvent = recordScoreEvent;

// --- LEADERBOARD LOGIC ---

function injectLeaderboardModal() {
    if (document.getElementById('leaderboard-modal')) return;

    const modalHtml = `
    <div id="leaderboard-modal" class="custom-modal-overlay hidden" style="z-index: 4000;">
        <div class="custom-modal-box" style="max-width: 600px;">
            <h3>Classement</h3>
            
            <!-- TABS -->
            <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                <button id="tab-leaderboard-global" class="tab-btn active" onclick="switchLeaderboardTab('global')">Global</button>
                <button id="tab-leaderboard-daily" class="tab-btn" onclick="switchLeaderboardTab('daily')">Jour</button>
                <button id="tab-leaderboard-weekly" class="tab-btn" onclick="switchLeaderboardTab('weekly')">Semaine</button>
                <button id="tab-leaderboard-friends" class="tab-btn" onclick="switchLeaderboardTab('friends')">Amis</button>
            </div>

            <!-- RESET COUNTDOWN (shown only for Jour / Semaine) -->
            <div id="leaderboard-reset-info" class="hidden" style="text-align: center; font-size: 0.8rem; opacity: 0.7; margin-bottom: 10px;"></div>

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

async function loadRecentLeaderboard(period) {
    const startDate = period === 'daily' ? getLocalDayStart() : getLocalWeekStart();
    const { data: events, error } = await supabaseClient
        .from('score_events')
        .select('user_id, points')
        .gte('created_at', startDate.toISOString());

    if (error) throw error;

    const totals = new Map();
    (events || []).forEach(event => {
        const userId = event.user_id;
        const points = Number(event.points) || 0;
        totals.set(userId, (totals.get(userId) || 0) + points);
    });

    return Array.from(totals.entries())
        .map(([user_id, total_score]) => ({ user_id, total_score }))
        .sort((a, b) => b.total_score - a.total_score);
}

async function loadGlobalLeaderboard() {
    const { data: stats, error } = await supabaseClient
        .from('user_stats')
        .select('user_id, pseudo, friend_code, avatar_index, daily_total_points, multiplayer_total_score');

    if (error) throw error;

    return (stats || [])
        .map(stat => ({
            user_id: stat.user_id,
            pseudo: stat.pseudo,
            friend_code: stat.friend_code,
            avatar_index: stat.avatar_index,
            total_score: getLeaderboardScore(stat)
        }))
        .sort((a, b) => b.total_score - a.total_score);
}

async function loadStatsForUsers(userIds) {
    if (!userIds.length) return new Map();

    const { data: stats, error } = await supabaseClient
        .from('user_stats')
        .select('user_id, pseudo, friend_code, avatar_index')
        .in('user_id', userIds);

    if (error) throw error;

    return new Map((stats || []).map(stat => [stat.user_id, stat]));
}

function updateLeaderboardResetInfo(type) {
    const resetInfo = document.getElementById('leaderboard-reset-info');
    if (!resetInfo) return;

    if (type === 'daily' || type === 'weekly') {
        const label = type === 'daily' ? 'journalier' : 'hebdomadaire';
        resetInfo.textContent = `Reset ${label} dans ${getTimeUntilReset(type)}`;
        resetInfo.classList.remove('hidden');
    } else {
        resetInfo.classList.add('hidden');
    }
}

async function loadLeaderboard(type) {
    const container = document.getElementById('leaderboard-content');
    container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Chargement...</p>';
    updateLeaderboardResetInfo(type);

    // Onglet Global : classement divisé par saison si la table `seasons` existe,
    // sinon on retombe silencieusement sur l'ancien classement global simple.
    // Les onglets Jour / Semaine / Amis ne sont pas concernés par ce bloc.
    if (type === 'global') {
        try {
            const seasonal = await buildSeasonalLeaderboard();

            if (seasonal && !seasonal.legacy) {
                updateSeasonCountdownBanner(seasonal.currentSeason, null);
                renderSeasonalLeaderboardTable(seasonal);
                return;
            }

            if (seasonal && seasonal.upcomingSeason) {
                updateSeasonCountdownBanner(null, seasonal.upcomingSeason);
            }
        } catch (e) {
            // Table `seasons` pas encore créée : comportement classique inchangé.
            console.warn('Classement par saison indisponible, classement global classique utilisé.', e);
        }

        try {
            const rows = await loadGlobalLeaderboard();
            renderSimpleLeaderboardTable(rows, 'Points global');
        } catch (e) {
            console.error(e);
            container.innerHTML = '<p style="text-align: center; color: var(--absent);">Erreur chargement.</p>';
        }
        return;
    }

    try {
        const isFriends = type === 'friends';
        const isRecent = type === 'daily' || type === 'weekly';
        let rows = [];

        if (isRecent) {
            rows = await loadRecentLeaderboard(type);
        } else {
            rows = await loadGlobalLeaderboard();
        }

        if (isFriends) {
            if (!currentUser) {
                container.innerHTML = '<p style="text-align: center; opacity: 0.6;">Connectez-vous pour voir le classement amis.</p>';
                return;
            }

            const { data: friendships } = await supabaseClient
                .from('friends')
                .select('user_id_1, user_id_2')
                .or(`user_id_1.eq.${currentUser.id},user_id_2.eq.${currentUser.id}`)
                .eq('status', 'accepted');

            const friendIds = (friendships || []).map(f => f.user_id_1 === currentUser.id ? f.user_id_2 : f.user_id_1);
            friendIds.push(currentUser.id);
            rows = rows.filter(row => friendIds.includes(row.user_id));
        }

        if (isRecent) {
            const statsMap = await loadStatsForUsers(rows.map(row => row.user_id));
            rows = rows.map(row => ({
                ...row,
                ...statsMap.get(row.user_id)
            }));
        }

        const scoreTitle = type === 'daily' ? 'Points du jour' : type === 'weekly' ? 'Points semaine' : 'Points global';
        renderSimpleLeaderboardTable(rows, scoreTitle);

    } catch (e) {
        console.error(e);
        if (type === 'daily' || type === 'weekly') {
            container.innerHTML = '<p style="text-align: center; color: var(--absent);">Le classement journalier/hebdo nécessite la table <strong>score_events</strong> sur Supabase.</p>';
        } else {
            container.innerHTML = '<p style="text-align: center; color: var(--absent);">Erreur chargement.</p>';
        }
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
    injectPublicProfileModal();
    injectLeaderboardModal();
    initInviteModal();

    const loginBtn = document.getElementById('btn-login-google');
    const logoutBtn = document.getElementById('btn-logout');
    const userProfileDiv = document.getElementById('user-profile-display');
    const leaderboardBtn = document.getElementById('leaderboardBtn');

    // Not Logged In Warning (Daily Mode)
    const notLoggedInModal = document.getElementById('not-logged-in-modal');
    const btnLoginFromWarning = document.getElementById('btn-login-from-warning');
    const btnPlayAnyway = document.getElementById('btn-play-anyway');
    if (btnLoginFromWarning) {
        btnLoginFromWarning.addEventListener('click', signInWithGoogle);
    }
    if (btnPlayAnyway) {
        btnPlayAnyway.addEventListener('click', () => {
            notLoggedInModal.classList.add('hidden');
        });
    }
    if (notLoggedInModal) {
        notLoggedInModal.addEventListener('click', (e) => {
            if (e.target === notLoggedInModal) notLoggedInModal.classList.add('hidden');
        });
    }

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

        // Mode "Mot du Jour" sans connexion : on prévient (à chaque partie) que
        // le score ne sera pas enregistré, sans empêcher de jouer.
        const authUrlParams = new URLSearchParams(window.location.search);
        const authGameMode = authUrlParams.get('mode') || 'daily';
        const isDailyGamePage = window.location.pathname.endsWith('game.html') && authGameMode === 'daily';
        if (isDailyGamePage && notLoggedInModal) {
            notLoggedInModal.classList.remove('hidden');
        }
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
