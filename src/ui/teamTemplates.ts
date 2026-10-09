/**
 * «Plantillas de equipo»: pick a ready-made team, see who's created and who already here joins,
 * and set it up. The new people get a room of their own beside the office (when there's space)
 * with their desks in it.
 */
import { addDeskInRoom, addRoom, layoutRooms, moveDeskToRoom, SIDES, updateRoom, type Room } from '../sim/layout';
import { ROLES } from '../sim/seed';
import { api, getState, subscribe, worker } from '../sim/store';
import { planTemplate, TEAM_TEMPLATES, templateOf, type TeamTemplate, type TemplatePlan } from '../sim/templates';
import type { TeamId } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';

type Result = { created: string[]; joined: string[]; lead: string };

/** Waits until the browser has these people (so their desks aren't tidied away as nobody's). */
function arrived(ids: string[], ms = 8000): Promise<boolean> {
  const here = () => ids.every((id) => worker(id));
  if (here()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const stop = subscribe(() => {
      if (!here()) return;
      stop();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(here());
    }, ms);
  });
}

/** The team's room: the one with its name, or a new one glued to the office where it fits. */
function teamRoom(t: TeamTemplate): Room | null {
  const have = layoutRooms().find((r) => r.name === t.room);
  if (have) return have;
  for (const r of layoutRooms()) {
    for (const side of SIDES) {
      const room = addRoom(r.id, side);
      if (typeof room === 'string') continue;
      updateRoom(room.id, { name: t.room });
      return room;
    }
  }
  return null;
}

/** Their desks in their room; whatever doesn't fit waits in «Mesas por colocar». */
function placeTeam(t: TeamTemplate, created: string[], joined: string[], moveJoined: boolean): { room: string | null; left: number } {
  const room = teamRoom(t);
  if (!room) return { room: null, left: created.length };
  let left = 0;
  for (const id of created) {
    const w = worker(id);
    if (w && !addDeskInRoom(w.desk, room.id)) left++;
  }
  if (moveJoined) for (const id of joined) {
    const w = worker(id);
    if (w && w.desk >= 0) moveDeskToRoom(w.desk, room.id);
  }
  return { room: room.name, left };
}

export function openTemplateDialog(): void {
  const d = document.getElementById('task-dialog') as HTMLDialogElement;
  let chosen: TeamId | null = null;
  let plan: TemplatePlan | null = null;
  /** People the plan would bring in that you've unticked. */
  const skip = new Set<string>();
  let profiles = true;
  let room = true;
  let busy = false;
  let problem = '';
  let done: { text: string; note: string } | null = null;

  const name = (id: string) => esc(worker(id)?.name ?? '¿?');
  const card = (t: TeamTemplate) => {
    const on = chosen === t.id;
    return `
      <button class="tpl${on ? ' is-chosen' : ''}" type="button" data-tpl="${t.id}" aria-pressed="${on}" style="--role:${ROLES[t.lead.role].color}">
        <span class="tpl-head"><span class="dot" aria-hidden="true"></span><strong>${esc(t.label)}</strong><span class="meta">${1 + t.members.length} puestos</span></span>
        <span class="tpl-about">${esc(t.about)}</span>
      </button>`;
  };

  const seatRow = (title: string, roleColor: string, adopt: string | null, lead: boolean, newName: string) => {
    const keep = adopt && !skip.has(adopt);
    return `
      <li class="tpl-seat" style="--role:${roleColor}">
        <span class="tpl-seat-post"><span class="dot" aria-hidden="true"></span>${esc(title)}${lead ? ' <span class="tpl-lead">dirige</span>' : ''}</span>
        ${
          adopt
            ? `<label class="check tpl-seat-who"><input type="checkbox" data-keep="${adopt}" ${keep ? 'checked' : ''} /> ${keep ? `${name(adopt)} <span class="meta">(ya está, se incorpora)</span>` : `<span class="meta">Llega alguien nuevo en vez de ${name(adopt)}</span>`}</label>`
            : `<span class="tpl-seat-who">${esc(newName)} <span class="meta">(nuevo, con su ficha)</span></span>`
        }
      </li>`;
  };

  const preview = () => {
    if (!chosen || !plan) return '<p class="section-note">Elige un equipo para ver quién llega y quién se suma.</p>';
    const t = templateOf(chosen);
    const extras = plan.extras;
    return `
      <section class="tpl-plan" aria-live="polite">
        <h3 class="section-title">Así queda ${esc(t.label)}</h3>
        <ul class="tpl-seats">
          ${seatRow(t.lead.title, ROLES[t.lead.role].color, plan.lead.adopt, true, t.lead.names[0])}
          ${plan.members.map((m) => seatRow(m.slot.title, ROLES[m.slot.role].color, m.adopt, false, m.slot.names[0])).join('')}
        </ul>
        ${
          extras.length
            ? `<p class="section-note">También pasarían a responder a quien dirija el equipo:</p>
               <ul class="tpl-seats">${extras
                 .map((id) => `<li class="tpl-seat"><label class="check tpl-seat-who"><input type="checkbox" data-keep="${id}" ${skip.has(id) ? '' : 'checked'} /> ${name(id)} <span class="meta">${esc(worker(id)?.title ?? '')}</span></label></li>`)
                 .join('')}</ul>`
            : ''
        }
        ${plan.blocked.length ? `<p class="section-note">Se quedan donde están: ${plan.blocked.map((b) => `${name(b.id)} (${esc(b.why)})`).join(', ')}.</p>` : ''}
        <label class="check"><input type="checkbox" data-profiles ${profiles ? 'checked' : ''} /> Dar la ficha del puesto a quien se incorpore sin ficha</label>
        <label class="check"><input type="checkbox" data-room ${room ? 'checked' : ''} /> Montarles su sala «${esc(t.room)}» y llevar allí sus mesas</label>
        <p class="section-note">Los nuevos llegan con su ficha escrita y se sientan directamente, sin entrevista. Los nombres de la plantilla los puedes cambiar después.</p>
      </section>`;
  };

  const render = () => {
    d.innerHTML = `
      <form method="dialog" class="dialog-form tpl-form" novalidate>
        <header class="dialog-head">
          <h2>Plantillas de equipo</h2>
          <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
        </header>
        ${
          done
            ? `<div class="tpl-done" role="status"><p><strong>${esc(done.text)}</strong></p>${done.note ? `<p class="section-note">${esc(done.note)}</p>` : ''}</div>
               <footer class="dialog-foot"><button class="btn btn-primary" type="button" data-close>Listo</button></footer>`
            : `<p class="section-note">Equipos listos: alguien que los dirige y cada puesto con su ficha (qué hace, cómo es, en qué se centra). Valen para cualquier proyecto: lo particular del tuyo lo sacan del dossier.</p>
               <div class="tpl-list">${TEAM_TEMPLATES.map(card).join('')}</div>
               ${preview()}
               ${problem ? `<p class="field-error" role="alert">${esc(problem)}</p>` : ''}
               <footer class="dialog-foot">
                 <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
                 <button class="btn btn-primary" type="submit" ${!chosen || busy ? 'disabled' : ''}>${icon.users(15)}${busy ? 'Montando…' : 'Montar equipo'}</button>
               </footer>`
        }
      </form>`;
  };

  // The plan follows the office while the dialog is open (someone hired or moved meanwhile).
  let planned = '';
  const replan = (force = false) => {
    if (!chosen || busy || done) return;
    const next = planTemplate(getState().workers, chosen);
    const key = JSON.stringify(next) + getState().workers.map((w) => w.name).join();
    if (!force && key === planned) return;
    planned = key;
    plan = next;
    render();
  };
  const stop = subscribe(() => replan());

  const apply = async () => {
    if (!chosen || !plan || busy) return;
    const t = templateOf(chosen);
    const keep = [plan.lead.adopt, ...plan.members.map((m) => m.adopt), ...plan.extras].filter((id): id is string => !!id && !skip.has(id));
    busy = true;
    problem = '';
    render();
    try {
      const r = await api<Result>(`/api/team/templates/${chosen}`, 'POST', { keep, profiles });
      await arrived([...r.created, ...r.joined]);
      const placed = room ? placeTeam(t, r.created, r.joined, true) : { room: null, left: r.created.length };
      const lead = worker(r.lead)?.name ?? 'Su responsable';
      done = {
        text: `${t.label} está en marcha: lo dirige ${lead}${r.created.length ? `, llegan ${r.created.length}` : ''}${r.joined.length ? `, se suman ${r.joined.filter((x) => x !== r.lead).length}` : ''}.`,
        note: !room
          ? r.created.length
            ? 'Sus mesas esperan en «Mesas por colocar» (Editar oficina).'
            : ''
          : placed.room
            ? placed.left
              ? `Su sala «${placed.room}» está montada; ${placed.left} mesa${placed.left === 1 ? '' : 's'} no cabía${placed.left === 1 ? '' : 'n'}: colócala${placed.left === 1 ? '' : 's'} en Editar oficina.`
              : `Tienen su sala «${placed.room}» con sus mesas.`
            : 'No cabía una sala nueva junto a la oficina: coloca sus mesas en Editar oficina (Mesas por colocar).',
      };
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo montar el equipo.';
    }
    busy = false;
    render();
  };

  d.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return d.close();
    const pick = t.closest<HTMLElement>('[data-tpl]');
    if (pick && !busy) {
      chosen = pick.dataset.tpl as TeamId;
      skip.clear();
      problem = '';
      replan(true);
      d.querySelector<HTMLElement>(`[data-tpl="${chosen}"]`)?.focus();
    }
  };
  d.onchange = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.keep) {
      if (t.checked) skip.delete(t.dataset.keep);
      else skip.add(t.dataset.keep);
      render();
      d.querySelector<HTMLElement>(`[data-keep="${t.dataset.keep}"]`)?.focus();
    } else if (t.matches('[data-profiles]')) profiles = t.checked;
    else if (t.matches('[data-room]')) room = t.checked;
  };
  d.onsubmit = (e) => {
    e.preventDefault();
    void apply();
  };
  d.addEventListener(
    'close',
    () => {
      stop();
      d.onclick = d.onchange = d.onsubmit = null;
    },
    { once: true },
  );

  render();
  d.showModal();
  d.querySelector<HTMLElement>('[data-tpl]')?.focus();
}
