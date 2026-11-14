#!/usr/bin/env python3
"""Team coordination tool for project/tasks.json (planning only, not part of the challenge solution).

Written before the hackathon to keep the task registry consistent. Uses only the
Python standard library (3.9+).

Commands:
  validate                          check the registry and the generated doc sections
  render [--check]                  regenerate (or check) the GENERATED blocks in docs/
  next [MEMBER_X]                   what a member (or the team) can do right now
  blocked                           blocked tasks and tasks waiting for others
  status                            counts by member and status, time to key moments
  show ID                           print one task
  set ID STATUS [...]               change a status safely (evidence for DONE, blocker for BLOCKED)
  authorize ID --source --scope     record written organizer permission for a CLARIFICATION_REQUIRED task
  schedule [SCENARIO]               feasibility model of the hackathon schedule (S1, S1_STRICT, S2, S3)
  owner PATH                        who owns a file or folder

Examples:
  python3 tools/tasks.py next MEMBER_B
  python3 tools/tasks.py set ENG-01 DONE --evidence "pytest pipeline/engine -q: 14 passed"
  python3 tools/tasks.py set PLNT-02 BLOCKED --blocker SCI-01 --blocker-owner MEMBER_E
  python3 tools/tasks.py authorize AUTH-01 --source "email from the local lead, 2026-10-20" --scope "download PGDA DEMs only"
  python3 tools/tasks.py schedule S1
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS_PATH = ROOT / "project" / "tasks.json"
ASTANA = timezone(timedelta(hours=5))

MEMBERS = ["MEMBER_A", "MEMBER_B", "MEMBER_C", "MEMBER_D", "MEMBER_E", "MEMBER_F"]
STATUSES = ["BACKLOG", "READY", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE"]
ACTIVE = {"IN_PROGRESS", "IN_REVIEW", "DONE"}
PRIORITIES = ["P0", "P1", "P2", "P3"]
PHASES = ["PREP", "HACK"]
AUTHORIZATIONS = ["PERMITTED", "CLARIFICATION_REQUIRED", "DEFER_UNTIL_EVENT"]
FLAGS = ["CRITICAL_PATH", "HIGH_RISK", "PARALLELIZABLE", "OPTIONAL"]
MILESTONES = [f"M{i}" for i in range(12)]
PREFIXES = "PREP|AUTH|RULE|KICK|INFRA|EARTH|TERR|PLNT|LIGHT|ENG|VAL|SCI|WEB|STORY|SUB|QA"
ID_RE = re.compile(rf"^({PREFIXES})-\d{{2}}$")
ID_IN_TEXT_RE = re.compile(rf"\b(?:{PREFIXES})-\d{{2}}\b")
REQUIRED = {
    "id": str, "title": str, "objective": str, "why": str, "owner": str, "collaborators": list,
    "phase": str, "authorization": str, "priority": str, "milestone": str, "status": str, "flags": list,
    "window": str, "dependencies": list, "blocked_by": list, "steps": list, "files_create": list,
    "files_modify": list, "interfaces": list, "datasets": list, "expected_output": list,
    "acceptance_criteria": list, "automated_tests": list, "manual_verification": list,
    "verification_commands": list, "completion_evidence": str, "failure_modes": list, "fallback": str,
    "estimated_effort": (int, float), "actual_evidence": list, "related_issues": list,
}
STR_LISTS = ["collaborators", "flags", "dependencies", "steps", "files_create", "files_modify", "interfaces",
             "datasets", "expected_output", "acceptance_criteria", "automated_tests", "manual_verification",
             "verification_commands", "failure_modes", "actual_evidence"]
BLOCK_RE = re.compile(
    r"(<!-- BEGIN GENERATED:(?P<name>[a-z-]+)(?::(?P<arg>[A-Z0-9_]+))? -->\n)(?P<body>.*?)"
    r"(<!-- END GENERATED:(?P=name)(?::(?P=arg))? -->)",
    re.S,
)
DOC_GLOBS = ["docs/**/*.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md", ".claude/commands/*.md", ".github/*.md"]
DOC_EXCLUDE = ("docs/archive/",)
NONE_MARK = "—"
STATUS_RU = {
    "BACKLOG": "в очереди", "READY": "можно начинать", "IN_PROGRESS": "в работе",
    "BLOCKED": "заблокирована", "IN_REVIEW": "на ревью", "DONE": "готово",
}
AUTH_RU = {
    "PERMITTED": "можно сейчас",
    "CLARIFICATION_REQUIRED": "только после письменного разрешения организаторов",
    "DEFER_UNTIL_EVENT": "только с начала хакатона",
}
WEEKDAY_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


# ----------------------------------------------------------------------------- io
def load() -> dict:
    with TASKS_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def save(data: dict) -> None:
    TASKS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def now_utc(override: str | None) -> datetime:
    return parse_time(override) if override else datetime.now(timezone.utc)


def fmt_local(dt: datetime) -> str:
    return dt.astimezone(ASTANA).strftime("%d.%m.%Y %H:%M")


def fmt_clock(dt: datetime) -> str:
    local = dt.astimezone(ASTANA)
    return f"{WEEKDAY_RU[local.weekday()]} {local:%H:%M}"


def by_id(data: dict) -> dict:
    return {t["id"]: t for t in data["tasks"]}


def not_before(task: dict, meta: dict) -> datetime | None:
    if task.get("not_before"):
        return parse_time(task["not_before"])
    if task.get("phase") == "HACK":
        return parse_time(meta["hackathon_start_utc"])
    return None


def authorized(task: dict) -> bool:
    """CLARIFICATION_REQUIRED tasks need recorded written permission before any work."""
    return task.get("authorization") != "CLARIFICATION_REQUIRED" or bool(task.get("authorization_evidence"))


def owners_of(path: str, ownership: dict) -> list | None:
    best = None
    for key, owners in ownership.items():
        if path == key or (key.endswith("/") and path.startswith(key)):
            if best is None or len(key) > len(best[0]):
                best = (key, owners)
    return best[1] if best else None


def is_none(values) -> bool:
    """True for an empty list/string or one that only says «—»."""
    if isinstance(values, str):
        return values.strip() in ("", NONE_MARK)
    return not values or all(str(v).strip() in ("", NONE_MARK) for v in values)


# ----------------------------------------------------------------------------- graph helpers
def find_cycle(tasks: dict) -> list | None:
    color = {tid: 0 for tid in tasks}
    stack: list = []

    def visit(tid: str):
        color[tid] = 1
        stack.append(tid)
        for dep in tasks[tid]["dependencies"]:
            if dep not in tasks:
                continue
            if color[dep] == 1:
                return stack[stack.index(dep):] + [dep]
            if color[dep] == 0:
                found = visit(dep)
                if found:
                    return found
        stack.pop()
        color[tid] = 2
        return None

    for tid in tasks:
        if color[tid] == 0:
            found = visit(tid)
            if found:
                return found
    return None


def ancestors(tasks: dict) -> dict:
    memo: dict = {}

    def walk(tid: str) -> set:
        if tid not in memo:
            memo[tid] = set()
            for dep in tasks[tid]["dependencies"]:
                if dep in tasks:
                    memo[tid] |= {dep} | walk(dep)
        return memo[tid]

    for tid in tasks:
        walk(tid)
    return memo


def critical_path(data: dict, phase: str = "HACK", priorities=("P0",)) -> tuple:
    tasks = {t["id"]: t for t in data["tasks"] if t["phase"] == phase and t["priority"] in priorities}
    memo: dict = {}

    def longest(tid: str):
        if tid in memo:
            return memo[tid]
        best = (0.0, [])
        for dep in tasks[tid]["dependencies"]:
            if dep in tasks:
                cand = longest(dep)
                if cand[0] > best[0]:
                    best = cand
        result = (best[0] + float(tasks[tid]["estimated_effort"]), best[1] + [tid])
        memo[tid] = result
        return result

    if find_cycle(tasks):
        return 0.0, []
    best = (0.0, [])
    for tid in tasks:
        cand = longest(tid)
        if cand[0] > best[0]:
            best = cand
    return best


# ----------------------------------------------------------------------------- schedule model
def scenario_tasks(data: dict, sc: dict) -> dict:
    priorities = sc.get("priorities", ["P0"])
    excluded = set(sc.get("exclude", []))
    overrides = sc.get("effort_overrides", {})
    return {
        t["id"]: dict(t, estimated_effort=float(overrides.get(t["id"], t["estimated_effort"])))
        for t in data["tasks"]
        if t["phase"] == "HACK" and t["priority"] in priorities and t["id"] not in excluded
    }


def simulate(data: dict, sc: dict) -> tuple:
    """Best of several list-scheduling runs (tie-break rules × P1 policies); see simulate_once.
    Preference: P0 fits at the planning productivity, then earlier P0 end, then more P1 tasks fit."""
    segs = segments_of(sc)
    prod = float(data["meta"].get("productivity", 0.75))
    best = None
    for policy in ("p0_first", "backfill"):
        for rule in ("tail", "descendants", "id"):
            run = simulate_once(data, sc, rule, policy)
            tasks, _, finish, _ = run
            p0 = max((finish[t] for t in finish if tasks[t]["priority"] == "P0"), default=0.0)
            p1_fit = sum(1 for t in finish if tasks[t]["priority"] != "P0" and at_clock(finish[t], segs, prod)[1] == 0)
            key = (at_clock(p0, segs, prod)[1] > 0, round(p0, 6), -p1_fit)
            if best is None or key < best[0]:
                best = (key, run)
    return best[1]


def simulate_once(data: dict, sc: dict, rule: str = "tail", policy: str = "p0_first") -> tuple:
    """List scheduling: one task at a time per owner, a task starts when its dependencies are done
    and its owner is free; among tasks that can start earliest, `rule` picks: the longest remaining
    chain, the most dependent tasks, or the id. Policy `p0_first` appends P1 after each owner's P0;
    `backfill` also lets a P1 task use an idle gap in its owner's P0 timeline (never delaying P0).
    Times are hours of work from the start of the scenario calendar."""
    tasks = scenario_tasks(data, sc)
    children = defaultdict(list)
    for t in tasks.values():
        for dep in t["dependencies"]:
            if dep in tasks:
                children[dep].append(t["id"])
    tail: dict = {}

    def tail_len(tid: str) -> float:
        if tid not in tail:
            tail[tid] = tasks[tid]["estimated_effort"] + max((tail_len(c) for c in children[tid]), default=0.0)
        return tail[tid]

    desc: dict = {}

    def descendants(tid: str) -> set:
        if tid not in desc:
            desc[tid] = set()
            for c in children[tid]:
                desc[tid] |= {c} | descendants(c)
        return desc[tid]

    for tid in tasks:
        descendants(tid)
    avail: dict = defaultdict(float)
    last: dict = {}
    start, finish, cause = {}, {}, {}
    priorities = sc.get("priorities", ["P0"])
    levels = [[p] for p in priorities] if policy == "p0_first" else [priorities[:1]]
    for level in levels:
        left = {tid for tid, t in tasks.items() if t["priority"] in level}
        while left:
            best = None
            for tid in sorted(left):
                t = tasks[tid]
                deps = [d for d in t["dependencies"] if d in tasks]
                if any(d not in finish for d in deps):
                    continue
                s, why = avail[t["owner"]], last.get(t["owner"])
                for dep in deps:
                    if finish[dep] > s:
                        s, why = finish[dep], dep
                rank = {"tail": -tail_len(tid), "descendants": -len(desc[tid]), "id": 0}[rule]
                key = (s, PRIORITIES.index(t["priority"]), rank, tid)
                if best is None or key < best[0]:
                    best = (key, tid, why)
            if best is None:
                break
            (s, *_), tid, why = best
            start[tid], finish[tid], cause[tid] = s, s + tasks[tid]["estimated_effort"], why
            avail[tasks[tid]["owner"]] = finish[tid]
            last[tasks[tid]["owner"]] = tid
            left.discard(tid)
    if policy == "backfill":
        rank_of = {"tail": lambda x: -tail_len(x), "descendants": lambda x: -len(desc[x]), "id": lambda x: 0}[rule]
        backfill(tasks, start, finish, cause, [p for p in priorities[1:]], rank_of)
    return tasks, start, finish, cause


def earliest_gap(busy: list, ready: float, dur: float) -> tuple:
    """Earliest start ≥ ready with `dur` free hours in a sorted list of (start, finish, id)."""
    t, prev = ready, None
    for s, f, tid in busy:
        if f <= t:
            if abs(f - t) < 1e-9:
                prev = tid
            continue
        if s >= t + dur - 1e-9:
            return t, prev
        t, prev = max(t, f), tid
    return t, prev


def backfill(tasks: dict, start: dict, finish: dict, cause: dict, levels: list, rank_of) -> None:
    busy: dict = defaultdict(list)
    for tid in start:
        busy[tasks[tid]["owner"]].append((start[tid], finish[tid], tid))
    for owner in busy:
        busy[owner].sort()
    for level in levels:
        left = {tid for tid, t in tasks.items() if t["priority"] == level}
        while left:
            best = None
            for tid in sorted(left):
                t = tasks[tid]
                deps = [d for d in t["dependencies"] if d in tasks]
                if any(d not in finish for d in deps):
                    continue
                ready = max([finish[d] for d in deps], default=0.0)
                s, prev = earliest_gap(busy[t["owner"]], ready, t["estimated_effort"])
                why = prev
                if abs(s - ready) < 1e-9 and deps:
                    why = max(deps, key=lambda d: finish[d])
                key = (s, rank_of(tid), tid)
                if best is None or key < best[0]:
                    best = (key, tid, why)
            if best is None:
                break
            (s, *_), tid, why = best
            start[tid], finish[tid], cause[tid] = s, s + tasks[tid]["estimated_effort"], why
            busy[tasks[tid]["owner"]].append((s, finish[tid], tid))
            busy[tasks[tid]["owner"]].sort()
            left.discard(tid)


def segments_of(sc: dict) -> list:
    return [(parse_time(a), parse_time(b)) for a, b in sc["segments"]]


def calendar_hours(segs: list) -> float:
    return sum((b - a).total_seconds() / 3600 for a, b in segs)


def at_clock(hours: float, segs: list, productivity: float) -> tuple:
    """Clock time when `hours` of work are done; second value = clock hours beyond the calendar."""
    need = hours / productivity
    for a, b in segs:
        span = (b - a).total_seconds() / 3600
        if need <= span + 1e-9:
            return a + timedelta(hours=need), 0.0
        need -= span
    return segs[-1][1], need


def fmt_segments(segs: list) -> str:
    days: dict = {}
    for a, b in segs:
        la, lb = a.astimezone(ASTANA), b.astimezone(ASTANA)
        days.setdefault(WEEKDAY_RU[la.weekday()], []).append(f"{la:%H:%M}–{lb:%H:%M}")
    return "; ".join(f"{d} {', '.join(v)}" for d, v in days.items())


def binding_chain(cause: dict, finish: dict, last_id: str) -> list:
    chain, tid = [], last_id
    while tid:
        chain.append(tid)
        tid = cause.get(tid)
    return list(reversed(chain))


def num(x: float) -> str:
    """Hours in Russian notation: 0,75 instead of 0.75."""
    return f"{float(x):.2f}".rstrip("0").rstrip(".").replace(".", ",")


def h(x: float) -> str:
    return num(x)


def plural(n: int, forms=("задача", "задачи", "задач")) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} {forms[0]}"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f"{n} {forms[1]}"
    return f"{n} {forms[2]}"


def pct(x: float) -> str:
    return f"{x * 100:.0f} %"


# ----------------------------------------------------------------------------- validation
def validate(data: dict, now: datetime, check_docs: bool = True) -> tuple:
    errors: list = []
    warnings: list = []
    for key in ("meta", "ownership", "tasks"):
        if key not in data:
            errors.append(f"нет раздела верхнего уровня «{key}»")
    if errors:
        return errors, warnings
    meta, ownership = data["meta"], data["ownership"]
    hack_start = parse_time(meta["hackathon_start_utc"])
    seen: dict = {}
    for i, task in enumerate(data["tasks"]):
        tid = task.get("id", f"#{i}")
        for field, typ in REQUIRED.items():
            if field not in task:
                errors.append(f"{tid}: нет поля {field}")
            elif not isinstance(task[field], typ):
                errors.append(f"{tid}: поле {field} неверного типа")
        if "authorization_evidence" not in task:
            errors.append(f"{tid}: нет поля authorization_evidence (null или запись о разрешении)")
        for field in STR_LISTS:
            if isinstance(task.get(field), list) and not all(isinstance(v, str) for v in task[field]):
                errors.append(f"{tid}: в списке {field} должны быть строки")
        if tid in seen:
            errors.append(f"{tid}: повторяющийся id")
        seen[tid] = task
        if not ID_RE.match(str(tid)):
            errors.append(f"{tid}: id не соответствует шаблону PREFIX-NN")
    if errors:
        return errors, warnings
    tasks = seen
    anc = ancestors(tasks) if not find_cycle(tasks) else {tid: set() for tid in tasks}
    creators: dict = defaultdict(list)
    for tid, t in tasks.items():
        for path in t["files_create"]:
            creators[path].append(tid)

    for tid, t in tasks.items():
        if t["owner"] not in MEMBERS:
            errors.append(f"{tid}: неизвестный владелец {t['owner']}")
        for c in t["collaborators"]:
            if c not in MEMBERS or c == t["owner"]:
                errors.append(f"{tid}: неверный соисполнитель {c}")
        if t["status"] not in STATUSES:
            errors.append(f"{tid}: неизвестный статус {t['status']}")
        if t["priority"] not in PRIORITIES:
            errors.append(f"{tid}: неизвестный приоритет {t['priority']}")
        if t["milestone"] not in MILESTONES:
            errors.append(f"{tid}: неизвестная веха {t['milestone']}")
        if t["phase"] not in PHASES:
            errors.append(f"{tid}: неизвестная фаза {t['phase']}")
        for f in t["flags"]:
            if f not in FLAGS:
                errors.append(f"{tid}: неизвестный флаг {f}")

        # authorization (PRE_EVENT_AUTHORIZATION)
        auth = t["authorization"]
        if auth not in AUTHORIZATIONS:
            errors.append(f"{tid}: неизвестная категория разрешения {auth}")
        if (t["phase"] == "HACK") != (auth == "DEFER_UNTIL_EVENT"):
            errors.append(f"{tid}: фаза {t['phase']} и разрешение {auth} не согласованы "
                          "(HACK ⇔ DEFER_UNTIL_EVENT)")
        ev = t["authorization_evidence"]
        if ev is not None:
            if auth != "CLARIFICATION_REQUIRED":
                errors.append(f"{tid}: authorization_evidence есть только у задач CLARIFICATION_REQUIRED")
            elif not (isinstance(ev, dict) and ev.get("source") and ev.get("scope") and ev.get("recorded_at")):
                errors.append(f"{tid}: authorization_evidence должен содержать source, scope и recorded_at")
        if t["status"] in ACTIVE | {"READY"} and not authorized(t):
            errors.append(f"{tid}: статус {t['status']} без записанного разрешения организаторов — "
                          "сначала `python3 tools/tasks.py authorize`")

        # completeness of the task card
        if not t["steps"]:
            errors.append(f"{tid}: нет шагов выполнения (steps)")
        if not t["acceptance_criteria"]:
            errors.append(f"{tid}: нет критериев приёмки")
        if not t["verification_commands"]:
            errors.append(f"{tid}: нет способа проверки")
        if is_none(t["automated_tests"]) and is_none(t["manual_verification"]):
            errors.append(f"{tid}: нет ни автотестов, ни ручной проверки")
        if is_none(t["completion_evidence"]):
            errors.append(f"{tid}: не указано, что считается доказательством готовности")
        if t["phase"] == "HACK" and (is_none(t["failure_modes"]) or is_none(t["fallback"])):
            errors.append(f"{tid}: у задачи хакатона должны быть типовые сбои и запасной путь")
        if not t["estimated_effort"] or t["estimated_effort"] <= 0:
            errors.append(f"{tid}: оценка трудозатрат должна быть > 0")
        if t["priority"] in ("P2", "P3") and "OPTIONAL" not in t["flags"]:
            warnings.append(f"{tid}: {t['priority']} без флага OPTIONAL")

        for dep in t["dependencies"]:
            if dep == tid:
                errors.append(f"{tid}: зависит сам от себя")
            elif dep not in tasks:
                errors.append(f"{tid}: неизвестная зависимость {dep}")
        deps = [tasks[d] for d in t["dependencies"] if d in tasks]
        deps_done = all(d["status"] == "DONE" for d in deps)

        for d in deps:
            if t["priority"] == "P0" and d["priority"] != "P0":
                errors.append(f"{tid}: P0 зависит от {d['id']} ({d['priority']}) — инверсия приоритета")
            if t["priority"] == "P1" and d["priority"] == "P3":
                errors.append(f"{tid}: P1 зависит от {d['id']} (P3) — инверсия приоритета")
            if t["phase"] == "PREP" and d["phase"] == "HACK":
                errors.append(f"{tid}: подготовительная задача зависит от задачи хакатона {d['id']}")
            if MILESTONES.index(d["milestone"]) > MILESTONES.index(t["milestone"]):
                warnings.append(f"{tid} ({t['milestone']}) зависит от {d['id']} ({d['milestone']}) — веха зависимости позже")

        nb = not_before(t, meta)
        if t["phase"] == "HACK" and t["status"] in ACTIVE and now < hack_start:
            errors.append(
                f"{tid}: статус {t['status']} до старта хакатона ({fmt_local(hack_start)} по Астане) — "
                "нарушение правила NASA о работе до хакатона"
            )
        if t["status"] == "READY":
            if not deps_done:
                errors.append(f"{tid}: READY, но не все зависимости в DONE")
            if nb and now < nb:
                errors.append(f"{tid}: READY раньше разрешённого времени ({fmt_local(nb)} по Астане)")
        if t["status"] == "DONE":
            if not t["actual_evidence"]:
                errors.append(f"{tid}: DONE без доказательств в actual_evidence")
            if not deps_done:
                errors.append(f"{tid}: DONE, но зависимости не завершены")
        if t["status"] == "BLOCKED" and not t["blocked_by"]:
            errors.append(f"{tid}: BLOCKED без blocked_by")
        if t["status"] in ("IN_PROGRESS", "IN_REVIEW") and not deps_done:
            warnings.append(f"{tid}: в работе при незавершённых зависимостях — допустимо только как черновик")
        if (t["status"] == "BACKLOG" and deps_done and (nb is None or now >= nb) and authorized(t)):
            warnings.append(f"{tid}: все условия выполнены — можно перевести в READY")

        # file ownership and safe ordering of edits
        for path in t["files_create"] + t["files_modify"]:
            owners = owners_of(path, ownership)
            if owners is None:
                errors.append(f"{tid}: у файла {path} нет владельца в ownership")
            elif t["owner"] not in owners:
                errors.append(f"{tid}: файл {path} принадлежит {', '.join(owners)}, а не {t['owner']}")
        for path in t["files_modify"]:
            for creator in creators.get(path, []):
                if creator != tid and creator not in anc.get(tid, set()):
                    errors.append(f"{tid}: меняет {path}, который создаёт {creator}, но не зависит от {creator}")

    for path, ids in creators.items():
        if len(ids) > 1:
            errors.append(f"файл {path} создают несколько задач: {', '.join(ids)}")
    if BUILD_PLAN.exists():
        plan = BUILD_PLAN.read_text(encoding="utf-8")
        for tid, t in tasks.items():
            if t["phase"] != "HACK":
                continue
            for path in t["files_create"] + t["files_modify"]:
                if not path.startswith("docs/") and not in_build_plan(path, plan):
                    warnings.append(f"{tid}: файла {path} нет в FILE_BY_FILE_BUILD_PLAN — добавьте строку в план файлов")

    cycle = find_cycle(tasks)
    if cycle:
        errors.append("цикл зависимостей: " + " → ".join(cycle))

    active = defaultdict(list)
    for tid, t in tasks.items():
        if t["status"] == "IN_PROGRESS":
            active[t["owner"]].append(tid)
    for member, ids in active.items():
        if len(ids) > 2:
            warnings.append(f"{member}: в работе {len(ids)} задач одновременно ({', '.join(ids)}) — лучше ≤ 2")

    load_h = defaultdict(float)
    for t in tasks.values():
        if t["phase"] == "HACK" and t["priority"] in ("P0", "P1"):
            load_h[t["owner"]] += float(t["estimated_effort"])
    for member, hours in load_h.items():
        if hours > 14:
            warnings.append(f"{member}: {num(hours)} ч P0+P1 на хакатоне — больше 14 ч, перегруз")

    for key, sc in meta.get("scenarios", {}).items():
        for ref in list(sc.get("exclude", [])) + list(sc.get("effort_overrides", {})):
            if ref not in tasks:
                errors.append(f"сценарий {key}: неизвестная задача {ref}")

    if check_docs:
        for path, ids in scan_doc_ids().items():
            for ref in sorted(ids - set(tasks)):
                errors.append(f"{path}: ссылка на несуществующую задачу {ref}")
        for path in render_all(data, check=True):
            errors.append(f"{path}: сгенерированные разделы устарели — запустите `python3 tools/tasks.py render`")
    return errors, warnings


def doc_files() -> list:
    files: list = []
    for pattern in DOC_GLOBS:
        files.extend(p for p in ROOT.glob(pattern) if p.is_file())
    return sorted(p for p in set(files) if not str(p.relative_to(ROOT)).startswith(DOC_EXCLUDE))


def scan_doc_ids() -> dict:
    found = {}
    for path in doc_files():
        ids = set(ID_IN_TEXT_RE.findall(path.read_text(encoding="utf-8")))
        if ids:
            found[str(path.relative_to(ROOT))] = ids
    return found


# ----------------------------------------------------------------------------- rendering
def esc(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def join_ids(ids) -> str:
    return ", ".join(ids) if ids else NONE_MARK


def code_list(items) -> str:
    return ", ".join(f"`{p}`" for p in items) if items else NONE_MARK


def check_line(v: str) -> str:
    return f"- {v}" if v.startswith("manual:") else f"- `{v}`"


WIN_RE = re.compile(r"(Сб|Вс)\s*(\d{1,2}):(\d{2})")
DATE_RE = re.compile(r"(\d{1,2})\.(\d{2})")


def window_key(t: dict) -> tuple:
    """Chronological key from the free-text window: hackathon time, else a date, else last."""
    w = t.get("window") or ""
    m = WIN_RE.search(w)
    if m:
        return (1, (0 if m.group(1) == "Сб" else 1440) + int(m.group(2)) * 60 + int(m.group(3)))
    d = DATE_RE.search(w)
    if d:
        return (0, int(d.group(2)) * 100 + int(d.group(1)))
    return (2, 0)


def gen_member_tasks(data: dict, member: str) -> str:
    tasks = by_id(data)
    meta = data["meta"]
    own = [t for t in data["tasks"] if t["owner"] == member]
    collab = [t for t in data["tasks"] if member in t["collaborators"]]
    own.sort(key=lambda t: (PHASES.index(t["phase"]), PRIORITIES.index(t["priority"]) > 1, window_key(t),
                            PRIORITIES.index(t["priority"]), t["id"]))
    out = []
    hours = defaultdict(float)
    for t in own:
        hours[(t["phase"], t["priority"])] += float(t["estimated_effort"])
    hack01 = hours[("HACK", "P0")] + hours[("HACK", "P1")]
    prep = sum(v for (ph, _), v in hours.items() if ph == "PREP")
    out.append(f"Задач: {len(own)}. До хакатона (PREP): {num(prep)} ч. На хакатоне P0+P1: {num(hack01)} ч "
               f"(P0 {num(hours[('HACK', 'P0')])} ч, P1 {num(hours[('HACK', 'P1')])} ч). "
               "Статусы смотрите командой `python3 tools/tasks.py next " + member + "`.\n")
    out.append("Порядок — по времени (сначала подготовка, затем хакатон; P2–P3 в конце).\n")
    out.append("| ID | Задача | P | Разрешение | Веха | Окно (Астана) | Ч | Зависит от | Флаги |")
    out.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for t in own:
        out.append(f"| {t['id']} | {esc(t['title'])} | {t['priority']} | {t['authorization']} | {t['milestone']} | "
                   f"{esc(t['window']) or NONE_MARK} | {num(t['estimated_effort'])} | {join_ids(t['dependencies'])} | "
                   f"{', '.join(t['flags']) or NONE_MARK} |")
    if collab:
        out.append("\n**Помогаю другим (соисполнитель):** " + ", ".join(
            f"{t['id']} ({t['owner']}, {esc(t['title'])})" for t in collab))
    incoming = []
    for t in own:
        for dep in t["dependencies"]:
            d = tasks.get(dep)
            if d and d["owner"] != member:
                incoming.append(f"- {t['id']} ждёт **{d['id']}** от {d['owner']} — {esc(d['title'])}")
    outgoing = defaultdict(list)
    for t in data["tasks"]:
        if t["owner"] == member:
            continue
        for dep in t["dependencies"]:
            d = tasks.get(dep)
            if d and d["owner"] == member:
                outgoing[dep].append(f"{t['id']} ({t['owner']})")
    out.append("\n**Входящие зависимости — что я жду от других:**\n")
    out.extend(incoming or ["- нет"])
    out.append("\n**Исходящие — кто ждёт мои результаты:**\n")
    out.extend([f"- **{k}** → {', '.join(v)}" for k, v in sorted(outgoing.items())] or ["- никто"])
    out.append("\n#### Карточки задач\n")
    for t in own:
        nb = not_before(t, meta)
        when = f" · не раньше {fmt_local(nb)} (Астана)" if nb else ""
        out.append(f"##### {t['id']} · {esc(t['title'])}\n")
        out.append(f"{t['priority']} · {t['phase']} · {t['milestone']} · разрешение: {t['authorization']} "
                   f"({AUTH_RU[t['authorization']]}) · окно: {t['window'] or NONE_MARK} · "
                   f"оценка {num(t['estimated_effort'])} ч{when}"
                   + (f" · флаги: {', '.join(t['flags'])}" if t["flags"] else "")
                   + (f" · соисполнители: {', '.join(t['collaborators'])}" if t["collaborators"] else "") + "\n")
        out.append(f"**Цель.** {t['objective']}\n")
        out.append(f"**Зачем.** {t['why']}\n")
        if t["dependencies"]:
            out.append("**Зависит от:** " + ", ".join(
                f"{d} ({tasks[d]['owner']})" if d in tasks else d for d in t["dependencies"]) + "\n")
        out.append("**Шаги:**\n")
        out.extend(f"{i}. {s}" for i, s in enumerate(t["steps"], 1))
        out.append("")
        out.append(f"**Создать:** {code_list(t['files_create'])} · **Изменить:** {code_list(t['files_modify'])}\n")
        if t["interfaces"] or t["datasets"]:
            out.append(f"**Интерфейсы:** {'; '.join(t['interfaces']) or NONE_MARK} · "
                       f"**Данные:** {'; '.join(t['datasets']) or NONE_MARK}\n")
        out.append(f"**Ожидаемый результат:** {'; '.join(t['expected_output']) or NONE_MARK}\n")
        out.append("**Критерии приёмки:**\n")
        out.extend(f"- [ ] {c}" for c in t["acceptance_criteria"])
        out.append("")
        if not is_none(t["automated_tests"]):
            out.append("**Автотесты:** " + ", ".join(f"`{c}`" for c in t["automated_tests"]) + "\n")
        if not is_none(t["manual_verification"]):
            out.append("**Ручная проверка:** " + "; ".join(t["manual_verification"]) + "\n")
        out.append("**Команды проверки:**\n")
        out.extend(check_line(v) for v in t["verification_commands"])
        out.append("")
        out.append(f"**Доказательство готовности:** {t['completion_evidence']}\n")
        out.append(f"**Типовые сбои:** {'; '.join(t['failure_modes'])} · **Запасной путь:** {t['fallback']}\n")
    return "\n".join(out).rstrip() + "\n"


def gen_wbs(data: dict, _arg=None) -> str:
    meta = data["meta"]
    groups = defaultdict(list)
    for t in data["tasks"]:
        groups[t["milestone"]].append(t)
    out = []
    for m in MILESTONES:
        if not groups[m]:
            continue
        items = sorted(groups[m], key=lambda t: (PRIORITIES.index(t["priority"]), t["id"]))
        hrs = sum(float(t["estimated_effort"]) for t in items)
        out.append(f"#### {m} · {meta['milestones'].get(m, '')} — {len(items)} задач, {num(hrs)} ч\n")
        out.append("| ID | Задача | Владелец | P | Ч | Зависит от | Окно | Флаги |")
        out.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for t in items:
            out.append(f"| {t['id']} | {esc(t['title'])} | {t['owner']} | {t['priority']} | {num(t['estimated_effort'])} | "
                       f"{join_ids(t['dependencies'])} | {esc(t['window']) or NONE_MARK} | {', '.join(t['flags']) or NONE_MARK} |")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def gen_critical_path(data: dict, _arg=None) -> str:
    tasks = by_id(data)
    total, chain = critical_path(data, "HACK", ("P0",))
    out = [f"Самая длинная цепочка P0-задач хакатона **только по зависимостям**: **{num(total)} ч** работы подряд "
           "(без учёта занятости владельцев, ожидания и перерывов). Цепочка с учётом занятости — в модели сценариев ниже.\n"]
    out.append("| # | ID | Задача | Владелец | Ч | Накопительно | Окно |")
    out.append("| --- | --- | --- | --- | --- | --- | --- |")
    acc = 0.0
    for i, tid in enumerate(chain, 1):
        t = tasks[tid]
        acc += float(t["estimated_effort"])
        out.append(f"| {i} | {tid} | {esc(t['title'])} | {t['owner']} | {num(t['estimated_effort'])} | {num(acc)} | {esc(t['window'])} |")
    total1, chain1 = critical_path(data, "HACK", ("P0", "P1"))
    out.append(f"\nС учётом P1-задач самая длинная цепочка по зависимостям — {num(total1)} ч: {' → '.join(chain1)}.")
    return "\n".join(out).rstrip() + "\n"


def gen_dependency_matrix(data: dict, _arg=None) -> str:
    tasks = by_id(data)
    edges = defaultdict(list)
    for t in data["tasks"]:
        for dep in t["dependencies"]:
            d = tasks.get(dep)
            if d and d["owner"] != t["owner"]:
                edges[(t["owner"], d["owner"])].append(f"{dep}→{t['id']}")
    short = {m: m.replace("MEMBER_", "") for m in MEMBERS}
    out = ["Строка — кто ждёт, столбец — от кого. В ячейке число межличностных зависимостей.\n"]
    out.append("| ждёт \\ от кого | " + " | ".join(short[m] for m in MEMBERS) + " |")
    out.append("| --- | " + " | ".join("---" for _ in MEMBERS) + " |")
    for row in MEMBERS:
        cells = []
        for col in MEMBERS:
            items = edges.get((row, col), [])
            cells.append("·" if row == col else (str(len(items)) if items else ""))
        out.append(f"| **{short[row]}** | " + " | ".join(cells) + " |")
    out.append("\nПодробно (производитель → потребитель):\n")
    by_producer = defaultdict(list)
    for (consumer, producer), items in edges.items():
        by_producer[producer].append((consumer, items))
    for producer in MEMBERS:
        for consumer, items in sorted(by_producer.get(producer, [])):
            out.append(f"- {producer} → {consumer}: {', '.join(sorted(items))}")
    return "\n".join(out).rstrip() + "\n"


def gen_workload(data: dict, _arg=None) -> str:
    rows = defaultdict(lambda: defaultdict(float))
    counts = defaultdict(int)
    for t in data["tasks"]:
        key = "PREP" if t["phase"] == "PREP" else (t["priority"] if t["priority"] in ("P0", "P1") else "P2+")
        rows[t["owner"]][key] += float(t["estimated_effort"])
        counts[t["owner"]] += 1
    out = ["| Участник | Роль | Задач | До 14.11, ч | Хакатон P0, ч | Хакатон P1, ч | P0+P1, ч | P2–P3, ч |",
           "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    total = defaultdict(float)
    for m in MEMBERS:
        r = rows[m]
        for k in ("PREP", "P0", "P1", "P2+"):
            total[k] += r[k]
        out.append(f"| {m} | {esc(data['meta']['members'].get(m, ''))} | {counts[m]} | {num(r['PREP'])} | {num(r['P0'])} | "
                   f"{num(r['P1'])} | {num(r['P0'] + r['P1'])} | {num(r['P2+'])} |")
    out.append(f"| **Итого** | | {sum(counts.values())} | {num(total['PREP'])} | {num(total['P0'])} | {num(total['P1'])} | "
               f"{num(total['P0'] + total['P1'])} | {num(total['P2+'])} |")
    return "\n".join(out) + "\n"


def scenario_row(data: dict, key: str, sc: dict) -> dict:
    prod = float(data["meta"].get("productivity", 0.75))
    tasks, start, finish, cause = simulate(data, sc)
    segs = segments_of(sc)
    p0_ids = [t for t in finish if tasks[t]["priority"] == "P0"]
    p0_end = max(finish[t] for t in p0_ids) if p0_ids else 0.0
    last = max(p0_ids, key=lambda t: (finish[t], t)) if p0_ids else None
    f100, o100 = at_clock(p0_end, segs, 1.0)
    f75, o75 = at_clock(p0_end, segs, prod)
    cal = calendar_hours(segs)
    if o75 == 0:
        verdict = f"помещается; запас {h(cal - p0_end / prod)} ч по часам"
    elif o100 == 0:
        verdict = f"только при 100 %; при {pct(prod)} не хватает {h(o75)} ч"
    else:
        verdict = f"не помещается даже при 100 % (+{h(o100)} ч)"
    p1 = [t for t in finish if tasks[t]["priority"] == "P1"]
    p1_fit = sum(1 for t in p1 if at_clock(finish[t], segs, prod)[1] == 0)
    return {"tasks": tasks, "start": start, "finish": finish, "cause": cause, "segs": segs, "p0_end": p0_end,
            "last": last, "f100": f100, "o100": o100, "f75": f75, "o75": o75, "verdict": verdict, "cal": cal,
            "p1": len(p1), "p1_fit": p1_fit, "prod": prod}


def gen_scenarios(data: dict, _arg=None) -> str:
    meta = data["meta"]
    prod = float(meta.get("productivity", 0.75))
    out = [f"Модель (`python3 tools/tasks.py schedule`): каждый участник выполняет свои задачи по очереди; задача "
           "начинается, когда готовы её зависимости и свободен владелец; из готовых — по одному из трёх правил "
           "(самая длинная оставшаяся цепочка, больше зависящих задач, порядок ID); P1 занимает только свободные "
           "окна участника и не сдвигает P0; берётся лучший вариант (раньше конец P0, затем больше P1). Перерывы и ночь — по календарю сценария. "
           f"«100 %» — оценки как записаны; «{pct(prod)}» — с поправкой на синхронизацию, слияния и отладку. "
           "Перекрытие ожидания расчётов GEE с другой работой и время соисполнителей на встречах не моделируются. "
           "Это проверка выполнимости, а не расписание (плановые окна — в HOUR_BY_HOUR_EXECUTION).\n"]
    out.append("| Сценарий | Рабочее время (Астана) | Объём | Работа по модели, ч | P0 готово при 100 % | "
               f"P0 готово при {pct(prod)} | Вывод |")
    out.append("| --- | --- | --- | --- | --- | --- | --- |")
    for key, sc in meta.get("scenarios", {}).items():
        r = scenario_row(data, key, sc)
        n0 = sum(1 for t in r["tasks"].values() if t["priority"] == "P0")
        scope = f"P0: {plural(n0)}, {h(sum(t['estimated_effort'] for t in r['tasks'].values() if t['priority'] == 'P0'))} ч"
        if sc.get("exclude"):
            scope += f"; без {', '.join(sc['exclude'])}"
        if sc.get("effort_overrides"):
            scope += f"; урезано: {', '.join(sc['effort_overrides'])}"
        if r["p1"]:
            scope += f"; P1: {plural(r['p1'])}, успевают {r['p1_fit']}"
        f100 = fmt_clock(r["f100"]) if r["o100"] == 0 else f"после конца (+{h(r['o100'])} ч)"
        f75 = fmt_clock(r["f75"]) if r["o75"] == 0 else f"после конца (+{h(r['o75'])} ч)"
        out.append(f"| **{key}** — {esc(sc.get('title', ''))} | {fmt_segments(r['segs'])} ({h(r['cal'])} ч) | {scope} | "
                   f"{h(r['p0_end'])} | {f100} | {f75} | {r['verdict']} |")
    out.append("")
    for key, sc in meta.get("scenarios", {}).items():
        r = scenario_row(data, key, sc)
        if r["last"]:
            chain = binding_chain(r["cause"], r["finish"], r["last"])
            out.append(f"- Цепочка, определяющая конец P0 в {key}: " + " → ".join(
                f"{tid} ({r['tasks'][tid]['owner'].replace('MEMBER_', '')})" for tid in chain) + ".")
    return "\n".join(out).rstrip() + "\n"


def gen_schedule(data: dict, key: str = "S1") -> str:
    sc = data["meta"]["scenarios"][key]
    r = scenario_row(data, key, sc)
    prod = r["prod"]
    rows = sorted(r["finish"], key=lambda t: (r["start"][t], t))
    out = [f"Сценарий {key} ({fmt_segments(r['segs'])}). Время работы считается от начала календаря; "
           f"«Ждёт» — что определило старт (зависимость или предыдущая задача владельца).\n"]
    out.append(f"| Старт, ч | Финиш, ч | ID | Задача | Владелец | Ч | Ждёт | Готово при 100 % | Готово при {pct(prod)} |")
    out.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for tid in rows:
        t = r["tasks"][tid]
        c100, o100 = at_clock(r["finish"][tid], r["segs"], 1.0)
        c75, o75 = at_clock(r["finish"][tid], r["segs"], prod)
        out.append(f"| {h(r['start'][tid])} | {h(r['finish'][tid])} | {tid} | {esc(t['title'])} | "
                   f"{t['owner'].replace('MEMBER_', '')} | {h(t['estimated_effort'])} | {r['cause'].get(tid) or NONE_MARK} | "
                   f"{fmt_clock(c100) if o100 == 0 else '+' + h(o100) + ' ч'} | "
                   f"{fmt_clock(c75) if o75 == 0 else '+' + h(o75) + ' ч'} |")
    return "\n".join(out).rstrip() + "\n"


def gen_dependency_graph(data: dict, key: str = "S1") -> str:
    """Mermaid diagram of P0 hackathon tasks by owner; thick outline = chain that ends P0 in the model."""
    p0 = [t for t in data["tasks"] if t["phase"] == "HACK" and t["priority"] == "P0"]
    ids = {t["id"] for t in p0}
    sc = data["meta"].get("scenarios", {}).get(key)
    chain: list = []
    if sc:
        r = scenario_row(data, key, sc)
        chain = binding_chain(r["cause"], r["finish"], r["last"]) if r["last"] else []
    node = lambda tid: tid.replace("-", "_")
    out = ["```mermaid", "flowchart LR"]
    for m in MEMBERS:
        own = [t for t in p0 if t["owner"] == m]
        if own:
            out.append(f'  subgraph {m}["{m}"]')
            out.extend(f'    {node(t["id"])}["{t["id"]} · {num(t["estimated_effort"])} ч"]' for t in own)
            out.append("  end")
    for t in p0:
        out.extend(f"  {node(d)} --> {node(t['id'])}" for d in t["dependencies"] if d in ids)
    if chain:
        out.append("  classDef chain stroke-width:4px")
        out.append("  class " + ",".join(node(t) for t in chain if t in ids) + " chain")
    out.append("```")
    return "\n".join(out) + "\n"


BUILD_PLAN = ROOT / "docs" / "engineering" / "FILE_BY_FILE_BUILD_PLAN.md"


def in_build_plan(path: str, text: str) -> bool:
    if path in text:
        return True
    base = path.rstrip("/").split("/")[-1]
    return f"`{base}`" in text or f"/{base}" in text


def gen_completeness(data: dict, _arg=None) -> str:
    """Automated part of the completeness review (TRACEABILITY_AND_COMPLETENESS §2)."""
    tasks = by_id(data)
    meta, ownership = data["meta"], data["ownership"]
    hack = [t for t in data["tasks"] if t["phase"] == "HACK"]
    p0 = [t for t in hack if t["priority"] == "P0"]
    anc = ancestors(tasks) if not find_cycle(tasks) else {tid: set() for tid in tasks}
    creators: dict = defaultdict(list)
    for t in data["tasks"]:
        for path in t["files_create"]:
            creators[path].append(t["id"])
    plan = BUILD_PLAN.read_text(encoding="utf-8") if BUILD_PLAN.exists() else ""

    def res(items):
        return "OK" if not items else f"нарушений: {len(items)} — " + ", ".join(sorted(items)[:12])

    unowned = [t["id"] for t in data["tasks"] if t["owner"] not in MEMBERS]
    cycle = find_cycle(tasks)
    inversions = [f"{t['id']}→{d}" for t in p0 for d in t["dependencies"] if d in tasks and tasks[d]["priority"] != "P0"]
    no_dod = [t["id"] for t in data["tasks"] if not t["acceptance_criteria"] or is_none(t["completion_evidence"])
              or (is_none(t["automated_tests"]) and is_none(t["manual_verification"]))]
    no_steps = [t["id"] for t in data["tasks"] if not t["steps"]]
    no_fallback = [t["id"] for t in hack if is_none(t["failure_modes"]) or is_none(t["fallback"])]
    not_in_plan = sorted({path for t in hack for path in t["files_create"] + t["files_modify"]
                          if not path.startswith("docs/") and not in_build_plan(path, plan)})
    wrong_owner = [f"{t['id']}:{path}" for t in data["tasks"] for path in t["files_create"] + t["files_modify"]
                   if (owners_of(path, ownership) or []) and t["owner"] not in owners_of(path, ownership)]
    unordered = [f"{t['id']}:{path}" for t in data["tasks"] for path in t["files_modify"]
                 for c in creators.get(path, []) if c != t["id"] and c not in anc.get(t["id"], set())]
    dup_creators = [path for path, ids in creators.items() if len(ids) > 1]
    auth_bad = [t["id"] for t in data["tasks"] if (t["phase"] == "HACK") != (t["authorization"] == "DEFER_UNTIL_EVENT")
                or (t["status"] in ACTIVE | {"READY"} and not authorized(t))]
    bad_refs = [f"{path}:{ref}" for path, ids in scan_doc_ids().items() for ref in ids if ref not in tasks]
    rows = [
        ("Задачи без владельца", "owner ∈ MEMBER_A…F", res(unowned)),
        ("Циклы зависимостей", "поиск цикла в графе", "OK" if not cycle else "цикл: " + " → ".join(cycle)),
        ("Главное демо без необязательных модулей", "P0 зависят только от P0", res(inversions)),
        ("У каждой задачи проверяемое «готово»", "критерии + (автотесты или ручная проверка) + доказательство", res(no_dod)),
        ("У каждой задачи шаги выполнения", "steps не пуст", res(no_steps)),
        ("У задач хакатона сбои и запасной путь", "failure_modes и fallback не пусты", res(no_fallback)),
        ("Пути файлов согласованы с планом файлов", "каждый путь задачи хакатона есть в FILE_BY_FILE_BUILD_PLAN", res(not_in_plan)),
        ("Файлы меняет их владелец", "ownership в tasks.json", res(wrong_owner)),
        ("Общие файлы меняются по порядку", "правка только после задачи-создателя", res(unordered + dup_creators)),
        ("Категории разрешений", "HACK ⇔ DEFER_UNTIL_EVENT; без разрешения не начинать", res(auth_bad)),
        ("Ссылки документов на задачи", "все ID в docs существуют (кроме архива)", res(bad_refs)),
    ]
    for key, sc in meta.get("scenarios", {}).items():
        r = scenario_row(data, key, sc)
        rows.append((f"Расписание {key}", "модель `tools/tasks.py schedule`", r["verdict"]))
    out = ["| Проверка | Как проверяется | Результат |", "| --- | --- | --- |"]
    out.extend(f"| {a} | {b} | {esc(c)} |" for a, b, c in rows)
    out.append(f"\nЗадач всего: {len(data['tasks'])}; хакатона: {len(hack)}; P0 хакатона: {len(p0)} "
               f"({num(sum(float(t['estimated_effort']) for t in p0))} ч).")
    return "\n".join(out) + "\n"


def gen_authorization(data: dict, _arg=None) -> str:
    rows = [t for t in data["tasks"] if t["phase"] == "PREP"]
    order = {a: i for i, a in enumerate(AUTHORIZATIONS)}
    rows.sort(key=lambda t: (order[t["authorization"]], t["id"]))
    out = ["| ID | Задача | Владелец | Категория | Разрешение записано |", "| --- | --- | --- | --- | --- |"]
    for t in rows:
        ev = t.get("authorization_evidence")
        rec = (f"{ev['recorded_at']}: {esc(ev['source'])} — {esc(ev['scope'])}" if ev
               else ("нет — работа запрещена" if t["authorization"] == "CLARIFICATION_REQUIRED" else "не требуется"))
        out.append(f"| {t['id']} | {esc(t['title'])} | {t['owner']} | {t['authorization']} | {rec} |")
    hack = [t for t in data["tasks"] if t["phase"] == "HACK"]
    out.append(f"\nЗадач хакатона: {len(hack)}, все — DEFER_UNTIL_EVENT (проверяется `tools/tasks.py validate`).")
    return "\n".join(out) + "\n"


GENERATORS = {
    "member-tasks": gen_member_tasks,
    "wbs": gen_wbs,
    "critical-path": gen_critical_path,
    "dependency-matrix": gen_dependency_matrix,
    "workload": gen_workload,
    "scenarios": gen_scenarios,
    "schedule": gen_schedule,
    "authorization": gen_authorization,
    "dependency-graph": gen_dependency_graph,
    "completeness": gen_completeness,
}


def render_all(data: dict, check: bool = False) -> list:
    changed = []
    for path in doc_files():
        text = path.read_text(encoding="utf-8")
        if "BEGIN GENERATED:" not in text:
            continue

        def repl(match):
            gen = GENERATORS.get(match.group("name"))
            if gen is None:
                return match.group(0)
            body = gen(data, match.group("arg")) if match.group("arg") else gen(data)
            return match.group(1) + body + match.group(5)

        new = BLOCK_RE.sub(repl, text)
        if new != text:
            changed.append(str(path.relative_to(ROOT)))
            if not check:
                path.write_text(new, encoding="utf-8")
    return changed


# ----------------------------------------------------------------------------- commands
def header(data: dict, now: datetime) -> str:
    meta = data["meta"]
    start = parse_time(meta["hackathon_start_utc"])
    pitch = parse_time(meta["local_pitch_utc"])
    deadline = parse_time(meta["global_deadline_utc"])
    line = f"Сейчас {fmt_local(now)} (Астана). "
    if now < start:
        days = (start - now).total_seconds() / 86400
        line += (f"До старта хакатона {days:.1f} дн. ({fmt_local(start)}). "
                 "Задачи HACK закрыты правилом NASA: до старта только обучение, аккаунты и планирование.")
    elif now < pitch:
        line += f"Хакатон идёт. До питча на площадке {(pitch - now).total_seconds() / 3600:.1f} ч ({fmt_local(pitch)})."
    elif now < deadline:
        line += f"До глобального дедлайна {(deadline - now).total_seconds() / 3600:.1f} ч ({fmt_local(deadline)})."
    else:
        line += "Глобальный дедлайн прошёл."
    return line


def executable(t: dict, tasks: dict, meta: dict, now: datetime) -> str:
    """Classify a task for `next`: active, ready, waiting, permission, locked or done."""
    if t["status"] == "DONE":
        return "done"
    if t["status"] in ("IN_PROGRESS", "IN_REVIEW"):
        return "active"
    nb = not_before(t, meta)
    if nb and now < nb:
        return "locked"
    if not authorized(t):
        return "permission"
    if t["status"] == "BLOCKED":
        return "waiting"
    if all(tasks[d]["status"] == "DONE" for d in t["dependencies"] if d in tasks):
        return "ready"
    return "waiting"


def sort_key(t: dict):
    """P0/P1 first, ordered by milestone; then P2/P3. Critical and risky work first within a milestone."""
    return (0 if t["priority"] in ("P0", "P1") else 1, MILESTONES.index(t["milestone"]),
            PRIORITIES.index(t["priority"]), 0 if "CRITICAL_PATH" in t["flags"] else 1,
            0 if "HIGH_RISK" in t["flags"] else 1, t["id"])


def cmd_next(data: dict, args) -> int:
    now = now_utc(args.now)
    tasks = by_id(data)
    meta = data["meta"]
    print(header(data, now))
    members = [args.member] if args.member else MEMBERS
    started = now >= parse_time(meta["hackathon_start_utc"])
    for member in members:
        if member not in MEMBERS:
            print(f"Неизвестный участник {member}. Варианты: {', '.join(MEMBERS)}")
            return 2
        own = [t for t in data["tasks"] if t["owner"] == member]
        if started:
            stale = [t["id"] for t in own if t["phase"] == "PREP" and t["status"] != "DONE"]
            own = [t for t in own if t["phase"] == "HACK"]
            if stale:
                print(f"\n({member}: незавершённые PREP-задачи больше не актуальны: {', '.join(stale)})")
        groups = defaultdict(list)
        for t in own:
            groups[executable(t, tasks, meta, now)].append(t)
        print(f"\n=== {member}: {meta['members'].get(member, '')}")
        for key, title in (("active", "[В РАБОТЕ] продолжить"), ("ready", "[МОЖНО НАЧАТЬ] по приоритету")):
            items = sorted(groups[key], key=sort_key)
            if items:
                print(title + ":")
                for t in items[: (len(items) if args.member else 3)]:
                    flags = f" [{', '.join(t['flags'])}]" if t["flags"] else ""
                    print(f"  {t['id']} {t['priority']} {t['milestone']} {t['window'] or ''} — {t['title']}{flags}")
        waiting = sorted(groups["waiting"], key=sort_key)
        if waiting and args.member:
            print("[ЖДЁТ] зависимостей или блокера:")
            for t in waiting:
                missing = [f"{d} ({tasks[d]['owner']}, {STATUS_RU[tasks[d]['status']]})"
                           for d in t["dependencies"] if d in tasks and tasks[d]["status"] != "DONE"]
                blockers = [f"{b.get('ref')} ({b.get('owner')})" for b in t["blocked_by"]]
                print(f"  {t['id']} — {t['title']}: ждёт {', '.join(missing + blockers) or NONE_MARK}")
        permission = sorted(groups["permission"], key=sort_key)
        if permission:
            print("[ЖДЁТ РАЗРЕШЕНИЯ ОРГАНИЗАТОРОВ] не начинать (PRE_EVENT_AUTHORIZATION §4):")
            for t in permission:
                print(f"  {t['id']} — {t['title']}")
        locked = groups["locked"]
        if locked:
            first = min(not_before(t, meta) for t in locked)
            print(f"[ЗАКРЫТО ДО СРОКА] {len(locked)} задач; ближайшая откроется {fmt_local(first)} (Астана).")
        done = groups["done"]
        print(f"Готово: {len(done)} из {len(own)}.")
    return 0


def cmd_blocked(data: dict, args) -> int:
    now = now_utc(args.now)
    tasks = by_id(data)
    print(header(data, now))
    blocked = [t for t in data["tasks"] if t["status"] == "BLOCKED"]
    print(f"\nЗаблокировано явно: {len(blocked)}")
    for t in sorted(blocked, key=sort_key):
        refs = "; ".join(f"{b.get('ref')} — владелец {b.get('owner')}" for b in t["blocked_by"])
        print(f"  {t['id']} ({t['owner']}) {t['title']}: {refs}")
    permission = [t for t in data["tasks"] if not authorized(t) and t["status"] != "DONE"]
    print(f"\nЖдут письменного разрешения организаторов: {len(permission)}")
    for t in sorted(permission, key=sort_key):
        print(f"  {t['id']} ({t['owner']}) {t['title']}")
    waiting = defaultdict(list)
    for t in data["tasks"]:
        if t["status"] in ("DONE",) or (not_before(t, data["meta"]) and now < not_before(t, data["meta"])):
            continue
        for dep in t["dependencies"]:
            d = tasks.get(dep)
            if d and d["status"] != "DONE" and d["owner"] != t["owner"]:
                waiting[d["owner"]].append(f"{t['id']} ({t['owner']}) ждёт {dep}")
    print("\nЖдут результатов других (только открытые по времени задачи):")
    if not waiting:
        print("  нет")
    for owner in MEMBERS:
        for line in waiting.get(owner, []):
            print(f"  блокирует {owner}: {line}")
    return 0


def cmd_status(data: dict, args) -> int:
    now = now_utc(args.now)
    print(header(data, now))
    print("\n" + " " * 10 + "".join(f"{s[:11]:>12}" for s in STATUSES) + f"{'ч осталось':>12}")
    for m in MEMBERS:
        own = [t for t in data["tasks"] if t["owner"] == m]
        counts = {s: sum(1 for t in own if t["status"] == s) for s in STATUSES}
        left = sum(float(t["estimated_effort"]) for t in own if t["status"] != "DONE" and t["priority"] in ("P0", "P1"))
        print(f"{m:<10}" + "".join(f"{counts[s]:>12}" for s in STATUSES) + f"{left:>12g}")
    p0_open = [t["id"] for t in data["tasks"] if t["priority"] == "P0" and t["status"] != "DONE"]
    waiting_auth = [t["id"] for t in data["tasks"] if not authorized(t) and t["status"] != "DONE"]
    print(f"\nОткрытых P0: {len(p0_open)}. Ждут разрешения организаторов: {', '.join(waiting_auth) or 'нет'}.")
    return 0


def cmd_show(data: dict, args) -> int:
    t = by_id(data).get(args.id)
    if not t:
        print(f"Нет задачи {args.id}")
        return 2
    print(json.dumps(t, ensure_ascii=False, indent=2))
    return 0


def cmd_set(data: dict, args) -> int:
    now = now_utc(args.now)
    tasks = by_id(data)
    t = tasks.get(args.id)
    if not t:
        print(f"Нет задачи {args.id}")
        return 2
    if args.status not in STATUSES:
        print(f"Статус должен быть одним из: {', '.join(STATUSES)}")
        return 2
    before, _ = validate(data, now, check_docs=False)
    start = parse_time(data["meta"]["hackathon_start_utc"])
    if t["phase"] == "HACK" and args.status in ACTIVE and now < start:
        print(f"Отказ: {args.id} — задача хакатона. До {fmt_local(start)} (Астана) работать над проектом нельзя "
              "(правило NASA Space Apps). Возьмите PREP-задачу: python3 tools/tasks.py next")
        return 3
    if args.status in ACTIVE | {"READY"} and not authorized(t):
        print(f"Отказ: {args.id} требует письменного разрешения организаторов (CLARIFICATION_REQUIRED). "
              "Когда оно получено: python3 tools/tasks.py authorize "
              f"{args.id} --source \"кто, где, дата\" --scope \"что именно разрешено\"")
        return 3
    if args.status == "DONE" and not (args.evidence or t["actual_evidence"]):
        print("Отказ: для DONE нужно доказательство: --evidence \"команда и результат / хэш коммита / ссылка\"")
        return 3
    if args.status == "BLOCKED" and not args.blocker:
        print("Отказ: для BLOCKED укажите --blocker (ID задачи или причина) и --blocker-owner MEMBER_X")
        return 3
    t["status"] = args.status
    if args.evidence:
        stamp = fmt_local(now)
        t["actual_evidence"].extend(f"{stamp}: {e}" for e in args.evidence)
    if args.status == "BLOCKED":
        t["blocked_by"].append({"ref": args.blocker, "owner": args.blocker_owner or "?", "since": fmt_local(now)})
    elif t["blocked_by"]:
        t["blocked_by"] = []
    after, _ = validate(data, now, check_docs=False)
    new = [e for e in after if e not in before]
    if new:
        print("Отказ: изменение создаёт ошибки:\n  " + "\n  ".join(new))
        return 3
    save(data)
    print(f"{args.id}: {STATUS_RU[args.status]} ({args.status}). Сохранено в project/tasks.json.")
    waiting = [d for d in t["dependencies"] if d in tasks and tasks[d]["status"] != "DONE"]
    if args.status in ("IN_PROGRESS", "IN_REVIEW") and waiting:
        print(f"Внимание: не завершены зависимости {', '.join(waiting)} — работайте как с черновиком, DONE только после них.")
    return 0


def cmd_authorize(data: dict, args) -> int:
    now = now_utc(args.now)
    t = by_id(data).get(args.id)
    if not t:
        print(f"Нет задачи {args.id}")
        return 2
    if t["authorization"] != "CLARIFICATION_REQUIRED":
        print(f"Отказ: {args.id} имеет категорию {t['authorization']} — разрешение организаторов к ней не применяется.")
        return 3
    if args.revoke:
        if t["status"] in ACTIVE:
            print(f"Отказ: {args.id} уже в статусе {t['status']}; сначала обсудите с командой и верните в BACKLOG.")
            return 3
        t["authorization_evidence"] = None
        if t["status"] == "READY":
            t["status"] = "BACKLOG"
        save(data)
        render_all(data)
        print(f"{args.id}: запись о разрешении удалена; таблица в PRE_EVENT_AUTHORIZATION §6 обновлена.")
        return 0
    if not (args.source and args.scope):
        print("Отказ: укажите --source (кто, где и когда дал разрешение) и --scope (что именно разрешено).")
        return 3
    t["authorization_evidence"] = {"source": args.source, "scope": args.scope, "recorded_at": fmt_local(now)}
    save(data)
    render_all(data)
    print(f"{args.id}: разрешение записано ({fmt_local(now)}); таблица в PRE_EVENT_AUTHORIZATION §6 обновлена. "
          "Добавьте цитату и дату в §4 и выполняйте только то, что входит в scope.")
    return 0


def cmd_schedule(data: dict, args) -> int:
    scenarios = data["meta"].get("scenarios", {})
    if args.scenario and args.scenario not in scenarios:
        print(f"Нет сценария {args.scenario}. Варианты: {', '.join(scenarios)}")
        return 2
    print(gen_scenarios(data))
    print(gen_schedule(data, args.scenario or "S1"))
    return 0


def cmd_owner(data: dict, args) -> int:
    path = args.path
    if (ROOT / path).is_dir() and not path.endswith("/"):
        path += "/"
    owners = owners_of(path, data["ownership"])
    print(", ".join(owners) if owners else "нет владельца — согласуйте с MEMBER_A")
    return 0


def cmd_validate(data: dict, args) -> int:
    now = now_utc(args.now)
    errors, warnings = validate(data, now, check_docs=not args.no_docs)
    total, chain = critical_path(data)
    print(header(data, now))
    print(f"Задач: {len(data['tasks'])}. Критический путь P0 хакатона по зависимостям: {num(total)} ч ({len(chain)} задач).")
    for w in warnings:
        print(f"ПРЕДУПРЕЖДЕНИЕ: {w}")
    for e in errors:
        print(f"ОШИБКА: {e}")
    print("OK" if not errors else f"Ошибок: {len(errors)}")
    return 1 if errors else 0


def cmd_render(data: dict, args) -> int:
    changed = render_all(data, check=args.check)
    if args.check:
        print("Сгенерированные разделы актуальны." if not changed else "Устарели: " + ", ".join(changed))
        return 1 if changed else 0
    print("Обновлено: " + (", ".join(changed) if changed else "ничего не изменилось"))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Реестр задач команды (project/tasks.json)")
    parser.add_argument("--now", help="подменить текущее время, ISO 8601 (для проверок)")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("validate")
    p.add_argument("--no-docs", action="store_true", help="не проверять документы")
    p = sub.add_parser("render")
    p.add_argument("--check", action="store_true")
    p = sub.add_parser("next")
    p.add_argument("member", nargs="?")
    sub.add_parser("blocked")
    sub.add_parser("status")
    p = sub.add_parser("show")
    p.add_argument("id")
    p = sub.add_parser("set")
    p.add_argument("id")
    p.add_argument("status")
    p.add_argument("--evidence", action="append")
    p.add_argument("--blocker")
    p.add_argument("--blocker-owner", choices=MEMBERS)
    p = sub.add_parser("authorize")
    p.add_argument("id")
    p.add_argument("--source", help="кто, где и когда дал письменное разрешение")
    p.add_argument("--scope", help="что именно разрешено")
    p.add_argument("--revoke", action="store_true", help="удалить запись о разрешении")
    p = sub.add_parser("schedule")
    p.add_argument("scenario", nargs="?")
    p = sub.add_parser("owner")
    p.add_argument("path")
    args = parser.parse_args(argv)
    data = load()
    commands = {
        "validate": cmd_validate, "render": cmd_render, "next": cmd_next, "blocked": cmd_blocked,
        "status": cmd_status, "show": cmd_show, "set": cmd_set, "authorize": cmd_authorize,
        "schedule": cmd_schedule, "owner": cmd_owner,
    }
    return commands.get(args.cmd or "validate", cmd_validate)(data, args)


if __name__ == "__main__":
    sys.exit(main())
