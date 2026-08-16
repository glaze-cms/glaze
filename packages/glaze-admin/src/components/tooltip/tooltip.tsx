import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

import type { ReactElement } from 'react';

import './tooltip.css';

interface TooltipProps {
	children: ReactElement;
	delay?: number;
	disabled?: boolean;
	label: string;
	shortcut?: string;
	side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Wraps a trigger element in a tooltip, optionally showing a keyboard shortcut badge.
 *
 * @param props.children - The trigger. Must forward a ref and spread props (Base UI renders through it).
 * @param props.delay - Milliseconds before the tooltip opens.
 * @param props.disabled - Suppress the tooltip without unmounting the trigger.
 * @param props.label - The tooltip text.
 * @param props.shortcut - Optional shortcut badge, e.g. `'⌘B'`.
 * @param props.side - Which side of the trigger to open on.
 * @returns The trigger, wired to its tooltip.
 */
export function Tooltip({
	label,
	shortcut,
	side = 'right',
	delay = 400,
	disabled,
	children,
}: TooltipProps) {
	return (
		<BaseTooltip.Provider delay={delay}>
			<BaseTooltip.Root disabled={disabled}>
				<BaseTooltip.Trigger render={children} />
				<BaseTooltip.Portal>
					<BaseTooltip.Positioner side={side}>
						<BaseTooltip.Popup className="tooltip-popup">
							{label}
							{shortcut && <span className="tooltip-shortcut">{shortcut}</span>}
						</BaseTooltip.Popup>
					</BaseTooltip.Positioner>
				</BaseTooltip.Portal>
			</BaseTooltip.Root>
		</BaseTooltip.Provider>
	);
}
