const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3100;
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'campus.sqlite'));
const sessions = new Map();
const upload = multer({ storage: multer.diskStorage({ destination: uploadDir, filename: (_, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ id: this.lastID, changes: this.changes }); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const now = () => new Date().toISOString();
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, course: user.course });
const classify = text => { const value = text.toLowerCase(); const rules = [['Wi-Fi/Internet', ['wifi', 'wi-fi', 'internet', 'network', 'connection']], ['Electrical', ['light', 'power', 'socket', 'electric', 'outlet']], ['Plumbing', ['tap', 'leak', 'water', 'toilet', 'drain']], ['Cleanliness', ['trash', 'dirty', 'clean', 'waste', 'spill']], ['Infrastructure', ['tile', 'door', 'roof', 'wall', 'lift', 'elevator']], ['Classroom', ['classroom', 'desk', 'chair', 'lecture room']], ['Laboratory Equipment', ['projector', 'microscope', 'printer', 'equipment', 'computer', 'lab']], ['Security', ['security', 'unsafe', 'theft', 'access']]]; return rules.find(([, words]) => words.some(word => value.includes(word)))?.[0] || 'Other'; };
const suggestPriority = text => { const value = text.toLowerCase(); if (/danger|sparking|flood|unsafe|emergency/.test(value)) return 'Urgent'; if (/broken|leak|cannot|blocked|down/.test(value)) return 'High'; if (/slow|dim|crack/.test(value)) return 'Medium'; return 'Low'; };
const issueSelect = `SELECT i.*, u.name AS reporterName FROM issues i JOIN users u ON u.id = i.createdBy`;
function issueShape(issue, history = []) { return { ...issue, updates: history, imageUrl: issue.imagePath ? `/uploads/${issue.imagePath}` : null }; }
async function loadIssue(id) { const issue = await get(`${issueSelect} WHERE i.id = ?`, [id]); if (!issue) return null; return issueShape(issue, await all('SELECT label, createdAt AS date FROM issue_history WHERE issueId = ? ORDER BY id', [id])); }

(async () => {
  await run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', course TEXT DEFAULT 'Student', createdAt TEXT NOT NULL)`);
  await run(`CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, location TEXT NOT NULL, imagePath TEXT, status TEXT NOT NULL DEFAULT 'Reported', assignee TEXT DEFAULT 'Unassigned', comment TEXT, rating INTEGER, createdBy INTEGER NOT NULL, createdAt TEXT NOT NULL, FOREIGN KEY(createdBy) REFERENCES users(id))`);
  await run(`CREATE TABLE IF NOT EXISTS issue_history (id INTEGER PRIMARY KEY AUTOINCREMENT, issueId TEXT NOT NULL, label TEXT NOT NULL, createdAt TEXT NOT NULL)`);
  const admin = await get('SELECT id FROM users WHERE email = ?', ['admin@campus.edu']);
  if (!admin) await run('INSERT INTO users (name,email,passwordHash,role,course,createdAt) VALUES (?,?,?,?,?,?)', ['Campus Administrator', 'admin@campus.edu', await bcrypt.hash('Admin@123', 10), 'admin', 'Facilities & Operations', now()]);
  else await run('UPDATE users SET name = ?, passwordHash = ?, role = ?, course = ? WHERE id = ?', ['Campus Administrator', await bcrypt.hash('Admin@123', 10), 'admin', 'Facilities & Operations', admin.id]);
  const oldDemo = await get('SELECT id FROM users WHERE email = ?', ['student@campus.edu']);
  if (oldDemo) { await run('DELETE FROM issue_history WHERE issueId IN (SELECT id FROM issues WHERE createdBy = ?)', [oldDemo.id]); await run('DELETE FROM issues WHERE createdBy = ?', [oldDemo.id]); await run('DELETE FROM users WHERE id = ?', [oldDemo.id]); }
})().catch(error => console.error('Database setup failed:', error));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { const token = (req.headers.authorization || '').replace('Bearer ', ''); req.user = sessions.get(token); next(); });
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Authentication required' });
const requireAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });

app.post('/api/auth/register', async (req, res) => { try { const { name, email, password, confirmPassword } = req.body; if (!name || !email || !password || password !== confirmPassword) return res.status(400).json({ error: 'Name, email, password and matching confirmation are required' }); if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' }); const hash = await bcrypt.hash(password, 10); const result = await run('INSERT INTO users (name,email,passwordHash,role,course,createdAt) VALUES (?,?,?,?,?,?)', [name.trim(), email.trim().toLowerCase(), hash, 'student', 'Student', now()]); const user = await get('SELECT * FROM users WHERE id = ?', [result.id]); const token = crypto.randomUUID(); sessions.set(token, user); res.status(201).json({ token, user: safeUser(user) }); } catch (error) { res.status(error.code === 'SQLITE_CONSTRAINT' ? 409 : 400).json({ error: error.code === 'SQLITE_CONSTRAINT' ? 'An account with this email already exists' : error.message }); } });
app.post('/api/auth/login', async (req, res) => { const user = await get('SELECT * FROM users WHERE email = ?', [String(req.body.email || '').trim().toLowerCase()]); if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' }); const token = crypto.randomUUID(); sessions.set(token, user); res.json({ token, user: safeUser(user) }); });
app.get('/api/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));
app.get('/api/issues', requireAuth, async (req, res) => { const rows = await all(`${issueSelect} ${req.user.role === 'admin' ? '' : 'WHERE i.createdBy = ?'} ORDER BY i.createdAt DESC`, req.user.role === 'admin' ? [] : [req.user.id]); res.json({ issues: await Promise.all(rows.map(row => loadIssue(row.id))) }); });
app.get('/api/student-stats', requireAuth, async (req, res) => { const row = await get(`SELECT COUNT(*) total, SUM(status IN ('Reported','Assigned')) pending, SUM(status = 'In Progress') progress, SUM(status = 'Resolved') resolved FROM issues WHERE createdBy = ?`, [req.user.id]); const notifications = await get('SELECT COUNT(*) count FROM issue_history h JOIN issues i ON i.id = h.issueId WHERE i.createdBy = ? AND h.label != ?', [req.user.id, 'Reported']); res.json({ total: row.total || 0, pending: row.pending || 0, progress: row.progress || 0, resolved: row.resolved || 0, notifications: notifications.count || 0 }); });
app.get('/api/analytics', requireAdmin, async (_, res) => { const [stats, categories, locations] = await Promise.all([get(`SELECT COUNT(*) total, SUM(status IN ('Reported','Assigned')) pending, SUM(status = 'In Progress') progress, SUM(status = 'Resolved') resolved FROM issues`), all('SELECT category name, COUNT(*) value FROM issues GROUP BY category ORDER BY value DESC'), all('SELECT location name, COUNT(*) value FROM issues GROUP BY location ORDER BY value DESC')]); res.json({ total: stats.total || 0, pending: stats.pending || 0, progress: stats.progress || 0, resolved: stats.resolved || 0, categories, locations }); });
app.get('/api/complaints/frequent', requireAuth, async (req, res) => { const rows = await all('SELECT category name, COUNT(*) value FROM issues GROUP BY category ORDER BY value DESC'); const total = rows.reduce((sum, row) => sum + row.value, 0); res.json({ complaints: rows.map(row => ({ ...row, percentage: total ? Math.round(row.value / total * 100) : 0 })) }); });
app.post('/api/issues', requireAuth, upload.single('image'), async (req, res) => { try { const input = req.body; if (!input.title || !input.description || !input.location) return res.status(400).json({ error: 'Title, description and location are required' }); const category = input.category || classify(`${input.title} ${input.description}`); const priority = input.priority || suggestPriority(`${input.title} ${input.description}`); const id = `SC-${Date.now().toString().slice(-7)}`; const imagePath = req.file?.filename || null; await run('INSERT INTO issues (id,title,description,category,priority,location,imagePath,status,assignee,createdBy,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, input.title, input.description, category, priority, input.location, imagePath, 'Reported', 'Unassigned', req.user.id, now()]); await run('INSERT INTO issue_history (issueId,label,createdAt) VALUES (?,?,?)', [id, 'Reported', now()]); res.status(201).json({ issue: await loadIssue(id), smart: { category, priority } }); } catch (error) { if (req.file) fs.rmSync(req.file.path, { force: true }); res.status(400).json({ error: error.message }); } });
app.patch('/api/issues/:id', requireAuth, async (req, res) => { const issue = await get('SELECT * FROM issues WHERE id = ? AND (createdBy = ? OR ? = 1)', [req.params.id, req.user.id, req.user.role === 'admin' ? 1 : 0]); if (!issue) return res.status(404).json({ error: 'Issue not found' }); const input = req.body; if (req.user.role === 'admin') { const statusChanged = input.status && input.status !== issue.status; await run('UPDATE issues SET status = COALESCE(?,status), assignee = COALESCE(?,assignee), comment = COALESCE(?,comment) WHERE id = ?', [input.status, input.assignee, input.comment, issue.id]); if (statusChanged) await run('INSERT INTO issue_history (issueId,label,createdAt) VALUES (?,?,?)', [issue.id, input.status, now()]); } else if (input.rating) await run('UPDATE issues SET rating = ? WHERE id = ?', [input.rating, issue.id]); res.json({ issue: await loadIssue(issue.id) }); });
app.get(/.*/, (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Smart Campus running at http://localhost:${PORT}`));
