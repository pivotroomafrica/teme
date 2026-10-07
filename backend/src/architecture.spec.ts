import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Executable architecture rules, so the module boundaries described in the README cannot erode silently.
 *  1. A module may import another module only through its public `index.ts`.
 *  2. Layers point inward: domain imports no framework layer, application never imports api.
 *  3. Modules form an acyclic graph.
 */
const SRC = resolve(__dirname);
const MODULES = join(SRC, 'modules');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

interface Edge {
  file: string;
  module: string;
  layer: string | null;
  target: string; // absolute path without extension
}

const IMPORT = /(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/g;

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const file of walk(MODULES)) {
    const rel = relative(MODULES, file).split(sep);
    const module = rel[0]!;
    const layer = ['api', 'application', 'domain', 'infrastructure'].includes(rel[1] ?? '')
      ? rel[1]!
      : null;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      out.push({ file, module, layer, target: resolve(file, '..', m[1]!) });
    }
  }
  return out;
}

const ALL = edges();
const where = (e: Edge) => relative(SRC, e.file).split(sep).join('/');

/** [module, path inside module] when the target is under src/modules, else null. */
function inModules(target: string): [string, string[]] | null {
  const rel = relative(MODULES, target);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(sep);
  return [parts[0]!, parts.slice(1)];
}

describe('architecture', () => {
  it('imports other modules only through their public index', () => {
    const violations = ALL.flatMap((e) => {
      const t = inModules(e.target);
      if (!t || t[0] === e.module) return [];
      const [, path] = t;
      const isIndex = path.length === 0 || (path.length === 1 && path[0] === 'index');
      return isIndex ? [] : [`${where(e)} reaches into ${t[0]}/${path.join('/')}`];
    });
    expect(violations).toEqual([]);
  });

  it('keeps domain code free of framework layers and application code free of controllers', () => {
    const violations = ALL.flatMap((e) => {
      const t = inModules(e.target);
      const targetLayer = t?.[0] === e.module ? (t[1][0] ?? null) : null;
      if (
        e.layer === 'domain' &&
        t &&
        t[0] === e.module &&
        targetLayer &&
        targetLayer !== 'domain'
      ) {
        return [`${where(e)} (domain) imports ${targetLayer}`];
      }
      if (e.layer === 'domain' && t && t[0] !== e.module) {
        return [`${where(e)} (domain) imports another module`];
      }
      if (e.layer === 'application' && targetLayer === 'api') {
        return [`${where(e)} (application) imports api`];
      }
      if (
        e.layer === 'infrastructure' &&
        (targetLayer === 'api' || targetLayer === 'application')
      ) {
        return [`${where(e)} (infrastructure) imports ${targetLayer}`];
      }
      return [];
    });
    expect(violations).toEqual([]);
  });

  it('has no dependency cycles between modules', () => {
    const graph = new Map<string, Set<string>>();
    for (const e of ALL) {
      const t = inModules(e.target);
      if (!t || t[0] === e.module) continue;
      (graph.get(e.module) ?? graph.set(e.module, new Set()).get(e.module)!).add(t[0]);
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const cycles: string[] = [];
    const visit = (node: string, path: string[]): void => {
      if (state.get(node) === 'done') return;
      if (state.get(node) === 'visiting') {
        cycles.push([...path.slice(path.indexOf(node)), node].join(' -> '));
        return;
      }
      state.set(node, 'visiting');
      for (const next of graph.get(node) ?? []) visit(next, [...path, node]);
      state.set(node, 'done');
    };
    for (const node of graph.keys()) visit(node, []);
    expect(cycles).toEqual([]);
  });
});
