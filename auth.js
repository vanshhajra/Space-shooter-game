// ── auth.js ──────────────────────────────────────────────────────────────────
// Client-side auth using localStorage.
// Passwords are hashed with SHA-256 via the Web Crypto API before storing.
// Per-user game data: highScore, totalGames, totalScore are persisted.
// ─────────────────────────────────────────────────────────────────────────────

const DB_KEY    = 'spaceShooterUsers';   // localStorage key for user registry
const SESS_KEY  = 'spaceShooterSession'; // localStorage key for current session

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function getUsers() {
  return JSON.parse(localStorage.getItem(DB_KEY) || '{}');
}

function saveUsers(users) {
  localStorage.setItem(DB_KEY, JSON.stringify(users));
}

function getSession() {
  return localStorage.getItem(SESS_KEY);
}

function saveSession(username) {
  localStorage.setItem(SESS_KEY, username);
}

function clearSession() {
  localStorage.removeItem(SESS_KEY);
}

// ── Exposed API ───────────────────────────────────────────────────────────────

// Register a new user. Returns { ok, error }
async function authRegister(username, password, confirmPassword) {
  username = username.trim();
  if (!username || username.length < 2)
    return { ok: false, error: 'Username must be at least 2 characters.' };
  if (password.length < 4)
    return { ok: false, error: 'Password must be at least 4 characters.' };
  if (password !== confirmPassword)
    return { ok: false, error: 'Passwords do not match.' };

  const users = getUsers();
  if (users[username.toLowerCase()])
    return { ok: false, error: 'Username already taken.' };

  const hash = await hashPassword(password);
  users[username.toLowerCase()] = {
    username,           // original casing for display
    hash,
    highScore:   0,
    totalGames:  0,
    totalScore:  0
  };
  saveUsers(users);
  return { ok: true };
}

// Login. Returns { ok, error }
async function authLogin(username, password) {
  username = username.trim();
  const users = getUsers();
  const record = users[username.toLowerCase()];
  if (!record) return { ok: false, error: 'Username not found.' };

  const hash = await hashPassword(password);
  if (hash !== record.hash) return { ok: false, error: 'Incorrect password.' };

  saveSession(record.username);
  return { ok: true, username: record.username };
}

// Get data for the current user (or null if guest / not found)
function getUserData(username) {
  if (!username) return null;
  const users = getUsers();
  return users[username.toLowerCase()] || null;
}

// Save game result for a user
function saveGameResult(username, score) {
  if (!username) return;
  const users = getUsers();
  const key   = username.toLowerCase();
  if (!users[key]) return;
  users[key].totalGames++;
  users[key].totalScore += score;
  if (score > users[key].highScore) users[key].highScore = score;
  saveUsers(users);
}

// ── Auth UI ───────────────────────────────────────────────────────────────────

let currentUser = null; // null = guest

function startSession(username) {
  currentUser = username;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('gameArea').style.display   = 'block';

  const label = document.getElementById('userLabel');
  if (username) {
    const data = getUserData(username);
    label.textContent = `👤 ${username}  |  Best: ${data ? data.highScore : 0}`;
  } else {
    label.textContent = '👤 Guest';
  }

  // Sync highScore into the game module if already loaded
  if (typeof syncHighScoreFromUser === 'function') syncHighScoreFromUser();
}

// ── Initialise UI on DOMContentLoaded ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Check for existing session
  const savedUser = getSession();
  if (savedUser && getUserData(savedUser)) {
    startSession(savedUser);
    return;
  }

  // Tab switching
  const tabLogin    = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm   = document.getElementById('loginForm');
  const registerForm= document.getElementById('registerForm');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.style.display    = '';
    registerForm.style.display = 'none';
    document.getElementById('loginError').textContent = '';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.style.display = '';
    loginForm.style.display    = 'none';
    document.getElementById('registerError').textContent = '';
  });

  // Login submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('loginUser').value;
    const pass = document.getElementById('loginPass').value;
    const result = await authLogin(user, pass);
    if (result.ok) {
      saveSession(result.username);
      startSession(result.username);
    } else {
      document.getElementById('loginError').textContent = result.error;
    }
  });

  // Register submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user  = document.getElementById('regUser').value;
    const pass  = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;
    const result = await authRegister(user, pass, pass2);
    if (result.ok) {
      // Auto-login after register
      const loginResult = await authLogin(user, pass);
      if (loginResult.ok) {
        saveSession(loginResult.username);
        startSession(loginResult.username);
      }
    } else {
      document.getElementById('registerError').textContent = result.error;
    }
  });

  // Guest
  document.getElementById('guestBtn').addEventListener('click', () => {
    startSession(null);
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearSession();
    currentUser = null;
    // Reset forms
    loginForm.reset();
    registerForm.reset();
    document.getElementById('loginError').textContent    = '';
    document.getElementById('registerError').textContent = '';
    document.getElementById('authScreen').style.display  = '';
    document.getElementById('gameArea').style.display    = 'none';
    // Stop any running game
    if (typeof pauseToMenu === 'function') pauseToMenu();
  });

});
