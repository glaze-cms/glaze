import { expect, test } from '#harness';

import { createTrailId } from './id.ts';

test('ids sort in the order they were handed out, within one millisecond', () => {
	const now = 1_800_000_000_000;
	const ids = Array.from({ length: 50 }, () => createTrailId(now));

	expect(ids.toSorted()).toEqual(ids);
	expect(new Set(ids).size).toBe(ids.length);
});

test('a clock that steps backwards cannot reorder the trail', () => {
	// An NTP correction mid-boot must not make the event that closes a request sort before the event
	// that opened it — that reads as a request nobody ever decided on.
	const first = createTrailId(1_800_000_000_000);
	const afterStepBack = createTrailId(1_700_000_000_000);

	expect([first, afterStepBack].toSorted()).toEqual([first, afterStepBack]);
});

test('ids sort chronologically across milliseconds', () => {
	const earlier = createTrailId(1_900_000_000_000);
	const later = createTrailId(1_900_000_000_001);

	expect([later, earlier].toSorted()).toEqual([earlier, later]);
});
