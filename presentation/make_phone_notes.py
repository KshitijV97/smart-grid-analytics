"""Convert STUDY_NOTES.md into plain text for phone note apps: python make_phone_notes.py"""
import re
from pathlib import Path

here = Path(__file__).parent
lines = (here / "STUDY_NOTES.md").read_text().splitlines()
out = []
for i, line in enumerate(lines):
    if line.startswith("```"):
        continue
    if re.match(r"^\|[-| ]+\|$", line):
        continue
    if line.startswith("|"):
        line = line.replace("**", "")
        # Header rows are followed by a separator row; render them as a label line.
        cells = [c.strip() for c in line.strip("|").split("|")]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if re.match(r"^\|[-| ]+\|$", nxt):
            out.append("[" + " | ".join(cells) + "]")
        else:
            out.append(" - " + " | ".join(cells))
        continue
    line = re.sub(r"^#+ ", "", line)
    line = line.replace("**", "").replace("`", "").replace("- [ ] ", "[ ] ")
    line = re.sub(r"(?<!\w)\*([^*\n]+)\*(?!\w)", r"\1", line)
    if line.strip() == "---":
        line = "----------"
    out.append(line)
text = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
(here / "phone_notes.txt").write_text(text)
print(f"wrote phone_notes.txt ({len(text):,} characters)")
