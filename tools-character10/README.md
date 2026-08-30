# Character 10 build

`character10-umbrella-crab.html` is generated, not hand-edited.

- `c10_template.html` — the real source: markup, rig, gait and attack code,
  with an `__EMBEDDED__` placeholder where the art atlas goes.
- `build.py` — lifts the base64 `EMBEDDED` art block out of the original
  paper-doll export and substitutes it into the template.

Edit the template, then run `python3 tools-character10/build.py` from the repo
root to regenerate the single-file HTML.
