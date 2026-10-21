# Sideline — AWS × NFL

Sideline is a coaching prototype built on the **NFL Big Data Bowl 2023** player-tracking data.
It turns every passing play into a *rep*: it replays the play in 2D or 3D, classifies the routes
that were run, grades each player and writes individual feedback a coach can read out loud
(French text-to-speech) right after the rep.

The demo follows the **Tampa Bay Buccaneers (TB)** through their 8 games of weeks 1–8 of the
2021 season, each one presented as a training session.

## Features

- **Session view**: choose a game, scroll through its reps grouped into drills, and replay each
  play frame by frame (10 frames per second).
- **2D field** and **3D view** (three.js): free orbit camera, Madden-style broadcast camera,
  drone inset view, 3D American football player models.
- **Routes**: offensive routes (Go, Post, Out, Slant…) are classified from the tracking data and
  drawn on the field, with bubbles above the players and a pre-trace mode that narrates each route.
- **Placement**: misplaced players are simulated and flagged with green or red squares on the ground.
- **Grades and feedback**: a green / orange / red grade per player and per rep, a coach summary,
  and a "phone" panel showing the message each player receives.
- **Reports**: KPIs and trends by player, play and drill.
- **Voice**: feedback read in French through the browser's `speechSynthesis` API.

## Running locally

The generated JSON is already committed in `web-react/public/data/`, so you don't need to run the
pipeline first.

```bash
cd web-react
npm install
npm run dev
```

Then open <http://localhost:5173>.

Other scripts:

```bash
npm run build     # type-check and build into web-react/dist
npm run preview   # serve the production build
npm run lint      # oxlint
```

### Refreshing the React app's data

After you change `pipeline/build.py`, regenerate the data and copy it into the React app:

```bash
python3 pipeline/build.py
cp web/data/*.json web-react/public/data/
```

## Data source and credits

- Tracking, play and PFF scouting data: [NFL Big Data Bowl 2023](https://www.kaggle.com/competitions/nfl-big-data-bowl-2023)
  (NFL Next Gen Stats and Pro Football Focus). The dataset only covers **passing plays** from
  weeks 1–8 of the 2021 season, and tracking starts about 0.5 s before the snap.
- 3D models: see `datas/models/`. Check each model's license and credit its author if required.

## Authors

Adrien JACQ, Axel LONDAS, Jules REYNAUD