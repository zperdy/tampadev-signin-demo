// Tampa.dev OAuth 2.1 PKCE Demo SPA

const CONFIG = {
  authorizeUrl: 'https://tampa.dev/oauth/authorize',
  tokenUrl: 'https://tampa.dev/oauth/token',
  registerUrl: 'https://tampa.dev/oauth/register',
  apiBase: 'https://api.tampa.dev',
  redirectUri: window.location.origin + '/',
  scopes: 'read:user user:email read:portfolio',
};

// ---- Utility: Base64 URL encoding ----

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(digest);
}

function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

// ---- Client Registration ----

async function getOrRegisterClient() {
  // 1. Pre-registered app from config.js takes priority
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CLIENT_ID) {
    return APP_CONFIG.CLIENT_ID;
  }

  // 2. Previously registered via dynamic registration
  const stored = localStorage.getItem('td_client_id');
  if (stored) return stored;

  // 3. Fall back to dynamic client registration
  updateStatus('Registering application...');

  const res = await fetch(CONFIG.registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Tampa.dev Demo SPA',
      redirect_uris: [CONFIG.redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!res.ok) {
    throw new Error('Failed to register client: ' + (await res.text()));
  }

  const data = await res.json();
  localStorage.setItem('td_client_id', data.client_id);
  updateStatus('');
  return data.client_id;
}

// ---- Token Storage ----

function storeTokens(tokens) {
  sessionStorage.setItem('td_access_token', tokens.access_token);
  if (tokens.refresh_token) {
    sessionStorage.setItem('td_refresh_token', tokens.refresh_token);
  }
}

function getAccessToken() {
  return sessionStorage.getItem('td_access_token');
}

function clearSession() {
  sessionStorage.removeItem('td_access_token');
  sessionStorage.removeItem('td_refresh_token');
  sessionStorage.removeItem('td_code_verifier');
  sessionStorage.removeItem('td_state');
}

// ---- API Helpers ----

async function apiFetch(path) {
  const token = getAccessToken();
  const res = await fetch(CONFIG.apiBase + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }
  return res.json();
}

// ---- Views ----

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function updateStatus(msg) {
  const el = document.getElementById('register-status');
  if (el) el.textContent = msg;
}

function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 5000);
}

// ---- OAuth Flow ----

async function startLogin() {
  try {
    const clientId = await getOrRegisterClient();
    const codeVerifier = await generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store PKCE params for the callback
    sessionStorage.setItem('td_code_verifier', codeVerifier);
    sessionStorage.setItem('td_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CONFIG.redirectUri,
      scope: CONFIG.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
    });

    window.location.href = CONFIG.authorizeUrl + '?' + params.toString();
  } catch (err) {
    showError('Login failed: ' + err.message);
    console.error(err);
  }
}

async function handleCallback(code, state) {
  showView('view-loading');

  // Verify state
  const savedState = sessionStorage.getItem('td_state');
  if (state !== savedState) {
    showError('Invalid state parameter. Possible CSRF attack.');
    showView('view-login');
    return;
  }

  const codeVerifier = sessionStorage.getItem('td_code_verifier');
  const clientId = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CLIENT_ID)
    || localStorage.getItem('td_client_id');

  if (!codeVerifier || !clientId) {
    showError('Missing session data. Please try signing in again.');
    showView('view-login');
    return;
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: CONFIG.redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error('Token exchange failed: ' + errBody);
    }

    const tokens = await tokenRes.json();
    storeTokens(tokens);

    // Clean up URL
    window.history.replaceState({}, '', '/');

    // Load dashboard
    await loadDashboard();
  } catch (err) {
    showError('Sign in failed: ' + err.message);
    showView('view-login');
    console.error(err);
  }
}

// ---- Dashboard ----

async function loadDashboard() {
  showView('view-dashboard');

  // Load all data in parallel
  const [profileResult, badgesResult, achievementsResult, portfolioResult, linkedResult] =
    await Promise.allSettled([
      apiFetch('/v1/profile'),
      apiFetch('/v1/profile/badges'),
      apiFetch('/v1/profile/achievements'),
      apiFetch('/v1/profile/portfolio'),
      apiFetch('/v1/me/linked-accounts'),
    ]);

  if (profileResult.status === 'fulfilled') {
    renderProfile(profileResult.value.data);
  } else {
    showError('Failed to load profile');
    console.error(profileResult.reason);
  }

  if (badgesResult.status === 'fulfilled') {
    renderBadges(badgesResult.value.data);
  } else {
    document.getElementById('badges-list').innerHTML =
      '<p class="placeholder">Could not load badges.</p>';
  }

  if (achievementsResult.status === 'fulfilled') {
    renderAchievements(achievementsResult.value.data);
  } else {
    document.getElementById('achievements-list').innerHTML =
      '<p class="placeholder">Could not load achievements.</p>';
  }

  if (portfolioResult.status === 'fulfilled') {
    renderPortfolio(portfolioResult.value.data);
  } else {
    document.getElementById('portfolio-list').innerHTML =
      '<p class="placeholder">Could not load portfolio.</p>';
  }

  if (linkedResult.status === 'fulfilled') {
    renderLinkedAccounts(linkedResult.value.data);
  } else {
    document.getElementById('linked-accounts-list').innerHTML =
      '<p class="placeholder">Could not load linked accounts.</p>';
  }
}

// ---- Renderers ----

function renderProfile(profile) {
  document.getElementById('profile-avatar').src =
    profile.avatarUrl || '';
  document.getElementById('profile-name').textContent = profile.name || '';
  document.getElementById('profile-username').textContent = profile.username
    ? '@' + profile.username
    : '';
  document.getElementById('profile-email').textContent = profile.email || '';
  document.getElementById('profile-bio').textContent = profile.bio || '';
  document.getElementById('profile-location').textContent =
    profile.location || '';
  document.getElementById('profile-joined').textContent = profile.createdAt
    ? 'Joined ' + new Date(profile.createdAt).toLocaleDateString()
    : '';

  // Apply user's theme color for personalization
  if (profile.themeColor) {
    applyThemeColor(profile.themeColor);
  }

  const socialsEl = document.getElementById('profile-socials');
  socialsEl.innerHTML = '';
  if (profile.socialLinks && profile.socialLinks.length > 0) {
    profile.socialLinks.forEach((url) => {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = prettifyUrl(url);
      socialsEl.appendChild(a);
    });
  }
}

function applyThemeColor(hex) {
  // Set the primary accent color from user's profile
  const root = document.documentElement;
  root.style.setProperty('--coral', hex);
  // Generate lighter/darker variants
  root.style.setProperty('--coral-light', hexToRgba(hex, 0.2));
  root.style.setProperty('--coral-dark', adjustBrightness(hex, -30));
}

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function adjustBrightness(hex, amount) {
  // Convert hex to RGB, adjust brightness, convert back
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (num & 255) + amount));
  return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function renderBadges(badges) {
  const container = document.getElementById('badges-list');

  if (!badges || badges.length === 0) {
    container.innerHTML = '<p class="placeholder">No badges earned yet.</p>';
    return;
  }

  // Group badges by rarity tier
  const tierOrder = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  const tierLabels = {
    legendary: 'Legendary',
    epic: 'Epic',
    rare: 'Rare',
    uncommon: 'Uncommon',
    common: 'Common'
  };

  const grouped = {};
  badges.forEach((badge) => {
    const tier = badge.rarity?.tier || 'common';
    if (!grouped[tier]) grouped[tier] = [];
    grouped[tier].push(badge);
  });

  let html = '';
  tierOrder.forEach((tier) => {
    if (!grouped[tier] || grouped[tier].length === 0) return;

    html += `
      <div class="badge-tier-group">
        <div class="badge-tier-label">${tierLabels[tier]}</div>
        <div class="badge-tier-badges">
          ${grouped[tier].map((badge) => {
            const pct = badge.rarity?.percentage != null ? badge.rarity.percentage.toFixed(1) + '%' : '';
            const groupName = badge.group ? badge.group.name : null;
            const tooltip = [
              badge.description || badge.name,
              pct ? `Held by ${pct} of users` : '',
              groupName ? `From: ${groupName}` : '',
            ].filter(Boolean).join(' \u2022 ');

            return `
              <div class="badge-chip" style="background: ${escapeAttr(badge.color || '#6b7280')}" title="${escapeAttr(tooltip)}">
                ${badge.iconUrl
                  ? `<img class="badge-chip-icon" src="${escapeAttr(badge.iconUrl)}" alt="" />`
                  : `<span class="badge-chip-emoji">${iconChar(badge.icon)}</span>`
                }
                <span class="badge-chip-name">${esc(badge.name)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderAchievements(achievements) {
  const container = document.getElementById('achievements-list');

  if (!achievements || achievements.length === 0) {
    container.innerHTML = '<p class="placeholder">No achievements yet.</p>';
    return;
  }

  container.innerHTML = achievements
    .map((a) => {
      const pct = a.targetValue > 0
        ? Math.min(100, Math.round((a.currentValue / a.targetValue) * 100))
        : 0;
      const isComplete = a.completedAt !== null;

      return `
        <div class="achievement-item">
          <div class="achievement-icon" style="background: ${escapeAttr(a.color || '#6b7280')}">
            ${iconChar(a.icon)}
          </div>
          <div class="achievement-info">
            <strong>${esc(a.name)}</strong>
            <span>${esc(a.description)}</span>
            ${
              isComplete
                ? ''
                : `<div class="achievement-progress">
                     <div class="achievement-progress-fill" style="width: ${pct}%"></div>
                   </div>`
            }
          </div>
          ${isComplete ? '<span class="achievement-complete">Completed</span>' : ''}
        </div>
      `;
    })
    .join('');
}

function renderPortfolio(items) {
  const container = document.getElementById('portfolio-list');

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="placeholder">No portfolio items yet.</p>';
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
      <div class="portfolio-item">
        <h4>${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>` : esc(item.title)}</h4>
        ${item.description ? `<p>${esc(item.description)}</p>` : ''}
      </div>
    `
    )
    .join('');
}

function renderLinkedAccounts(accounts) {
  const container = document.getElementById('linked-accounts-list');

  if (!accounts || accounts.length === 0) {
    container.innerHTML =
      '<p class="placeholder">No linked accounts.</p>';
    return;
  }

  container.innerHTML = accounts
    .map(
      (acct) => `
      <div class="linked-account">
        <div class="provider-icon">${providerIcon(acct.provider)}</div>
        <div>
          <div class="provider">${esc(acct.provider)}</div>
          <div class="provider-detail">${esc(acct.providerUsername || acct.providerEmail || '')}</div>
        </div>
      </div>
    `
    )
    .join('');
}

// ---- Helpers ----

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function prettifyUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function providerIcon(provider) {
  const icons = {
    github: '\u{1F4BB}',
    google: '\u{1F310}',
    discord: '\u{1F4AC}',
    slack: '\u{1F4E8}',
  };
  return icons[(provider || '').toLowerCase()] || '\u{1F517}';
}

function iconChar(icon) {
  const icons = {
    calendar: '\u{1F4C5}',
    users: '\u{1F465}',
    star: '\u2B50',
    trophy: '\u{1F3C6}',
    code: '\u{1F4BB}',
    heart: '\u2764\uFE0F',
    fire: '\u{1F525}',
    rocket: '\u{1F680}',
    zap: '\u26A1',
  };
  return icons[icon] || '\u{1F3C5}';
}

// ---- Logout ----

function logout() {
  clearSession();
  showView('view-login');
}

// ---- Init ----

function init() {
  // Wire up event listeners
  document.getElementById('btn-signin').addEventListener('click', (e) => {
    e.preventDefault();
    startLogin();
  });

  document.getElementById('btn-logout').addEventListener('click', logout);

  // Check if returning from OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (code && state) {
    handleCallback(code, state);
    return;
  }

  // Check for existing session
  if (getAccessToken()) {
    loadDashboard();
    return;
  }

  // Show login
  showView('view-login');
}

init();
