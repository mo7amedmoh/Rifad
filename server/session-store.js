const session = require('express-session');
const db = require('./db');

class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    this.read = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
    this.write = db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire');
    this.remove = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanup = db.prepare('DELETE FROM sessions WHERE expire <= ?');
  }

  get(sid, callback) {
    try {
      const row = this.read.get(sid);
      if (!row || row.expire <= Date.now()) {
        if (row) this.remove.run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expire = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
      this.write.run(sid, JSON.stringify(value), expire);
      this.cleanup.run(Date.now());
      callback(null);
    } catch (error) { callback(error); }
  }

  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }

  destroy(sid, callback = () => {}) {
    try { this.remove.run(sid); callback(null); }
    catch (error) { callback(error); }
  }

  clear(callback = () => {}) {
    try { db.exec('DELETE FROM sessions'); callback(null); }
    catch (error) { callback(error); }
  }

  length(callback) {
    try { callback(null, db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expire > ?').get(Date.now()).count); }
    catch (error) { callback(error); }
  }
}

module.exports = SQLiteSessionStore;
