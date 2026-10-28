import { describe, expect, it } from 'vitest';
import { collectItems, type Item } from '../../model';
import { IDS, SCENARIO } from '../../../../tests/fixtures/scenario';
import { emptyCache, prunePlanner, rangeCovers, type PlannerEntry } from '../cache';
import {
  applyPatches,
  matchesTarget,
  overrideTargetFor,
  pendingOverride,
  plannerItemKey,
  propagateOverrideId,
  remapNoteId,
  remapUndoNotes,
  type NotePatch,
  type OverridePatch,
} from '../patches';
import { pickPlannerEntry } from '../state';

const CONTEXT = { courses: SCENARIO.courses, userId: IDS.user };

function scenarioItems(): Item[] {
  return collectItems({
    origin: SCENARIO.origin,
    userId: IDS.user,
    courses: SCENARIO.courses,
    groups: SCENARIO.groups,
    colors: SCENARIO.colors,
    plannerItems: SCENARIO.plannerItems,
    assignmentDetails: {},
    undatedAssignments: [],
    overrides: [],
    limited: false,
    allAssignments: [],
    hiddenCourseIds: [],
  });
}

function itemByKey(key: string): Item {
  const item = scenarioItems().find((entry) => entry.key === key);
  if (item === undefined) throw new Error(`No item ${key}`);
  return item;
}

describe('override targets', () => {
  it('uses the assignment for an assignment-backed quiz and discussion', () => {
    expect(overrideTargetFor(itemByKey(`assignment:${IDS.assignments.bioQuiz3Today}`))).toEqual({
      plannableType: 'assignment',
      plannableId: IDS.assignments.bioQuiz3Today,
      assignmentId: IDS.assignments.bioQuiz3Today,
    });
    expect(
      overrideTargetFor(itemByKey(`assignment:${IDS.assignments.historyEquianoDiscussion}`)),
    ).toMatchObject({
      plannableType: 'assignment',
    });
  });

  it('uses the planner type for pages, tasks, checkpoints and peer reviews', () => {
    const key = `sub_assignment:${IDS.subAssignments.historyDebate2ReplyToTopic}`;
    expect(overrideTargetFor(itemByKey(key))).toEqual({
      plannableType: 'sub_assignment',
      plannableId: IDS.subAssignments.historyDebate2ReplyToTopic,
      assignmentId: null,
    });
    expect(
      overrideTargetFor(itemByKey(`planner_note:${IDS.notes.bioStudyGroup}`))?.plannableType,
    ).toBe('planner_note');
    expect(overrideTargetFor(itemByKey(`wiki_page:${IDS.pages.bioChapter7}`))?.plannableType).toBe(
      'wiki_page',
    );
  });

  it('matches listed overrides by assignment id first', () => {
    const quiz = {
      plannableType: 'assignment',
      plannableId: '1012',
      assignmentId: '1012',
    } as const;
    const listed = pendingOverride(
      { plannableType: 'quiz', plannableId: '10012', assignmentId: '1012' },
      { markedComplete: true, dismissed: false },
      '9',
      IDS.user,
    );
    expect(matchesTarget(listed, quiz)).toBe(true);
    const page = { plannableType: 'wiki_page', plannableId: '1501', assignmentId: null } as const;
    expect(
      matchesTarget(
        pendingOverride(page, { markedComplete: true, dismissed: false }, '1', '5'),
        page,
      ),
    ).toBe(true);
    expect(matchesTarget(listed, page)).toBe(false);
  });
});

describe('applying patches', () => {
  const quizKey = `assignment:${IDS.assignments.bioQuiz3Today}`;
  const target = {
    plannableType: 'assignment',
    plannableId: '1012',
    assignmentId: '1012',
  } as const;
  const overridePatch: OverridePatch = {
    kind: 'override',
    id: 1,
    key: quizKey,
    target,
    override: pendingOverride(target, { markedComplete: true, dismissed: false }, '', IDS.user),
    confirmedAt: null,
  };

  it('puts the override on the planner row and at the front of the override list', () => {
    const result = applyPatches(
      { plannerItems: SCENARIO.plannerItems, overrides: SCENARIO.plannerOverrides },
      [overridePatch],
      CONTEXT,
    );
    const row = result.plannerItems.find((item) => plannerItemKey(item) === quizKey);
    expect(row?.planner_override?.marked_complete).toBe(true);
    expect(result.overrides?.[0]).toBe(overridePatch.override);
    expect(result.overrides).toHaveLength(SCENARIO.plannerOverrides.length + 1);
  });

  it('adds, changes and removes custom tasks', () => {
    const add: NotePatch = {
      kind: 'note',
      id: 2,
      noteId: 'pending-2',
      note: {
        id: 'pending-2',
        title: 'New',
        details: null,
        todoDate: '2026-10-29T03:59:00.000Z',
        courseId: '101',
      },
      deleteAt: null,
      confirmedAt: null,
    };
    const remove: NotePatch = { ...add, id: 3, noteId: IDS.notes.bioStudyGroup, note: null };
    const result = applyPatches(
      { plannerItems: SCENARIO.plannerItems, overrides: null },
      [add, remove],
      CONTEXT,
    );

    const added = result.plannerItems.find((item) => item.plannable_id === 'pending-2');
    expect(added).toMatchObject({
      plannable_type: 'planner_note',
      plannable_date: '2026-10-29T03:59:00.000Z',
      plannable: { title: 'New', course_id: '101' },
      context_name: 'BIO 110: Principles of Biology',
    });
    expect(result.plannerItems.some((item) => item.plannable_id === IDS.notes.bioStudyGroup)).toBe(
      false,
    );
    expect(result.overrides).toBeNull();
  });

  it('gives queued writes the id from the first answer and the real id of a new task', () => {
    const second: OverridePatch = { ...overridePatch, id: 4 };
    const patched = propagateOverrideId([overridePatch, second], quizKey, '77');
    expect(patched.map((patch) => (patch.kind === 'override' ? patch.override.id : null))).toEqual([
      '77',
      '77',
    ]);

    const noteTarget = {
      plannableType: 'planner_note',
      plannableId: 'pending-9',
      assignmentId: null,
    } as const;
    const noteDone: OverridePatch = {
      ...overridePatch,
      key: 'planner_note:pending-9',
      target: noteTarget,
      override: pendingOverride(
        noteTarget,
        { markedComplete: true, dismissed: false },
        '',
        IDS.user,
      ),
    };
    const [remapped] = remapNoteId([noteDone], 'pending-9', '8899');
    expect(remapped).toMatchObject({
      key: 'planner_note:8899',
      target: { plannableId: '8899' },
      override: { plannable_id: '8899' },
    });
  });

  it('gives the undo records of a new task its real id', () => {
    const target = {
      plannableType: 'planner_note',
      plannableId: 'pending-9',
      assignmentId: null,
    } as const;
    const other = { plannableType: 'assignment', plannableId: '5', assignmentId: '5' } as const;
    const undos = {
      'undo-1': {
        createdAt: 1,
        info: { kind: 'done' as const, count: 2 },
        record: {
          kind: 'overrides' as const,
          entries: [
            {
              key: 'planner_note:pending-9',
              target,
              previous: { markedComplete: false, dismissed: false },
            },
            {
              key: 'assignment:5',
              target: other,
              previous: { markedComplete: true, dismissed: false },
            },
          ],
        },
      },
      'undo-2': {
        createdAt: 2,
        info: { kind: 'deleted' as const, count: 1 },
        record: { kind: 'delete' as const, patchId: 4 },
      },
    };

    const remapped = remapUndoNotes(undos, 'pending-9', '8899');

    expect(remapped['undo-1']?.record).toEqual({
      kind: 'overrides',
      entries: [
        {
          key: 'planner_note:8899',
          target: { ...target, plannableId: '8899' },
          previous: { markedComplete: false, dismissed: false },
        },
        undos['undo-1'].record.entries[1],
      ],
    });
    expect(remapped['undo-2']).toEqual(undos['undo-2']);
  });
});

describe('planner entries', () => {
  const entry = (
    start: string,
    end: string,
    loadedAt: number,
    usedAt = loadedAt,
  ): PlannerEntry => ({
    range: { start, end },
    items: [],
    loadedAt,
    usedAt,
  });

  it('uses an entry that covers the whole range as complete', () => {
    const week = { start: '2026-10-25T04:00:00.000Z', end: '2026-11-01T03:59:59.999Z' };
    const old = entry('2026-07-07T04:00:00.000Z', '2026-11-01T03:59:59.999Z', 1);
    const newer = entry('2026-07-06T04:00:00.000Z', '2026-11-08T04:59:59.999Z', 2);
    const cache = { ...emptyCache('https://a.edu'), planner: { a: old, b: newer } };
    const wanted = { start: '2026-07-08T04:00:00.000Z', end: '2026-11-01T03:59:59.999Z' };

    expect(pickPlannerEntry(cache, wanted, week)).toEqual({ entry: newer, complete: true });
    expect(rangeCovers(old.range, week)).toBe(true);
  });

  it('else uses the newest entry that covers the week, as not complete', () => {
    const week = { start: '2026-10-25T04:00:00.000Z', end: '2026-11-01T03:59:59.999Z' };
    // From before midnight: it starts a day after the new range.
    const before = entry('2026-07-09T04:00:00.000Z', '2026-11-01T03:59:59.999Z', 1);
    const cache = { ...emptyCache('https://a.edu'), planner: { a: before } };
    const wanted = { start: '2026-07-08T04:00:00.000Z', end: '2026-11-01T03:59:59.999Z' };

    expect(pickPlannerEntry(cache, wanted, week)).toEqual({ entry: before, complete: false });
    expect(
      pickPlannerEntry(cache, wanted, { ...week, end: '2026-11-08T04:59:59.999Z' }),
    ).toBeNull();
  });

  it('keeps the most recently used ranges', () => {
    const planner = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`k${index}`, entry('a', 'b', 0, index)]),
    );
    expect(Object.keys(prunePlanner(planner, 3)).sort()).toEqual(['k7', 'k8', 'k9']);
  });
});
