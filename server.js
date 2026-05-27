const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('database.db');

// ========== СОЗДАНИЕ ТАБЛИЦ ==========
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
        is_admin INTEGER DEFAULT 0
    )`);
    
    // Добавляем колонки, если их нет (для старых баз)
    db.run(`ALTER TABLE users ADD COLUMN nickname_color TEXT DEFAULT '#ffffff'`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN record_cups INTEGER DEFAULT 0`, () => {});
    
    // Админ unity / ALT F4
    db.get(`SELECT * FROM users WHERE login = 'unity'`, (err, row) => {
        if (!row) {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO users (login, password, nickname, tag, is_admin) VALUES (?, ?, ?, ?, ?)`,
                ['unity', 'ALT F4', 'Администратор', tag, 1]);
        }
    });

    // Добавляем тестовых игроков для таблицы лидеров
    db.get(`SELECT COUNT(*) as count FROM users WHERE login LIKE 'test_%'`, (err, row) => {
        if (row.count === 0) {
            const testPlayers = [
                { login: 'test_pro', nickname: 'ProGamer', cups: 12500, boxes: 340 },
                { login: 'test_legend', nickname: 'LegendMaster', cups: 8700, boxes: 210 },
                { login: 'test_fighter', nickname: 'FighterX', cups: 5200, boxes: 150 },
                { login: 'test_noob', nickname: 'NoobSaibot', cups: 350, boxes: 12 },
                { login: 'test_veteran', nickname: 'OldGuard', cups: 25400, boxes: 890 }
            ];
            testPlayers.forEach(p => {
                const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
                db.run(`INSERT INTO users (login, nickname, tag, cups, total_boxes, coins) VALUES (?, ?, ?, ?, ?, ?)`,
                    [p.login, p.nickname, tag, p.cups, p.boxes, 500]);
            });
            console.log('✅ Добавлено 5 тестовых игроков для таблицы лидеров');
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
            if (player.is_admin === 1) {
                if (password === 'ALT F4') {
                    res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, is_admin: true } });
                } else {
                    res.json({ success: false, message: 'Неверный пароль администратора' });
                }
            } else {
                res.json({ success: true, player: { id: player.id, nickname: player.nickname, tag: player.tag, avatar: player.avatar, coins: player.coins, total_boxes: player.total_boxes, cups: player.cups, is_admin: false } });
            }
        } else {
            const tag = '#' + Math.random().toString(36).substr(2, 6).toUpperCase();
            db.run(`INSERT INTO users (nickname, tag) VALUES (?, ?)`, [nickname, tag], function(err) {
                if (err) return res.json({ success: false, message: 'Ошибка создания' });
                db.get(`SELECT * FROM users WHERE id = ?`, [this.lastID], (err, newPlayer) => {
                    res.json({ success: true, player: { id: newPlayer.id, nickname: newPlayer.nickname, tag: newPlayer.tag, avatar: newPlayer.avatar, coins: newPlayer.coins, total_boxes: newPlayer.total_boxes, cups: newPlayer.cups, is_admin: false } });
                });
            });
        }
    });
});

// Получить всех пользователей (для таблицы лидеров)
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, nickname, avatar, cups, total_boxes FROM users`, (err, users) => {
        if (err) return res.json([]);
        res.json(users || []);
    });
});

// Получить данные игрока
app.get('/api/player/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT id, nickname, tag, avatar, nickname_color, coins, total_boxes, cups, record_cups FROM users WHERE id = ?`, [id], (err, player) => {
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

// Смена никнейма (только цвет пока)
app.post('/api/change_nickname', (req, res) => {
    const { playerId, color } = req.body;
    db.run(`UPDATE users SET nickname_color = ? WHERE id = ?`, [color, playerId]);
    res.json({ success: true });
});

// Добавление монет (для игрового режима)
app.post('/api/add_coins', (req, res) => {
    const { playerId, coins } = req.body;
    db.run(`UPDATE users SET coins = coins + ? WHERE id = ?`, [coins, playerId]);
    res.json({ success: true });
});

// Добавление кубков и обновление рекорда
app.post('/api/add_cups', (req, res) => {
    const { playerId, cups } = req.body;
    db.get(`SELECT cups, record_cups FROM users WHERE id = ?`, [playerId], (err, user) => {
        if (user) {
            const newCups = (user.cups || 0) + cups;
            const newRecord = Math.max(user.record_cups || 0, newCups);
            db.run(`UPDATE users SET cups = ?, record_cups = ? WHERE id = ?`, [newCups, newRecord, playerId]);
        }
        res.json({ success: true });
    });
});

// Сохранение пути к славе
app.post('/api/save_path', (req, res) => {
    const { playerId, pathData } = req.body;
    db.run(`UPDATE users SET path_data = ? WHERE id = ?`, [JSON.stringify(pathData), playerId]);
    res.json({ success: true });
});

app.listen(port, () => console.log(`🚀 Сервер на порту ${port}`));
