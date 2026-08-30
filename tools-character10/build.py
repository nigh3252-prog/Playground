import re,sys
SRC="/root/.claude/uploads/5b249d90-100b-54d0-a12f-b8af369feabd/19988e14-character10paperdollwalk.html"
s=open(SRC,encoding="utf-8").read()
m=re.search(r'const EMBEDDED\s*=\s*(\{.*?\});\s*\n',s,re.S)
blob=m.group(1)
t=open("tools-character10/c10_template.html",encoding="utf-8").read()
assert "__EMBEDDED__" in t
out=t.replace("__EMBEDDED__",blob)
open("character10-umbrella-crab.html","w",encoding="utf-8").write(out)
print("wrote", len(out))
