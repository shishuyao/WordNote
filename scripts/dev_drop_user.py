import sqlite3
import sys

DB = r"D:\DeepSeekWorkPlace\projects\wordnote\data\wordnote.db"
user = sys.argv[1] if len(sys.argv) > 1 else "__dev__"

c = sqlite3.connect(DB)
c.execute("DELETE FROM users WHERE username=?", (user,))
c.commit()
print("users:", [r[1] for r in c.execute("SELECT id, username FROM users")])
