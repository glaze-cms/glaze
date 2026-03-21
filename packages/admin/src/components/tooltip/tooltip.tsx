import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

/* Types */
import type { ReactElement } from 'react';

/* Styles */
import './tooltip.css';

interface TooltipProps {
	children: ReactElement;
	delay?: number;
	disabled?: boolean;
	label: string;
	shortcut?: string;
	side?: 'top' | 'right' | 'bottom' | 'left';
}

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
