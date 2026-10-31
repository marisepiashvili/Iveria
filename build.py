#!/usr/bin/env python3
"""ივერიის საიტის აწყობა.

კითხულობს issues/ საქაღალდის .txt ფაილებს და ქმნის data/ საქაღალდეს:
  data/years.js                 წლების სია (მთავარი გვერდი)
  data/catalog/<წელი>.js        ერთი წლის ნომრების სია
  data/issues/<წელი>/<id>.js    თითო ნომრის სრული ტექსტი
  data/docs.js, data/search/    ძიების ინდექსი

data/ საქაღალდე ყოველ ჯერზე თავიდან იქმნება — ხელით ნუ შეცვლით.
გაშვება:  python3 build.py
"""
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "issues"
OUT = ROOT / "data"

FIELDS = {
    "ნომერი": "number",
    "თარიღი": "isoDate",
    "თარიღი გაზეთზე": "date",
    "წელიწადი": "yearLabel",
    "წყარო": "source",
    "სკანი": "scan",
    "საძიებელი": "contents",
}
MONTHS = ["იანვარს", "თებერვალს", "მარტს", "აპრილს", "მაისს", "ივნისს",
          "ივლისს", "აგვისტოს", "სექტემბერს", "ოქტომბერს", "ნოემბერს", "დეკემბერს"]
WORD = re.compile(r"[^\W\d_]+")
MIN_WORD = 3  # app.js-შიც იგივე უნდა იყოს
SHARD_LEN = 3  # app.js-შიც იგივე უნდა იყოს


class IssueError(Exception):
    pass


def shard_name(key):
    return "-".join(format(ord(c), "x") for c in key)


def issue_id(iso, number):
    slug = number.zfill(3) if number.isdigit() else re.sub(r"[^\w-]+", "-", number).strip("-")
    return f"{iso}-{slug}"


def read_issue(path):
    raw = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    head, _, body = raw.partition("\n\n")
    meta = {}
    for n, line in enumerate(head.split("\n"), 1):
        if not line.strip():
            continue
        key, sep, value = line.partition(":")
        key = key.strip()
        if not sep or key not in FIELDS:
            raise IssueError(
                f"სტრიქონი {n}: „{line[:40]}“ — თავში მოსალოდნელია მხოლოდ ველები "
                f"({', '.join(FIELDS)}), შემდეგ ცარიელი სტრიქონი და ტექსტი")
        meta[FIELDS[key]] = value.strip()

    if not meta.get("number"):
        raise IssueError("აკლია „ნომერი:“")
    iso = meta.get("isoDate", "")
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", iso)
    if not m:
        raise IssueError(f"„თარიღი:“ უნდა იყოს ფორმატით 1877-03-03 (ახლა: „{iso}“)")
    if not 1 <= int(m.group(2)) <= 12:
        raise IssueError(f"არასწორი თვე თარიღში „{iso}“")
    if not meta.get("date"):
        meta["date"] = f"{int(m.group(3))} {MONTHS[int(m.group(2)) - 1]} {m.group(1)} წ."
    if not body.strip():
        raise IssueError("ტექსტი ცარიელია")

    meta["text"] = body.strip() + "\n"
    meta["id"] = issue_id(iso, meta["number"])
    meta["year"] = m.group(1)
    return meta


def outline(text):
    heads, pages = [], 1
    for line in text.split("\n"):
        line = line.strip()
        if re.fullmatch(r"={3,}", line):
            pages += 1
        h = re.match(r"(#{1,2})\s+(.+)", line)
        if h:
            heads.append(h.group(2).strip())
    return heads, pages


def words_of(issue):
    plain = " ".join([issue.get("contents", ""), issue["text"]]).lower()
    return {w for w in WORD.findall(plain) if len(w) >= MIN_WORD}


def js(call, *args):
    return call + "(" + ",".join(json.dumps(a, ensure_ascii=False, separators=(",", ":")) for a in args) + ");\n"


def main():
    started = time.time()
    if not SRC.is_dir():
        sys.exit(f"საქაღალდე {SRC} ვერ მოიძებნა")

    issues, errors, seen = [], [], {}
    for path in sorted(SRC.rglob("*.txt")):
        rel = path.relative_to(ROOT)
        try:
            issue = read_issue(path)
        except IssueError as e:
            errors.append(f"{rel}: {e}")
            continue
        except UnicodeDecodeError:
            errors.append(f"{rel}: ფაილი UTF-8 კოდირებით არ არის შენახული")
            continue
        if issue["id"] in seen:
            errors.append(f"{rel}: იგივე ნომერი და თარიღი უკვე არის ფაილში {seen[issue['id']]}")
            continue
        seen[issue["id"]] = rel
        issues.append(issue)

    if errors:
        print("შეცდომები — ეს ფაილები გამოტოვებულია:\n  " + "\n  ".join(errors) + "\n")

    def order(i):
        n = i["number"]
        return (i["isoDate"], int(n) if n.isdigit() else 0, n)
    issues.sort(key=order)

    tmp = ROOT / "data.building"
    if tmp.exists():
        shutil.rmtree(tmp)
    (tmp / "catalog").mkdir(parents=True)
    (tmp / "search").mkdir()

    build = time.strftime("%Y%m%d%H%M%S")
    by_year, index = {}, {}
    for num, issue in enumerate(issues):
        year = issue["year"]
        heads, pages = outline(issue["text"])
        entry = {"id": issue["id"], "n": issue["number"], "iso": issue["isoDate"], "date": issue["date"],
                 "h": heads, "p": pages}
        by_year.setdefault(year, []).append(entry)

        d = tmp / "issues" / year
        d.mkdir(parents=True, exist_ok=True)
        public = {k: v for k, v in issue.items() if k != "year"}
        (d / f"{issue['id']}.js").write_text(js("IVERIA.issue", public), encoding="utf-8")

        for w in words_of(issue):
            index.setdefault(w[:SHARD_LEN], {}).setdefault(w, []).append(num)

    for year, entries in by_year.items():
        (tmp / "catalog" / f"{year}.js").write_text(js("IVERIA.catalog", year, entries), encoding="utf-8")

    for key, words in index.items():
        # დოკუმენტების ნომრები ინახება სხვაობებად — ასე ფაილი ბევრად პატარაა
        packed = {}
        for w, nums in words.items():
            prev, deltas = 0, []
            for n in nums:
                deltas.append(n - prev)
                prev = n
            packed[w] = ",".join(map(str, deltas))
        (tmp / "search" / f"{shard_name(key)}.js").write_text(js("IVERIA.shard", key, packed), encoding="utf-8")

    docs = [[i["id"], i["number"], i["isoDate"], i["date"]] for i in issues]
    (tmp / "docs.js").write_text(js("IVERIA.docs", docs), encoding="utf-8")
    years = [[y, len(e)] for y, e in sorted(by_year.items())]
    (tmp / "years.js").write_text(
        js("IVERIA.years", {"build": build, "total": len(issues), "years": years}), encoding="utf-8")

    if OUT.exists():
        shutil.rmtree(OUT)
    tmp.rename(OUT)

    print(f"მზადაა: {len(issues)} ნომერი, {len(by_year)} წელი, "
          f"{sum(len(w) for w in index.values())} სიტყვა ძიების ინდექსში "
          f"({time.time() - started:.1f} წმ).")
    if errors:
        print(f"ყურადღება: {len(errors)} ფაილი გამოტოვებულია (იხ. ზემოთ).")
        sys.exit(1)


if __name__ == "__main__":
    main()
