import sqlite3
import sys

sys.path.insert(0, r"D:\DeepSeekWorkPlace\projects\wordnote\server")
from app.security import hash_password  # noqa: E402

DB = r"D:\DeepSeekWorkPlace\projects\wordnote\data\wordnote.db"
user = sys.argv[1] if len(sys.argv) > 1 else "__dev__"
password = sys.argv[2] if len(sys.argv) > 2 else "test123456"

c = sqlite3.connect(DB)
c.execute("DELETE FROM users WHERE username=?", (user,))
c.execute("INSERT INTO users(username, password_hash, created_at) VALUES(?,?,0)", (user, hash_password(password)))
c.commit()
print("users:", [r[1] for r in c.execute("SELECT id, username FROM users")])
