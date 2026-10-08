# Oficina 3D — Product

## Purpose
A local office of AI agents working for the user's own product (web + marketing agency). Team, roles and tasks are shown twice: as an operable panel and as a live 3D office where each worker's state is visible at a glance. Being built in phases; see docs/agentes.md for the agent vision (hierarchy, meetings, memory, connectors, security).

## Users & job
Agency lead / PM supervising a 6-person team: who is doing what, who is blocked, who is pairing with whom, how far the project is. They reassign work, create tasks and unblock people from the panel.

## Capabilities
- Nothing simulated. Four fixed roles come with the office, one each: Dirección (always the head; desk in their own office), Organización (roams the team's desks), Entrevistas (meeting room; welcomes each newcomer in reception and walks them to the meeting room) and Escéptico (patrols outside). Renamable, not removable. You hire everyone else (name, role, title, boss); the Equipo tab is a top-down org chart (drag a card onto another to change boss; max three levels; staff such as the sceptic sit outside the chain). Activity follows facts only: away, idle, working, pairing, blocked; the sceptic patrols outside the building and comes in to the head's desk when called («visiting»). An entrance door (wall item, unique) is the only way in: people arriving or newly hired walk in through it, people leaving walk out and vanish; it swings open when someone is near.
- Eight roles: Dirección, Organización, Cuentas, Investigación, Diseño, Desarrollo, Marketing, Escéptico.
- Tasks: created by you (later by agents), left unassigned for the Organizer to hand out once agents run on AI (phase 3); you can always assign or correct them by hand. Progress only moves when someone reports it.
- Real local clock (no speed-up). A «Trabajar» switch opens/closes the office; each worker has its own «Viene a trabajar» switch. Away workers leave the scene.
- Real sun: light through the windows follows the sun's position for the office's location (Ajustes; guessed from the time zone), with dusk, night lamps and moonlight. The panel theme is separate.
- Create / edit / reassign / delete tasks, set pairing, block / unblock.
- Ajustes: General (office, location), IA (default text provider and model: Claude, Groq or local Ollama; Anthropic and Groq keys; image provider/key) and Conectores (MCP library from reviewed presets with pinned versions, or custom). Each agent's detail has an IA section (provider, shared or own key, model, connectors).
- Ajustes → Proyecto: connects the user's real project (this computer, a server over SSH, or HTTPS) through oficina-link (link/oficina-link.mjs), live. The project opts in with its own `oficina.link.json` manifest; the tab gives everything to paste (manifest, link file with its SHA-256, server variable, and a prompt for the project's coding AI). Read-only by default, with per-permission switches; writing (proposals you approve in «Para ti», or direct with the project's name typed) needs both the manifest and you, and is warned against. Access log, live saves, diff, apply/discard/undo.
- Activity feed + KPIs (done today, in progress, blocked, project %). Office name and product are set in Ajustes.
- Appearance editor per worker (skin, hairstyle and colour, facial hair, headwear, glasses, clothes and colours) with a live 3D preview. Default figure is a Totoro (user-supplied GLB, optimized into public/models/totoro.glb) whose leaf takes the role colour; the customizable vinyl-toy figure is the alternative.
- Office editor (topbar «Editar oficina»): rooms and every object are layout data (src/sim/layout.ts, saved apart from the simulation). The office is built from rectangular rooms that must join (a doorway opens automatically in each shared wall); default is a 9 × 9 m team room, a 4 m reception with the entrance, then a 6 × 5 m meeting room above the head's 5 × 4 m office, all with their front and back edges in line. Desks: only the head's comes with the layout; each new agent's desk waits under «Mesas por colocar» in the editor (its owner waits in reception), goes to the next default spot (two columns of three in the team room) when placed, and leaves with them. Restoring the layout keeps the agents' desks on those default spots. Ceiling light (no visible fixtures) fades in from sunset. Rooms resize from grips on each side (0.5 m steps or whole parcels), get added with «＋ Sala» on a free side, and each has its own floor and wall finish. Objects drag on a 25 cm grid, turn, duplicate, remove, add from a picture catalogue, undo, restore; placement refuses overlaps, leaving a room and blocking doorways; walking routes are A* through doorways. Windows are wall objects on any outside wall, sharing one design (slider or door window + frame colour); daylight falls through each at the sun's angle. The camera orbits 360° (walls facing it drop away, partitions drop to half height), right-drag slides the view within limits and it glides back. User models: iMac, bird-of-paradise plants, wicker basket, bush, desk plant, Ogi M / Ogi Y desks, Renya / Sava / Roundish chairs, windows (public/models). Desks, chair packs and windows each have one shared style; pickers show rendered thumbnails of the real models.

## Constraints
- Local-first: a Node server (server/, loopback only, Host/Origin checks, per-start token) owns the state in SQLite in the user's data directory, outside the repo. The browser syncs over one WebSocket. The office layout still lives in localStorage.
- Secrets (API keys, tokens) live in an encrypted vault (AES-256-GCM, key in the OS keychain). The browser can set or delete them but never read them. Sharing the code or a build must never leak data.
- Project link: the link alone touches the project and enforces the manifest (paths, always-blocked secrets and folders, no symlinks, git-ignored files invisible, no commands, protected build/CI files, secrets masked, files with secrets never written, optimistic lock on writes). The office pins the manifest's hash and stops on any change until re-approved. SSH needs a known host key; HTTPS keeps only the token's hash on the server, refuses browsers (Origin) and plain http off loopback.
- Language: Spanish UI copy.
- Accessible without the 3D view: every 3D action has a panel equivalent.

## Platform
web

## Stack
Vite + TypeScript + three.js (vanilla). Chosen by user. Server: Node 22 (tsx), node:sqlite, ws, @napi-rs/keyring. `npm run dev` runs both.
