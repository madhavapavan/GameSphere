const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

dotenv.config();

const app = express();
const port = 3000;

// Set up PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Routes

// Landing Page
app.get('/', (req, res) => {
    res.render('landing');
});

// Sign Up Page
app.get('/signup', (req, res) => {
    res.render('signup');
});

app.post('/signup', async (req, res) => {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
            [name, email, hashedPassword, role]
        );
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error during signup');
    }
});

// Login Page
app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { email, password, role } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [email, role]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const validPassword = await bcrypt.compare(password, user.password);
            if (validPassword) {
                req.session.user = user;
                if (user.role === 'admin') {
                    res.redirect('/admin/dashboard');
                } else {
                    res.redirect('/player/dashboard');
                }
            } else {
                res.status(400).send('Invalid password');
            }
        } else {
            res.status(400).send('User not found');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error during login');
    }
});

// Player Dashboard
app.get('/player/dashboard', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'player') {
        return res.redirect('/login');
    }
    try {
        const games = await pool.query(`
            SELECT g.*, COUNT(e.id) AS enrolled_count
            FROM games g
            LEFT JOIN enrollments e ON g.id = e.game_id
            GROUP BY g.id
        `);
        res.render('player-dashboard', { games: games.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/games/:id/enroll', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'player') {
        return res.redirect('/login');
    }
    const { id } = req.params;
    const playerId = req.session.user.id;
    try {
        const game = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
        const enrollments = await pool.query('SELECT * FROM enrollments WHERE game_id = $1', [id]);
        if (enrollments.rows.length >= game.rows[0].player_limit) {
            return res.status(400).send('Game is full');
        }
        await pool.query('INSERT INTO enrollments (player_id, game_id) VALUES ($1, $2)', [playerId, id]);
        res.redirect('/player/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Admin Dashboard
app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    try {
        const games = await pool.query('SELECT * FROM games WHERE created_by = $1', [req.session.user.id]);
        res.render('admin-dashboard', { games: games.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/games/create', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    res.render('create-game');
});

app.post('/games/create', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    const { title, description, date, player_limit } = req.body;
    try {
        await pool.query(
            'INSERT INTO games (title, description, date, player_limit, created_by) VALUES ($1, $2, $3, $4, $5)',
            [title, description, date, player_limit, req.session.user.id]
        );
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.get('/games/:id/edit', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    const { id } = req.params;
    try {
        const game = await pool.query('SELECT * FROM games WHERE id = $1', [id]);
        res.render('edit-game', { game: game.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/games/:id/edit', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    const { id } = req.params;
    const { title, description, date, player_limit } = req.body;
    try {
        await pool.query(
            'UPDATE games SET title = $1, description = $2, date = $3, player_limit = $4 WHERE id = $5',
            [title, description, date, player_limit, id]
        );
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/games/:id/delete', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM games WHERE id = $1', [id]);
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

//admin logout
// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error during logout');
        }
        res.redirect('/login');  // Redirect to login page after logout
    });
});

// Player Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error during logout');
        }
        res.redirect('/login');  // Redirect to login page after logout
    });
});
