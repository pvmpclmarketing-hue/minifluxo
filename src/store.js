import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve('data/leads.json');
let leads = [];

export async function load() {
  try { leads = JSON.parse(await readFile(file, 'utf8')); } catch { leads = []; }
}

async function persist() {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(leads, null, 2));
}

export async function save(lead) {
  const index = leads.findIndex((item) => item.id === lead.id);
  if (index >= 0) leads[index] = lead;
  else leads.unshift(lead);
  await persist();
  return lead;
}

export function list() { return leads; }
export function findByPhone(phone) { return leads.find((lead) => lead.phone === phone); }
export function findByKieTask(taskId) { return leads.find((lead) => lead.kieTaskId === taskId); }
