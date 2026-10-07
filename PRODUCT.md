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
- Room editor (topbar «Editar sala»): every object in the office is layout data (src/sim/layout.ts, saved apart from the simulation). Drag on a 25 cm grid, turn, duplicate, remove, add from a catalogue, undo, restore. Placement refuses overlaps and leaving the room; desks keep their worker, and walking routes are A* over the real furniture. User models: iMac set, bird-of-paradise plants, wicker basket, potted bush, desk plant, Ogi M / Ogi Y desks (public/models). «Personalizar mesas» sets one model + top + frame finish for every desk; the default «Clásica» is the original look.

## Constraints
- Local simulation only (localStorage). No backend. Data is fictional.
- Language: Spanish UI copy.
- Accessible without the 3D view: every 3D action has a panel equivalent.

## Platform
web

## Stack
Vite + TypeScript + three.js (vanilla). Chosen by user.
