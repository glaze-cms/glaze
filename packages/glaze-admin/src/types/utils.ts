/**
 * Adds an optional `className` to a props type, for components that forward styling to their root node.
 * Used bare (`WithClassName`) when a component takes no other DOM props.
 */
export type WithClassName<T = unknown> = T & { className?: string };
