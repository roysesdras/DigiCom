/**
 * DigiCom SuperAdmin Control Dashboard Module
 * Lazy-loaded on demand ONLY for Admin users on Desktop.
 * ZERO Emojis - Clean SVG Icons & Professional Typography.
 */

(function () {
  'use strict';

  if (window.AdminDashboard) return;

  const state = {
    metrics: null,
    users: [],
    searchQuery: '',
    activeTab: 'metrics', // 'metrics' | 'users' | 'broadcast'
    isLoading: false
  };

  // SVG Icons (Zero Emojis)
  const icons = {
    shield: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
    users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    activity: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
    bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
    trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
    slash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`,
    close: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function injectAdminStyles() {
    if (document.getElementById('admin-dashboard-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-dashboard-styles';
    style.textContent = `
      @media (max-width: 768px) {
        .admin-modal-overlay, .btn-admin-dashboard {
          display: none !important;
        }
      }
      .admin-modal-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(11, 20, 26, 0.85);
        backdrop-filter: blur(8px);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        animation: adminFadeIn 0.2s ease;
      }
      @keyframes adminFadeIn {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .admin-modal-card {
        background: #111b21;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        width: 100%;
        max-width: 960px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 50px rgba(0,0,0,0.6);
        overflow: hidden;
        color: #e9edef;
        font-family: inherit;
      }
      .admin-header {
        padding: 1.25rem 1.5rem;
        background: #202c33;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .admin-title-box {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }
      .admin-title-box h2 {
        font-size: 1.15rem;
        font-weight: 700;
        margin: 0;
        color: #f1f5f9;
        letter-spacing: 0.02em;
      }
      .admin-badge-role {
        padding: 0.2rem 0.6rem;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(16, 185, 129, 0.3);
        color: #10b981;
        font-size: 0.72rem;
        font-weight: 600;
        border-radius: 99px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .admin-nav-tabs {
        display: flex;
        background: #111b21;
        padding: 0.5rem 1.5rem 0 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        gap: 0.5rem;
      }
      .admin-tab-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        padding: 0.65rem 1.1rem;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-bottom: 2px solid transparent;
        transition: all 0.15s ease;
      }
      .admin-tab-btn:hover {
        color: #e2e8f0;
      }
      .admin-tab-btn.active {
        color: #00a884;
        border-bottom-color: #00a884;
      }
      .admin-content {
        padding: 1.5rem;
        overflow-y: auto;
        flex: 1;
      }
      .admin-grid-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .metric-card {
        background: #1f2c34;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        padding: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .metric-label {
        font-size: 0.78rem;
        color: #94a3b8;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .metric-val {
        font-size: 1.6rem;
        font-weight: 700;
        color: #f8fafc;
      }
      .metric-sub {
        font-size: 0.75rem;
        color: #10b981;
      }
      .admin-table-wrapper {
        background: #1f2c34;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        overflow: hidden;
      }
      .admin-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 0.85rem;
      }
      .admin-table th {
        background: #111b21;
        padding: 0.85rem 1rem;
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.72rem;
        letter-spacing: 0.04em;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .admin-table td {
        padding: 0.85rem 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        color: #e2e8f0;
      }
      .admin-table tr:last-child td {
        border-bottom: none;
      }
      .admin-btn-action {
        padding: 0.38rem 0.7rem;
        border-radius: 6px;
        border: none;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: background 0.15s ease, opacity 0.15s ease;
      }
      .btn-ban {
        background: rgba(245, 158, 11, 0.18);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.3);
      }
      .btn-ban:hover {
        background: rgba(245, 158, 11, 0.35);
      }
      .btn-unban {
        background: rgba(16, 185, 129, 0.18);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.3);
      }
      .btn-nuke {
        background: rgba(239, 68, 68, 0.18);
        color: #f87171;
        border: 1px solid rgba(239, 68, 68, 0.3);
        margin-left: 0.35rem;
      }
      .btn-nuke:hover {
        background: rgba(239, 68, 68, 0.35);
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.18rem 0.5rem;
        border-radius: 99px;
        font-size: 0.72rem;
        font-weight: 600;
      }
      .status-pill.online {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
      }
      .status-pill.offline {
        background: rgba(148, 163, 184, 0.12);
        color: #94a3b8;
      }
      .status-pill.banned {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
      }
      .admin-search-box {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        background: #111b21;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.45rem 0.85rem;
        margin-bottom: 1rem;
      }
      .admin-search-box input {
        background: transparent;
        border: none;
        color: #f8fafc;
        font-size: 0.88rem;
        outline: none;
        width: 100%;
      }
      .broadcast-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 600px;
      }
      .broadcast-form textarea {
        background: #1f2c34;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 0.85rem;
        color: #f8fafc;
        font-size: 0.9rem;
        resize: vertical;
        min-height: 120px;
        outline: none;
      }
      .broadcast-form textarea:focus {
        border-color: #00a884;
      }
      .btn-send-broadcast {
        background: #00a884;
        color: #111b21;
        border: none;
        border-radius: 8px;
        padding: 0.75rem 1.25rem;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .btn-send-broadcast:hover {
        background: #029474;
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchMetrics() {
    try {
      const res = await fetch('/api/admin/metrics', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (data.success) {
        state.metrics = data.metrics;
      }
    } catch (e) {
      console.error('[Admin] Error fetching metrics:', e);
    }
  }

  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (data.success) {
        state.users = data.users || [];
      }
    } catch (e) {
      console.error('[Admin] Error fetching users:', e);
    }
  }

  async function toggleBanUser(userId, currentBanState) {
    const actionName = currentBanState ? 'débannir' : 'bannir';
    if (!confirm(`Voulez-vous vraiment ${actionName} cet utilisateur ?`)) return;

    try {
      const res = await fetch('/api/admin/users/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, banState: !currentBanState })
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
        await fetchMetrics();
        renderAdminContent();
      } else {
        alert(data.error || 'Erreur lors du bannissement');
      }
    } catch (e) {
      alert('Erreur réseau');
    }
  }

  async function nukeUser(userId, username) {
    if (!confirm(`ATTENTION: Voulez-vous TOUT SUPPRIMER pour @${username} ?\n\nCela effacera définitivement le compte, TOUS ses messages envoyés/reçus et ses fichiers joints.`)) {
      return;
    }
    const confirmPrompt = prompt(`Pour confirmer la suppression totale (Nuke), saisissez le nom d'utilisateur "${username}" :`);
    if (confirmPrompt !== username) {
      alert('Confirmation incorrecte. Annulation de la suppression.');
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/nuke/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert('Utilisateur et l\'intégralité de son historique purgés avec succès.');
        await fetchUsers();
        await fetchMetrics();
        renderAdminContent();
      } else {
        alert(data.error || 'Erreur lors de la purge');
      }
    } catch (e) {
      alert('Erreur réseau');
    }
  }

  async function sendBroadcast(message) {
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (data.success) {
        alert('Annonce diffusée en direct à tous les utilisateurs connectés.');
        document.getElementById('broadcast-text').value = '';
      } else {
        alert(data.error || 'Erreur lors de l\'envoi');
      }
    } catch (e) {
      alert('Erreur réseau');
    }
  }

  function renderAdminContent() {
    const container = document.getElementById('admin-dashboard-body');
    if (!container) return;

    if (state.activeTab === 'metrics') {
      const m = state.metrics || {};
      container.innerHTML = `
        <div class="admin-grid-metrics">
          <div class="metric-card">
            <span class="metric-label">Connectés Direct</span>
            <span class="metric-val" style="color: #10b981;">${m.online_users_count || 0}</span>
            <span class="metric-sub">${m.online_sockets || 0} sockets WebSockets</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Total Utilisateurs</span>
            <span class="metric-val">${m.total_users || 0}</span>
            <span class="metric-sub">Comptes enregistrés</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Salons Actifs</span>
            <span class="metric-val">${m.total_salons || 0}</span>
            <span class="metric-sub">Groupes de discussion</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Messages Aujourd'hui</span>
            <span class="metric-val" style="color: #38bdf8;">${m.today_messages || 0}</span>
            <span class="metric-sub">${m.total_messages || 0} messages au total</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Mémoire Serveur VPS</span>
            <span class="metric-val">${m.server_memory_mb || 0} MB</span>
            <span class="metric-sub">Uptime: ${m.server_uptime_hours || 0} heures</span>
          </div>
        </div>
      `;
    } else if (state.activeTab === 'users') {
      const query = (state.searchQuery || '').trim().toLowerCase();
      let filteredUsers = state.users;
      if (query) {
        filteredUsers = filteredUsers.filter(u => 
          (u.username || '').toLowerCase().includes(query) ||
          (u.display_name || '').toLowerCase().includes(query) ||
          (u.role || '').toLowerCase().includes(query)
        );
      }

      let rowsHtml = filteredUsers.map(u => {
        const isBanned = Boolean(u.is_banned);
        const isOnline = Boolean(u.is_online);
        return `
          <tr>
            <td><strong>@${escapeHtml(u.username)}</strong></td>
            <td>${escapeHtml(u.display_name || u.username)}</td>
            <td><span class="admin-badge-role">${escapeHtml(u.role)}</span></td>
            <td>
              ${isBanned 
                ? `<span class="status-pill banned">Banni</span>`
                : isOnline 
                  ? `<span class="status-pill online">En ligne</span>` 
                  : `<span class="status-pill offline">Hors ligne</span>`}
            </td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '-'}</td>
            <td style="text-align: right;">
              <button class="admin-btn-action ${isBanned ? 'btn-unban' : 'btn-ban'}" data-user-id="${u.id}" data-banned="${isBanned ? '1' : '0'}">
                ${icons.slash} ${isBanned ? 'Débannir' : 'Bannir'}
              </button>
              ${u.role !== 'admin' ? `
                <button class="admin-btn-action btn-nuke" data-nuke-id="${u.id}" data-username="${escapeHtml(u.username)}">
                  ${icons.trash} Nuke
                </button>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');

      container.innerHTML = `
        <div class="admin-search-box">
          ${icons.search}
          <input type="text" id="admin-search-input" placeholder="Rechercher par pseudo, nom ou rôle..." value="${escapeHtml(state.searchQuery)}">
        </div>
        <div class="admin-table-wrapper">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Identifiant</th>
                <th>Nom d'affichage</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Date d'inscription</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #94a3b8;">Aucun utilisateur trouvé.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;

      const searchInput = document.getElementById('admin-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          state.searchQuery = e.target.value;
          renderAdminContent();
        });
      }

      container.querySelectorAll('.btn-ban, .btn-unban').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.userId;
          const isBanned = btn.dataset.banned === '1';
          toggleBanUser(uid, isBanned);
        });
      });

      container.querySelectorAll('.btn-nuke').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.nukeId;
          const uname = btn.dataset.username;
          nukeUser(uid, uname);
        });
      });
    } else if (state.activeTab === 'broadcast') {
      container.innerHTML = `
        <div class="broadcast-form">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #f8fafc;">Diffusion d'une annonce générale en direct</h3>
          <p style="font-size: 0.85rem; color: #94a3b8; margin: 0 0 1rem 0;">Ce message s'affichera immédiatement en alerte sur les écrans de tous les utilisateurs actuellement connectés.</p>
          <textarea id="broadcast-text" placeholder="Saisissez votre annonce ici..."></textarea>
          <button type="button" class="btn-send-broadcast" id="btn-submit-broadcast">
            ${icons.bell} Diffuser l'annonce
          </button>
        </div>
      `;

      const btn = document.getElementById('btn-submit-broadcast');
      if (btn) {
        btn.addEventListener('click', () => {
          const text = document.getElementById('broadcast-text').value;
          if (!text || !text.trim()) {
            alert('Veuillez saisir un texte d\'annonce.');
            return;
          }
          sendBroadcast(text);
        });
      }
    }
  }

  function openModal() {
    injectAdminStyles();

    let overlay = document.getElementById('admin-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'admin-modal-overlay';
      overlay.className = 'admin-modal-overlay';
      overlay.innerHTML = `
        <div class="admin-modal-card">
          <div class="admin-header">
            <div class="admin-title-box">
              ${icons.shield}
              <h2>SuperAdmin Control Center</h2>
              <span class="admin-badge-role">SuperAdmin</span>
            </div>
            <button type="button" id="btn-admin-close" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;padding:4px;">
              ${icons.close}
            </button>
          </div>
          <div class="admin-nav-tabs">
            <button class="admin-tab-btn active" data-tab="metrics">
              ${icons.activity} Métriques & Serveur
            </button>
            <button class="admin-tab-btn" data-tab="users">
              ${icons.users} Utilisateurs & Modération
            </button>
            <button class="admin-tab-btn" data-tab="broadcast">
              ${icons.bell} Annonce Générale
            </button>
          </div>
          <div class="admin-content" id="admin-dashboard-body">
            <div style="text-align:center; padding: 2rem; color: #94a3b8;">Chargement des télémétries...</div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      document.getElementById('btn-admin-close').addEventListener('click', closeModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });

      overlay.querySelectorAll('.admin-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
          overlay.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
          tabBtn.classList.add('active');
          state.activeTab = tabBtn.dataset.tab;
          renderAdminContent();
        });
      });
    }

    overlay.style.display = 'flex';
    Promise.all([fetchMetrics(), fetchUsers()]).then(() => {
      renderAdminContent();
    });
  }

  function closeModal() {
    const overlay = document.getElementById('admin-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  window.AdminDashboard = {
    open: openModal,
    close: closeModal
  };
})();
