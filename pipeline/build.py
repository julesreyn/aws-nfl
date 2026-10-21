# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas", "numpy"]
# ///
"""Pipeline DATA du proto "Coach Tracking".

Lit datas/ (NFL Big Data Bowl 2023) et écrit web/data/ :
  sessions.json, session_<gameId>.json, tracking_<gameId>.json pour les 8 matchs de TB.
Lancement depuis la racine du repo : uv run pipeline/build.py
"""
from __future__ import annotations

import json
import math
import re
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datas"
OUT = ROOT / "web" / "data"
TEAM = "TB"

GREEN, ORANGE = 70, 45

EVENT_LABELS = {
    "ball_snap": "Snap", "autoevent_ballsnap": "Snap",
    "pass_forward": "Passe", "autoevent_passforward": "Passe",
    "play_action": "Play action", "pass_arrived": "Ballon arrivé",
    "pass_outcome_caught": "Réception", "pass_outcome_incomplete": "Incomplète",
    "qb_sack": "Sack", "first_contact": "Contact", "tackle": "Plaquage",
    "fumble": "Fumble", "line_set": "Ligne en place", "man_in_motion": "Motion",
    "out_of_bounds": "Sortie", "qb_strip_sack": "Strip sack",
    "interception": "Interception", "run": "QB scramble",
    "pass_outcome_touchdown": "Touchdown", "touchdown": "Touchdown",
    "pass_tipped": "Ballon dévié", "shift": "Shift", "handoff": "Remise",
    "penalty_flag": "Drapeau", "fumble_offense_recovered": "Fumble récupéré",
    "fumble_defense_recovered": "Fumble perdu", "lateral": "Latéral",
    "qb_slide": "Glissade QB", "safety": "Safety", "pass_shovel": "Shovel pass",
}
TERMINAL = {"pass_outcome_caught", "pass_outcome_incomplete", "qb_sack", "qb_strip_sack", "tackle",
            "out_of_bounds", "interception", "pass_outcome_touchdown", "touchdown", "safety"}

GROUP = {"T": "OL", "G": "OL", "C": "OL", "DE": "DL", "DT": "DL", "NT": "DL", "OLB": "LB", "ILB": "LB",
         "MLB": "LB", "LB": "LB", "CB": "DB", "SS": "DB", "FS": "DB", "DB": "DB", "QB": "QB", "RB": "RB",
         "FB": "RB", "WR": "WR", "TE": "TE"}
GROUP_FR = {"OL": "Ligne offensive", "DL": "Ligne défensive", "LB": "Linebackers", "DB": "Secondaire",
            "QB": "Quarterback", "RB": "Running backs", "WR": "Receveurs", "TE": "Tight ends"}
POS_FR = {"LT": "le tackle gauche", "LG": "le guard gauche", "C": "le centre", "RG": "le guard droit",
          "RT": "le tackle droit"}
FORMATION_FR = {"SHOTGUN": "Shotgun", "SINGLEBACK": "Singleback", "I_FORM": "I-Form", "EMPTY": "Empty",
                "PISTOL": "Pistol", "JUMBO": "Jumbo", "WILDCAT": "Wildcat"}
RESULT_FR = {"C": "Complète", "I": "Incomplète", "S": "Sack", "IN": "Interception", "R": "Scramble"}


# ----------------------------------------------------------------------------- utils
def isnum(v) -> bool:
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def fr(v, nd=1) -> str:
    """Nombre au format français (virgule décimale)."""
    if not isnum(v):
        return "?"
    s = f"{v:.{nd}f}"
    if nd > 0:
        s = s.rstrip("0").rstrip(".") if "." in s else s
    return s.replace(".", ",")


def yd(v, nd=1):
    """'1,3 yard' / '2,4 yards'."""
    return f"{fr(v, nd)} {'yards' if isnum(v) and abs(round(v, nd)) >= 2 else 'yard'}"


def r2(v):
    return None if not isnum(v) else round(float(v), 2)


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def lerp_score(v, good, bad):
    """1 quand v == good, 0 quand v == bad (linéaire, borné)."""
    if not isnum(v):
        return None
    return clamp((v - bad) / (good - bad))


def pick(options, *key):
    h = zlib.crc32("|".join(str(k) for k in key).encode())
    return options[h % len(options)]


def grade_of(score):
    return "green" if score >= GREEN else ("orange" if score >= ORANGE else "red")


def clock_s(c: str) -> int:
    try:
        m, s = str(c).split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return 0


def pl(n, one, many=None):
    return one if abs(n) < 2 else (many or one + "s")


def oral(t):
    """Unités lisibles par la synthèse vocale : '0,6 s' -> '0,6 seconde', 'yd/s' -> 'yards par seconde'."""
    def sec(m):
        v = float(m.group(1).replace(",", "."))
        return f"{m.group(1)} {'secondes' if v >= 2 else 'seconde'}"
    t = re.sub(r"(\d+(?:,\d+)?) yd/s", r"\1 yards par seconde", t)
    return re.sub(r"(\d+(?:,\d+)?) s\b", sec, t)


def ordinal(n):
    return "1er" if n == 1 else f"{n}e"


def nint(v):
    return None if not isnum(v) else int(v)


# ----------------------------------------------------------------------------- loading
def load_static():
    games = pd.read_csv(DATA / "games.csv")
    games = games[(games.homeTeamAbbr == TEAM) | (games.visitorTeamAbbr == TEAM)].sort_values("week")
    plays = pd.read_csv(DATA / "plays.csv")
    plays = plays[plays.gameId.isin(games.gameId)]
    pff = pd.read_csv(DATA / "pffScoutingData.csv")
    pff = pff[pff.gameId.isin(games.gameId)]
    players = pd.read_csv(DATA / "players.csv").set_index("nflId")
    return games, plays, pff, players


def load_tracking(game_id):
    t = pd.read_csv(DATA / "tracking" / f"tracking_{game_id}.csv",
                    usecols=["playId", "nflId", "frameId", "jerseyNumber", "team", "playDirection",
                             "x", "y", "s", "o", "event"])
    left = t.playDirection == "left"
    t.loc[left, "x"] = 120 - t.loc[left, "x"]
    t.loc[left, "y"] = 53.3 - t.loc[left, "y"]
    t.loc[left, "o"] = (t.loc[left, "o"] + 180) % 360
    return t


class PlayTrack:
    """Positions par joueur indexées par frame (index = frameId - 1)."""

    def __init__(self, df: pd.DataFrame):
        self.n = int(df.frameId.max())
        self.X, self.Y, self.S, self.O = {}, {}, {}, {}
        self.team, self.jersey = {}, {}
        ball = df[df.team == "football"]
        self.bx = np.full(self.n, np.nan)
        self.by = np.full(self.n, np.nan)
        self.bx[ball.frameId.values - 1] = ball.x.values
        self.by[ball.frameId.values - 1] = ball.y.values
        for pid, g in df[df.team != "football"].groupby("nflId"):
            pid = int(pid)
            idx = g.frameId.values - 1
            for store, col in ((self.X, "x"), (self.Y, "y"), (self.S, "s"), (self.O, "o")):
                a = np.full(self.n, np.nan)
                a[idx] = g[col].values
                store[pid] = a
            self.team[pid] = g.team.iloc[0]
            self.jersey[pid] = nint(g.jerseyNumber.iloc[0])
        ev = df[df.event.notna() & (df.event != "None")][["frameId", "event"]].drop_duplicates()
        self.raw_events = sorted((int(f), e) for f, e in ev.itertuples(index=False))

    def first(self, *names):
        for f, e in self.raw_events:
            if e in names:
                return f
        return None

    def pos(self, pid, f):
        """Position (x, y) au frame 1-based f."""
        if pid not in self.X or f is None:
            return None
        i = min(max(f, 1), self.n) - 1
        x, y = self.X[pid][i], self.Y[pid][i]
        if math.isnan(x):
            return None
        return np.array([x, y])

    def dist(self, a, b, f):
        pa, pb = self.pos(a, f), self.pos(b, f)
        if pa is None or pb is None:
            return math.nan
        return float(np.hypot(*(pa - pb)))

    def dist_series(self, a, b):
        if a not in self.X or b not in self.X:
            return np.full(self.n, np.nan)
        return np.hypot(self.X[a] - self.X[b], self.Y[a] - self.Y[b])

    def reaction(self, pid, snap):
        """Temps (s) entre le snap et le premier mouvement franc (s > 1 yd/s ou déplacement > 0.5 yd)."""
        if pid not in self.X or snap is None:
            return math.nan
        x0, y0 = self.X[pid][snap - 1], self.Y[pid][snap - 1]
        for f in range(snap + 1, min(self.n, snap + 25) + 1):
            i = f - 1
            if math.isnan(self.X[pid][i]):
                continue
            if self.S[pid][i] > 1.0 or math.hypot(self.X[pid][i] - x0, self.Y[pid][i] - y0) > 0.5:
                return (f - snap) / 10
        return math.nan


# ----------------------------------------------------------------------------- name matching
NAME_RE = r"([A-Z][a-z]{0,2}\.\s?[A-Z][A-Za-z'\-\.]*(?:\s[A-Z][A-Za-z'\-]+)?)"


def norm(s):
    return re.sub(r"[^a-z]", "", s.lower())


def match_name(abbr, candidates, players):
    if not abbr:
        return None
    ini, _, last = abbr.partition(".")
    last = norm(last)
    for pid in candidates:
        if pid not in players.index:
            continue
        dn = str(players.loc[pid, "displayName"])
        first, _, rest = dn.partition(" ")
        r = norm(rest)
        if first[:1].upper() == ini[:1].upper() and r and (r == last or r.startswith(last) or last.startswith(r)):
            return pid
    return None


def target_abbr(desc):
    m = re.search(r"pass.*?(?:\bto|intended for) " + NAME_RE, desc)
    return m.group(1) if m else None


def interceptor_abbr(desc):
    m = re.search(r"INTERCEPTED by " + NAME_RE, desc)
    return m.group(1) if m else None


# ----------------------------------------------------------------------------- metrics
def metric(key, label, value, unit, ok, nd=2):
    if isinstance(value, (int, float, np.floating)) and not isinstance(value, bool):
        value = None if not isnum(float(value)) else round(float(value), nd)
    return {"key": key, "label": label, "value": value, "unit": unit, "ok": ok}


def ok_lt(v, thr):
    return None if not isnum(v) else bool(v < thr)


def ok_ge(v, thr):
    return None if not isnum(v) else bool(v >= thr)


def wmean(parts):
    parts = [(s, w) for s, w in parts if s is not None]
    if not parts:
        return 0.5
    return sum(s * w for s, w in parts) / sum(w for _, w in parts)


class Ctx:
    """Contexte d'une action (play) pour le calcul des métriques."""

    def __init__(self, gid, play, pt: PlayTrack, pff_play: pd.DataFrame, players):
        self.gid, self.play, self.pt, self.players = gid, play, pt, players
        self.pff = pff_play.set_index("nflId")
        pt_ = pt
        self.snap = pt_.first("ball_snap", "autoevent_ballsnap")
        self.snap_inferred = self.snap is None
        if self.snap is None:  # pas d'événement snap : premier mouvement du ballon
            mv = np.where(np.abs(pt_.bx - pt_.bx[0]) > 0.3)[0]
            self.snap = int(max(1, mv[0])) if len(mv) else min(11, pt_.n)
        self.pass_f = pt_.first("pass_forward", "autoevent_passforward")
        self.arr_f = pt_.first("pass_arrived", "pass_outcome_caught", "pass_outcome_incomplete",
                               "interception", "pass_outcome_touchdown", "pass_tipped")
        if self.arr_f is None and self.pass_f and pt_.n > self.pass_f:
            # le suivi s'arrête ~0,5 s après la passe : on prend la dernière frame
            self.arr_f = pt_.n
        self.sack_f = pt_.first("qb_sack", "qb_strip_sack")
        term = [f for f, e in pt_.raw_events if e in TERMINAL and f >= self.snap]
        self.end_f = max(term) if term else pt_.n
        self.los_x = float(pt_.bx[self.snap - 1]) if not math.isnan(pt_.bx[self.snap - 1]) else float(play.absoluteYardlineNumber)
        roles = self.pff.pff_role
        qbs = [int(i) for i in roles[roles == "Pass"].index if int(i) in pt_.X]
        self.qb = qbs[0] if qbs else None
        off_team = play.possessionTeam
        self.offense = [p for p, t in pt_.team.items() if t == off_team]
        self.defense = [p for p, t in pt_.team.items() if t != off_team]
        self.routes = [int(i) for i in roles[roles == "Pass Route"].index if int(i) in pt_.X]
        self.result = play.passResult if isinstance(play.passResult, str) else None
        desc = str(play.playDescription)
        self.target = match_name(target_abbr(desc), self.routes or self.offense, players)
        if self.target is None and self.arr_f and self.routes:
            bp = np.array([pt_.bx[self.arr_f - 1], pt_.by[self.arr_f - 1]])
            if not np.isnan(bp).any():
                d = [(float(np.hypot(*(self.pt.pos(r, self.arr_f) - bp))), r) for r in self.routes
                     if self.pt.pos(r, self.arr_f) is not None]
                if d and min(d)[0] < 3:
                    self.target = min(d)[1]
        self.interceptor = match_name(interceptor_abbr(desc), self.defense, players)
        # fin de la protection : passe, sack, scramble ou 5 s
        run_f = pt_.first("run")
        cands = [f for f in (self.pass_f, self.sack_f, run_f) if f]
        self.prot_end = min(cands) if cands else min(self.end_f, self.snap + 50)

    def pffv(self, pid, col):
        try:
            v = self.pff.loc[pid, col]
        except KeyError:
            return None
        return v if isnum(v) else None

    # --- Pass Block -----------------------------------------------------------
    def pass_block(self, pid, group):
        pt, snap = self.pt, self.snap
        react = pt.reaction(pid, snap)
        x0 = pt.X[pid][snap - 1]
        win = pt.X[pid][snap - 1: min(pt.n, snap + 10)]
        depth = float(np.nanmax(x0 - win)) if not np.isnan(win).all() else math.nan
        depth = max(depth, 0.0) if isnum(depth) else depth
        opp = self.pffv(pid, "pff_nflIdBlockedPlayer")
        opp = int(opp) if opp is not None and int(opp) in pt.X else None
        lost_f, side = None, None
        if opp is not None and self.qb is not None:
            d_oq = pt.dist_series(opp, self.qb)
            d_bq = pt.dist_series(pid, self.qb)
            for f in range(snap + 3, self.prot_end + 1):
                i = f - 1
                if np.isnan(d_oq[i]) or np.isnan(d_bq[i]):
                    continue
                if d_oq[i] < 1.5 or (d_oq[i] < 5 and d_oq[i] < d_bq[i] - 0.5):
                    lost_f = f
                    qy = pt.Y[self.qb][i]
                    side = "à l'extérieur" if abs(pt.Y[opp][i] - qy) > abs(pt.Y[pid][i] - qy) else "à l'intérieur"
                    break
        hold = ((lost_f or self.prot_end) - snap) / 10 if opp is not None else math.nan
        hit = self.pffv(pid, "pff_hitAllowed") or 0
        hurry = self.pffv(pid, "pff_hurryAllowed") or 0
        sack = self.pffv(pid, "pff_sackAllowed") or 0
        beaten = self.pffv(pid, "pff_beatenByDefender") or 0
        press = int(hit + hurry + sack)
        hold_ok = None if opp is None else (True if lost_f is None else bool(hold >= 2.5))
        ms = [
            metric("reaction_s", "Réaction au snap", react, "s", ok_lt(react, 0.5)),
            metric("set_depth_yd", "Profondeur du pass set", depth, "yd",
                   ok_ge(depth, 0.7) if group == "OL" else None),
            metric("hold_s", "Tenue du bloc", hold, "s", hold_ok),
            metric("pressures_allowed", "Pressions concédées", press, "", press == 0 and not beaten),
        ]
        hold_sc = None if opp is None else (1.0 if lost_f is None else clamp(hold / 3.0))
        p_sc = 0.0 if sack else (0.25 if hit else (0.45 if hurry or beaten else 1.0))
        score = wmean([(lerp_score(react, 0.2, 0.9), 0.2), (lerp_score(depth, 1.2, 0.0) if group == "OL" else None, 0.1),
                       (hold_sc, 0.35), (p_sc, 0.45)])
        info = dict(react=react, depth=depth, hold=hold, lost=lost_f is not None, side=side,
                    opp=pt.jersey.get(opp) if opp else None, press=press, sack=bool(sack), hit=bool(hit),
                    hurry=bool(hurry), beaten=bool(beaten), group=group)
        return ms, 100 * score, info

    # --- Pass Rush ------------------------------------------------------------
    def pass_rush(self, pid, group):
        pt, snap = self.pt, self.snap
        react = pt.reaction(pid, snap)
        t_qb, dmin = math.nan, math.nan
        if self.qb is not None:
            d = pt.dist_series(pid, self.qb)[snap - 1: self.prot_end]
            if not np.isnan(d).all():
                dmin = float(np.nanmin(d))
                hits = np.where(d < 2.0)[0]
                if len(hits):
                    t_qb = hits[0] / 10
        hit = self.pffv(pid, "pff_hit") or 0
        hurry = self.pffv(pid, "pff_hurry") or 0
        sack = self.pffv(pid, "pff_sack") or 0
        press = int(hit + hurry + sack)
        ms = [
            metric("reaction_s", "Réaction au snap", react, "s", ok_lt(react, 0.5)),
            metric("time_to_qb_s", "Temps jusqu'au QB", t_qb if isnum(t_qb) else None, "s",
                   None if not isnum(t_qb) else bool(t_qb <= 3.0)),
            metric("min_qb_dist_yd", "Distance min. au QB", dmin, "yd",
                   None if not isnum(dmin) else (True if dmin <= 2.0 else (False if dmin >= 5 else None))),
            metric("pressure", "Pression obtenue", press, "", True if press else None),
        ]
        t_prot = (self.prot_end - snap) / 10
        quick = t_prot < 2.5 and not press  # passe rapide : impossible d'arriver au QB
        if quick:
            ms[2]["ok"] = None if ms[2]["ok"] is False else ms[2]["ok"]
            p_sc, d_sc = 0.7, lerp_score(dmin, 2.0, 8.0)
        else:
            p_sc, d_sc = (1.0 if sack else (0.9 if hit else (0.8 if hurry else 0.4))), lerp_score(dmin, 1.5, 7.0)
        score = wmean([(lerp_score(react, 0.2, 0.9), 0.25), (d_sc, 0.35), (p_sc, 0.4)])
        info = dict(react=react, t_qb=t_qb, dmin=dmin, press=press, sack=bool(sack), hit=bool(hit),
                    hurry=bool(hurry), group=group, quick=quick, t_prot=t_prot)
        return ms, 100 * score, info

    # --- Pass (QB) ------------------------------------------------------------
    def qb_pass(self, pid, group):
        pt, snap = self.pt, self.snap
        end = self.pass_f or self.sack_f or self.prot_end
        t = (end - snap) / 10 if end else math.nan
        seg = pt.X[pid][snap - 1: end]
        drop = float(self.los_x - np.nanmin(seg)) if len(seg) and not np.isnan(seg).all() else math.nan
        res = self.result
        ms = [
            metric("throw_time_s", "Temps avant la passe" if self.pass_f else "Temps dans la poche", t, "s",
                   None if not isnum(t) else bool(t <= 3.0) if self.pass_f else False),
            metric("drop_depth_yd", "Profondeur du drop", drop, "yd",
                   None if not isnum(drop) else bool(5 <= drop <= 10)),
            metric("result", "Résultat", RESULT_FR.get(res, "—"), "",
                   {"C": True, "I": None, "S": False, "IN": False, "R": None}.get(res)),
            metric("yards", "Yards gagnés", float(self.play.playResult) if isnum(self.play.playResult) else None,
                   "yd", None, 0),
        ]
        t_sc = 1.0 if isnum(t) and t <= 3.0 else lerp_score(t, 3.0, 4.5)
        r_sc = {"C": 1.0, "I": 0.4, "S": 0.0, "IN": 0.0, "R": 0.6}.get(res, 0.5)
        score = 100 * wmean([(t_sc, 0.4), (r_sc, 0.6)])
        yds = self.play.playResult if isnum(self.play.playResult) else 0
        if res == "C" and yds >= max(10, self.play.yardsToGo):
            score += 8
        if res == "IN":
            score = min(score, 30)
        if res == "S":
            score = min(score, 38)
        info = dict(t=t, drop=drop, res=res, yds=int(yds), passed=self.pass_f is not None)
        return ms, score, info

    # --- Pass Route -----------------------------------------------------------
    def nearest(self, pid, f, pool):
        if f is None:
            return math.nan
        ds = [self.pt.dist(pid, o, f) for o in pool]
        ds = [d for d in ds if isnum(d)]
        return min(ds) if ds else math.nan

    def pass_route(self, pid, group):
        pt, snap = self.pt, self.snap
        end = self.arr_f or (self.pass_f + 10 if self.pass_f else self.end_f)
        end = min(end, pt.n)
        seg = pt.X[pid][snap - 1: end]
        depth = float(np.nanmax(seg) - self.los_x) if not np.isnan(seg).all() else math.nan
        sseg = pt.S[pid][snap - 1: end]
        vmax = float(np.nanmax(sseg)) if not np.isnan(sseg).all() else math.nan
        sep_p = self.nearest(pid, self.pass_f, self.defense)
        sep_a = self.nearest(pid, self.arr_f, self.defense)
        is_t = self.target == pid
        thr_v = 7.0 if group == "WR" else 6.0
        ms = [
            metric("route_depth_yd", "Profondeur de route", depth, "yd", None),
            metric("max_speed_yds", "Vitesse max", vmax, "yd/s", ok_ge(vmax, thr_v)),
            metric("sep_pass_yd", "Séparation à la passe", sep_p if isnum(sep_p) else None, "yd", ok_ge(sep_p, 2.0)),
            metric("sep_arrival_yd", "Séparation après la passe", sep_a if isnum(sep_a) else None, "yd",
                   ok_ge(sep_a, 1.5)),
            metric("target", "Ciblé", "Oui" if is_t else "Non", "", None),
        ]
        sep = sep_a if isnum(sep_a) else sep_p
        score = 100 * wmean([(lerp_score(sep_p, 3.0, 0.5), 0.35), (lerp_score(sep_a, 2.5, 0.3), 0.25),
                             (lerp_score(vmax, thr_v + 1, thr_v - 3), 0.4)])
        res = self.result
        if is_t and res == "C":
            score += 12
        if is_t and res == "IN":
            score -= 20
        info = dict(depth=depth, vmax=vmax, sep_p=sep_p, sep_a=sep_a, sep=sep, target=is_t, res=res,
                    yds=int(self.play.playResult) if isnum(self.play.playResult) else 0, thr_v=thr_v,
                    passed=self.pass_f is not None)
        return ms, score, info

    # --- Coverage -------------------------------------------------------------
    def coverage(self, pid, group):
        pt, snap = self.pt, self.snap
        react = pt.reaction(pid, snap)
        pool = self.routes or [p for p in self.offense if p != self.qb]
        d_p = self.nearest(pid, self.pass_f, pool)
        d_a = self.nearest(pid, self.arr_f, pool)

        zone = self.play.pff_passCoverageType == "Zone"
        on_target = False
        if self.target and self.arr_f:
            dt = pt.dist(pid, self.target, self.arr_f)
            others = [pt.dist(o, self.target, self.arr_f) for o in self.defense if o != pid]
            others = [o for o in others if isnum(o)]
            on_target = isnum(dt) and (not others or dt <= min(others))
            if on_target:  # défenseur responsable de la cible : on mesure l'écart à la cible
                d_p = pt.dist(pid, self.target, self.pass_f) if self.pass_f else d_p
                d_a = dt
        # en zone, un écart large au receveur le plus proche n'est une faute que sur la cible
        strict = on_target or not zone
        far = 3.0

        def okc(d):
            if not isnum(d):
                return None
            if d <= 1.5:
                return True
            return False if (strict and d > far) else None

        ms = [
            metric("reaction_s", "Réaction au snap", react, "s", ok_lt(react, 1.0)),
            metric("cov_pass_yd", "Écart au receveur (passe)", d_p if isnum(d_p) else None, "yd", okc(d_p)),
            metric("cov_arrival_yd", "Écart au receveur (après la passe)", d_a if isnum(d_a) else None, "yd", okc(d_a)),
        ]
        r_sc = lerp_score(react, 0.4, 1.4)
        if strict:
            score = 100 * wmean([(r_sc, 0.2), (lerp_score(d_p, 1.0, 5.0), 0.4), (lerp_score(d_a, 0.8, 4.5), 0.4)])
        else:
            score = 100 * wmean([(r_sc, 0.3), (0.85 if isnum(d_p) and d_p <= 4 else 0.7, 0.7)])
        res = self.result
        yds = int(self.play.playResult) if isnum(self.play.playResult) else 0
        if on_target and res == "C":
            score -= 5 + min(yds, 20) / 2
        if on_target and res == "I":
            score += 15
        if not self.pass_f:
            score = max(score, 70)
        if self.interceptor == pid:
            score = max(score, 95)
        if res == "S":
            score += 8
        info = dict(react=react, d_p=d_p, d_a=d_a, on_target=on_target, res=res, yds=yds, far=far,
                    strict=strict, pick=self.interceptor == pid, passed=self.pass_f is not None)
        return ms, score, info


ROLE_FN = {"Pass Block": Ctx.pass_block, "Pass Rush": Ctx.pass_rush, "Pass": Ctx.qb_pass,
           "Pass Route": Ctx.pass_route, "Coverage": Ctx.coverage}


# ----------------------------------------------------------------------------- feedback (rep)
def opp_str(j):
    return f"le {j}" if j else "ton vis-à-vis"


def feedback(role, i, key):
    k = key
    L = i.get("lenient", False)  # essai noté vert : on ne relève pas les détails mineurs
    if role == "Pass Block":
        o = opp_str(i["opp"])
        if i["sack"]:
            return pick([f"Sack concédé, {o} t'a battu{' ' + i['side'] if i['side'] else ''}. On revoit ça au film.",
                         f"C'est ton gars qui fait le sack. Reste entre {o} et le QB.",
                         f"Sack concédé sur {o}, tes pieds se sont arrêtés trop tôt."], *k)
        if i["lost"] and isnum(i["hold"]) and i["hold"] < 2.5:
            return pick([f"Bloc cédé à {fr(i['hold'])} s sur {o}, tu t'es fait battre {i['side']}.",
                         f"{o.capitalize()} te passe {i['side']} à {fr(i['hold'])} s, garde tes mains dedans.",
                         f"Tu lâches {o} après {fr(i['hold'])} s, il file {i['side']}. Reste devant lui."], *k)
        if i["hit"] or i["hurry"] or i["beaten"]:
            return pick([f"Pression concédée sur {o}, ton bloc ne tient pas jusqu'à la passe.",
                         f"{o.capitalize()} met la pression sur le QB, finis ton bloc.",
                         f"QB pressé par {o}, recule ta main extérieure et ferme l'angle."], *k)
        if not L and isnum(i["react"]) and i["react"] >= 0.5:
            return pick([f"Départ en retard au snap, {fr(i['react'])} s. Pars avec le ballon.",
                         f"{fr(i['react'])} s pour sortir de ton stance, c'est trop lent.",
                         f"Tu pars en retard, {fr(i['react'])} s. Regarde le ballon, pas le voisin."], *k)
        if not L and i["group"] == "OL" and isnum(i["depth"]) and i["depth"] < 0.7:
            return pick([f"Pass set trop court, {yd(i['depth'])} de recul. Gagne de la profondeur au premier pas.",
                         f"Seulement {yd(i['depth'])} de kick-step, recule plus pour absorber le rush."], *k)
        if isnum(i["hold"]):
            return pick([f"Bloc solide sur {o}, tenu {fr(i['hold'])} s. Rien à dire.",
                         f"Propre : départ en {fr(i['react'])} s et pas une pression concédée.",
                         f"Bonne protection, tu gardes {o} devant toi tout le long.",
                         f"Poche propre de ton côté, {fr(i['hold'])} s de bloc tenu. Continue."], *k)
        return pick(["Bon chip, protection propre de ton côté.", "Rien n'est passé chez toi, bon boulot en protection."], *k)

    if role == "Pass Rush":
        t = fr(i["t_qb"]) if isnum(i["t_qb"]) else None
        if i["sack"]:
            return pick([f"Sack ! Tu arrives au QB en {t or '?'} s. Continue comme ça.",
                         "Sack pour toi, rush gagné. C'est exactement ça.",
                         f"Gros sack, {t or '?'} s pour arriver sur le QB. Énorme."], *k)
        if i["hit"] or i["hurry"]:
            return pick([f"Pression sur le QB{' en ' + t + ' s' if t else ''}, bon travail. Maintenant finis l'action.",
                         "Tu mets le QB sous pression, bon rush. Le prochain, tu le plaques.",
                         f"QB pressé, tu gagnes ton duel. Garde ce rythme."], *k)
        if not L and isnum(i["react"]) and i["react"] >= 0.5:
            return pick([f"Départ lent au snap, {fr(i['react'])} s. Pars sur le ballon.",
                         f"{fr(i['react'])} s pour démarrer, tu laisses le bloqueur s'installer.",
                         f"Tu sors en retard, {fr(i['react'])} s. Anticipe le snap."], *k)
        if i["quick"]:
            return pick([f"Passe partie en {fr(i['t_prot'])} s, impossible d'arriver. Bon départ quand même.",
                         f"Ballon lâché vite, {fr(i['t_prot'])} s. Mains hautes dans le couloir la prochaine fois.",
                         f"Passe rapide du QB, rien à faire au rush. Lève les bras pour gêner la passe."], *k)
        if not L and isnum(i["dmin"]) and i["dmin"] >= 4:
            return pick([f"Tu restes à {yd(i['dmin'])} du QB, gagne ton duel et attaque une épaule.",
                         f"Bloqué à {yd(i['dmin'])} du QB. Enchaîne un move, ne reste pas collé.",
                         f"Pas de rush : {yd(i['dmin'])} du QB au plus près. Utilise tes mains."], *k)
        return pick([f"Tu approches à {yd(i['dmin'])} du QB, il manque le dernier pas.",
                     f"Bon départ, {fr(i['react'])} s, mais pas de pression. Finis ton rush.",
                     f"{yd(i['dmin'])} du QB au plus près, presque. Accélère au dernier pas."], *k)

    if role == "Pass":
        t = fr(i["t"])
        if i["res"] == "IN":
            return pick([f"Interception après {t} s, ballon forcé. Protège le ballon.",
                         "Interception. Lis le défenseur avant de lâcher le ballon.",
                         f"Ballon intercepté, {t} s dans la poche. Si c'est fermé, jette-le dehors."], *k)
        if i["res"] == "S":
            return pick([f"Sack après {t} s dans la poche. Lâche le ballon plus tôt ou sors de la poche.",
                         f"{t} s sans lâcher le ballon, sack. Va sur ton check-down.",
                         f"Sack à {t} s. Sens la pression et glisse dans la poche."], *k)
        if i["res"] == "R":
            return pick([f"Scramble après {t} s. Bien si rien n'est ouvert, mais garde les yeux en bas du terrain.",
                         f"Tu sors de la poche à {t} s, bonne décision si la lecture est fermée."], *k)
        if not L and isnum(i["t"]) and i["t"] > 3.0:
            return pick([f"Tu gardes le ballon {t} s, trop long. Déclenche avant 3 secondes.",
                         f"{t} s avant la passe, la protection ne tiendra pas toujours. Accélère ta lecture.",
                         f"Ballon parti à {t} s, c'est tard. Va plus vite dans ta progression."], *k)
        if i["res"] == "C":
            return pick([f"Complète en {t} s pour {yd(i['yds'], 0)}, bon tempo.",
                         f"Bonne passe, {t} s et {yd(i['yds'], 0)}. Continue comme ça.",
                         f"Lecture propre, ballon parti en {t} s. {yd(i['yds'], 0)} de gagnés."], *k)
        return pick([f"Incomplète mais bon tempo, {t} s. Reste sur ta lecture.",
                     f"Ballon parti en {t} s, timing correct. Travaille la précision.",
                     f"Passe ratée, mais {t} s c'est le bon rythme."], *k)

    if role == "Pass Route":
        sep = i["sep"]
        if i["target"] and i["res"] == "C":
            return pick([f"Réception pour {yd(i['yds'], 0)} avec {yd(sep)} de séparation, belle route.",
                         f"Bien joué, {yd(i['yds'], 0)}. Tu étais ouvert de {yd(sep)}.",
                         f"Catch propre, {yd(sep)} d'avance sur ton défenseur."], *k)
        if i["target"] and i["res"] == "IN":
            return pick([f"Interception sur ta route, {yd(sep)} de séparation. Bats-toi pour le ballon.",
                         "Ballon intercepté sur toi. Reviens vers le ballon, ne le laisse pas au défenseur."], *k)
        if i["target"] and isnum(sep) and sep < 1.5:
            return pick([f"Ciblé mais seulement {yd(sep)} de séparation. Casse plus net à la coupure.",
                         f"Défenseur collé à {yd(sep)} sur la passe. Vends mieux ta route.",
                         f"{yd(sep)} de séparation seulement. Gagne ta coupure."], *k)
        if not L and isnum(i["sep_p"]) and i["sep_p"] < 1.5:
            return pick([f"Seulement {yd(i['sep_p'])} de séparation à la passe. Vends mieux ta route.",
                         f"Tu restes couvert à {yd(i['sep_p'])}. Attaque le défenseur avant ta coupure.",
                         f"Pas ouvert : {yd(i['sep_p'])} au moment de la passe. Casse plus fort."], *k)
        if not L and isnum(i["vmax"]) and i["vmax"] < i["thr_v"] and isnum(i["depth"]) and i["depth"] >= 5:
            return pick([f"Pointe à {fr(i['vmax'])} yd/s seulement, attaque plus fort la profondeur.",
                         f"Route trop lente, {fr(i['vmax'])} yd/s max. Mets du rythme dès le snap."], *k)
        if i["target"]:
            return pick([f"Ciblé avec {yd(sep)} de séparation, tu as fait ton boulot.",
                         f"Ouvert de {yd(sep)} sur la cible, bonne route."], *k)
        if isnum(i["sep_p"]):
            return pick([f"{yd(i['sep_p'])} de séparation à la passe, tu étais ouvert.",
                         f"Route propre, {yd(i['sep_p'])} d'avance. Le ballon viendra.",
                         f"Bien ouvert, {yd(i['sep_p'])}. Continue à vendre tes routes."], *k)
        return pick([f"Route à {yd(i['depth'])}, pas de passe sur l'action. Garde la même intensité.",
                     f"Pas de ballon lancé, mais pointe à {fr(i['vmax'])} yd/s. Bonne intensité."], *k)

    if role == "Coverage":
        if i["pick"]:
            return pick(["Interception ! Grosse lecture, c'est ton ballon.",
                         "Pick ! Tu as lu le QB et attaqué le ballon. Parfait.",
                         "Interception pour toi, superbe lecture du jeu."], *k)
        if i["on_target"] and i["res"] == "C":
            return pick([f"Réception concédée, tu étais à {yd(i['d_a'])} du receveur. Colle-le plus près.",
                         f"{yd(i['yds'], 0)} concédés sur ton receveur, {yd(i['d_a'])} d'écart après la passe.",
                         f"Ton gars attrape, {yd(i['d_a'])} de cushion. Resserre ta couverture."], *k)
        if i["on_target"] and i["res"] in ("I",):
            return pick([f"Passe incomplète sur ton gars, {yd(i['d_a'])} d'écart. Belle couverture.",
                         "Ballon défendu sur ton receveur, bon travail.",
                         f"Tu restes sur lui à {yd(i['d_a'])}, incomplète. Bravo."], *k)
        if not L and isnum(i["react"]) and i["react"] >= 1.2:
            return pick([f"Réaction lente au snap, {fr(i['react'])} s. Lis ta clé plus vite.",
                         f"{fr(i['react'])} s pour bouger, tu donnes de l'avance au receveur."], *k)
        if i["strict"] and isnum(i["d_a"]) and i["d_a"] > i["far"]:
            return pick([f"Trop loin du receveur, {yd(i['d_a'])} après la passe. Resserre.",
                         f"{yd(i['d_a'])} de cushion après la passe, c'est trop. Rapproche-toi.",
                         f"Écart de {yd(i['d_a'])}, ferme plus vite sur le receveur."], *k)
        if not i["passed"]:
            return pick(["Pas de passe, ta couverture a tenu. Bon travail.",
                         "Couverture tenue jusqu'au bout, le QB n'a rien trouvé."], *k)
        if isnum(i["d_p"]) and i["d_p"] <= 2.0:
            return pick([f"Couverture serrée, {yd(i['d_p'])} du receveur à la passe.",
                         f"Bonne couverture, {yd(i['d_a'])} d'écart après la passe.",
                         f"Tu restes au contact, {yd(i['d_p'])} à la passe. Continue."], *k)
        return pick([f"Zone tenue, receveur le plus proche à {yd(i['d_p'])} à la passe.",
                     f"Ta zone est propre, {yd(i['d_p'])} du premier receveur. Garde les yeux sur le QB.",
                     f"Couverture correcte, {yd(i['d_p'])} au moment de la passe. Ferme plus vite sur le ballon."], *k)
    return "Essai enregistré."


# ----------------------------------------------------------------------------- briefs
CUES = {
    "reaction_s": "pars sur le mouvement du ballon, pas sur le voisin",
    "set_depth_yd": "gagne de la profondeur sur ton premier kick-step",
    "hold_s": "garde tes mains à l'intérieur et tes pieds sous toi jusqu'à la passe",
    "pressures_allowed": "reste entre ton gars et le QB, ferme la porte à l'intérieur",
    "time_to_qb_s": "attaque une épaule et enchaîne ton move de rush",
    "min_qb_dist_yd": "gagne ton duel au premier contact, utilise tes mains",
    "throw_time_s": "lis ta progression plus vite, ballon parti avant 3 secondes",
    "drop_depth_yd": "soigne ton drop, cinq à sept yards et pieds prêts",
    "result": "protège le ballon et prends le check-down si c'est fermé",
    "max_speed_yds": "attaque le défenseur à pleine vitesse avant ta coupure",
    "sep_pass_yd": "vends ta route et casse net à la coupure",
    "sep_arrival_yd": "finis ta route et reviens vers le ballon",
    "cov_pass_yd": "colle ton receveur au moment où le QB arme",
    "cov_arrival_yd": "ferme vite sur le receveur quand le ballon part",
}
ROLE_CUE = {"Pass Block": "garde le même niveau de protection", "Pass Rush": "continue à mettre de la pression",
            "Pass": "garde ce tempo dans ta lecture", "Pass Route": "continue à vendre tes routes",
            "Coverage": "reste aussi serré en couverture"}
LABELS = {"reaction_s": "réaction au snap", "set_depth_yd": "pass set", "hold_s": "tenue du bloc",
          "pressures_allowed": "pressions concédées", "time_to_qb_s": "temps jusqu'au QB",
          "min_qb_dist_yd": "distance au QB", "throw_time_s": "temps avant la passe",
          "drop_depth_yd": "drop", "result": "résultat", "max_speed_yds": "vitesse",
          "sep_pass_yd": "séparation", "sep_arrival_yd": "séparation à l'arrivée",
          "cov_pass_yd": "écart au receveur", "cov_arrival_yd": "écart à l'arrivée"}


def good_text(key, k, n, vals):
    m = fr(np.mean(vals), 2 if key == "reaction_s" else 1) if vals else "?"
    Y = yd(np.mean(vals)) if vals else "?"
    return {
        "reaction_s": f"Bon départ au snap sur {k} {pl(k, 'essai')} sur {n}, {m} s en moyenne.",
        "set_depth_yd": f"Pass set propre, {Y} de recul en moyenne.",
        "hold_s": f"Bloc tenu sur {k} {pl(k, 'essai')} sur {n}.",
        "pressures_allowed": f"Aucune pression concédée sur {k} {pl(k, 'essai')} sur {n}.",
        "time_to_qb_s": f"Tu arrives au QB sur {k} {pl(k, 'essai')} sur {n}, en {m} s en moyenne.",
        "min_qb_dist_yd": f"Tu passes à moins de 2 yards du QB sur {k} {pl(k, 'essai')} sur {n}.",
        "throw_time_s": f"Ballon lâché dans le tempo sur {k} {pl(k, 'essai')} sur {n}, {m} s en moyenne.",
        "drop_depth_yd": f"Drop régulier, {Y} en moyenne.",
        "result": f"{k} {pl(k, 'passe complète', 'passes complètes')} sur {n}.",
        "max_speed_yds": f"Bonne vitesse dans tes routes, {m} yd/s de pointe en moyenne.",
        "sep_pass_yd": f"Séparation créée sur {k} {pl(k, 'essai')} sur {n}, {Y} en moyenne.",
        "sep_arrival_yd": f"Ouvert après la passe sur {k} {pl(k, 'essai')} sur {n}.",
        "cov_pass_yd": f"Couverture serrée à la passe sur {k} {pl(k, 'essai')} sur {n}, {Y} en moyenne.",
        "cov_arrival_yd": f"Au contact après la passe sur {k} {pl(k, 'essai')} sur {n}.",
        "pressure": f"{k} {pl(k, 'pression')} obtenue{'s' if k > 1 else ''} sur {n} essais.",
    }.get(key, f"Bon travail sur {k} {pl(k, 'essai')} sur {n}.")


def fix_text(key, b, n, vals):
    m = fr(np.mean(vals), 2 if key == "reaction_s" else 1) if vals else "?"
    Y = yd(np.mean(vals)) if vals else "?"
    return {
        "reaction_s": f"Départ en retard sur {b} {pl(b, 'essai')} sur {n}, {m} s en moyenne.",
        "set_depth_yd": f"Pass set trop court sur {b} {pl(b, 'essai')}, {Y} de recul en moyenne.",
        "hold_s": f"Bloc cédé sur {b} {pl(b, 'essai')} sur {n}, à {m} s en moyenne.",
        "pressures_allowed": f"{b} {pl(b, 'essai')} avec pression concédée sur {n}.",
        "time_to_qb_s": f"Trop long pour arriver au QB, {m} s en moyenne.",
        "min_qb_dist_yd": f"Tu restes loin du QB sur {b} {pl(b, 'essai')} sur {n}, {Y} au plus près.",
        "throw_time_s": f"Tu gardes trop le ballon sur {b} {pl(b, 'essai')} sur {n}, {m} s en moyenne.",
        "drop_depth_yd": f"Drop irrégulier sur {b} {pl(b, 'essai')}, {Y} en moyenne.",
        "result": f"{b} {pl(b, 'ballon')} perdu{'s' if b > 1 else ''} ou {pl(b, 'sack')} sur {n} essais.",
        "max_speed_yds": f"Pas assez de vitesse sur {b} {pl(b, 'essai')} sur {n}, {m} yd/s de pointe.",
        "sep_pass_yd": f"Pas assez de séparation sur {b} {pl(b, 'essai')} sur {n}, {Y} en moyenne à la passe.",
        "sep_arrival_yd": f"Couvert après la passe sur {b} {pl(b, 'essai')} sur {n}.",
        "cov_pass_yd": f"Trop loin de ton receveur sur {b} {pl(b, 'essai')} sur {n}, {Y} en moyenne.",
        "cov_arrival_yd": f"Écart trop grand après la passe sur {b} {pl(b, 'essai')} sur {n}, {Y} en moyenne.",
    }.get(key, f"À corriger sur {b} {pl(b, 'essai')} sur {n}.")


def first_name(name):
    return name.split(" ")[0] if name else ""


def last_name(name):
    return name.split(" ", 1)[-1] if name else ""


def who_num(meta):
    """'le numéro 94, Lawrence' : lisible par TTS."""
    return f"{last_name(meta['name'])}, numéro {meta['jersey']}"


def lc_first(t):
    return t[:1].lower() + t[1:] if t else t


def player_brief(pid, reps_p, next_drill, side, name, n_drill=None):
    """reps_p: liste de dicts rep-player (role, metrics, score)."""
    n = len(reps_p)
    key = (pid, n, next_drill["index"] if next_drill else 0, side)
    stats = {}
    for rp in reps_p:
        for m in rp["metrics"]:
            if m["ok"] is None and m["key"] != "pressure":
                continue
            s = stats.setdefault(m["key"], {"ok": 0, "bad": 0, "vals": [], "bad_vals": [], "ok_vals": []})
            v = m["value"] if isinstance(m["value"], (int, float)) else None
            if m["ok"]:
                s["ok"] += 1
                if v is not None:
                    s["ok_vals"].append(v)
            elif m["ok"] is False:
                s["bad"] += 1
                if v is not None:
                    s["bad_vals"].append(v)
            if v is not None:
                s["vals"].append(v)
    role = max({rp["role"] for rp in reps_p}, key=lambda r: sum(1 for x in reps_p if x["role"] == r))
    goods = [(s["ok"] / max(1, s["ok"] + s["bad"]), s["ok"], k) for k, s in stats.items() if s["ok"] > 0]
    bads = [(s["bad"] / max(1, s["ok"] + s["bad"]), s["bad"], k) for k, s in stats.items() if s["bad"] > 0]
    points = []
    fix_key = None
    if bads:
        bads.sort(key=lambda t: (-t[0], -t[1], t[2]))
        fix_key = bads[0][2]
    if goods:
        goods.sort(key=lambda t: (-t[0], -t[1], t[2]))
        gk = next((g for g in goods if g[2] != fix_key), goods[0])[2]
        s = stats[gk]
        if gk == "pressure":
            k = int(sum(s["vals"]))
            points.append({"kind": "good", "text": good_text(gk, k, n, [])})
        elif gk == "result":
            points.append({"kind": "good", "text": good_text(gk, s["ok"], n, [])})
        else:
            points.append({"kind": "good", "text": good_text(gk, s["ok"], n, s["ok_vals"] or s["vals"])})
    else:
        points.append({"kind": "good", "text": pick([f"Tu as pris {n} {pl(n, 'essai')}, l'engagement est là.",
                                                     "L'intensité est là, on construit à partir de ça."], *key)})
    if fix_key:
        s = stats[fix_key]
        vals = s["bad_vals"] if fix_key == "hold_s" else (s["bad_vals"] or s["vals"])
        points.append({"kind": "fix", "text": fix_text(fix_key, s["bad"], n, vals)})
    else:
        points.append({"kind": "fix", "text": pick(["Rien de gros à corriger sur ce drill.",
                                                    "Pas de faute technique relevée, garde ce niveau."], *key)})
    cue = CUES.get(fix_key, ROLE_CUE.get(role, "garde le même niveau"))
    side_fr = "en attaque" if side == "offense" else "en défense"
    if next_drill:
        nxt = pick([f"Au prochain drill {side_fr}, le {next_drill['index']} au Q{next_drill['quarter']} : {cue}.",
                    f"Sur le drill {next_drill['index']}, une seule consigne : {cue}.",
                    f"Prochaine série {side_fr} : {cue}."], *key)
    else:
        nxt = f"Dernière série {side_fr} de la séance : {cue} à l'entraînement."
    points.append({"kind": "next", "text": nxt})
    avg = np.mean([rp["score"] for rp in reps_p])
    greens = sum(1 for rp in reps_p if rp["grade"] == "green")
    fn = first_name(name)
    if avg >= GREEN:
        mood = pick([f"{fn}, c'est du solide.", f"Très bonne série, {fn}.", f"{fn}, rien à redire sur l'ensemble."], *key)
    elif avg >= ORANGE:
        mood = pick([f"{fn}, c'est correct, mais il y a mieux à faire.", f"Série moyenne, {fn}.",
                     f"{fn}, {greens} {pl(greens, 'essai propre', 'essais propres')} sur {n}, on peut monter d'un cran."
                     if greens else f"{fn}, du bon et du moins bon."], *key)
    else:
        mood = pick([f"{fn}, série difficile.", f"C'était dur pour toi, {fn}.", f"{fn}, on doit corriger des choses."], *key)
    n_drill = n_drill or n
    intro = f"Drill terminé, {n_drill} {pl(n_drill, 'essai')}."
    if n < n_drill:
        intro += f" Tu étais sur {n} des {n_drill} essais."
    intro += f" {mood}"
    text = " ".join([intro] + [p["text"] for p in points])
    if len(text.split()) < 40:
        text += pick([f" On reste concentré sur chaque snap, {fn}.", " On garde ce sérieux sur la prochaine série.",
                      " Respire, on remet ça tout de suite."], *key)
    return {"text": oral(text), "points": points}


def group_brief(group, side, reps, players_meta, key):
    """reps: liste de reps (dicts) du drill. Analyse de la coordination du groupe."""
    rows = [(r, pid, rp) for r in reps for pid, rp in r["players"].items()
            if players_meta[pid]["group"] == group]
    if not rows:
        return None
    key = (*key, group)
    n_reps = len(reps)
    gname = GROUP_FR[group]
    roles = {}
    for _, _, rp in rows:
        roles[rp["role"]] = roles.get(rp["role"], 0) + 1
    role = max(roles, key=roles.get)

    def mval(rp, k):
        for m in rp["metrics"]:
            if m["key"] == k and isinstance(m["value"], (int, float)):
                return m["value"]
        return None

    def who(pid, pos=None):
        meta = players_meta[pid]
        base = POS_FR.get(pos) if pos else None
        nm = last_name(meta["name"])
        return f"{base}, {nm}," if base else nm

    parts = []
    if role in ("Pass Block", "Pass Rush"):
        spreads, lag = [], {}
        for r in reps:
            rs = [(pid, mval(rp, "reaction_s"), rp["pos"]) for pid, rp in r["players"].items()
                  if players_meta[pid]["group"] == group and rp["role"] == role and mval(rp, "reaction_s") is not None]
            if len(rs) >= 2:
                vals = [v for _, v, _ in rs]
                spreads.append(max(vals) - min(vals))
                mu = np.mean(vals)
                for pid, v, pos in rs:
                    lag.setdefault(pid, {"d": [], "pos": pos})["d"].append(v - mu)
        unit = "la ligne" if group in ("OL", "DL") else "le groupe"
        if spreads:
            sp = fr(np.mean(spreads), 2)
            late = max(lag.items(), key=lambda kv: np.mean(kv[1]["d"]))
            lg = np.mean(late[1]["d"])
            if lg > 0.08:
                w = who(late[0], late[1]["pos"])
                parts.append(pick([f"{w[:1].upper() + w[1:]} part en retard, {fr(lg, 2)} seconde derrière les autres au snap.",
                                   f"Au snap, {unit} se disperse sur {sp} seconde, et c'est {w} qui décolle en dernier.",
                                   f"Attention au départ : {w} part {fr(lg, 2)} seconde après {unit}."], *key))
            else:
                parts.append(pick([f"Bon départ groupé, {unit} part ensemble au snap.",
                                   f"Au snap, tout le monde part ensemble, {sp} seconde d'écart à peine.",
                                   f"Départ synchro, {unit} sort comme un seul homme."], *key))
        if role == "Pass Block":
            press = sum(int(mval(rp, "pressures_allowed") or 0) for _, _, rp in rows)
            lost = sum(1 for _, _, rp in rows for m in rp["metrics"] if m["key"] == "hold_s" and m["ok"] is False)
            if press == 0 and lost:
                parts.append(f"Pas de pression concédée, mais {lost} {pl(lost, 'bloc cédé', 'blocs cédés')} trop tôt, on tient plus longtemps.")
            elif press == 0:
                parts.append(pick([f"Zéro pression concédée en {n_reps} {pl(n_reps, 'essai')}, la poche a tenu.",
                                   "Poche propre du début à la fin, le QB a eu son temps."], *key))
            else:
                parts.append(pick([f"On concède {press} {pl(press, 'pression')} et {lost} {pl(lost, 'bloc cédé', 'blocs cédés')} "
                                   f"sur {n_reps} {pl(n_reps, 'essai')}, il faut tenir plus longtemps.",
                                   f"{press} {pl(press, 'pression concédée', 'pressions concédées')} sur la série, "
                                   "on communique mieux sur les stunts."], *key))
        else:
            press = sum(int(mval(rp, "pressure") or 0) for _, _, rp in rows)
            best = [(mval(rp, "min_qb_dist_yd"), pid) for _, pid, rp in rows if mval(rp, "min_qb_dist_yd") is not None]
            if press:
                parts.append(pick([f"{press} {pl(press, 'pression')} sur le QB en {n_reps} {pl(n_reps, 'essai')}, continuez à mettre les mains.",
                                   f"Le rush pèse : {press} {pl(press, 'pression obtenue', 'pressions obtenues')} sur la série."], *key))
            else:
                parts.append(pick(["Pas de pression sur la série, il faut gagner les duels plus vite.",
                                   "Le QB n'a pas été inquiété, on varie les moves et on enchaîne."], *key))
            if best:
                d, pid = min(best)
                if d < 3:
                    parts.append(f"{who(pid)} est passé le plus près, à {yd(d)} du QB.")
    elif role == "Pass":
        ts = [mval(rp, "throw_time_s") for _, _, rp in rows if mval(rp, "throw_time_s") is not None]
        comp = sum(1 for r, _, _ in rows if r["passResult"] == "C")
        mt = fr(np.mean(ts)) if ts else "?"
        parts.append(pick([f"{comp} {pl(comp, 'passe complète', 'passes complètes')} sur {n_reps}, ballon lâché en {mt} s en moyenne.",
                           f"Côté QB, {comp} sur {n_reps} et un tempo moyen de {mt} s."], *key))
        long_ = sum(1 for t in ts if t > 3.0)
        parts.append(f"{long_} {pl(long_, 'fois', 'fois')} le ballon gardé plus de trois secondes, il faut déclencher plus tôt."
                     if long_ else pick(["Le tempo est bon, on garde ça.", "Rythme respecté sur toute la série."], *key))
    elif role == "Pass Route":
        seps = [mval(rp, "sep_pass_yd") for _, _, rp in rows if mval(rp, "sep_pass_yd") is not None]
        tg = {}
        for _, pid, rp in rows:
            if any(m["key"] == "target" and m["value"] == "Oui" for m in rp["metrics"]):
                tg[pid] = tg.get(pid, 0) + 1
        if seps:
            parts.append(pick([f"En moyenne {yd(np.mean(seps))} de séparation au moment de la passe.",
                               f"On se crée {yd(np.mean(seps))} d'espace en moyenne quand le ballon part."], *key))
        if tg:
            pid = max(tg, key=tg.get)
            parts.append(f"{who(pid)} est la cible préférée, {tg[pid]} {pl(tg[pid], 'ballon')}.")
        covered = sum(1 for x in seps if x < 1.5)
        if covered:
            parts.append(f"{covered} {pl(covered, 'route reste couverte', 'routes restent couvertes')} à moins d'un yard et demi, on travaille les coupures.")
        elif seps:
            parts.append("Personne n'est resté collé à son défenseur, bon timing collectif.")
    else:  # Coverage
        cnt = len([1 for r in reps if any(players_meta[p]["group"] == group for p in r["players"])])
        comp_r = [r for r in reps if r["passResult"] == "C" and any(players_meta[p]["group"] == group for p in r["players"])]
        yds = sum(r["playResult"] or 0 for r in comp_r)
        if comp_r:
            parts.append(pick([f"{len(comp_r)} {pl(len(comp_r), 'réception concédée', 'réceptions concédées')} pour {yd(yds, 0)} sur {cnt} {pl(cnt, 'essai')}.",
                               f"L'adversaire attrape {len(comp_r)} {pl(len(comp_r), 'ballon')} pour {yd(yds, 0)} sur la série."], *key))
        else:
            parts.append(pick(["Aucune réception concédée sur la série, très bien.", "Zéro ballon attrapé en face, bravo."], *key))
        resp = {}
        for _, pid, rp in rows:
            for m in rp["metrics"]:
                if m["key"] == "cov_arrival_yd" and m["ok"] is False:
                    resp[pid] = resp.get(pid, 0) + 1
        if resp:
            pid = max(resp, key=resp.get)
            parts.append(f"{who(pid)} laisse trop de cushion, {resp[pid]} {pl(resp[pid], 'fois', 'fois')} à plus de trois yards de son receveur.")
        else:
            parts.append(pick(["Les receveurs ciblés sont restés sous contrôle.", "Bon placement, personne n'est largué."], *key))
    if not parts:
        return None
    return oral(" ".join(parts))


def coach_brief(drill, reps, players_meta):
    s = drill["summary"]
    n = len(reps)
    key = ("coach", drill["id"], n)
    g, o, r = s["green"], s["orange"], s["red"]
    side_w = "l'attaque" if drill["side"] == "offense" else "la défense"
    out = []
    if n == 1:
        out.append(pick([f"Un seul essai pour {side_w} : {lc_first(reps[0]['coachSummary'])}",
                         f"Série express, un snap pour {side_w}. {reps[0]['coachSummary']}"], *key))
    else:
        if g / n >= 0.6:
            out.append(pick([f"Bonne série de {side_w}, {g} essais sur {n} dans le vert.",
                             f"C'est propre pour {side_w} : {g} bons essais sur {n}.",
                             f"Belle série, {side_w} enchaîne {g} réussites sur {n}."], *key))
        elif r >= max(2, n / 2):
            out.append(pick([f"Série compliquée pour {side_w}, {r} essais à reprendre sur {n}.",
                             f"Ça n'a pas tourné pour {side_w} : {r} essais ratés sur {n}.",
                             f"Série difficile, {side_w} se fait bousculer sur {r} des {n} essais."], *key))
        elif g == 0:
            out.append(pick([f"Rien de vraiment propre pour {side_w} sur ces {n} essais, mais pas de catastrophe.",
                             f"{n} essais sans vraie réussite pour {side_w}, on doit monter d'un cran."], *key))
        else:
            out.append(pick([f"Série mitigée pour {side_w} : {g} {pl(g, 'essai propre', 'essais propres')} sur {n}.",
                             f"Du bon et du moins bon pour {side_w}, {g} {pl(g, 'réussite')} sur {n}."], *key))
        best = max(reps, key=lambda x: x["score"])
        if best["grade"] == "green":
            down = best["label"].split(" · ")[0]
            out.append(pick([f"À garder : le {down} à {best['gameClock']}, {lc_first(best['coachSummary'])}",
                             f"Le meilleur moment, c'est le {down} à {best['gameClock']} : {lc_first(best['coachSummary'])}"], *key))
    # adversaire marquant
    opp_line = None
    if drill["side"] == "offense":
        cnt = {}
        for rep in reps:
            for pid in rep["_opp"].get("pressure", []):
                cnt[pid] = cnt.get(pid, 0) + 1
        if cnt:
            pid = max(cnt, key=lambda k: (cnt[k], k))
            m = players_meta.get(pid)
            if m and (cnt[pid] >= 2 or len(cnt) == 1):
                opp_line = pick([f"Une pression concédée, signée {who_num(m)}.",
                                 f"Seule alerte : {who_num(m)} arrive une fois sur le QB."], *key) if cnt[pid] == 1 else \
                    pick([f"Attention à {who_num(m)} : {cnt[pid]} {pl(cnt[pid], 'pression')} sur notre QB dans la série.",
                                 f"En face, {who_num(m)} nous pose problème, {cnt[pid]} {pl(cnt[pid], 'fois', 'fois')} dans le backfield.",
                                 f"Il faut une aide sur {who_num(m)}, il arrive {cnt[pid]} {pl(cnt[pid], 'fois', 'fois')} sur le QB."], *key)
        elif n > 1:
            opp_line = pick(["La protection a tenu, aucune pression concédée.",
                             "Zéro pression concédée, la ligne a fait le boulot."], *key)
    else:
        tg = {}
        for rep in reps:
            t = rep["_opp"].get("target")
            if t and rep["passResult"] == "C":
                c = tg.setdefault(t, [0, 0])
                c[0] += 1
                c[1] += rep["playResult"] or 0
        if tg:
            pid = max(tg, key=lambda k: (tg[k][1], k))
            m = players_meta.get(pid)
            if m and tg[pid][1] >= 10:
                opp_line = pick([f"{last_name(m['name'])}, numéro {m['jersey']}, nous fait mal : {tg[pid][0]} {pl(tg[pid][0], 'réception')} pour {yd(tg[pid][1], 0)}.",
                                 f"Il faut mieux encadrer {who_num(m)}, {yd(tg[pid][1], 0)} pris sur la série.",
                                 f"Priorité sur {who_num(m)} : {tg[pid][0]} {pl(tg[pid][0], 'ballon attrapé', 'ballons attrapés')} pour {yd(tg[pid][1], 0)}."], *key)
        sacks = sum(1 for rep in reps if rep["passResult"] == "S")
        ints = sum(1 for rep in reps if rep["passResult"] == "IN")
        if opp_line is None and (sacks or ints):
            bits = []
            if sacks:
                bits.append(f"{sacks} {pl(sacks, 'sack')}")
            if ints:
                bits.append(f"{ints} {pl(ints, 'interception')}")
            opp_line = f"Gros travail collectif, {' et '.join(bits)} sur la série."
    if opp_line:
        out.append(opp_line)
    # joueur à aller voir : celui dont la moyenne est la plus basse
    agg = {}
    for rep in reps:
        for pid, rp in rep["players"].items():
            agg.setdefault(pid, []).append(rp)
    if agg:
        pid = min(agg, key=lambda p: (np.mean([x["score"] for x in agg[p]]), p))
        avg = np.mean([x["score"] for x in agg[pid]])
        if avg < ORANGE + 5:
            m = players_meta[pid]
            worst = min(agg[pid], key=lambda x: x["score"])
            out.append(pick([f"Prends {first_name(m['name'])}, numéro {m['jersey']}, deux minutes. Dis-lui : « {worst['feedback']} »",
                             f"Un mot à {m['name']}, numéro {m['jersey']} : « {worst['feedback']} »",
                             f"Va voir {m['name']} et dis-lui : « {worst['feedback']} »"], *key))
    return oral(" ".join(out[:4]))


def coach_summary(ctx: Ctx, side, rplayers, players_meta, key):
    play = ctx.play
    res = ctx.result
    yds = int(play.playResult) if isnum(play.playResult) else 0

    def nm(pid):
        m = players_meta[pid]
        return f"{last_name(m['name'])} ({m['jersey']})"
    if side == "offense":
        head = {"C": f"Complète pour {yd(yds, 0)}", "I": "Passe incomplète", "S": f"Sack, {yd(yds, 0)}",
                "IN": "Interception", "R": f"Scramble pour {yd(yds, 0)}"}.get(res, "Action terminée")
        culprits = [pid for pid, rp in rplayers.items() if rp["role"] == "Pass Block"
                    and any(m["key"] == "pressures_allowed" and m["ok"] is False for m in rp["metrics"])]
        if culprits:
            prot = f"protection percée par {' et '.join(nm(p) for p in culprits[:2])}"
        else:
            prot = pick(["protection propre", "poche solide", "la ligne tient"], *key)
        qb = next((rp for rp in rplayers.values() if rp["role"] == "Pass"), None)
        t = next((m["value"] for m in qb["metrics"] if m["key"] == "throw_time_s"), None) if qb else None
        tt = f", ballon parti en {fr(t)} s" if isnum(t) and ctx.pass_f else ""
        return f"{head}, {prot}{tt}."
    head = {"C": f"Réception concédée pour {yd(yds, 0)}", "I": "Passe incomplète", "S": "Sack obtenu",
            "IN": "Interception", "R": f"Scramble concédé, {yd(yds, 0)}"}.get(res, "Action terminée")
    rushers = [pid for pid, rp in rplayers.items() if rp["role"] == "Pass Rush"
               and any(m["key"] == "pressure" and m["ok"] for m in rp["metrics"])]
    if rushers:
        pr = f"pression de {' et '.join(nm(p) for p in rushers[:2])}"
    elif ctx.pass_f and (ctx.pass_f - ctx.snap) < 25:
        pr = pick(["passe rapide, pas le temps d'arriver", "ballon parti vite, le rush n'a rien pu faire"], *key)
    else:
        pr = pick(["pas de pression sur le QB", "le rush n'arrive pas", "QB tranquille dans sa poche"], *key)
    extra = ""
    if ctx.interceptor and str(ctx.interceptor) in players_meta:
        extra = f", pick de {nm(str(ctx.interceptor))}"
    return f"{head}, {pr}{extra}."


# ----------------------------------------------------------------------------- calibration
# Répartition cible des notes : ~25 % rouge, ~37 % orange, ~38 % vert (par rôle, puis par side).
CAL_RED, CAL_ORANGE = 0.25, 0.62


class Calibrator:
    def __init__(self):
        self.vals = {}

    def add(self, key, v):
        self.vals.setdefault(key, []).append(float(v))

    def freeze(self):
        self.sorted = {k: np.sort(np.array(v)) for k, v in self.vals.items()}

    def __call__(self, key, v):
        a = self.sorted[key]
        p = (np.searchsorted(a, v, "left") + np.searchsorted(a, v, "right")) / 2 / len(a)
        if p < CAL_RED:
            sc = 15 + p / CAL_RED * 29
        elif p < CAL_ORANGE:
            sc = 45 + (p - CAL_RED) / (CAL_ORANGE - CAL_RED) * 24.9
        else:
            sc = 70 + (p - CAL_ORANGE) / (1 - CAL_ORANGE) * 28
        return int(round(clamp(sc, 0, 100)))


# ----------------------------------------------------------------------------- build
def build_game(game, plays, pff, players):
    """Phase 1 : tracking, métriques et scores bruts."""
    gid = int(game.gameId)
    home = game.homeTeamAbbr == TEAM
    opp = game.visitorTeamAbbr if home else game.homeTeamAbbr
    label = f"Semaine {int(game.week)} · {'vs' if home else '@'} {opp}"
    trk = load_tracking(gid)
    gplays = plays[plays.gameId == gid].copy()
    gplays["clk"] = gplays.gameClock.map(clock_s)
    gplays = gplays.sort_values(["quarter", "clk", "playId"], ascending=[True, False, True])
    tplays = dict(tuple(trk.groupby("playId")))
    gpff = dict(tuple(pff[pff.gameId == gid].groupby("playId")))

    players_meta = {}
    jerseys = trk[trk.team != "football"].groupby("nflId").agg(j=("jerseyNumber", "first"), t=("team", "first"))
    for pid, row in jerseys.iterrows():
        pid = int(pid)
        if pid in players.index:
            pos = str(players.loc[pid, "officialPosition"])
            name = str(players.loc[pid, "displayName"])
        else:
            pos, name = "?", f"Joueur {pid}"
        players_meta[str(pid)] = {"id": pid, "name": name, "jersey": nint(row.j), "team": row.t, "position": pos,
                                  "group": GROUP.get(pos, "DB" if row.t != TEAM else "WR"), "ours": row.t == TEAM}

    tracking_out, reps = {}, []
    for play in gplays.itertuples(index=False):
        pid_play = int(play.playId)
        if pid_play not in tplays or pid_play not in gpff:
            continue
        pt = PlayTrack(tplays[pid_play])
        ctx = Ctx(gid, play, pt, gpff[pid_play], players)
        side = "offense" if play.possessionTeam == TEAM else "defense"

        tp = {}
        for p in pt.X:
            arr = []
            for i in range(pt.n):
                x = pt.X[p][i]
                if math.isnan(x):
                    arr.append(None)
                else:
                    o = pt.O[p][i]
                    arr.append([r2(x), r2(pt.Y[p][i]), r2(pt.S[p][i]), r2(o) if isnum(o) else 0])
            tp[str(p)] = arr
        ball = [None if math.isnan(pt.bx[i]) else [r2(pt.bx[i]), r2(pt.by[i])] for i in range(pt.n)]
        tracking_out[str(pid_play)] = {"nFrames": pt.n, "players": tp, "ball": ball}

        events, seen = [], set()
        for f, e in pt.raw_events:
            lab = EVENT_LABELS.get(e)
            if not lab or lab in seen:
                continue
            seen.add(lab)
            events.append({"frame": f, "name": e, "label": lab})
        if "Snap" not in seen:
            events.append({"frame": ctx.snap, "name": "ball_snap", "label": "Snap"})
            events.sort(key=lambda e: e["frame"])

        rplayers = {}
        opp_press = []
        for prow in gpff[pid_play].itertuples(index=False):
            nid = int(prow.nflId)
            meta = players_meta.get(str(nid))
            if not meta or nid not in pt.X:
                continue
            if not meta["ours"]:
                if prow.pff_role == "Pass Rush" and any(isnum(getattr(prow, c)) and getattr(prow, c) > 0
                                                        for c in ("pff_hit", "pff_hurry", "pff_sack")):
                    opp_press.append(str(nid))
                continue
            fn = ROLE_FN.get(prow.pff_role)
            if fn is None:
                continue
            ms, score, info = fn(ctx, nid, meta["group"])
            rplayers[str(nid)] = {
                "role": prow.pff_role,
                "pos": prow.pff_positionLinedUp if isinstance(prow.pff_positionLinedUp, str) else meta["position"],
                "grade": "", "score": 0, "metrics": ms, "feedback": "",
                "_raw": float(clamp(score, 0, 100)), "_info": info,
            }
        fmt = FORMATION_FR.get(play.offenseFormation, str(play.offenseFormation).title()) if isinstance(play.offenseFormation, str) else None
        cov = play.pff_passCoverage if isinstance(play.pff_passCoverage, str) else None
        dn = int(play.down) if isnum(play.down) and play.down > 0 else None
        lab = " · ".join([x for x in [f"{ordinal(dn)} & {int(play.yardsToGo)}" if dn else None, fmt, cov] if x])
        yds = int(play.playResult) if isnum(play.playResult) else 0
        rep = {
            "id": str(pid_play), "playId": pid_play, "index": 0, "drillId": "", "side": side,
            "label": lab, "description": str(play.playDescription), "quarter": int(play.quarter),
            "gameClock": str(play.gameClock), "down": dn, "yardsToGo": nint(play.yardsToGo),
            "formation": play.offenseFormation if isinstance(play.offenseFormation, str) else None,
            "coverage": cov, "passResult": ctx.result, "playResult": yds,
            "losX": round(ctx.los_x, 2), "nFrames": pt.n, "snapFrame": ctx.snap, "endFrame": ctx.end_f,
            "events": events, "grade": "", "score": 0,
            "coachSummary": coach_summary(ctx, side, rplayers, players_meta, (gid, pid_play)),
            "players": rplayers,
            "_poss": play.possessionTeam,
            "_opp": {"pressure": opp_press, "target": str(ctx.target) if ctx.target and side == "defense" else None},
        }
        reps.append(rep)

    session = {"id": str(gid), "team": TEAM, "opponent": opp, "week": int(game.week), "date": game.gameDate,
               "label": label, "players": players_meta, "drills": [], "reps": reps}
    summary = {"id": str(gid), "team": TEAM, "opponent": opp, "home": bool(home), "week": int(game.week),
               "date": game.gameDate, "label": label}
    return session, tracking_out, summary


def rep_raw(rep):
    rp = rep["players"]
    if rp:
        ws = [(x["score"], 2.0 if x["role"] == "Pass" else 1.0) for x in rp.values()]
        sc = sum(s * w for s, w in ws) / sum(w for _, w in ws)
    else:
        sc = 50
    res, yds, togo = rep["passResult"], rep["playResult"], rep["yardsToGo"] or 10
    if rep["side"] == "offense":
        sc += {"C": 8 if yds >= togo else 2, "I": -8, "S": -25, "IN": -30, "R": 0}.get(res, 0)
        sc += clamp(yds, -10, 25) * 0.6
    else:
        sc += {"C": -6 if yds >= togo else 2, "I": 10, "S": 25, "IN": 30, "R": -2}.get(res, 0)
        sc -= clamp(yds, -10, 25) * 0.6
    return sc


def finalize(session, pcal, rcal):
    """Phase 2 : notes calibrées, retours, drills et briefs."""
    gid = int(session["id"])
    reps, players_meta = session["reps"], session["players"]
    for rep in reps:
        for nid, rp in rep["players"].items():
            rp["score"] = pcal(rp["role"], rp["_raw"])
            rp["grade"] = grade_of(rp["score"])
            info = rp.pop("_info")
            info["lenient"] = rp["grade"] == "green"
            rp["feedback"] = oral(feedback(rp["role"], info, (gid, rep["playId"], nid)))
            del rp["_raw"]
        sc = rcal((session["id"], rep["side"]), rep.pop("_raw"))
        res = rep["passResult"]
        if rep["side"] == "offense" and res in ("S", "IN"):
            sc = min(sc, 40)
        if rep["side"] == "defense" and res in ("S", "IN"):
            sc = max(sc, 75)
        rep["score"], rep["grade"] = sc, grade_of(sc)

    drills = []
    for i, r in enumerate(reps, 1):
        r["index"] = i
        if not drills or drills[-1]["_poss"] != r["_poss"] or drills[-1]["quarter"] != r["quarter"]:
            k = len(drills) + 1
            drills.append({"id": f"d{k}", "index": k, "side": r["side"], "quarter": r["quarter"],
                           "name": f"Drill {k} · {'Attaque' if r['side'] == 'offense' else 'Défense'} · Q{r['quarter']}",
                           "repIds": [], "_poss": r["_poss"], "_reps": []})
        drills[-1]["repIds"].append(r["id"])
        drills[-1]["_reps"].append(r)
        r["drillId"] = drills[-1]["id"]
    for d in drills:
        dreps = d["_reps"]
        d["summary"] = {g: sum(1 for r in dreps if r["grade"] == g) for g in ("green", "orange", "red")}
        nxt = next((x for x in drills if x["index"] > d["index"] and x["side"] == d["side"]), None)
        groups = {}
        for g in ["OL", "QB", "WR", "TE", "RB", "DL", "LB", "DB"]:
            t = group_brief(g, d["side"], dreps, players_meta, (gid, d["id"]))
            if t:
                groups[g] = t
        pbriefs = {}
        for p in sorted({p for r in dreps for p in r["players"]}, key=int):
            rp = [r["players"][p] for r in dreps if p in r["players"]]
            pbriefs[p] = player_brief(p, rp, nxt, d["side"], players_meta[p]["name"], len(dreps))
        d["brief"] = {"coach": coach_brief(d, dreps, players_meta), "groups": groups, "players": pbriefs}
    for d in drills:
        del d["_poss"], d["_reps"]
    for r in reps:
        del r["_poss"], r["_opp"]
    session["drills"] = drills
    return {"nReps": len(reps), "nDrills": len(drills),
            "grades": {g: sum(1 for r in reps if r["grade"] == g) for g in ("green", "orange", "red")}}


def dump(obj, path):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    games, plays, pff, players = load_static()
    built = []
    pcal = Calibrator()
    for game in games.itertuples(index=False):
        session, trk, summary = build_game(game, plays, pff, players)
        dump(trk, OUT / f"tracking_{game.gameId}.json")
        built.append((session, summary))
        for rep in session["reps"]:
            for rp in rep["players"].values():
                pcal.add(rp["role"], rp["_raw"])
    pcal.freeze()
    # notes joueurs calibrées -> score brut de la rep -> calibration par side
    rcal = Calibrator()
    for session, _ in built:
        for rep in session["reps"]:
            for rp in rep["players"].values():
                rp["score"] = pcal(rp["role"], rp["_raw"])
            rep["_raw"] = rep_raw(rep)
            rcal.add((session["id"], rep["side"]), rep["_raw"])
    rcal.freeze()
    sessions = []
    for session, summary in built:
        summary.update(finalize(session, pcal, rcal))
        dump(session, OUT / f"session_{session['id']}.json")
        sessions.append(summary)
        print(f"{summary['label']:<24} {summary['nReps']:>3} reps  {summary['nDrills']:>2} drills  {summary['grades']}")
    dump(sessions, OUT / "sessions.json")
    print(f"OK -> {OUT}")


if __name__ == "__main__":
    main()
