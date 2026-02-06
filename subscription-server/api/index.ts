import { handle } from "hono/vercel";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sql } from "@vercel/postgres";
import { createHash, randomBytes } from "crypto";
import Stripe from "stripe";

export const runtime = "nodejs";

// ============================================================================
// Admin HTML
// ============================================================================

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude PI Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: {
              900: '#f8fafc',
              800: '#e2e8f0',
              700: '#cbd5e1',
              500: '#94a3b8',
              400: '#64748b',
              200: '#334155',
            },
            accent: {
              600: '#fb7185',
              500: '#f97316',
              50: '#2a1016',
            },
            surface: {
              50: '#020617',
              200: '#1e293b',
            }
          }
        }
      }
    }
  </script>
  <style>
    :root {
      --ribbon-a: linear-gradient(120deg, #fef08a 0%, #f97316 28%, #ef4444 54%, #111827 78%, #06b6d4 100%);
      --ribbon-b: linear-gradient(115deg, #0b1120 10%, #111827 32%, #0f172a 40%, #ef4444 60%, #22d3ee 100%);
      --glass: rgba(8, 15, 30, 0.62);
      --line: rgba(148, 163, 184, 0.22);
      --glow: 0 20px 50px rgba(15, 23, 42, 0.55);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Sora", system-ui, sans-serif;
      color: #e2e8f0;
      background: radial-gradient(circle at 14% 22%, rgba(249,115,22,0.22), transparent 34%),
                  radial-gradient(circle at 82% 18%, rgba(34,211,238,0.24), transparent 36%),
                  radial-gradient(circle at 76% 78%, rgba(236,72,153,0.18), transparent 36%),
                  #020617;
      min-height: 100vh;
      overflow-x: hidden;
    }
    body::before,
    body::after {
      content: "";
      position: fixed;
      width: 150vw;
      height: 42vh;
      left: -25vw;
      border-radius: 999px;
      filter: blur(8px) saturate(1.05);
      opacity: 0.9;
      pointer-events: none;
      z-index: -1;
    }
    body::before {
      top: 10vh;
      background: var(--ribbon-a);
      transform: rotate(-11deg);
    }
    body::after {
      bottom: -10vh;
      background: var(--ribbon-b);
      transform: rotate(8deg);
      opacity: 0.75;
    }
    h1, h2, h3 { font-family: "Space Grotesk", sans-serif; letter-spacing: 0.01em; }
    .max-w-6xl {
      max-width: 1150px !important;
      background: var(--glass);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--glow);
      backdrop-filter: blur(14px);
      margin-top: 2rem;
    }
    .bg-white {
      background: rgba(15, 23, 42, 0.68) !important;
      border: 1px solid var(--line) !important;
      backdrop-filter: blur(10px);
    }
    .bg-brand-100,
    .hover\:bg-brand-100:hover { background: rgba(30, 41, 59, 0.8) !important; }
    .rounded-xl, .rounded-2xl { border-radius: 18px !important; }
    .text-brand-900 { color: #f8fafc !important; }
    .text-brand-800, .text-brand-700 { color: #cbd5e1 !important; }
    .text-brand-500, .text-brand-400 { color: #94a3b8 !important; }
    .bg-surface-50 { background: rgba(15, 23, 42, 0.52) !important; }
    .border-surface-200 { border-color: rgba(148, 163, 184, 0.2) !important; }
    .bg-brand-900 {
      background: linear-gradient(130deg, #f97316 0%, #ef4444 40%, #06b6d4 100%) !important;
      color: #fff !important;
      box-shadow: 0 10px 25px rgba(14, 165, 233, 0.28), inset 0 0 0 1px rgba(255,255,255,0.16);
    }
    .bg-brand-900:hover { filter: brightness(1.06); }
    .hover\:bg-brand-800:hover { filter: brightness(1.06); }
    .bg-accent-600 {
      background: linear-gradient(125deg, #fb7185 0%, #f97316 100%) !important;
      box-shadow: 0 12px 24px rgba(249, 115, 22, 0.28);
    }
    .hover\:bg-accent-500:hover { filter: brightness(1.08); }
    .bg-red-50, .bg-green-50, .bg-blue-50, .bg-accent-50 {
      background: rgba(15, 23, 42, 0.6) !important;
    }
    .text-red-700 { color: #fda4af !important; }
    .text-green-700, .text-green-600 { color: #6ee7b7 !important; }
    .text-blue-700, .text-blue-600 { color: #7dd3fc !important; }
    .text-accent-600, .hover\:text-accent-500:hover { color: #fb7185 !important; }
    input, select {
      background: rgba(2, 6, 23, 0.75) !important;
      color: #e2e8f0 !important;
      border-color: rgba(148, 163, 184, 0.3) !important;
    }
    input::placeholder { color: #64748b; }
    .shadow-sm, .shadow-lg { box-shadow: var(--glow) !important; }
    .grid > .bg-white { transition: transform 180ms ease, box-shadow 220ms ease, border-color 220ms ease; }
    .grid > .bg-white:hover {
      transform: translateY(-3px);
      border-color: rgba(34, 211, 238, 0.34) !important;
      box-shadow: 0 20px 40px rgba(8, 47, 73, 0.4) !important;
    }
    tr { transition: background-color 160ms ease; }
    tr:hover { background: rgba(30, 41, 59, 0.42); }
    button { transition: transform 140ms ease, filter 180ms ease, box-shadow 180ms ease; }
    button:hover { transform: translateY(-1px); }
    .fixed.inset-0.bg-brand-900\/60 { background: rgba(2, 6, 23, 0.74) !important; }
    @media (max-width: 900px) {
      .max-w-6xl { margin: 0.75rem; border-radius: 18px; }
      body::before, body::after { opacity: 0.55; }
    }
  </style>
</head>
<body class="bg-surface-50 min-h-screen">
  <div id="app"></div>
  <script>
    const API_BASE = window.location.origin;
    let state = {
      apiKey: localStorage.getItem('adminApiKey') || '',
      authenticated: false,
      tab: 'stats',
      stats: null,
      users: [],
      rootUsers: [],
      apiKeys: [],
      usage: null,
      loading: false,
      error: null,
      showAddKey: false,
      newKeyName: '',
      newKeyValue: '',
      showUserModal: null,
      selectedUser: null,
      expandedRootIds: [],
      rootDetailsById: {},
      loadingRootIds: [],
      showAssignKey: null,
      showAddUser: false,
      newUserEmail: '',
      newUserTrialDays: 14,
      newUserMaxLicenses: 10,
    };
    function setState(updates) {
      state = { ...state, ...updates };
      render();
    }
    async function apiCall(endpoint, options = {}) {
      const res = await fetch(API_BASE + endpoint, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + state.apiKey,
          ...options.headers,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'HTTP ' + res.status);
      }
      return res.json();
    }
    async function login() {
      setState({ loading: true, error: null });
      try {
        const stats = await apiCall('/v1/admin/stats');
        localStorage.setItem('adminApiKey', state.apiKey);
        setState({ authenticated: true, stats, loading: false });
        loadData();
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    }
    async function loadData() {
      try {
        const [stats, usersData, rootUsersData, keysData, usageData] = await Promise.all([
          apiCall('/v1/admin/stats'),
          apiCall('/v1/admin/users'),
          apiCall('/v1/admin/root-users'),
          apiCall('/v1/admin/api-keys'),
          apiCall('/v1/admin/usage'),
        ]);
        setState({
          stats,
          users: usersData.users || [],
          rootUsers: rootUsersData.roots || [],
          apiKeys: keysData.keys || [],
          usage: usageData
        });
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function toggleRootGroup(rootUserId) {
      const expanded = state.expandedRootIds || [];
      if (expanded.includes(rootUserId)) {
        setState({ expandedRootIds: expanded.filter((id) => id !== rootUserId) });
        return;
      }
      const existing = state.rootDetailsById ? state.rootDetailsById[rootUserId] : null;
      if (existing) {
        setState({ expandedRootIds: [...expanded, rootUserId] });
        return;
      }
      const loading = state.loadingRootIds || [];
      if (!loading.includes(rootUserId)) {
        setState({ loadingRootIds: [...loading, rootUserId] });
      }
      try {
        const detail = await apiCall('/v1/admin/root-users/' + rootUserId + '/members');
        setState({
          rootDetailsById: { ...(state.rootDetailsById || {}), [rootUserId]: detail },
          loadingRootIds: (state.loadingRootIds || []).filter((id) => id !== rootUserId),
          expandedRootIds: [...(state.expandedRootIds || []), rootUserId],
        });
      } catch (err) {
        setState({
          error: err.message,
          loadingRootIds: (state.loadingRootIds || []).filter((id) => id !== rootUserId),
        });
      }
    }
    async function toggleKeyActive(id, isActive) {
      try {
        await apiCall('/v1/admin/api-keys/' + id, { method: 'PATCH', body: JSON.stringify({ isActive: !isActive }) });
        loadData();
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function deleteKey(id) {
      if (!confirm('Delete this API key?')) return;
      try {
        await apiCall('/v1/admin/api-keys/' + id, { method: 'DELETE' });
        loadData();
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function addKey() {
      if (!state.newKeyValue) return;
      setState({ loading: true });
      try {
        await apiCall('/v1/admin/api-keys', { method: 'POST', body: JSON.stringify({ key: state.newKeyValue, name: state.newKeyName || 'Unnamed' }) });
        setState({ showAddKey: false, newKeyName: '', newKeyValue: '', loading: false });
        loadData();
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    }
    async function assignKeyToUser(keyId, userId) {
      try {
        await apiCall('/v1/admin/api-keys/' + keyId + '/assign', { method: 'PATCH', body: JSON.stringify({ userId: userId || null }) });
        setState({ showAssignKey: null });
        loadData();
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function viewUser(userId) {
      try {
        const user = await apiCall('/v1/admin/users/' + userId);
        setState({ showUserModal: true, selectedUser: user });
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function updateUserSubscription(userId, updates) {
      try {
        await apiCall('/v1/admin/users/' + userId + '/subscription', { method: 'PATCH', body: JSON.stringify(updates) });
        viewUser(userId);
        loadData();
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function createUserAdmin() {
      if (!state.newUserEmail) return;
      setState({ loading: true, error: null });
      try {
        await apiCall('/v1/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            email: state.newUserEmail,
            trialDays: Number(state.newUserTrialDays) || 14,
            maxLicenses: Number(state.newUserMaxLicenses) || 10,
          }),
        });
        setState({
          showAddUser: false,
          newUserEmail: '',
          newUserTrialDays: 14,
          newUserMaxLicenses: 10,
          loading: false
        });
        loadData();
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    }
    async function deleteUserAdmin(userId) {
      const user = (state.users || []).find((u) => u.id === userId);
      const email = user ? user.email : ('ID ' + userId);
      if (!confirm('Delete user ' + email + '? This will remove access and auth tokens.')) return;
      try {
        await apiCall('/v1/admin/users/' + userId, { method: 'DELETE' });
        if (state.selectedUser && state.selectedUser.id === userId) {
          setState({ showUserModal: false, selectedUser: null });
        }
        loadData();
      } catch (err) {
        setState({ error: err.message });
      }
    }
    async function extendTrial(userId, days) {
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + days);
      await updateUserSubscription(userId, { trialEndsAt: newDate.toISOString(), currentPeriodEnd: newDate.toISOString(), status: 'trialing' });
    }
    async function runMaintenance() {
      setState({ loading: true });
      try {
        const result = await apiCall('/v1/admin/maintenance', { method: 'POST', body: JSON.stringify({ cleanupTokens: true, resetDailyUsage: true }) });
        alert('Maintenance complete: ' + JSON.stringify(result.results));
        setState({ loading: false });
        loadData();
      } catch (err) {
        setState({ error: err.message, loading: false });
      }
    }
    function logout() {
      localStorage.removeItem('adminApiKey');
      setState({ authenticated: false, apiKey: '' });
    }
    function formatDate(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleDateString();
    }
    function formatDateTime(dateStr) {
      if (!dateStr) return '-';
      return new Date(dateStr).toLocaleString();
    }
    function formatTokens(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n.toString();
    }
    function render() {
      const app = document.getElementById('app');
      if (!state.authenticated) {
        app.innerHTML = '<div class="min-h-screen flex items-center justify-center"><div class="bg-white rounded-xl shadow-lg p-8 w-full max-w-md"><h1 class="text-2xl font-semibold text-brand-900 mb-6">Claude PI Admin</h1>' + (state.error ? '<div class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4">' + state.error + '</div>' : '') + '<div class="space-y-4"><div><label class="block text-sm font-medium text-brand-700 mb-1">Admin API Key</label><input type="password" id="apiKeyInput" value="' + state.apiKey + '" placeholder="Enter your admin API key" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div><button onclick="login()" ' + (state.loading ? 'disabled' : '') + ' class="w-full bg-brand-900 text-white py-2 px-4 rounded-lg hover:bg-brand-800 transition-colors disabled:opacity-50">' + (state.loading ? 'Connecting...' : 'Connect') + '</button></div></div></div>';
        document.getElementById('apiKeyInput')?.addEventListener('input', (e) => { state.apiKey = e.target.value; });
        document.getElementById('apiKeyInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') login(); });
        return;
      }
      const statsHtml = !state.stats ? '<div class="text-brand-500">Loading...</div>' : '<div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.stats.totalUsers + '</div><div class="text-brand-500">Total Users</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.stats.activeSubscriptions + '</div><div class="text-brand-500">Active Subscriptions</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.stats.activeApiKeys + '</div><div class="text-brand-500">API Keys</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.stats.validationsLast24h + '</div><div class="text-brand-500">Validations (24h)</div></div></div>';
      const usersHeaderHtml = '<div class="mb-4"><button onclick="setState({showAddUser:true})" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">+ Invite User</button></div>';
      const rootRowsHtml = (state.rootUsers || []).map(r => {
        const expanded = (state.expandedRootIds || []).includes(r.id);
        const loading = (state.loadingRootIds || []).includes(r.id);
        const detail = state.rootDetailsById ? state.rootDetailsById[r.id] : null;
        const arrow = expanded ? '&#9662;' : '&#9656;';
        const summaryRow = '<tr class="border-b border-surface-200"><td class="px-4 py-3 text-brand-900"><button onclick="toggleRootGroup(' + r.id + ')" class="text-brand-700 hover:text-brand-900 mr-2">' + arrow + '</button>' + r.email + '</td><td class="px-4 py-3"><span class="inline-flex px-2 py-1 text-xs font-medium rounded-md ' + (r.subscriptionStatus === 'active' ? 'bg-green-50 text-green-700' : r.subscriptionStatus === 'trialing' ? 'bg-accent-50 text-accent-600' : 'bg-red-50 text-red-700') + '">' + r.subscriptionStatus + '</span></td><td class="px-4 py-3 text-brand-500">' + (r.maxLicenses || 0) + '</td><td class="px-4 py-3 text-brand-500">' + (r.subUserCount || 0) + '</td><td class="px-4 py-3 text-brand-500">' + (r.pendingInviteCount || 0) + '</td><td class="px-4 py-3 space-x-3"><button onclick="viewUser(' + r.id + ')" class="text-sm text-accent-600 hover:text-accent-500">View Root</button></td></tr>';
        if (!expanded) return summaryRow;
        if (loading) {
          return summaryRow + '<tr class="border-b border-surface-200 bg-surface-50"><td colspan="6" class="px-6 py-4 text-sm text-brand-500">Loading sub users and invites...</td></tr>';
        }
        const subUsers = detail && detail.subUsers ? detail.subUsers : [];
        const pendingInvites = detail && detail.pendingInvites ? detail.pendingInvites : [];
        const subUsersHtml = subUsers.length
          ? subUsers.map(u => '<div class="py-1"><span class="text-brand-900">' + u.email + '</span><span class="text-xs text-brand-500 ml-2">joined ' + formatDate(u.createdAt) + '</span></div>').join('')
          : '<div class="text-brand-500">No sub users yet.</div>';
        const invitesHtml = pendingInvites.length
          ? pendingInvites.map(i => '<div class="py-1"><span class="text-brand-900">' + i.email + '</span><span class="text-xs text-brand-500 ml-2">invited ' + formatDate(i.createdAt) + ' • trial ' + i.trialDays + ' days</span></div>').join('')
          : '<div class="text-brand-500">No pending invites.</div>';
        const detailRow = '<tr class="border-b border-surface-200 bg-surface-50"><td colspan="6" class="px-6 py-4"><div class="grid grid-cols-1 md:grid-cols-2 gap-6"><div><div class="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-2">Current Sub Users</div>' + subUsersHtml + '</div><div><div class="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-2">Pending Invites</div>' + invitesHtml + '</div></div></td></tr>';
        return summaryRow + detailRow;
      }).join('');
      const usersTableHtml = !state.rootUsers.length ? '<div class="text-brand-500">No root users yet</div>' : '<div class="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden"><table class="w-full"><thead class="bg-surface-50 border-b border-surface-200"><tr><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Root User</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Status</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Licenses</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Sub Users</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Pending Invites</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Actions</th></tr></thead><tbody>' + rootRowsHtml + '</tbody></table></div>';
      const usersHtml = usersHeaderHtml + usersTableHtml;
      const keysHtml = '<div class="mb-4"><button onclick="setState({showAddKey:true})" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">+ Add API Key</button></div>' + (state.apiKeys.length ? '<div class="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden"><table class="w-full"><thead class="bg-surface-50 border-b border-surface-200"><tr><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Name</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Status</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Assigned To</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Daily Usage</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Actions</th></tr></thead><tbody>' + state.apiKeys.map(k => '<tr class="border-b border-surface-200 last:border-0 ' + (k.isActive ? (k.assignedUserEmail ? 'bg-green-50/30' : 'bg-amber-50/30') : 'bg-red-50/30') + '"><td class="px-4 py-3 text-brand-900">' + (k.name || 'Unnamed') + '</td><td class="px-4 py-3"><span class="inline-flex px-2 py-1 text-xs font-medium rounded-md ' + (k.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700') + '">' + (k.isActive ? 'Active' : 'Disabled') + '</span></td><td class="px-4 py-3">' + (k.assignedUserEmail ? '<span class="text-green-600">' + k.assignedUserEmail + '</span>' : '<span class="text-brand-400">Unassigned</span>') + '</td><td class="px-4 py-3 text-brand-500">' + formatTokens(k.dailyUsageTokens || 0) + '</td><td class="px-4 py-3 space-x-2"><button onclick="setState({showAssignKey:' + k.id + '})" class="text-sm text-blue-600 hover:text-blue-500">Assign</button><button onclick="toggleKeyActive(' + k.id + ', ' + k.isActive + ')" class="text-sm text-accent-600 hover:text-accent-500">' + (k.isActive ? 'Disable' : 'Enable') + '</button><button onclick="deleteKey(' + k.id + ')" class="text-sm text-red-600 hover:text-red-500">Delete</button></td></tr>').join('') + '</tbody></table></div>' : '<div class="text-brand-500">No API keys in pool</div>');
      const usageHtml = !state.usage ? '<div class="text-brand-500">Loading usage data...</div>' : '<div class="space-y-6"><div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + formatTokens(state.usage.summary.last7Days.totalTokens) + '</div><div class="text-brand-500">Tokens (7 days)</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.usage.summary.last7Days.requestCount + '</div><div class="text-brand-500">Requests (7 days)</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + formatTokens(state.usage.summary.last30Days.totalTokens) + '</div><div class="text-brand-500">Tokens (30 days)</div></div><div class="bg-white rounded-xl p-6 shadow-sm border border-surface-200"><div class="text-3xl font-semibold text-brand-900">' + state.usage.summary.last30Days.requestCount + '</div><div class="text-brand-500">Requests (30 days)</div></div></div><div class="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden"><h3 class="px-4 py-3 font-medium text-brand-700 bg-surface-50 border-b border-surface-200">Usage by User (30 days)</h3><table class="w-full"><thead class="bg-surface-50 border-b border-surface-200"><tr><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">User</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Tokens</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Requests</th></tr></thead><tbody>' + (state.usage.byUser || []).filter(u => u.totalTokens > 0).map(u => '<tr class="border-b border-surface-200 last:border-0"><td class="px-4 py-3 text-brand-900">' + u.email + '</td><td class="px-4 py-3 text-brand-500">' + formatTokens(u.totalTokens) + '</td><td class="px-4 py-3 text-brand-500">' + u.requestCount + '</td></tr>').join('') + '</tbody></table></div><div class="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden"><h3 class="px-4 py-3 font-medium text-brand-700 bg-surface-50 border-b border-surface-200">Recent Activity</h3><table class="w-full"><thead class="bg-surface-50 border-b border-surface-200"><tr><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">User</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Type</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Tokens</th><th class="text-left px-4 py-3 text-sm font-medium text-brand-700">Time</th></tr></thead><tbody>' + (state.usage.recentLogs || []).slice(0, 20).map(l => '<tr class="border-b border-surface-200 last:border-0"><td class="px-4 py-3 text-brand-900">' + l.email + '</td><td class="px-4 py-3 text-brand-500">' + (l.requestType || 'unknown') + '</td><td class="px-4 py-3 text-brand-500">' + formatTokens(l.tokensUsed) + '</td><td class="px-4 py-3 text-brand-500 text-sm">' + formatDateTime(l.loggedAt) + '</td></tr>').join('') + '</tbody></table></div></div>';
      const addKeyModalHtml = state.showAddKey ? '<div class="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"><div class="bg-white rounded-2xl shadow-lg w-full max-w-md p-6"><h2 class="text-lg font-semibold text-brand-900 mb-4">Add API Key</h2><div class="space-y-4"><div><label class="block text-sm font-medium text-brand-700 mb-1">Name (optional)</label><input type="text" id="newKeyName" value="' + state.newKeyName + '" placeholder="e.g., Production Key 1" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div><div><label class="block text-sm font-medium text-brand-700 mb-1">Anthropic API Key</label><input type="password" id="newKeyValue" value="' + state.newKeyValue + '" placeholder="sk-ant-api03-..." class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div></div><div class="flex justify-end gap-2 mt-6"><button onclick="setState({showAddKey:false,newKeyName:\\'\\',newKeyValue:\\'\\'})" class="px-4 py-2 text-brand-500 hover:text-brand-700">Cancel</button><button onclick="addKey()" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">Add Key</button></div></div></div>' : '';
      const addUserModalHtml = state.showAddUser ? '<div class="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"><div class="bg-white rounded-2xl shadow-lg w-full max-w-md p-6"><h2 class="text-lg font-semibold text-brand-900 mb-2">Create Root Invite</h2><p class="text-sm text-brand-500 mb-4">Create signup eligibility by email for a root account. Team members are invited later by that root user.</p><div class="space-y-4"><div><label class="block text-sm font-medium text-brand-700 mb-1">Email</label><input type="email" id="newUserEmail" value="' + state.newUserEmail + '" placeholder="owner@firm.com" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div><div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-brand-700 mb-1">Trial Days</label><input type="number" min="0" id="newUserTrialDays" value="' + state.newUserTrialDays + '" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div><div><label class="block text-sm font-medium text-brand-700 mb-1">Max Licenses</label><input type="number" min="1" id="newUserMaxLicenses" value="' + state.newUserMaxLicenses + '" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500" /></div></div></div><div class="flex justify-end gap-2 mt-6"><button onclick="setState({showAddUser:false,newUserEmail:\\'\\',newUserTrialDays:14,newUserMaxLicenses:10})" class="px-4 py-2 text-brand-500 hover:text-brand-700">Cancel</button><button onclick="createUserAdmin()" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">Create Invite</button></div></div></div>' : '';
      const userModalHtml = state.showUserModal && state.selectedUser ? '<div class="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"><div class="bg-white rounded-2xl shadow-lg w-full max-w-lg p-6"><h2 class="text-lg font-semibold text-brand-900 mb-4">' + state.selectedUser.email + '</h2><div class="space-y-4"><div class="grid grid-cols-2 gap-4"><div><div class="text-sm text-brand-500">Status</div><div class="font-medium">' + state.selectedUser.subscriptionStatus + '</div></div><div><div class="text-sm text-brand-500">Created</div><div class="font-medium">' + formatDate(state.selectedUser.createdAt) + '</div></div><div><div class="text-sm text-brand-500">Expires</div><div class="font-medium">' + formatDate(state.selectedUser.trialEndsAt || state.selectedUser.currentPeriodEnd) + '</div></div><div><div class="text-sm text-brand-500">Assigned Key</div><div class="font-medium">' + (state.selectedUser.assignedKey ? state.selectedUser.assignedKey.name : 'Pool') + '</div></div></div><div class="border-t border-surface-200 pt-4"><div class="text-sm text-brand-500 mb-2">Usage (Last 30 Days)</div><div class="grid grid-cols-2 gap-4"><div class="bg-surface-50 rounded-lg p-3"><div class="text-xl font-semibold text-brand-900">' + formatTokens(state.selectedUser.usage?.last30Days?.totalTokens || 0) + '</div><div class="text-sm text-brand-500">Tokens</div></div><div class="bg-surface-50 rounded-lg p-3"><div class="text-xl font-semibold text-brand-900">' + (state.selectedUser.usage?.last30Days?.requestCount || 0) + '</div><div class="text-sm text-brand-500">Requests</div></div></div></div><div class="border-t border-surface-200 pt-4"><div class="text-sm text-brand-500 mb-2">Assign API Key</div><select id="userKeySelect" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500"><option value="">Use Pool (Rotation)</option>' + state.apiKeys.filter(k => k.isActive).map(k => '<option value="' + k.id + '" ' + (state.selectedUser.assignedKey?.id === k.id ? 'selected' : '') + '>' + (k.name || 'Unnamed') + (k.assignedUserEmail && k.assignedToUserId !== state.selectedUser.id ? ' (assigned to ' + k.assignedUserEmail + ')' : '') + '</option>').join('') + '</select></div><div class="border-t border-surface-200 pt-4"><div class="text-sm text-brand-500 mb-2">Actions</div><div class="flex gap-2 flex-wrap"><button onclick="extendTrial(' + state.selectedUser.id + ', 7)" class="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100">+7 Days</button><button onclick="extendTrial(' + state.selectedUser.id + ', 14)" class="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100">+14 Days</button><button onclick="extendTrial(' + state.selectedUser.id + ', 30)" class="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100">+30 Days</button><button onclick="updateUserSubscription(' + state.selectedUser.id + ', {status: \\'active\\'})" class="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100">Set Active</button><button onclick="updateUserSubscription(' + state.selectedUser.id + ', {status: \\'expired\\'})" class="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm hover:bg-red-100">Expire</button></div></div></div><div class="flex justify-end gap-2 mt-6"><button onclick="setState({showUserModal:false,selectedUser:null})" class="px-4 py-2 text-brand-500 hover:text-brand-700">Close</button><button onclick="(function(){ var sel = document.getElementById(\\'userKeySelect\\'); assignKeyToUser(state.selectedUser.assignedKey?.id || null, null); var keyId = sel.value ? parseInt(sel.value) : null; if(keyId) assignKeyToUser(keyId, state.selectedUser.id); else if(state.selectedUser.assignedKey) assignKeyToUser(state.selectedUser.assignedKey.id, null); viewUser(state.selectedUser.id); })()" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">Save Key Assignment</button></div></div></div>' : '';
      const assignKeyModalHtml = state.showAssignKey ? '<div class="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50"><div class="bg-white rounded-2xl shadow-lg w-full max-w-md p-6"><h2 class="text-lg font-semibold text-brand-900 mb-4">Assign Key to User</h2><div class="space-y-4"><select id="assignUserSelect" class="w-full border border-surface-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500"><option value="">Unassigned (Pool)</option>' + state.users.map(u => '<option value="' + u.id + '">' + u.email + '</option>').join('') + '</select></div><div class="flex justify-end gap-2 mt-6"><button onclick="setState({showAssignKey:null})" class="px-4 py-2 text-brand-500 hover:text-brand-700">Cancel</button><button onclick="(function(){ var sel = document.getElementById(\\'assignUserSelect\\'); assignKeyToUser(state.showAssignKey, sel.value ? parseInt(sel.value) : null); })()" class="px-4 py-2 bg-brand-900 text-white rounded-lg hover:bg-brand-800">Assign</button></div></div></div>' : '';
      app.innerHTML = '<div class="max-w-6xl mx-auto p-6"><div class="flex justify-between items-center mb-8"><h1 class="text-2xl font-semibold text-brand-900">Claude PI Admin</h1><button onclick="logout()" class="text-brand-500 hover:text-brand-700">Sign Out</button></div>' + (state.error ? '<div class="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4">' + state.error + ' <button onclick="setState({error:null})" class="ml-2 underline">Dismiss</button></div>' : '') + '<div class="flex gap-2 mb-6"><button onclick="setState({tab:\\'stats\\'})" class="px-4 py-2 rounded-lg ' + (state.tab === 'stats' ? 'bg-brand-900 text-white' : 'bg-white text-brand-700 hover:bg-brand-100') + '">Stats</button><button onclick="setState({tab:\\'users\\'})" class="px-4 py-2 rounded-lg ' + (state.tab === 'users' ? 'bg-brand-900 text-white' : 'bg-white text-brand-700 hover:bg-brand-100') + '">Users</button><button onclick="setState({tab:\\'keys\\'})" class="px-4 py-2 rounded-lg ' + (state.tab === 'keys' ? 'bg-brand-900 text-white' : 'bg-white text-brand-700 hover:bg-brand-100') + '">API Keys</button><button onclick="setState({tab:\\'usage\\'})" class="px-4 py-2 rounded-lg ' + (state.tab === 'usage' ? 'bg-brand-900 text-white' : 'bg-white text-brand-700 hover:bg-brand-100') + '">Usage</button></div>' + (state.tab === 'stats' ? statsHtml : '') + (state.tab === 'users' ? usersHtml : '') + (state.tab === 'keys' ? keysHtml : '') + (state.tab === 'usage' ? usageHtml : '') + '<div class="mt-8 pt-6 border-t border-surface-200"><button onclick="runMaintenance()" ' + (state.loading ? 'disabled' : '') + ' class="px-4 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-500 disabled:opacity-50">' + (state.loading ? 'Running...' : 'Run Maintenance') + '</button><span class="ml-3 text-sm text-brand-500">Cleans expired tokens & resets daily usage counters</span></div></div>' + addKeyModalHtml + addUserModalHtml + userModalHtml + assignKeyModalHtml;
    }
    render();
    const observer = new MutationObserver(() => {
      const nameInput = document.getElementById('newKeyName');
      const valueInput = document.getElementById('newKeyValue');
      const userEmailInput = document.getElementById('newUserEmail');
      const userTrialDaysInput = document.getElementById('newUserTrialDays');
      const userMaxLicensesInput = document.getElementById('newUserMaxLicenses');
      if (nameInput && !nameInput.dataset.bound) { nameInput.dataset.bound = 'true'; nameInput.addEventListener('input', (e) => { state.newKeyName = e.target.value; }); }
      if (valueInput && !valueInput.dataset.bound) { valueInput.dataset.bound = 'true'; valueInput.addEventListener('input', (e) => { state.newKeyValue = e.target.value; }); }
      if (userEmailInput && !userEmailInput.dataset.bound) { userEmailInput.dataset.bound = 'true'; userEmailInput.addEventListener('input', (e) => { state.newUserEmail = e.target.value; }); }
      if (userTrialDaysInput && !userTrialDaysInput.dataset.bound) { userTrialDaysInput.dataset.bound = 'true'; userTrialDaysInput.addEventListener('input', (e) => { state.newUserTrialDays = Number(e.target.value || 0); }); }
      if (userMaxLicensesInput && !userMaxLicensesInput.dataset.bound) { userMaxLicensesInput.dataset.bound = 'true'; userMaxLicensesInput.addEventListener('input', (e) => { state.newUserMaxLicenses = Number(e.target.value || 0); }); }
    });
    observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  </script>
</body>
</html>`;

// ============================================================================
// Types
// ============================================================================

interface User {
  id: number;
  email: string;
  password_hash: string;
  owner_user_id: number | null;
  max_licenses: number;
  created_at: string;
  updated_at: string;
}

interface Subscription {
  id: number;
  user_id: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: "trialing" | "active" | "canceled" | "past_due" | "unpaid" | "expired";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

interface ApiKey {
  id: number;
  key_encrypted: string;
  key_name: string | null;
  is_active: boolean;
  assigned_to_user_id: number | null;
  daily_usage_tokens: number;
  last_usage_reset: string;
  created_at: string;
}

interface SignupInvite {
  id: number;
  email: string;
  trial_days: number;
  owner_user_id: number | null;
  max_licenses: number | null;
  created_at: string;
  claimed_at: string | null;
}

// ============================================================================
// Database Schema & Init
// ============================================================================

const SCHEMA_VERSION = 1;

async function initDatabase(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      max_licenses INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_licenses INTEGER NOT NULL DEFAULT 10`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'trialing',
      trial_ends_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS api_key_pool (
      id SERIAL PRIMARY KEY,
      key_encrypted TEXT NOT NULL,
      key_name TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      daily_usage_tokens INTEGER DEFAULT 0,
      last_usage_reset TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS daily_validations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      validated_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT,
      success BOOLEAN DEFAULT TRUE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_key_id INTEGER REFERENCES api_key_pool(id) ON DELETE SET NULL,
      tokens_used INTEGER NOT NULL,
      request_type TEXT,
      logged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS signup_invites (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      trial_days INTEGER NOT NULL DEFAULT 14,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      max_licenses INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      claimed_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE signup_invites ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`;
  await sql`ALTER TABLE signup_invites ADD COLUMN IF NOT EXISTS max_licenses INTEGER`;

  await sql`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `;

  const { rows } = await sql`SELECT version FROM schema_version LIMIT 1`;
  if (rows.length === 0) {
    await sql`INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`;
  }

  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_key_pool_active ON api_key_pool(is_active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_daily_validations_user ON daily_validations(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signup_invites_email ON signup_invites(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_owner_user_id ON users(owner_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signup_invites_owner_user_id ON signup_invites(owner_user_id)`;
}

let initialized = false;
async function ensureDatabase(): Promise<void> {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
}

// ============================================================================
// Database Operations
// ============================================================================

async function createUser(
  email: string,
  passwordHash: string,
  options?: { ownerUserId?: number | null; maxLicenses?: number }
): Promise<User | null> {
  try {
    const ownerUserId = options?.ownerUserId ?? null;
    const maxLicenses = options?.maxLicenses ?? 10;
    const { rows } = await sql`
      INSERT INTO users (email, password_hash, owner_user_id, max_licenses)
      VALUES (${email.toLowerCase()}, ${passwordHash}, ${ownerUserId}, ${maxLicenses})
      RETURNING *
    `;
    return rows[0] as User || null;
  } catch {
    return null;
  }
}

async function getUserById(id: number): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] as User || null;
}

async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
  return rows[0] as User || null;
}

async function createSubscription(userId: number, trialDays: number = 14): Promise<Subscription | null> {
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    await sql`
      INSERT INTO subscriptions (user_id, status, trial_ends_at, current_period_end)
      VALUES (${userId}, 'trialing', ${trialEndsAt}, ${trialEndsAt})
    `;
    return getSubscriptionByUserId(userId);
  } catch {
    return null;
  }
}

async function getSubscriptionByUserId(userId: number): Promise<Subscription | null> {
  const { rows } = await sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`;
  return rows[0] as Subscription || null;
}

async function getSubscriptionByStripeCustomerId(customerId: string): Promise<Subscription | null> {
  const { rows } = await sql`SELECT * FROM subscriptions WHERE stripe_customer_id = ${customerId}`;
  return rows[0] as Subscription || null;
}

async function createOrRefreshSignupInvite(
  email: string,
  trialDays: number = 14,
  options?: { ownerUserId?: number | null; maxLicenses?: number | null }
): Promise<SignupInvite | null> {
  const normalized = email.toLowerCase();
  const safeTrialDays = Math.max(0, Math.floor(trialDays));
  const ownerUserId = options?.ownerUserId ?? null;
  const maxLicenses = options?.maxLicenses ?? null;
  const { rows } = await sql`
    INSERT INTO signup_invites (email, trial_days, owner_user_id, max_licenses, claimed_at)
    VALUES (${normalized}, ${safeTrialDays}, ${ownerUserId}, ${maxLicenses}, NULL)
    ON CONFLICT (email) DO UPDATE SET
      trial_days = EXCLUDED.trial_days,
      owner_user_id = EXCLUDED.owner_user_id,
      max_licenses = EXCLUDED.max_licenses,
      claimed_at = NULL
    RETURNING *
  `;
  return rows[0] as SignupInvite || null;
}

async function getActiveSignupInvite(email: string): Promise<SignupInvite | null> {
  const { rows } = await sql`
    SELECT * FROM signup_invites
    WHERE email = ${email.toLowerCase()} AND claimed_at IS NULL
    LIMIT 1
  `;
  return rows[0] as SignupInvite || null;
}

async function claimSignupInvite(email: string): Promise<void> {
  await sql`
    UPDATE signup_invites
    SET claimed_at = NOW()
    WHERE email = ${email.toLowerCase()} AND claimed_at IS NULL
  `;
}

async function getOwnerForUser(user: User): Promise<User> {
  if (!user.owner_user_id) return user;
  const owner = await getUserById(user.owner_user_id);
  return owner || user;
}

async function countSubUsers(ownerUserId: number): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::int AS count
    FROM users
    WHERE owner_user_id = ${ownerUserId}
  `;
  return Number(rows[0]?.count || 0);
}

async function countPendingSubUserInvites(ownerUserId: number): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::int AS count
    FROM signup_invites
    WHERE owner_user_id = ${ownerUserId}
      AND claimed_at IS NULL
  `;
  return Number(rows[0]?.count || 0);
}

async function updateSubscription(
  userId: number,
  updates: Partial<Omit<Subscription, "id" | "user_id" | "created_at">>
): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  }

  if (fields.length === 0) return false;

  values.push(userId);
  fields.push("updated_at = NOW()");

  const query = `UPDATE subscriptions SET ${fields.join(", ")} WHERE user_id = $${values.length}`;
  const result = await sql.query(query, values);
  return (result.rowCount ?? 0) > 0;
}

async function createAuthToken(userId: number, tokenHash: string, expiresInDays: number = 30): Promise<AuthToken | null> {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { rows } = await sql`
      INSERT INTO auth_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt})
      RETURNING *
    `;
    return rows[0] as AuthToken || null;
  } catch {
    return null;
  }
}

async function getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
  const { rows } = await sql`
    SELECT * FROM auth_tokens WHERE token_hash = ${tokenHash} AND expires_at > NOW()
  `;
  return rows[0] as AuthToken || null;
}

async function updateTokenLastUsed(tokenId: number): Promise<void> {
  await sql`UPDATE auth_tokens SET last_used_at = NOW() WHERE id = ${tokenId}`;
}

async function deleteExpiredTokens(): Promise<number> {
  const result = await sql`DELETE FROM auth_tokens WHERE expires_at <= NOW()`;
  return result.rowCount ?? 0;
}

async function deleteUserTokens(userId: number): Promise<number> {
  const result = await sql`DELETE FROM auth_tokens WHERE user_id = ${userId}`;
  return result.rowCount ?? 0;
}

async function addApiKey(encryptedKey: string, keyName?: string): Promise<ApiKey | null> {
  try {
    const { rows } = await sql`
      INSERT INTO api_key_pool (key_encrypted, key_name)
      VALUES (${encryptedKey}, ${keyName || null})
      RETURNING *
    `;
    return rows[0] as ApiKey || null;
  } catch {
    return null;
  }
}

async function getAvailableApiKey(): Promise<ApiKey | null> {
  const { rows } = await sql`
    SELECT * FROM api_key_pool
    WHERE is_active = TRUE
    ORDER BY assigned_to_user_id IS NULL DESC, daily_usage_tokens ASC
    LIMIT 1
  `;
  return rows[0] as ApiKey || null;
}

async function getApiKeyForUser(userId: number): Promise<ApiKey | null> {
  const { rows } = await sql`
    SELECT * FROM api_key_pool WHERE assigned_to_user_id = ${userId} AND is_active = TRUE
  `;
  if (rows[0]) return rows[0] as ApiKey;
  return getAvailableApiKey();
}

async function resetDailyUsage(): Promise<number> {
  const result = await sql`
    UPDATE api_key_pool SET daily_usage_tokens = 0, last_usage_reset = NOW()
  `;
  return result.rowCount ?? 0;
}

async function logValidation(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  success: boolean = true
): Promise<void> {
  await sql`
    INSERT INTO daily_validations (user_id, ip_address, user_agent, success)
    VALUES (${userId}, ${ipAddress || null}, ${userAgent || null}, ${success})
  `;
}

function isSubscriptionActive(subscription: Subscription): boolean {
  if (subscription.status === "active") return true;
  if (subscription.status === "trialing") {
    const trialEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
    return trialEnd ? trialEnd > new Date() : false;
  }
  return false;
}

function getSubscriptionExpiry(subscription: Subscription): string | null {
  if (subscription.status === "trialing") {
    return subscription.trial_ends_at;
  }
  return subscription.current_period_end;
}

// ============================================================================
// Helpers
// ============================================================================

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-encryption-key-32bytes!!!!";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "admin-secret-key";

function hashPassword(password: string): string {
  const hash = createHash("sha256");
  hash.update(password + "claude-pi-salt");
  return hash.digest("hex");
}

function generateToken(): string {
  return `claudepi_v1_${randomBytes(32).toString("hex")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function decryptApiKey(encrypted: string): string {
  const encryptedBuffer = Buffer.from(encrypted, "base64");
  const keyBuffer = Buffer.from(ENCRYPTION_KEY);
  const decrypted = Buffer.alloc(encryptedBuffer.length);
  for (let i = 0; i < encryptedBuffer.length; i++) {
    decrypted[i] = encryptedBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  return decrypted.toString();
}

function encryptApiKey(key: string): string {
  const keyBuffer = Buffer.from(key);
  const encKeyBuffer = Buffer.from(ENCRYPTION_KEY);
  const encrypted = Buffer.alloc(keyBuffer.length);
  for (let i = 0; i < keyBuffer.length; i++) {
    encrypted[i] = keyBuffer[i] ^ encKeyBuffer[i % encKeyBuffer.length];
  }
  return encrypted.toString("base64");
}

async function getUserFromAuth(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);
  const authToken = await getAuthTokenByHash(tokenHash);
  if (!authToken) return null;
  return getUserById(authToken.user_id);
}

// ============================================================================
// Stripe Setup
// ============================================================================

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any })
  : null;

const PRICE_ID = process.env.STRIPE_PRICE_ID || "price_xxx";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// ============================================================================
// App Setup
// ============================================================================

const app = new Hono();

app.use("/*", cors());
app.use("/*", logger());

// Health check
app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "claude-pi-subscription-server",
    version: "0.1.0",
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  })
);

// ============================================================================
// Auth Routes
// ============================================================================

app.post("/v1/auth/signup", async (c) => {
  await ensureDatabase();
  const body = await c.req.json();
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const invite = await getActiveSignupInvite(email);
  if (!invite) {
    return c.json({ error: "invite_required" }, 403);
  }

  const ownerUserId = invite.owner_user_id ?? null;
  if (ownerUserId) {
    const owner = await getUserById(ownerUserId);
    if (!owner) {
      return c.json({ error: "owner_not_found" }, 403);
    }
    const ownerSubCount = await countSubUsers(ownerUserId);
    if (ownerSubCount >= (owner.max_licenses || 0)) {
      return c.json({ error: "license_limit_reached" }, 403);
    }
  }

  const passwordHash = hashPassword(password);
  const user = await createUser(email, passwordHash, {
    ownerUserId,
    maxLicenses: invite.max_licenses ?? 10,
  });

  if (!user) {
    return c.json({ error: "Failed to create account" }, 500);
  }

  const subscription = await createSubscription(user.id, invite.trial_days || 14);

  if (!subscription) {
    return c.json({ error: "Failed to create subscription" }, 500);
  }

  if (ownerUserId) {
    const ownerSub = await getSubscriptionByUserId(ownerUserId);
    if (!ownerSub || !isSubscriptionActive(ownerSub)) {
      return c.json({ error: "owner_subscription_inactive" }, 403);
    }
    await updateSubscription(user.id, {
      status: ownerSub.status,
      trial_ends_at: ownerSub.trial_ends_at,
      current_period_start: ownerSub.current_period_start,
      current_period_end: ownerSub.current_period_end,
      stripe_customer_id: ownerSub.stripe_customer_id,
      stripe_subscription_id: ownerSub.stripe_subscription_id,
    });
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  await createAuthToken(user.id, tokenHash, 30);
  await claimSignupInvite(email);

  const apiKey = await getApiKeyForUser(user.id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  const ownerUser = ownerUserId ? await getUserById(ownerUserId) : null;
  return c.json({
    authToken: token,
    email: user.email,
    anthropicApiKey: decryptedKey,
    subscriptionStatus: ownerUserId ? ((await getSubscriptionByUserId(ownerUserId))?.status || subscription.status) : subscription.status,
    expiresAt: ownerUserId ? getSubscriptionExpiry((await getSubscriptionByUserId(ownerUserId)) || subscription) : getSubscriptionExpiry(subscription),
    accountType: ownerUserId ? "sub_user" : "root",
    ownerEmail: ownerUser?.email || null,
  });
});

app.post("/v1/auth/login", async (c) => {
  await ensureDatabase();
  const body = await c.req.json();
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const passwordHash = hashPassword(password);
  if (user.password_hash !== passwordHash) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const owner = await getOwnerForUser(user);
  const subscription = await getSubscriptionByUserId(owner.id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 403);
  }

  if (!isSubscriptionActive(subscription)) {
    return c.json({
      error: "Subscription expired",
      subscriptionStatus: subscription.status,
    }, 403);
  }

  await deleteUserTokens(user.id);
  const token = generateToken();
  const tokenHash = hashToken(token);
  await createAuthToken(user.id, tokenHash, 30);

  const apiKey = await getApiKeyForUser(user.id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  await logValidation(
    user.id,
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    c.req.header("user-agent"),
    true
  );

  return c.json({
    authToken: token,
    email: user.email,
    anthropicApiKey: decryptedKey,
    subscriptionStatus: subscription.status,
    expiresAt: getSubscriptionExpiry(subscription),
    accountType: user.owner_user_id ? "sub_user" : "root",
    ownerEmail: user.owner_user_id ? owner.email : null,
    maxLicenses: owner.max_licenses,
  });
});

app.post("/v1/auth/validate", async (c) => {
  await ensureDatabase();
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  const authToken = await getAuthTokenByHash(tokenHash);
  if (!authToken) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await updateTokenLastUsed(authToken.id);

  const authedUser = await getUserById(authToken.user_id);
  if (!authedUser) {
    return c.json({ error: "User not found" }, 401);
  }
  const owner = await getOwnerForUser(authedUser);
  const subscription = await getSubscriptionByUserId(owner.id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 403);
  }

  if (!isSubscriptionActive(subscription)) {
    return c.json({
      error: "Subscription expired",
      subscriptionStatus: subscription.status,
    }, 403);
  }

  const apiKey = await getApiKeyForUser(authToken.user_id);
  const decryptedKey = apiKey ? decryptApiKey(apiKey.key_encrypted) : null;

  await logValidation(
    authToken.user_id,
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    c.req.header("user-agent"),
    true
  );

  return c.json({
    anthropicApiKey: decryptedKey,
    subscriptionStatus: subscription.status,
    expiresAt: getSubscriptionExpiry(subscription),
    accountType: authedUser.owner_user_id ? "sub_user" : "root",
    ownerEmail: authedUser.owner_user_id ? owner.email : null,
    maxLicenses: owner.max_licenses,
  });
});

app.post("/v1/auth/logout", async (c) => {
  await ensureDatabase();
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  const authToken = await getAuthTokenByHash(tokenHash);
  if (!authToken) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await deleteUserTokens(authToken.user_id);

  return c.json({ success: true });
});

// ============================================================================
// Subscription Routes
// ============================================================================

app.post("/v1/subscriptions/create-checkout", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subscription = await getSubscriptionByUserId(user.id);
  let customerId = subscription?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id.toString() },
    });
    customerId = customer.id;

    if (subscription) {
      await updateSubscription(user.id, { stripe_customer_id: customerId });
    }
  }

  const body = await c.req.json().catch(() => ({}));
  const successUrl = body.successUrl || "http://localhost:3001/subscription/success";
  const cancelUrl = body.cancelUrl || "http://localhost:3001/subscription/cancel";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: { metadata: { userId: user.id.toString() } },
  });

  return c.json({ url: session.url });
});

app.post("/v1/subscriptions/portal", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subscription = await getSubscriptionByUserId(user.id);
  if (!subscription?.stripe_customer_id) {
    return c.json({ error: "No subscription found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const returnUrl = body.returnUrl || "http://localhost:3001";

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });

  return c.json({ url: session.url });
});

app.post("/v1/subscriptions/webhook", async (c) => {
  await ensureDatabase();
  if (!stripe) {
    return c.json({ error: "Stripe not configured" }, 503);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    return c.json({ error: "Missing signature" }, 400);
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, {
          stripe_subscription_id: session.subscription as string,
          status: "active",
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        const status = subscription.status as any;
        await updateSubscription(sub.user_id, {
          status: status === "active" ? "active" : status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, {
          status: "canceled",
          canceled_at: new Date().toISOString(),
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      const sub = await getSubscriptionByStripeCustomerId(customerId);
      if (sub) {
        await updateSubscription(sub.user_id, { status: "past_due" });
      }
      break;
    }
  }

  return c.json({ received: true });
});

app.get("/v1/subscriptions/status", async (c) => {
  await ensureDatabase();
  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subscription = await getSubscriptionByUserId(user.id);
  if (!subscription) {
    return c.json({ error: "No subscription found" }, 404);
  }

  return c.json({
    status: subscription.status,
    trialEndsAt: subscription.trial_ends_at,
    currentPeriodEnd: subscription.current_period_end,
    canceledAt: subscription.canceled_at,
  });
});

app.post("/v1/account/invite-subuser", async (c) => {
  await ensureDatabase();
  const user = await getUserFromAuth(c.req.header("Authorization"));
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (user.owner_user_id) {
    return c.json({ error: "only_root_account_can_invite" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const trialDaysRaw = Number(body.trialDays);
  const trialDays = Number.isFinite(trialDaysRaw) ? Math.max(0, Math.floor(trialDaysRaw)) : 14;

  if (!email) {
    return c.json({ error: "email_required" }, 400);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: "invalid_email" }, 400);
  }
  const rootDomain = user.email.split("@")[1]?.toLowerCase() || "";
  const inviteDomain = email.split("@")[1]?.toLowerCase() || "";
  if (!rootDomain || rootDomain !== inviteDomain) {
    return c.json({ error: "domain_mismatch" }, 403);
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    if (existing.owner_user_id === user.id) {
      return c.json({ error: "already_member" }, 409);
    }
    return c.json({ error: "email_already_registered" }, 409);
  }

  const subCount = await countSubUsers(user.id);
  const pendingInvites = await countPendingSubUserInvites(user.id);
  if (subCount + pendingInvites >= (user.max_licenses || 0)) {
    return c.json({ error: "license_limit_reached" }, 403);
  }

  const invite = await createOrRefreshSignupInvite(email, trialDays, {
    ownerUserId: user.id,
  });
  if (!invite) {
    return c.json({ error: "failed_to_create_invite" }, 500);
  }
  return c.json({
    success: true,
    invite: {
      id: invite.id,
      email: invite.email,
      trialDays: invite.trial_days,
      ownerUserId: invite.owner_user_id,
      createdAt: invite.created_at,
    },
  });
});

// ============================================================================
// Admin Routes
// ============================================================================

async function adminAuth(c: any, next: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }
  const token = authHeader.slice(7);
  if (token !== ADMIN_API_KEY) {
    return c.json({ error: "Invalid admin key" }, 403);
  }
  return next();
}

app.post("/v1/admin/api-keys", adminAuth, async (c) => {
  await ensureDatabase();
  const body = await c.req.json();
  const { key, name } = body;

  if (!key) {
    return c.json({ error: "API key is required" }, 400);
  }

  const encryptedKey = encryptApiKey(key);
  const apiKey = await addApiKey(encryptedKey, name);

  if (!apiKey) {
    return c.json({ error: "Failed to add API key" }, 500);
  }

  return c.json({
    id: apiKey.id,
    name: apiKey.key_name,
    isActive: apiKey.is_active,
    createdAt: apiKey.created_at,
  });
});

app.get("/v1/admin/api-keys", adminAuth, async (c) => {
  await ensureDatabase();
  const { rows } = await sql`
    SELECT k.id, k.key_name, k.is_active, k.assigned_to_user_id, k.daily_usage_tokens,
           k.last_usage_reset, k.created_at, u.email as assigned_user_email
    FROM api_key_pool k
    LEFT JOIN users u ON k.assigned_to_user_id = u.id
    ORDER BY k.created_at DESC
  `;

  return c.json({
    keys: rows.map((k: any) => ({
      id: k.id,
      name: k.key_name,
      isActive: k.is_active,
      assignedToUserId: k.assigned_to_user_id,
      assignedUserEmail: k.assigned_user_email,
      dailyUsageTokens: k.daily_usage_tokens,
      lastUsageReset: k.last_usage_reset,
      createdAt: k.created_at,
    })),
  });
});

app.patch("/v1/admin/api-keys/:id", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.isActive !== undefined) {
    values.push(body.isActive);
    updates.push(`is_active = $${values.length}`);
  }

  if (body.name !== undefined) {
    values.push(body.name);
    updates.push(`key_name = $${values.length}`);
  }

  if (updates.length === 0) {
    return c.json({ error: "No updates provided" }, 400);
  }

  values.push(id);
  const query = `UPDATE api_key_pool SET ${updates.join(", ")} WHERE id = $${values.length}`;
  await sql.query(query, values);

  return c.json({ success: true });
});

app.delete("/v1/admin/api-keys/:id", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  await sql`DELETE FROM api_key_pool WHERE id = ${id}`;

  return c.json({ success: true });
});

// Assign/unassign API key to user
app.patch("/v1/admin/api-keys/:id/assign", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const { userId } = body; // null to unassign

  if (userId !== null && userId !== undefined) {
    // Verify user exists
    const user = await getUserById(userId);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }
  }

  await sql`UPDATE api_key_pool SET assigned_to_user_id = ${userId ?? null} WHERE id = ${id}`;

  return c.json({ success: true });
});

// Get single user with assigned key info
app.get("/v1/admin/users/:id", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));

  const { rows } = await sql`
    SELECT u.id, u.email, u.created_at, u.owner_user_id, u.max_licenses,
           owner.email as owner_email,
           s_owner.status as subscription_status, s_owner.trial_ends_at, s_owner.current_period_end,
           s_owner.stripe_customer_id, s_owner.stripe_subscription_id,
           k.id as assigned_key_id, k.key_name as assigned_key_name
    FROM users u
    LEFT JOIN users owner ON u.owner_user_id = owner.id
    LEFT JOIN subscriptions s_owner ON COALESCE(u.owner_user_id, u.id) = s_owner.user_id
    LEFT JOIN api_key_pool k ON k.assigned_to_user_id = u.id AND k.is_active = TRUE
    WHERE u.id = ${id}
  `;

  if (rows.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  const u = rows[0] as any;

  // Get usage stats for last 30 days
  const { rows: usageRows } = await sql`
    SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
           COUNT(*) as request_count
    FROM usage_logs
    WHERE user_id = ${id} AND logged_at > NOW() - INTERVAL '30 days'
  `;
  const usageStats = usageRows[0] || { total_tokens: 0, request_count: 0 };

  return c.json({
    id: u.id,
    email: u.email,
    accountType: u.owner_user_id ? "sub_user" : "root",
    ownerUserId: u.owner_user_id,
    ownerEmail: u.owner_email || null,
    maxLicenses: u.max_licenses,
    createdAt: u.created_at,
    subscriptionStatus: u.subscription_status || "none",
    trialEndsAt: u.trial_ends_at,
    currentPeriodEnd: u.current_period_end,
    stripeCustomerId: u.stripe_customer_id,
    assignedKey: u.assigned_key_id ? {
      id: u.assigned_key_id,
      name: u.assigned_key_name,
    } : null,
    usage: {
      last30Days: {
        totalTokens: Number(usageStats.total_tokens),
        requestCount: Number(usageStats.request_count),
      }
    }
  });
});

// Update user subscription (extend trial, change status)
app.patch("/v1/admin/users/:id/subscription", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.status !== undefined) {
    values.push(body.status);
    updates.push(`status = $${values.length}`);
  }

  if (body.trialEndsAt !== undefined) {
    values.push(body.trialEndsAt);
    updates.push(`trial_ends_at = $${values.length}`);
  }

  if (body.currentPeriodEnd !== undefined) {
    values.push(body.currentPeriodEnd);
    updates.push(`current_period_end = $${values.length}`);
  }

  if (updates.length === 0) {
    return c.json({ error: "No updates provided" }, 400);
  }

  values.push(id);
  updates.push("updated_at = NOW()");
  const query = `UPDATE subscriptions SET ${updates.join(", ")} WHERE user_id = $${values.length}`;
  const result = await sql.query(query, values);

  if ((result.rowCount ?? 0) === 0) {
    return c.json({ error: "Subscription not found" }, 404);
  }

  return c.json({ success: true });
});

// Get aggregated usage stats
app.get("/v1/admin/usage", adminAuth, async (c) => {
  await ensureDatabase();

  // Total tokens last 7 days
  const { rows: [usage7d] } = await sql`
    SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
           COUNT(*) as request_count
    FROM usage_logs
    WHERE logged_at > NOW() - INTERVAL '7 days'
  `;

  // Total tokens last 30 days
  const { rows: [usage30d] } = await sql`
    SELECT COALESCE(SUM(tokens_used), 0) as total_tokens,
           COUNT(*) as request_count
    FROM usage_logs
    WHERE logged_at > NOW() - INTERVAL '30 days'
  `;

  // Usage by user (last 30 days)
  const { rows: byUser } = await sql`
    SELECT u.id, u.email,
           COALESCE(SUM(l.tokens_used), 0) as total_tokens,
           COUNT(l.id) as request_count
    FROM users u
    LEFT JOIN usage_logs l ON u.id = l.user_id AND l.logged_at > NOW() - INTERVAL '30 days'
    GROUP BY u.id, u.email
    ORDER BY total_tokens DESC
    LIMIT 50
  `;

  // Recent usage logs
  const { rows: recentLogs } = await sql`
    SELECT l.id, l.user_id, u.email, l.tokens_used, l.request_type, l.logged_at
    FROM usage_logs l
    JOIN users u ON l.user_id = u.id
    ORDER BY l.logged_at DESC
    LIMIT 100
  `;

  return c.json({
    summary: {
      last7Days: {
        totalTokens: Number(usage7d.total_tokens),
        requestCount: Number(usage7d.request_count),
      },
      last30Days: {
        totalTokens: Number(usage30d.total_tokens),
        requestCount: Number(usage30d.request_count),
      },
    },
    byUser: byUser.map((row: any) => ({
      id: row.id,
      email: row.email,
      totalTokens: Number(row.total_tokens),
      requestCount: Number(row.request_count),
    })),
    recentLogs: recentLogs.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      tokensUsed: row.tokens_used,
      requestType: row.request_type,
      loggedAt: row.logged_at,
    })),
  });
});

// Log usage (called by main server)
app.post("/v1/usage/log", async (c) => {
  await ensureDatabase();

  // Authenticate via user token (not admin)
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);
  const authToken = await getAuthTokenByHash(tokenHash);

  if (!authToken) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const body = await c.req.json();
  const { tokensUsed, requestType, apiKeyId } = body;

  if (!tokensUsed || typeof tokensUsed !== "number") {
    return c.json({ error: "tokensUsed is required and must be a number" }, 400);
  }

  await sql`
    INSERT INTO usage_logs (user_id, api_key_id, tokens_used, request_type)
    VALUES (${authToken.user_id}, ${apiKeyId || null}, ${tokensUsed}, ${requestType || null})
  `;

  return c.json({ success: true });
});

app.post("/v1/admin/users", adminAuth, async (c) => {
  await ensureDatabase();
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const trialDaysRaw = Number(body.trialDays);
  const maxLicensesRaw = Number(body.maxLicenses);
  const trialDays = Number.isFinite(trialDaysRaw) ? Math.max(0, Math.floor(trialDaysRaw)) : 14;
  const maxLicenses = Number.isFinite(maxLicensesRaw) ? Math.max(1, Math.floor(maxLicensesRaw)) : 10;

  if (!email) {
    return c.json({ error: "Email is required" }, 400);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return c.json({ error: "Invalid email format" }, 400);
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const invite = await createOrRefreshSignupInvite(email, trialDays, {
    ownerUserId: null,
    maxLicenses,
  });
  if (!invite) {
    return c.json({ error: "Failed to create invite" }, 500);
  }
  return c.json({
    invite: {
      id: invite.id,
      email: invite.email,
      trialDays: invite.trial_days,
      maxLicenses: invite.max_licenses,
      createdAt: invite.created_at,
    }
  });
});

app.delete("/v1/admin/users/:id", adminAuth, async (c) => {
  await ensureDatabase();
  const id = parseInt(c.req.param("id"));
  if (!Number.isFinite(id)) {
    return c.json({ error: "Invalid user id" }, 400);
  }

  const existing = await getUserById(id);
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  await sql`UPDATE api_key_pool SET assigned_to_user_id = NULL WHERE assigned_to_user_id = ${id}`;
  const result = await sql`DELETE FROM users WHERE id = ${id}`;
  if ((result.rowCount ?? 0) === 0) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json({ success: true });
});

app.get("/v1/admin/users", adminAuth, async (c) => {
  await ensureDatabase();
  const { rows } = await sql`
    SELECT u.id, u.email, u.created_at, u.owner_user_id, u.max_licenses,
           owner.email as owner_email,
           s_owner.status as subscription_status, s_owner.trial_ends_at, s_owner.current_period_end,
           s_owner.stripe_customer_id, s_owner.stripe_subscription_id,
           k.id as assigned_key_id, k.key_name as assigned_key_name
    FROM users u
    LEFT JOIN users owner ON u.owner_user_id = owner.id
    LEFT JOIN subscriptions s_owner ON COALESCE(u.owner_user_id, u.id) = s_owner.user_id
    LEFT JOIN api_key_pool k ON k.assigned_to_user_id = u.id AND k.is_active = TRUE
    ORDER BY u.created_at DESC
  `;

  return c.json({
    users: rows.map((u: any) => ({
      id: u.id,
      email: u.email,
      accountType: u.owner_user_id ? "sub_user" : "root",
      ownerUserId: u.owner_user_id,
      ownerEmail: u.owner_email || null,
      maxLicenses: u.max_licenses,
      createdAt: u.created_at,
      subscriptionStatus: u.subscription_status || "none",
      trialEndsAt: u.trial_ends_at,
      currentPeriodEnd: u.current_period_end,
      stripeCustomerId: u.stripe_customer_id,
      assignedKeyId: u.assigned_key_id,
      assignedKeyName: u.assigned_key_name,
    })),
  });
});

app.get("/v1/admin/root-users", adminAuth, async (c) => {
  await ensureDatabase();
  const { rows } = await sql`
    SELECT
      r.id,
      r.email,
      r.max_licenses,
      r.created_at,
      s.status as subscription_status,
      s.trial_ends_at,
      s.current_period_end,
      (
        SELECT COUNT(*)::int
        FROM users su
        WHERE su.owner_user_id = r.id
      ) as sub_user_count,
      (
        SELECT COUNT(*)::int
        FROM signup_invites si
        WHERE si.owner_user_id = r.id
          AND si.claimed_at IS NULL
      ) as pending_invite_count
    FROM users r
    LEFT JOIN subscriptions s ON s.user_id = r.id
    WHERE r.owner_user_id IS NULL
    ORDER BY r.created_at DESC
  `;

  return c.json({
    roots: rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      maxLicenses: Number(r.max_licenses || 0),
      subscriptionStatus: r.subscription_status || "none",
      trialEndsAt: r.trial_ends_at,
      currentPeriodEnd: r.current_period_end,
      subUserCount: Number(r.sub_user_count || 0),
      pendingInviteCount: Number(r.pending_invite_count || 0),
      createdAt: r.created_at,
    })),
  });
});

app.get("/v1/admin/root-users/:id/members", adminAuth, async (c) => {
  await ensureDatabase();
  const rootId = parseInt(c.req.param("id"));
  if (!Number.isFinite(rootId)) {
    return c.json({ error: "Invalid root id" }, 400);
  }

  const { rows: rootRows } = await sql`
    SELECT u.id, u.email, u.max_licenses, u.created_at,
           s.status as subscription_status, s.trial_ends_at, s.current_period_end
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE u.id = ${rootId} AND u.owner_user_id IS NULL
    LIMIT 1
  `;
  if (rootRows.length === 0) {
    return c.json({ error: "Root user not found" }, 404);
  }
  const root = rootRows[0] as any;

  const { rows: subUsers } = await sql`
    SELECT u.id, u.email, u.created_at,
           s_owner.status as subscription_status,
           s_owner.trial_ends_at,
           s_owner.current_period_end
    FROM users u
    LEFT JOIN subscriptions s_owner ON s_owner.user_id = ${rootId}
    WHERE u.owner_user_id = ${rootId}
    ORDER BY u.created_at DESC
  `;

  const { rows: pendingInvites } = await sql`
    SELECT id, email, trial_days, created_at
    FROM signup_invites
    WHERE owner_user_id = ${rootId}
      AND claimed_at IS NULL
    ORDER BY created_at DESC
  `;

  return c.json({
    root: {
      id: root.id,
      email: root.email,
      maxLicenses: Number(root.max_licenses || 0),
      subscriptionStatus: root.subscription_status || "none",
      trialEndsAt: root.trial_ends_at,
      currentPeriodEnd: root.current_period_end,
      createdAt: root.created_at,
    },
    subUsers: subUsers.map((u: any) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      subscriptionStatus: u.subscription_status || "none",
      trialEndsAt: u.trial_ends_at,
      currentPeriodEnd: u.current_period_end,
    })),
    pendingInvites: pendingInvites.map((i: any) => ({
      id: i.id,
      email: i.email,
      trialDays: Number(i.trial_days || 0),
      createdAt: i.created_at,
    })),
  });
});

app.get("/v1/admin/stats", adminAuth, async (c) => {
  await ensureDatabase();

  const { rows: [userCount] } = await sql`SELECT COUNT(*) as count FROM users`;
  const { rows: [activeSubCount] } = await sql`
    SELECT COUNT(*) as count
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE u.owner_user_id IS NULL
      AND s.status IN ('active', 'trialing')
  `;
  const { rows: [apiKeyCount] } = await sql`
    SELECT COUNT(*) as count FROM api_key_pool WHERE is_active = TRUE
  `;
  const { rows: [validationsToday] } = await sql`
    SELECT COUNT(*) as count FROM daily_validations WHERE validated_at > NOW() - INTERVAL '1 day'
  `;

  return c.json({
    totalUsers: Number(userCount.count),
    activeSubscriptions: Number(activeSubCount.count),
    activeApiKeys: Number(apiKeyCount.count),
    validationsLast24h: Number(validationsToday.count),
  });
});

app.post("/v1/admin/maintenance", adminAuth, async (c) => {
  await ensureDatabase();
  const body = await c.req.json().catch(() => ({}));
  const results: Record<string, any> = {};

  if (body.cleanupTokens !== false) {
    const deleted = await deleteExpiredTokens();
    results.expiredTokensDeleted = deleted;
  }

  if (body.resetDailyUsage) {
    const reset = await resetDailyUsage();
    results.apiKeysReset = reset;
  }

  return c.json({ success: true, results });
});

// Admin UI
app.get("/admin", (c) => {
  return c.html(ADMIN_HTML);
});

// Legacy admin URL - keep compatibility while ensuring latest UI
app.get("/admin.html", (c) => {
  return c.redirect("/admin", 308);
});

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ============================================================================
// Vercel Exports
// ============================================================================

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
