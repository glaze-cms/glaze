/**
 * Waits for the wall clock to enter a new second.
 *
 * drizzle-kit names migration folders by the second and, given two in the same second, picks the
 * parent by lexical sort of a random suffix. A test that chains several converges against one
 * migration directory keeps them in distinct seconds, or its chain can come out in the wrong order.
 *
 * @returns Resolves once the second has changed.
 */
export async function nextSecond(): Promise<void> {
	const now = Date.now();
	await new Promise((resolve) => setTimeout(resolve, 1000 - (now % 1000) + 5));
}
