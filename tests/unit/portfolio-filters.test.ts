import { describe, expect, it } from 'vitest';
import {
  normalizeTeams,
  resultsLine,
  severityMatch,
  teamMatch,
} from '../../src/lib/portfolio-filters-core';
import { en } from '../../src/i18n/en';
import { it as itDict } from '../../src/i18n/it';

describe('portfolio open-alerts filter', () => {
  it('matches, misses or reports an unknown count (-1), never treating unknown as zero', () => {
    expect(severityMatch('', -1, -1)).toBe('match');
    expect(severityMatch('critical', 1, 0)).toBe('match');
    expect(severityMatch('critical', 0, 3)).toBe('miss');
    expect(severityMatch('critical', -1, -1)).toBe('unknown');
    expect(severityMatch('high', 0, 2)).toBe('match');
    expect(severityMatch('high', 1, -1)).toBe('match');
    expect(severityMatch('high', 0, 0)).toBe('miss');
    expect(severityMatch('high', 0, -1)).toBe('unknown');
    expect(severityMatch('high', -1, -1)).toBe('unknown');
  });

  it('appends the projects hidden for unknown counts to the results line, singular and plural', () => {
    const p = en.portfolio;
    expect(resultsLine(p.results, 3, 4, 0, p.unknownHidden)).toBe('3 of 4 projects');
    expect(resultsLine(p.results, 1, 4, 1, p.unknownHidden)).toBe(
      '1 of 4 projects · 1 project with unknown counts not shown',
    );
    expect(resultsLine(p.results, 0, 4, 2, p.unknownHidden)).toBe(
      '0 of 4 projects · 2 projects with unknown counts not shown',
    );
    const q = itDict.portfolio;
    expect(resultsLine(q.results, 1, 4, 1, q.unknownHidden)).toBe(
      '1 di 4 progetti · 1 progetto con conteggi sconosciuti non mostrato',
    );
    expect(resultsLine(q.results, 1, 4, 2, q.unknownHidden)).toBe(
      '1 di 4 progetti · 2 progetti con conteggi sconosciuti non mostrati',
    );
  });
});

describe('portfolio team filter', () => {
  it('normalises link values: trim, lowercase, no empties, de-duplicated, first order kept', () => {
    expect(normalizeTeams([' A ', 'a', '', 'b'])).toEqual(['a', 'b']);
    expect(normalizeTeams(['x'.repeat(150)])).toEqual(['x'.repeat(100)]);
  });

  it('matches any selected team (OR); no selection matches everything', () => {
    expect(teamMatch([], [])).toBe(true);
    expect(teamMatch(['a'], [])).toBe(false);
    expect(teamMatch(['a', 'b'], ['b'])).toBe(true);
    expect(teamMatch(['a'], ['b', 'c'])).toBe(false);
  });

  it('results line counts projects without teams that the team filter hid', () => {
    const p = en.portfolio;
    expect(resultsLine(p.results, 1, 4, 0, p.unknownHidden, 2, p.noTeamsHidden)).toBe(
      '1 of 4 projects · 2 projects without teams not shown',
    );
    expect(resultsLine(p.results, 1, 4, 1, p.unknownHidden, 1, p.noTeamsHidden)).toBe(
      '1 of 4 projects · 1 project with unknown counts not shown · 1 project without teams not shown',
    );
    const q = itDict.portfolio;
    expect(resultsLine(q.results, 1, 4, 0, q.unknownHidden, 1, q.noTeamsHidden)).toBe(
      '1 di 4 progetti · 1 progetto senza team non mostrato',
    );
    expect(resultsLine(p.results, 3, 4, 0, p.unknownHidden)).toBe('3 of 4 projects');
  });
});
