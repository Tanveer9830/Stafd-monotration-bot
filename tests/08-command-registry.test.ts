import { describe, expect, it } from 'vitest';
import { ALL_COMMANDS, ALL_OPERATIONS, COMMAND_MAP, OPERATION_MAP, listRegisteredOperations } from '../src/commands';

const EXPECTED_COUNTS: Record<string, number> = {
  owner: 10,
  admin: 5,
  server: 5,
  staff: 14,
  activity: 3,
  ticket: 18,
  monitor: 5,
  scan: 4,
  review: 5,
  warning: 4,
  appeal: 4,
  leave: 5,
  analytics: 5,
  report: 4,
  integration: 3,
  settings: 3,
  system: 2,
  help: 1,
};

describe('Command operation registry', () => {
  it('registers exactly 100 executable operations with the documented root distribution', () => {
    expect(ALL_OPERATIONS).toHaveLength(100);
    expect(OPERATION_MAP.size).toBe(100);
    expect(new Set(ALL_OPERATIONS.map((op) => `${op.root}:${op.group ?? ''}:${op.sub ?? ''}`)).size).toBe(100);

    const counts: Record<string, number> = {};
    for (const op of ALL_OPERATIONS) counts[op.root] = (counts[op.root] ?? 0) + 1;
    expect(counts).toEqual(EXPECTED_COUNTS);
  });

  it('exposes exactly 18 slash command roots, matching the operation roots', () => {
    expect(ALL_COMMANDS).toHaveLength(18);
    expect(COMMAND_MAP.size).toBe(18);
    const roots = new Set(ALL_OPERATIONS.map((op) => op.root));
    expect([...COMMAND_MAP.keys()].sort()).toEqual([...roots].sort());
  });

  it('has a handler and description for every operation, and no undocumented operation keys', () => {
    for (const op of ALL_OPERATIONS) {
      expect(typeof op.handler, `${op.root}/${op.sub ?? ''} handler`).toBe('function');
      expect(op.description.trim().length, `${op.root}/${op.sub ?? ''} description`).toBeGreaterThan(0);
    }
    const listed = listRegisteredOperations();
    expect(listed).toHaveLength(100);
    expect(listed).toContain('help');
    expect(listed).not.toContain('help help');
    expect(new Set(listed).size).toBe(100);
  });

  it('builds every Discord command payload without an invalid option or description', () => {
    for (const root of ALL_COMMANDS) {
      const json = root.data.toJSON();
      expect(json.name.length).toBeLessThanOrEqual(32);
      expect(json.description.length).toBeLessThanOrEqual(100);
      const walk = (options: Array<Record<string, unknown>> | undefined) => {
        for (const option of options ?? []) {
          expect(String(option.name).length).toBeLessThanOrEqual(32);
          if (typeof option.description === 'string') {
            expect(option.description.length).toBeLessThanOrEqual(100);
          }
          if (Array.isArray(option.options)) walk(option.options as Array<Record<string, unknown>>);
        }
      };
      walk(json.options as Array<Record<string, unknown>> | undefined);
    }
  });

  it('contains no blank or placeholder handlers', () => {
    const source = ALL_OPERATIONS.map((op) => op.handler.toString()).join('\n');
    expect(source).not.toMatch(/TODO|FIXME|not implemented|placeholder/i);
  });
});
