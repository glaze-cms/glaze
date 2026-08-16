import ChevronIcon from '@assets/svg/chevron.svg?react';
import { Collapsible as BaseCollapsible } from '@base-ui/react';
import classNames from 'classnames';

import type { WithClassName } from '@/types';
import type { ReactNode } from 'react';

import './collapsible.css';

/** One row inside the collapsible's panel. */
export interface CollapsibleElement {
	label: string;
	isActive?: boolean;
	onClick: () => void;
}

interface CollapsibleProps extends WithClassName {
	trigger: {
		Icon: ReactNode;
		title: string;
		className?: string;
	};
	panel: {
		className?: string;
		elements: readonly CollapsibleElement[];
		/** Shown in place of the rows when `elements` is empty. */
		emptyLabel?: string;
	};
}

/**
 * A titled, icon-led disclosure holding a list of selectable rows.
 *
 * @param props.trigger - The always-visible header: its icon, title, and optional class.
 * @param props.panel - The disclosed content: the rows and an optional class.
 * @returns The collapsible section.
 */
export function Collapsible({
	className,
	trigger: { Icon, title, className: triggerClassName },
	panel: { className: panelClassName, elements, emptyLabel },
}: CollapsibleProps) {
	return (
		<BaseCollapsible.Root className={classNames('collapsible', className)}>
			<BaseCollapsible.Trigger className={classNames('trigger', triggerClassName)}>
				{Icon}
				<span className="title">{title}</span>
				<ChevronIcon className="chevron" aria-hidden="true" />
			</BaseCollapsible.Trigger>
			<BaseCollapsible.Panel keepMounted className={classNames('panel', panelClassName)}>
				<div className="panel-inner">
					{elements.length === 0 && emptyLabel ? (
						<p className="empty">{emptyLabel}</p>
					) : (
						elements.map((element) => (
							<button
								key={element.label}
								type="button"
								onClick={element.onClick}
								className={classNames('element', { active: element.isActive })}
							>
								{element.label}
							</button>
						))
					)}
				</div>
			</BaseCollapsible.Panel>
		</BaseCollapsible.Root>
	);
}
