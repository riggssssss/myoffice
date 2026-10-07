# Oficina 3D — Product

## Purpose
Admin dashboard for a small software agency. Team, roles and task assignments are shown twice: as an operable admin panel and as a live isometric 3D office where each worker's state is visible at a glance.

## Users & job
Agency lead / PM supervising a 6-person team: who is doing what, who is blocked, who is pairing with whom, how far the project is. They reassign work, create tasks and unblock people from the panel.

## Capabilities
- 6 workers with role, current task, activity (working, pairing, meeting, coffee, blocked, idle, reviewing).
- Simulated clock (09:00–18:00) with speed control; progress advances automatically.
- Create / edit / reassign tasks, set pairing, block / unblock. State persists locally.
- Activity feed + KPIs (done today, in progress, blocked, project %).
- Appearance editor per worker (skin, hairstyle and colour, facial hair, headwear, glasses, clothes and colours) with a live 3D preview. Default figure is a Totoro (user-supplied GLB, optimized into public/models/totoro.glb) whose leaf takes the role colour; the customizable vinyl-toy figure is the alternative.
- Office editor (topbar «Editar oficina»): rooms and every object are layout data (src/sim/layout.ts, saved apart from the simulation). The office is built from rectangular rooms that must join (a doorway opens automatically in each shared wall); default is two 9 × 9 m parcels, team room + meeting room. Rooms resize from grips on each side (0.5 m steps or whole parcels), get added with «＋ Sala» on a free side, and each has its own floor and wall finish. Objects drag on a 25 cm grid, turn, duplicate, remove, add from a picture catalogue, undo, restore; placement refuses overlaps, leaving a room and blocking doorways; walking routes are A* through doorways. Windows are wall objects on any outside wall, sharing one design (slider or door window + frame colour); daylight falls through each at the sun's angle. The camera orbits 360° (walls facing it drop away, partitions drop to half height), right-drag slides the view within limits and it glides back. User models: iMac, bird-of-paradise plants, wicker basket, bush, desk plant, Ogi M / Ogi Y desks, Renya / Sava / Roundish chairs, windows (public/models). Desks, chair packs and windows each have one shared style; pickers show rendered thumbnails of the real models.

## Constraints
- Local simulation only (localStorage). No backend. Data is fictional.
- Language: Spanish UI copy.
- Accessible without the 3D view: every 3D action has a panel equivalent.

## Platform
web

## Stack
Vite + TypeScript + three.js (vanilla). Chosen by user.
