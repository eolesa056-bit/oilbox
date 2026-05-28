const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('database.db');

// Создание таблиц
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE,
        password TEXT,
        nickname TEXT,
        tag TEXT UNIQUE,
        avatar TEXT DEFAULT '🎮',
        nickname_color TEXT DEFAULT '#ffffff',
        coins INTEGER DEFAULT 100,
        total_boxes INTEGER DEFAULT 0,
        cups INTEGER DEFAULT 0,
        record_cups INTEGER DEFAULT 0,
        gems INTEGER DEFAULT 0,
        is_banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        is_admin INTEGER DEFAULT 0,
        path_data TEXT DEFAULT '[]'
    )`);

    // Админы
    db.get(`SELECT * FROM users WHERE login = 'unity'`, (err, row) => {
        if (!row) {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO users (login, password, nickname, tag, is_admin) VALUES (?, ?, ?, ?, ?)`,
                ['unity', 'ALT F4', 'Администратор', tag, 1]);
        }
    });
    db.get(`SELECT * FROM users WHERE login = 'root'`, (err, row) => {
        if (!row) {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO users (login, password, nickname, tag, is_admin) VALUES (?, ?, ?, ?, ?)`,
                ['root', 'ZXC1337', 'Root Admin', tag, 1]);
        }
    });
});

app.use(express.static('public'));
app.use(express.json());

// ========== API ==========

// Вход / регистрация
app.post('/api/login', (req, res) => {
    const { nickname, password } = req.body;
    db.get(`SELECT * FROM users WHERE nickname = ?`, [nickname], (err, player) => {
        if (player) {
            if (player.is_admin === 1 && (password === 'ALT F4' || password === 'ZXC1337')) {
                res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, gems: player.gems, is_admin: true } });
            } else if (player.is_admin === 0) {
                res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, gems: player.gems, is_admin: false } });
            } else {
                res.json({ success: false, message: 'Неверный пароль' });
            }
        } else {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO users (nickname, tag) VALUES (?, ?)`, [nickname, tag], function(err) {
                if (err) return res.json({ success: false, message: 'Ошибка создания' });
                db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (err, newPlayer) => {
                    res.json({ success: true, player: { id: newPlayer.id, nickname: newPlayer.nickname, tag: newPlayer.tag, avatar: newPlayer.avatar, coins: newPlayer.coins, total_boxes: newPlayer.total_boxes, cups: newPlayer.cups, gems: newPlayer.gems, is_admin: false } });
                });
            });
        }
    });
});

// Получить всех игроков
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, nickname, avatar, nickname_color, cups, total_boxes, coins, gems, is_banned, ban_reason FROM users`, (err, users) => {
        if (err) return res.json([]);
        res.json(users || []);
    });
});

// Получить одного игрока
app.get('/api/player/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT id, nickname, tag, avatar, nickname_color, coins, total_boxes, cups, record_cups, gems, is_banned, ban_reason, path_data FROM users WHERE id = ?`, [id], (err, player) => {
        if (!player) return res.json({ error: 'not found' });
        res.json(player);
    });
});

// Смена аватарки
app.post('/api/change_avatar', (req, res) => {
    const { playerId, avatar } = req.body;
    db.run(`UPDATE users SET avatar = ? WHERE id = ?`, [avatar, playerId]);
    res.json({ success: true });
});

// Смена цвета/ника
app.post('/api/change_nickname', (req, res) => {
    const { playerId, color, newNickname } = req.body;
    if (newNickname) {
        db.run(`UPDATE users SET nickname = ?, nickname_color = ? WHERE id = ?`, [newNickname, color, playerId]);
    } else {
        db.run(`UPDATE users SET nickname_color = ? WHERE id = ?`, [color, playerId]);
    }
    res.json({ success: true });
});

// Добавление монет
app.post('/api/add_coins', (req, res) => {
    const { playerId, coins } = req.body;
    db.run(`UPDATE users SET coins = coins + ? WHERE id = ?`, [coins, playerId]);
    res.json({ success: true });
});

// Добавление гемов
app.post('/api/add_gems', (req, res) => {
    const { playerId, gems } = req.body;
    db.run(`UPDATE users SET gems = gems + ? WHERE id = ?`, [gems, playerId]);
    res.json({ success: true });
});

// Трата гемов
app.post('/api/spend_gems', (req, res) => {
    const { playerId, gems } = req.body;
    db.run(`UPDATE users SET gems = gems - ? WHERE id = ? AND gems >= ?`, [gems, playerId, gems]);
    res.json({ success: true });
});

// Добавление ящика
app.post('/api/add_box', (req, res) => {
    const { playerId } = req.body;
    db.run(`UPDATE users SET total_boxes = total_boxes + 1 WHERE id = ?`, [playerId]);
    res.json({ success: true });
});

// Добавление кубков (за бои)
app.post('/api/add_cups', (req, res) => {
    const { playerId, cups } = req.body;
    console.log(`🎮 Игрок ${playerId} получает ${cups} кубков`);
    db.get(`SELECT cups, record_cups FROM users WHERE id = ?`, [playerId], (err, user) => {
        if (user) {
            const newCups = (user.cups || 0) + cups;
            const newRecord = Math.max(user.record_cups || 0, newCups);
            db.run(`UPDATE users SET cups = ?, record_cups = ? WHERE id = ?`, [newCups, newRecord, playerId]);
        }
        res.json({ success: true });
    });
});

// ========== БАН И РАЗБАН ==========
const userSockets = new Map();

app.post('/api/ban', (req, res) => {
    const { userId, reason } = req.body;
    console.log(`🔨 БАН игрока ${userId}: ${reason}`);
    db.run(`UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?`, [reason, userId]);
    
    const socket = userSockets.get(parseInt(userId));
    if (socket) {
        socket.emit('session_terminated', { reason: reason });
        setTimeout(() => socket.disconnect(true), 100);
    }
    res.json({ success: true });
});

app.post('/api/unban', (req, res) => {
    const { userId } = req.body;
    console.log(`✅ РАЗБАН игрока ${userId}`);
    db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?`, [userId]);
    res.json({ success: true });
});

// Сохранение пути к славе
app.post('/api/save_path', (req, res) => {
    const { playerId, pathData } = req.body;
    db.run(`UPDATE users SET path_data = ? WHERE id = ?`, [JSON.stringify(pathData), playerId]);
    res.json({ success: true });
});

// Промокоды
app.get('/api/promocodes', (req, res) => {
    db.all(`SELECT * FROM promocodes`, (err, promos) => {
        if (err) return res.json([]);
        res.json(promos || []);
    });
});
app.post('/api/create_promo', (req, res) => {
    const { code, reward, max } = req.body;
    db.run(`INSERT INTO promocodes (code, reward, max_activations) VALUES (?, ?, ?)`, [code, reward, max]);
    res.json({ success: true });
});
app.post('/api/delete_promo', (req, res) => {
    const { id } = req.body;
    db.run(`DELETE FROM promocodes WHERE id = ?`, [id]);
    res.json({ success: true });
});

// Ивенты
app.get('/api/events', (req, res) => {
    db.all(`SELECT * FROM events WHERE is_active = 1`, (err, events) => {
        if (err) return res.json([]);
        res.json(events || []);
    });
});
app.post('/api/create_event', (req, res) => {
    const { name, type, end_time } = req.body;
    db.run(`INSERT INTO events (name, event_type, end_time, is_active) VALUES (?, ?, ?, 1)`, [name, type, end_time]);
    res.json({ success: true });
});
app.post('/api/stop_event', (req, res) => {
    const { eventId } = req.body;
    db.run(`UPDATE events SET is_active = 0 WHERE id = ?`, [eventId]);
    res.json({ success: true });
});

// Репорты
app.get('/api/reports', (req, res) => {
    db.all(`SELECT r.*, u1.nickname as from_nick, u2.nickname as to_nick 
            FROM reports r 
            LEFT JOIN users u1 ON r.from_player_id = u1.id 
            LEFT JOIN users u2 ON r.to_player_id = u2.id`, (err, reports) => {
        if (err) return res.json([]);
        res.json(reports || []);
    });
});
app.post('/api/resolve_report', (req, res) => {
    const { reportId, action } = req.body;
    if (action === 'ban') {
        db.get(`SELECT to_player_id FROM reports WHERE id = ?`, [reportId], (err, report) => {
            if (report) db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [report.to_player_id]);
        });
    }
    db.run(`UPDATE reports SET status = 'resolved' WHERE id = ?`, [reportId]);
    res.json({ success: true });
});

// ========== SOCKET.IO ==========
const http = require('http');
const socketIo = require('socket.io');
const server = http.createServer(app);
const io = socketIo(server);

io.on('connection', (socket) => {
    console.log('✅ Сокет подключён:', socket.id);
    
    socket.on('auth', (userId, callback) => {
        const uid = parseInt(userId);
        db.get(`SELECT * FROM users WHERE id = ?`, [uid], (err, user) => {
            if (err || !user) {
                callback({ success: false });
            } else {
                socket.userId = uid;
                userSockets.set(uid, socket);
                callback({ success: true });
                console.log(`👤 Игрок ${user.nickname} (${uid}) авторизован`);
            }
        });
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) {
            console.log(`❌ Игрок ${socket.userId} отключился`);
            userSockets.delete(socket.userId);
        }
    });
});

server.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
